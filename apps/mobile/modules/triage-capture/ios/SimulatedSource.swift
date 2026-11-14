import AVFoundation
import Foundation
import QuartzCore
import SignalEngine
import UIKit

/// Stands in for the camera on the iOS simulator. Frames come from the engine package's
/// `SyntheticSitting`, are paced in real time on the capture clock, and take the same path as
/// camera frames from there on. Nothing here is a measurement, and no picture of a face is made.
final class SimulatedSource: FrameSource {
  let kind = SittingFile.Source.simulated
  weak var delegate: FrameSourceDelegate?
  var holdsFrameRate = false

  /// Frames are generated a block at a time. At the generator's default 16 breaths per minute
  /// a 60 second block holds a whole number of breaths, so the chest joins without a jump. The
  /// pulse can jump by part of a beat at a join; the engine rejects that one interval.
  private static let blockSeconds = 60.0
  /// Beat-to-beat change of a resting adult (RMSSD of about 42 ms), so a simulated sitting has
  /// variability to report.
  private static let beatIntervalDeviationMs = 30.0
  /// Low enough for single beats to be timed. At the generator's default the engine reports
  /// the rate and withholds RMSSD and SDNN, which would leave that path unseen on the simulator.
  private static let sensorNoise = 0.02
  private static let aspectRatio = 16.0 / 9.0

  private let queue = DispatchQueue(label: "triagecam.capture.simulated", qos: .userInitiated)
  private let lock = NSLock()
  private var timer: DispatchSourceTimer?
  private var rate = 60.0
  private var startedAt = 0.0
  private var block: [FrameRecord] = []
  private var blockIndex = 0
  private var nextFrame = 0
  private var facePresent = false
  private var preview: PreviewSettings?
  private var lastPreviewAt = -Double.infinity
  private var position = CameraPosition.back

  var frameRate: Double { lock.withLock { rate } }

  var camera: CameraPosition { lock.withLock { position } }

  /// There is no session: the preview view draws the test pattern.
  var previewSession: AVCaptureSession? { nil }
  var previewDevice: AVCaptureDevice? { nil }

  /// The generator has one "camera". The choice is kept so the flip control and the mirrored
  /// preview can be exercised on the simulator.
  func switchCamera(to position: CameraPosition) throws {
    lock.withLock { self.position = position }
    CapturePreviewHub.changed()
  }

  func permission() -> PermissionStatus { .granted }

  func requestPermission(_ completion: @escaping (PermissionStatus) -> Void) {
    completion(.granted)
  }

  func start(_ settings: CaptureSettings) throws {
    queue.sync {
      guard timer == nil else { return }
      lock.withLock {
        rate = settings.frameRate
        facePresent = false
        position = settings.camera
      }
      startedAt = CACurrentMediaTime()
      blockIndex = 0
      nextFrame = 0
      block = Self.frames(block: 0, startingAt: startedAt, frameRate: settings.frameRate)
      lastPreviewAt = -.infinity

      let timer = DispatchSource.makeTimerSource(queue: queue)
      timer.schedule(deadline: .now(), repeating: 1 / settings.frameRate, leeway: .milliseconds(1))
      timer.setEventHandler { [weak self] in self?.deliverDueFrames() }
      timer.resume()
      self.timer = timer
    }
    CapturePreviewHub.changed()
  }

  func stop() {
    queue.sync {
      timer?.cancel()
      timer = nil
    }
    lock.withLock {
      preview = nil
      facePresent = false
    }
  }

  private static func frames(block index: Int, startingAt start: Double, frameRate: Double) -> [FrameRecord] {
    var sitting = SyntheticSitting()
    sitting.durationSeconds = blockSeconds
    sitting.frameRate = frameRate
    sitting.startTime = start + Double(index) * blockSeconds
    sitting.seed = UInt64(index + 1)
    sitting.beatIntervalDeviationMs = beatIntervalDeviationMs
    sitting.noise = sensorNoise
    // Only the first block starts with the wait for a face.
    if index > 0 { sitting.settleSeconds = 0 }
    var frames = sitting.frames()
    // The generator has no frame before a block's first to measure chest motion against.
    if index > 0, frames.count > 1 { frames[0].chestMotion = frames[1].chestMotion }
    return frames
  }

  /// A timer tick can be late, so every frame whose time has come is delivered, each with the
  /// timestamp it was generated for.
  private func deliverDueFrames() {
    let now = CACurrentMediaTime()
    while true {
      if nextFrame == block.count {
        blockIndex += 1
        nextFrame = 0
        block = Self.frames(block: blockIndex, startingAt: startedAt, frameRate: frameRate)
      }
      let record = block[nextFrame]
      guard record.t <= now else { break }
      nextFrame += 1
      lock.withLock { facePresent = record.facePresent }
      delegate?.frameSource(self, didProduce: record)
    }
    encodePreviewIfDue(at: now)
  }

  func outlines() -> FaceOutlines {
    let present = lock.withLock { facePresent }
    return FaceOutlines(aspectRatio: Self.aspectRatio, regions: present ? Self.regions : nil)
  }

  /// A seated adult about 0.75 m from the camera, drawn once and never moved.
  private static let regions = FaceRegions(
    face: CGRect(x: 0.41, y: 0.14, width: 0.18, height: 0.40),
    forehead: [
      CGPoint(x: 0.435, y: 0.235), CGPoint(x: 0.470, y: 0.225), CGPoint(x: 0.530, y: 0.225),
      CGPoint(x: 0.565, y: 0.235), CGPoint(x: 0.555, y: 0.160), CGPoint(x: 0.445, y: 0.160),
    ],
    leftCheek: [
      CGPoint(x: 0.428, y: 0.335), CGPoint(x: 0.474, y: 0.335), CGPoint(x: 0.474, y: 0.420), CGPoint(x: 0.428, y: 0.420),
    ],
    rightCheek: [
      CGPoint(x: 0.526, y: 0.335), CGPoint(x: 0.572, y: 0.335), CGPoint(x: 0.572, y: 0.420), CGPoint(x: 0.526, y: 0.420),
    ],
    chest: CGRect(x: 0.34, y: 0.68, width: 0.32, height: 0.24)
  )

  // MARK: Live view and face crop

  func setPreview(_ settings: PreviewSettings?) {
    lock.withLock { preview = settings }
  }

  private func encodePreviewIfDue(at now: Double) {
    guard let settings = lock.withLock({ preview }), now - lastPreviewAt >= 1 / settings.framesPerSecond else { return }
    lastPreviewAt = now
    let elapsed = now - startedAt
    let long = settings.maxLongSide
    let size = CGSize(width: long, height: (long / Self.aspectRatio).rounded())
    DispatchQueue.global(qos: .utility).async { [weak self] in
      guard let self, let image = TestPattern.jpeg(size: size, elapsed: elapsed, quality: settings.quality) else { return }
      self.delegate?.frameSource(self, didEncodePreview: image)
    }
  }

  func captureFaceCrop(_ completion: @escaping (Result<EncodedImage, CaptureError>) -> Void) {
    guard lock.withLock({ facePresent }) else {
      completion(.failure(CaptureError(.noFace, "No face is being tracked")))
      return
    }
    DispatchQueue.global(qos: .utility).async {
      let image = TestPattern.jpeg(size: CGSize(width: 256, height: 256), elapsed: nil, quality: 0.85)
      completion(image.map { .success($0) } ?? .failure(CaptureError(.noFace, "The test pattern could not be drawn")))
    }
  }
}

/// The picture the simulated source sends where a camera frame would go: grey bars, a label,
/// and a marker that moves with time so a viewer can tell the stream is live.
enum TestPattern {
  private static let greys: [CGFloat] = [0.16, 0.24, 0.32, 0.40, 0.48, 0.56]

  static func jpeg(size: CGSize, elapsed: Double?, quality: Double) -> EncodedImage? {
    guard let data = image(size: size, elapsed: elapsed).jpegData(compressionQuality: quality) else { return nil }
    return EncodedImage(jpeg: data, width: Int(size.width), height: Int(size.height))
  }

  /// `elapsed` nil leaves the moving marker out: a still, for the face crop and the on-phone preview.
  static func image(size: CGSize, elapsed: Double?) -> UIImage {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    return UIGraphicsImageRenderer(size: size, format: format).image { context in
      let barWidth = size.width / CGFloat(greys.count)
      for (index, grey) in greys.enumerated() {
        UIColor(white: grey, alpha: 1).setFill()
        context.fill(CGRect(x: CGFloat(index) * barWidth, y: 0, width: barWidth + 1, height: size.height))
      }

      let label = "Simulated source" as NSString
      let attributes: [NSAttributedString.Key: Any] = [
        .font: UIFont.monospacedSystemFont(ofSize: max(11, size.height / 14), weight: .medium),
        .foregroundColor: UIColor.white,
      ]
      let labelSize = label.size(withAttributes: attributes)
      label.draw(at: CGPoint(x: (size.width - labelSize.width) / 2, y: (size.height - labelSize.height) / 2), withAttributes: attributes)

      guard let elapsed else { return }
      // Crosses the frame once every ten seconds.
      let position = CGFloat(elapsed.truncatingRemainder(dividingBy: 10) / 10) * size.width
      UIColor.white.setFill()
      context.fill(CGRect(x: position, y: size.height - 6, width: max(4, size.width / 40), height: 6))
    }
  }
}
