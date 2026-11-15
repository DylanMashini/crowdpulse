import CoreVideo
import Foundation
import SignalEngine
import Vision

// Reads raw NV12 frames (full range, BT.709) on stdin and writes a sitting file.
//
//   ffmpeg -i video ... -f rawvideo - | video-to-sitting --width W --height H --fps F --out x.jsonl
//
// --mode face   Vision landmarks and the phone's RegionGeometry, RegionSampler and smoothing.
// --mode patch  The video is already a crop of skin: the whole frame is every region.
// --timestamps  A file with one capture time per frame, in seconds. Without it, frame n is at n / fps.

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}

var width = 0, height = 0, fps = 0.0, outPath = "", mode = "face", note: String?, timestampsPath: String?
var arguments = CommandLine.arguments.dropFirst().makeIterator()
while let flag = arguments.next() {
  guard let value = arguments.next() else { fail("\(flag) needs a value") }
  switch flag {
  case "--width": width = Int(value) ?? 0
  case "--height": height = Int(value) ?? 0
  case "--fps": fps = Double(value) ?? 0
  case "--out": outPath = value
  case "--mode": mode = value
  case "--note": note = value
  case "--timestamps": timestampsPath = value
  default: fail("unknown option \(flag)")
  }
}
guard width > 0, height > 0, width % 2 == 0, height % 2 == 0, fps > 0, !outPath.isEmpty, ["face", "patch"].contains(mode)
else { fail("usage: video-to-sitting --width W --height H --fps F --out file.jsonl [--mode face|patch] [--timestamps file] [--note text]") }

/// The phone's FaceTracker, run in step with the frames instead of on its own queue.
/// The constants are FaceTracker's; keep them the same.
struct Tracker {
  static let minInterval = 1.0 / 15
  static let lostAfter = 0.5
  static let smoothing = 0.15
  static let maxJump: CGFloat = 0.6
  static let maxScaleChange: CGFloat = 1.6

  var regions: FaceRegions?
  var id = 0
  var updatedAt = -Double.infinity
  var lastDetection = -Double.infinity

  mutating func feed(_ buffer: CVPixelBuffer, at t: Double) {
    guard t - lastDetection >= Self.minInterval - 1e-9 else { return }
    lastDetection = t
    guard let detected = Self.detect(in: buffer) else { return }
    if let current = regions, t - updatedAt <= Self.lostAfter, Self.sameFace(current.face, detected.face) {
      let amount = 1 - exp(-(t - updatedAt) / Self.smoothing)
      regions = current.moved(toward: detected, by: CGFloat(amount))
    } else {
      regions = detected
      id += 1
    }
    updatedAt = t
  }

  func current(at t: Double) -> FaceRegions? {
    t - updatedAt <= Self.lostAfter ? regions : nil
  }

  static func detect(in buffer: CVPixelBuffer) -> FaceRegions? {
    let request = VNDetectFaceLandmarksRequest()
    let handler = VNImageRequestHandler(cvPixelBuffer: buffer, orientation: .up, options: [:])
    guard (try? handler.perform([request])) != nil, let faces = request.results, !faces.isEmpty else { return nil }
    let size = CGSize(width: CVPixelBufferGetWidth(buffer), height: CVPixelBufferGetHeight(buffer))
    let largest = faces.max { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height }
    return largest.flatMap { RegionGeometry.regions(for: $0, imageSize: size) }
  }

  static func sameFace(_ a: CGRect, _ b: CGRect) -> Bool {
    let jump = hypot(a.midX - b.midX, a.midY - b.midY)
    let scale = max(a.width, b.width) / max(min(a.width, b.width), .leastNonzeroMagnitude)
    return jump <= maxJump * max(a.width, b.width) && scale <= maxScaleChange
  }
}

var pixelBuffer: CVPixelBuffer?
let attributes = [kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary] as CFDictionary
guard
  CVPixelBufferCreate(nil, width, height, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange, attributes, &pixelBuffer)
    == kCVReturnSuccess, let buffer = pixelBuffer
else { fail("cannot create a pixel buffer") }
CVBufferSetAttachment(buffer, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)

let frameBytes = width * height * 3 / 2
let input = FileHandle.standardInput

/// One whole frame from stdin, or nil at the end of the stream.
func readFrame() -> Data? {
  var frame = Data(capacity: frameBytes)
  while frame.count < frameBytes {
    guard let chunk = try? input.read(upToCount: frameBytes - frame.count), !chunk.isEmpty else { return nil }
    frame.append(chunk)
  }
  return frame
}

func load(_ frame: Data, into buffer: CVPixelBuffer) {
  CVPixelBufferLockBaseAddress(buffer, [])
  defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
  frame.withUnsafeBytes { source in
    var offset = 0
    for plane in 0..<2 {
      let rows = plane == 0 ? height : height / 2
      let stride = CVPixelBufferGetBytesPerRowOfPlane(buffer, plane)
      let destination = CVPixelBufferGetBaseAddressOfPlane(buffer, plane)!
      for row in 0..<rows {
        memcpy(destination + row * stride, source.baseAddress! + offset, width)
        offset += width
      }
    }
  }
}

let header = SittingFile.Header(
  sittingId: nil, source: .camera, nominalFrameRate: fps,
  startedAt: "1970-01-01T00:00:00.000Z", captureStart: 0, note: note)
let writer: SittingFileWriter
do { writer = try SittingFileWriter(url: URL(fileURLWithPath: outPath), header: header) } catch { fail("cannot write \(outPath): \(error)") }

var timestamps: [Double]?
if let timestampsPath {
  guard let text = try? String(contentsOfFile: timestampsPath, encoding: .utf8) else { fail("cannot read \(timestampsPath)") }
  timestamps = text.split(whereSeparator: \.isNewline).compactMap { Double($0) }
}

let wholeFrame = [CGPoint(x: 0, y: 0), CGPoint(x: 1, y: 0), CGPoint(x: 1, y: 1), CGPoint(x: 0, y: 1)]
let sampler = RegionSampler()
var tracker = Tracker()
var frames = 0, faceFrames = 0

while let frame = readFrame() {
  if let timestamps, frames >= timestamps.count { break }
  let t = timestamps?[frames] ?? Double(frames) / fps
  load(frame, into: buffer)

  var polygons: (forehead: [CGPoint], left: [CGPoint], right: [CGPoint])?
  var trackId: Int?
  if mode == "patch" {
    polygons = (wholeFrame, wholeFrame, wholeFrame)
    trackId = 1
  } else {
    tracker.feed(buffer, at: t)
    if let regions = tracker.current(at: t) {
      polygons = (regions.forehead, regions.leftCheek, regions.rightCheek)
      trackId = tracker.id
    }
  }

  var record = FrameRecord(t: t, facePresent: false, exposure: .locked, droppedFrames: 0)
  if let polygons {
    let colours = PlanarFrame.withLocked(buffer) { planar -> [RegionColor]? in
      let samples = [polygons.forehead, polygons.left, polygons.right].map { sampler.sample($0, in: planar)?.color }
      return samples.contains { $0 == nil } ? nil : samples.compactMap { $0 }
    }
    if let colours = colours ?? nil {
      record.facePresent = true
      record.forehead = colours[0]
      record.leftCheek = colours[1]
      record.rightCheek = colours[2]
      record.faceTrackId = trackId
      faceFrames += 1
    }
  }
  do { try writer.append(record) } catch { fail("write failed: \(error)") }
  frames += 1
}
do { try writer.close() } catch { fail("close failed: \(error)") }
print("{\"frames\":\(frames),\"faceFrames\":\(faceFrames),\"faceTracks\":\(mode == "patch" ? 1 : tracker.id)}")
