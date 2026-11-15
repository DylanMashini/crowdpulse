import AVFoundation
import CoreImage
import CoreMedia
import CoreVideo
import Foundation
import SignalEngine

/// Why the Mac's camera could not be opened. The raw value goes to the server as the error message.
enum CameraFailure: String, Error {
  case denied = "camera_denied"
  case none = "no_camera"
  case failed = "camera_failed"
}

/// This Mac's own camera, opened here instead of in a browser: uncompressed frames in the
/// camera's pixel format (`420f`), each with the camera's own capture time, at a held 30 a second.
/// Exposure, white balance and focus are frozen after the first second where the camera allows it.
final class Camera: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  /// Seconds of automatic exposure before it is frozen, and a moment more before frames count as locked.
  static let settleSeconds = 1.0
  static let lockedAfterSeconds = 1.3
  static let frameRate = 30.0

  struct Held {
    var exposure = false
    var whiteBalance = false
    var focus = false
  }

  let device: AVCaptureDevice
  private let session = AVCaptureSession()
  private let output = AVCaptureVideoDataOutput()
  private let queue: DispatchQueue
  private let onFrame: (CVPixelBuffer, Double, Int, ExposureState) -> Void
  /// Capture-clock seconds (the host clock) to seconds since 1970, fixed when the camera opens.
  private let wallOffset: Double
  private var firstTime: Double?
  private var lockTried = false

  // Read on `queue` only.
  private(set) var delivered = 0
  private(set) var dropped = 0
  private(set) var held = Held()
  private(set) var width = 0
  private(set) var height = 0
  /// The longest time between two frames since the last `takeLongestGap()`.
  private var longestGap = 0.0
  private var lastTime: Double?

  /// What the camera says it can freeze. Known as soon as it is open.
  var supports: Held {
    Held(
      exposure: device.isExposureModeSupported(.locked),
      whiteBalance: device.isWhiteBalanceModeSupported(.locked),
      focus: device.isFocusModeSupported(.locked))
  }

  /// Blocks until the user has answered the system's camera prompt, the first time.
  static func authorise() throws {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized: return
    case .notDetermined:
      let answered = DispatchSemaphore(value: 0)
      var granted = false
      AVCaptureDevice.requestAccess(for: .video) {
        granted = $0
        answered.signal()
      }
      answered.wait()
      if !granted { throw CameraFailure.denied }
    default: throw CameraFailure.denied
    }
  }

  /// The built-in camera when there is one, never an iPhone offered as a Continuity Camera:
  /// the phone is busy being the film camera.
  static func find() -> AVCaptureDevice? {
    var types: [AVCaptureDevice.DeviceType] = [.builtInWideAngleCamera]
    if #available(macOS 14.0, *) { types.append(.external) } else { types.append(.externalUnknown) }
    let found = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .unspecified).devices
    let usable = found.filter { device in
      if #available(macOS 13.0, *), device.isContinuityCamera { return false }
      return !device.isSuspended
    }
    return usable.first { $0.deviceType == .builtInWideAngleCamera } ?? usable.first
  }

  init(queue: DispatchQueue, onFrame: @escaping (CVPixelBuffer, Double, Int, ExposureState) -> Void) throws {
    try Self.authorise()
    guard let device = Self.find() else { throw CameraFailure.none }
    self.device = device
    self.queue = queue
    self.onFrame = onFrame
    wallOffset = Date().timeIntervalSince1970 - CMClockGetTime(CMClockGetHostTimeClock()).seconds
    super.init()
  }

  /// 1280 x 720 at 30 a second when the camera has it, else the nearest size that runs at 30.
  private func format() -> AVCaptureDevice.Format? {
    let candidates = device.formats.filter { format in
      format.videoSupportedFrameRateRanges.contains { $0.minFrameRate <= Self.frameRate && $0.maxFrameRate >= Self.frameRate }
    }
    func score(_ format: AVCaptureDevice.Format) -> Int {
      let size = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
      let subtype = CMFormatDescriptionGetMediaSubType(format.formatDescription)
      let native = subtype == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange || subtype == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
      return abs(Int(size.width) - 1280) + abs(Int(size.height) - 720) + (native ? 0 : 1)
    }
    return candidates.min { score($0) < score($1) }
  }

  func start() throws {
    session.beginConfiguration()
    guard let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else {
      session.commitConfiguration()
      throw CameraFailure.failed
    }
    session.addInput(input)
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
    // A frame that arrives while the last is still being measured is dropped, and counted.
    output.alwaysDiscardsLateVideoFrames = true
    output.setSampleBufferDelegate(self, queue: queue)
    guard session.canAddOutput(output) else {
      session.commitConfiguration()
      throw CameraFailure.failed
    }
    session.addOutput(output)
    session.commitConfiguration()

    // The format and the rate hold only while the device stays locked across startRunning.
    guard (try? device.lockForConfiguration()) != nil else { throw CameraFailure.failed }
    // A picture that reframes itself moves the face under the regions: Center Stage off where it exists.
    if device.activeFormat.isCenterStageSupported || device.formats.contains(where: { $0.isCenterStageSupported }) {
      AVCaptureDevice.centerStageControlMode = .app
      AVCaptureDevice.isCenterStageEnabled = false
    }
    if let format = format() {
      device.activeFormat = format
      let duration = CMTime(value: 1, timescale: CMTimeScale(Self.frameRate))
      // Held at 30: left alone, the camera slows its frame rate in a dim room.
      device.activeVideoMinFrameDuration = duration
      device.activeVideoMaxFrameDuration = duration
    }
    if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
    if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) { device.whiteBalanceMode = .continuousAutoWhiteBalance }
    session.startRunning()
    device.unlockForConfiguration()
    guard session.isRunning else { throw CameraFailure.failed }
  }

  /// Turns the camera off and gives exposure back to the camera, so the next program finds it as usual.
  func stop() {
    if session.isRunning { session.stopRunning() }
    guard held.exposure || held.whiteBalance || held.focus, (try? device.lockForConfiguration()) != nil else { return }
    if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
    if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) { device.whiteBalanceMode = .continuousAutoWhiteBalance }
    if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
    device.unlockForConfiguration()
  }

  /// Freezes what the camera settled on, as far as it lets a program do that.
  private func hold() {
    guard (try? device.lockForConfiguration()) != nil else { return }
    defer { device.unlockForConfiguration() }
    if device.isExposureModeSupported(.locked) {
      device.exposureMode = .locked
      held.exposure = device.exposureMode == .locked
    }
    if device.isWhiteBalanceModeSupported(.locked) {
      device.whiteBalanceMode = .locked
      held.whiteBalance = device.whiteBalanceMode == .locked
    }
    if device.isFocusModeSupported(.locked) {
      device.focusMode = .locked
      held.focus = device.focusMode == .locked
    }
  }

  func takeLongestGap() -> Double {
    defer { longestGap = 0 }
    return longestGap
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let captured = CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds
    guard captured.isFinite else { return }
    let first = firstTime ?? captured
    firstTime = first
    if let lastTime { longestGap = max(longestGap, captured - lastTime) }
    lastTime = captured
    delivered += 1
    width = CVPixelBufferGetWidth(buffer)
    height = CVPixelBufferGetHeight(buffer)
    if !lockTried, captured - first >= Self.settleSeconds {
      lockTried = true
      hold()
    }
    onFrame(buffer, captured + wallOffset, dropped, captured - first >= Self.lockedAfterSeconds ? .locked : .adjusting)
  }

  func captureOutput(_ output: AVCaptureOutput, didDrop sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    dropped += 1
  }
}

/// The picture for the live view: smaller, lossy and at half the camera's rate. The pulse is
/// never measured on these. One is encoded at a time, off the measuring queue; a frame that
/// comes while one is being encoded is not shown.
final class PreviewEncoder {
  static let longSide = 640.0
  static let quality = 0.6

  private let queue = DispatchQueue(label: "live-sitting.preview", qos: .utility)
  private let free = DispatchSemaphore(value: 1)
  private let context = CIContext(options: [.cacheIntermediates: false])
  private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
  private var count = 0

  /// Every second frame, when the encoder is free. `send` gets the JPEG, its size and the frame's time in ms.
  func offer(_ buffer: CVPixelBuffer, at t: Double, send: @escaping (Data, Int, Int, Double) -> Void) {
    count += 1
    guard count % 2 == 0, free.wait(timeout: .now()) == .success else { return }
    queue.async { [self] in
      defer { free.signal() }
      let image = CIImage(cvPixelBuffer: buffer)
      let scale = min(1, Self.longSide / max(image.extent.width, image.extent.height))
      let scaled = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
      let options = [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): Self.quality]
      guard let jpeg = context.jpegRepresentation(of: scaled, colorSpace: colorSpace, options: options) else { return }
      send(jpeg, Int(scaled.extent.width.rounded()), Int(scaled.extent.height.rounded()), t * 1000)
    }
  }
}
