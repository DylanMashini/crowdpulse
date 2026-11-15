import Accelerate
import CoreVideo
import Foundation
import ImageIO
import SignalEngine
import Vision

// A sitting from frames that arrive as they are taken: the dashboard's own webcam, in place of
// the phone. JPEG frames come in on stdin with their capture times; each is reduced to a frame
// record by the phone's own region code (as video-to-sitting does for a file) and handed to
// the SignalEngine. Outlines, one reading a second and the summary go out on stdout, one JSON
// object per line. The web server starts one of these per webcam (apps/web/src/server/webcam.ts).
//
// stdin, little-endian, one record after another:
//   'F'  Float64 t, UInt32 droppedFrames, UInt32 length, then the JPEG.   t is capture-clock seconds.
//   'S'  UInt32 length, then JSON {"sittingId": "...", "file": "/path.jsonl" or null}.
//        The sitting starts on the next frame.
//   'E'  End the sitting: the summary follows on stdout.
//   'A'  Abandon the sitting: nothing is kept.
//
// stdout:
//   {"type":"frame","t":…,"outlines":{aspectRatio, face, forehead, leftCheek, rightCheek, chest}}
//   {"type":"started","sittingId":…,"captureStart":…}
//   {"type":"reading","sittingId":…,"reading":Reading}          the engine's Reading, unchanged
//   {"type":"summary","sittingId":…,"endedAt":…,"summary":SittingSummary,"file":true|false}
//   {"type":"abandoned"}   {"type":"error","message":…}

/// Seconds after the first frame during which the camera is taken to be finding its exposure.
/// A browser cannot say when a webcam's exposure has settled, so the first frames are not measured on.
let settleSeconds = 1.0
let nominalFrameRate = 30.0

let output = FileHandle.standardOutput
func emit(_ object: [String: Any]) {
  guard var data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return }
  data.append(0x0a)
  output.write(data)
}

func encoded<T: Encodable>(_ value: T) -> Any {
  (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(value))) ?? NSNull()
}

// ---------------------------------------------------------------- JPEG -> the camera's own pixel format

/// Decodes into full-range BT.709 NV12, the format the phone's camera delivers and the region
/// code reads. The buffer is reused while the frame size stays the same.
final class FrameDecoder {
  private var buffer: CVPixelBuffer?
  private var conversion = vImage_ARGBToYpCbCr()

  init() {
    var range = vImage_YpCbCrPixelRange(Yp_bias: 0, CbCr_bias: 128, YpRangeMax: 255, CbCrRangeMax: 255, YpMax: 255, YpMin: 0, CbCrMax: 255, CbCrMin: 0)
    vImageConvert_ARGBToYpCbCr_GenerateConversion(
      kvImage_ARGBToYpCbCrMatrix_ITU_R_709_2, &range, &conversion, kvImageARGB8888, kvImage420Yp8_CbCr8, vImage_Flags(kvImageNoFlags))
  }

  func decode(_ jpeg: Data) -> CVPixelBuffer? {
    guard
      let source = CGImageSourceCreateWithData(jpeg as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { return nil }
    let width = image.width / 2 * 2, height = image.height / 2 * 2
    guard width >= 64, height >= 64, let target = pixelBuffer(width: width, height: height) else { return nil }

    // The picture's own colour space, so the numbers are the ones in the file: no colour management.
    var format = vImage_CGImageFormat(
      bitsPerComponent: 8, bitsPerPixel: 32,
      colorSpace: image.colorSpace.flatMap { $0.model == .rgb ? Unmanaged.passUnretained($0) : nil },
      bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipFirst.rawValue),
      version: 0, decode: nil, renderingIntent: .defaultIntent)
    var argb = vImage_Buffer()
    guard vImageBuffer_InitWithCGImage(&argb, &format, nil, image, vImage_Flags(kvImageNoFlags)) == kvImageNoError else { return nil }
    defer { free(argb.data) }
    argb.width = vImagePixelCount(width)
    argb.height = vImagePixelCount(height)

    CVPixelBufferLockBaseAddress(target, [])
    defer { CVPixelBufferUnlockBaseAddress(target, []) }
    var luma = vImage_Buffer(
      data: CVPixelBufferGetBaseAddressOfPlane(target, 0), height: vImagePixelCount(height), width: vImagePixelCount(width),
      rowBytes: CVPixelBufferGetBytesPerRowOfPlane(target, 0))
    var chroma = vImage_Buffer(
      data: CVPixelBufferGetBaseAddressOfPlane(target, 1), height: vImagePixelCount(height / 2), width: vImagePixelCount(width / 2),
      rowBytes: CVPixelBufferGetBytesPerRowOfPlane(target, 1))
    let order: [UInt8] = [0, 1, 2, 3]
    guard vImageConvert_ARGB8888To420Yp8_CbCr8(&argb, &luma, &chroma, &conversion, order, vImage_Flags(kvImageNoFlags)) == kvImageNoError
    else { return nil }
    return target
  }

  private func pixelBuffer(width: Int, height: Int) -> CVPixelBuffer? {
    if let buffer, CVPixelBufferGetWidth(buffer) == width, CVPixelBufferGetHeight(buffer) == height { return buffer }
    var created: CVPixelBuffer?
    let attributes = [kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary] as CFDictionary
    guard
      CVPixelBufferCreate(nil, width, height, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange, attributes, &created) == kCVReturnSuccess,
      let made = created
    else { return nil }
    CVBufferSetAttachment(made, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)
    buffer = made
    return made
  }
}

// ---------------------------------------------------------------- one sitting

/// The engine, the sitting file and the reading clock: the capture module's SittingSession.
final class Sitting {
  let id: String
  let captureStart: Double
  private let engine: SignalEngine
  private let writer: SittingFileWriter?
  private let fileURL: URL?
  private let droppedBefore: Int
  private(set) var lastFrameTime: Double
  private var frames = 0
  private var readingsEmitted = 0
  private var fileFailed = false

  init(id: String, file: String?, firstFrame: FrameRecord) {
    self.id = id
    captureStart = firstFrame.t
    lastFrameTime = firstFrame.t
    droppedBefore = firstFrame.droppedFrames
    var configuration = EngineConfiguration.default
    configuration.nominalFrameRate = nominalFrameRate
    engine = SignalEngine(configuration: configuration)
    fileURL = file.map { URL(fileURLWithPath: $0) }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    // The capture clock of a webcam frame is the browser's wall clock, in seconds since 1970.
    let header = SittingFile.Header(
      sittingId: id, source: .camera, nominalFrameRate: nominalFrameRate,
      startedAt: formatter.string(from: Date(timeIntervalSince1970: firstFrame.t)), captureStart: firstFrame.t, note: "webcam")
    writer = fileURL.flatMap { try? SittingFileWriter(url: $0, header: header) }
    ingest(firstFrame)
  }

  func ingest(_ frame: FrameRecord) {
    var record = frame
    record.droppedFrames = max(0, frame.droppedFrames - droppedBefore)
    // There is no frame before the sitting's first to measure movement against.
    if frames == 0 { record.chestMotion = nil }
    lastFrameTime = record.t
    frames += 1
    engine.ingest(record)
    guard let writer, !fileFailed else { return }
    do { try writer.append(record) } catch { fileFailed = true }
  }

  /// The next one-second reading if its time has come. `now` runs on between frames, so a
  /// camera that goes quiet still produces readings, and they turn stale.
  func readingIfDue(now: Double) -> Reading? {
    let due = Int(now - captureStart)
    guard due > readingsEmitted else { return nil }
    readingsEmitted = due
    return engine.reading(at: now)
  }

  /// Returns the summary and whether the sitting file is whole.
  func finish() -> (summary: SittingSummary, file: Bool) {
    let summary = engine.finish()
    guard let writer, let fileURL else { return (summary, false) }
    do { try writer.close() } catch { fileFailed = true }
    if fileFailed { try? FileManager.default.removeItem(at: fileURL) }
    return (summary, !fileFailed)
  }

  func abandon() {
    try? writer?.close()
    if let fileURL { try? FileManager.default.removeItem(at: fileURL) }
  }
}

// ---------------------------------------------------------------- frames in, readings out

let decoder = FrameDecoder()
let sampler = RegionSampler()
let chestMotion = ChestMotionEstimator()
var tracker = Tracker()
var firstFrameTime: Double?
var lastFrameTime = -Double.infinity
/// The machine's own clock when the newest frame arrived: between frames, "now" on the capture
/// clock is the newest frame's time plus what has passed here since.
var lastFrameArrival = 0.0
var pendingSitting: (id: String, file: String?)?
var sitting: Sitting?

func uptime() -> Double { Double(DispatchTime.now().uptimeNanoseconds) / 1e9 }

func point(_ point: CGPoint) -> [String: Any] { ["x": Double(point.x), "y": Double(point.y)] }
func rect(_ rect: CGRect) -> [String: Any] {
  ["x": Double(rect.minX), "y": Double(rect.minY), "width": Double(rect.width), "height": Double(rect.height)]
}

func emitReadingIfDue(now: Double) {
  guard let sitting, let reading = sitting.readingIfDue(now: now) else { return }
  emit(["type": "reading", "sittingId": sitting.id, "reading": encoded(reading)])
}

func handleFrame(t: Double, dropped: Int, jpeg: Data) {
  // Out of order or repeated: the engine would ignore it, and the tracker must not see time run back.
  guard t > lastFrameTime else { return }
  guard let buffer = decoder.decode(jpeg) else { return emit(["type": "error", "message": "A frame could not be decoded"]) }
  lastFrameTime = t
  lastFrameArrival = uptime()
  let start = firstFrameTime ?? t
  firstFrameTime = start

  tracker.feed(buffer, at: t)
  let regions = tracker.current(at: t)
  var record = FrameRecord(
    t: t, facePresent: false, exposure: t - start >= settleSeconds ? .locked : .adjusting, droppedFrames: dropped)
  var aspectRatio = 4.0 / 3.0
  let read: Void? = PlanarFrame.withLocked(buffer) { frame in
    aspectRatio = Double(frame.width) / Double(frame.height)
    guard let regions else { return chestMotion.reset() }
    let samples = [regions.forehead, regions.leftCheek, regions.rightCheek].map { sampler.sample($0, in: frame)?.color }
    // All three regions or none, as for dataset video: a face half out of the picture is not measured on.
    if !samples.contains(where: { $0 == nil }) {
      record.facePresent = true
      record.forehead = samples[0]
      record.leftCheek = samples[1]
      record.rightCheek = samples[2]
      record.faceTrackId = tracker.id
      let box = regions.face
      record.face = FaceBox(x: Double(box.minX), y: Double(box.minY), width: Double(box.width), height: Double(box.height))
    }
    record.chestMotion = chestMotion.update(chest: regions.chest, in: frame)
  }
  if read == nil { chestMotion.reset() }

  if let waiting = pendingSitting {
    pendingSitting = nil
    let started = Sitting(id: waiting.id, file: waiting.file, firstFrame: record)
    sitting = started
    emit(["type": "started", "sittingId": started.id, "captureStart": started.captureStart])
  } else {
    sitting?.ingest(record)
  }

  var outlines: [String: Any] = [
    "aspectRatio": aspectRatio, "face": NSNull(), "forehead": NSNull(), "leftCheek": NSNull(), "rightCheek": NSNull(), "chest": NSNull(),
  ]
  if let regions, record.facePresent {
    outlines["face"] = rect(regions.face)
    outlines["forehead"] = regions.forehead.map(point)
    outlines["leftCheek"] = regions.leftCheek.map(point)
    outlines["rightCheek"] = regions.rightCheek.map(point)
    if let chest = regions.chest { outlines["chest"] = rect(chest) }
  }
  emit(["type": "frame", "t": t, "exposureLocked": record.exposure == .locked, "outlines": outlines])
  emitReadingIfDue(now: t)
}

func endSitting(keep: Bool) {
  pendingSitting = nil
  guard let current = sitting else { return emit(keep ? ["type": "error", "message": "No sitting is running"] : ["type": "abandoned"]) }
  sitting = nil
  guard keep else {
    current.abandon()
    return emit(["type": "abandoned"])
  }
  let result = current.finish()
  emit(["type": "summary", "sittingId": current.id, "endedAt": current.lastFrameTime, "summary": encoded(result.summary), "file": result.file])
}

// Everything above runs on this one queue: the engine is not thread-safe.
let work = DispatchQueue(label: "live-sitting")
let ticker = DispatchSource.makeTimerSource(queue: work)
ticker.schedule(deadline: .now() + 0.25, repeating: 0.25)
ticker.setEventHandler {
  guard sitting != nil else { return }
  emitReadingIfDue(now: lastFrameTime + (uptime() - lastFrameArrival))
}
ticker.resume()

let input = FileHandle.standardInput
func read(_ count: Int) -> Data? {
  var data = Data(capacity: count)
  while data.count < count {
    guard let chunk = try? input.read(upToCount: count - data.count), !chunk.isEmpty else { return nil }
    data.append(chunk)
  }
  return data
}
func number<T>(_ data: Data, at offset: Int, as type: T.Type) -> T {
  data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: offset, as: type) }
}
/// A frame or a command larger than this is not one: the stream is out of step.
let maxRecordBytes = 4_000_000

reading: while let kind = read(1)?.first {
  switch kind {
  case UInt8(ascii: "F"):
    guard let header = read(16) else { break reading }
    let t = Double(bitPattern: UInt64(littleEndian: number(header, at: 0, as: UInt64.self)))
    let dropped = Int(UInt32(littleEndian: number(header, at: 8, as: UInt32.self)))
    let length = Int(UInt32(littleEndian: number(header, at: 12, as: UInt32.self)))
    guard length <= maxRecordBytes, let jpeg = read(length) else { break reading }
    work.sync { handleFrame(t: t, dropped: dropped, jpeg: jpeg) }
  case UInt8(ascii: "S"):
    guard let header = read(4) else { break reading }
    let length = Int(UInt32(littleEndian: number(header, at: 0, as: UInt32.self)))
    guard length <= maxRecordBytes, let body = read(length) else { break reading }
    let options = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
    work.sync {
      guard let id = options?["sittingId"] as? String else { return emit(["type": "error", "message": "A sitting needs an id"]) }
      sitting?.abandon()
      sitting = nil
      pendingSitting = (id, options?["file"] as? String)
    }
  case UInt8(ascii: "E"):
    work.sync { endSitting(keep: true) }
  case UInt8(ascii: "A"):
    work.sync { endSitting(keep: false) }
  default:
    emit(["type": "error", "message": "Unknown record on stdin"])
    break reading
  }
}
// The server has gone, or closed the camera: a sitting still running is given up.
work.sync { sitting?.abandon() }
