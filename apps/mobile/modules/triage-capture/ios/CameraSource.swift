import AVFoundation
import Foundation
import SignalEngine

/// The camera: AVFoundation capture reduced to one `FrameRecord` per frame.
///
/// Three queues keep the frame path short. `sessionQueue` configures the session and the
/// device. `captureQueue` receives every frame and does only the per-frame arithmetic (region
/// means and chest motion). Face landmarks run on the tracker's queue and JPEG encoding on the
/// encoder's, each fed at most one buffer at a time.
final class CameraSource: NSObject, FrameSource, AVCaptureVideoDataOutputSampleBufferDelegate {
  let kind = SittingFile.Source.camera
  weak var delegate: FrameSourceDelegate?

  private static let fallbackFrameRate = 30.0
  /// 60 fps counts as sustained while each second delivers at least this share of it.
  private static let sustainedShare = 0.9
  private static let slowSecondsBeforeFallback = 3
  private static let faceCropMaxLongSide = 512.0
  private static let faceCropQuality = 0.85
  /// The crop is the landmark box grown by this share on each side, to take in the whole head.
  private static let faceCropMargin: CGFloat = 0.25

  private let session = AVCaptureSession()
  private let output = AVCaptureVideoDataOutput()
  private let sessionQueue = DispatchQueue(label: "triagecam.capture.session")
  private let captureQueue = DispatchQueue(label: "triagecam.capture.frames", qos: .userInteractive)
  private let tracker = FaceTracker()
  private let encoder = ImageEncoder()

  // Used on the session queue only.
  private var device: AVCaptureDevice?
  private var settings = CaptureSettings()
  private var rotationObservation: NSKeyValueObservation?
  private var rotationCoordinator: AnyObject?
  private var notificationTokens: [NSObjectProtocol] = []

  // Used on the capture queue only.
  private let sampler = RegionSampler()
  private let chestMotion = ChestMotionEstimator()
  private var droppedFrames = 0
  private var secondStartedAt = 0.0
  private var framesThisSecond = 0
  private var slowSeconds = 0
  private var lastPreviewAt = -Double.infinity

  // Shared between queues, behind the lock.
  private let lock = NSLock()
  private var exposure: ExposureController?
  private var currentFrameRate = 60.0
  private var rateHeld = false
  private var rotationAngle: CGFloat = 0
  private var position = CameraPosition.back
  private var activeDevice: AVCaptureDevice?
  private var aspectRatio = 16.0 / 9.0
  private var preview: PreviewSettings?
  private var pendingCrops: [(Result<EncodedImage, CaptureError>) -> Void] = []

  var frameRate: Double { lock.withLock { currentFrameRate } }

  var holdsFrameRate: Bool {
    get { lock.withLock { rateHeld } }
    set { lock.withLock { rateHeld = newValue } }
  }

  var camera: CameraPosition { lock.withLock { position } }

  var previewSession: AVCaptureSession? { session }

  var previewDevice: AVCaptureDevice? { lock.withLock { activeDevice } }

  // MARK: Permission

  func permission() -> PermissionStatus {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized: return .granted
    case .notDetermined: return .undetermined
    default: return .denied
    }
  }

  func requestPermission(_ completion: @escaping (PermissionStatus) -> Void) {
    AVCaptureDevice.requestAccess(for: .video) { granted in
      completion(granted ? .granted : .denied)
    }
  }

  // MARK: Start and stop

  func start(_ settings: CaptureSettings) throws {
    guard permission() == .granted else {
      throw CaptureError(.cameraPermission, "Camera access has not been granted")
    }
    try sessionQueue.sync {
      if session.isRunning { return }
      try configure(settings, restartsCounters: true)
      session.startRunning()
      guard session.isRunning else {
        throw CaptureError(.cameraUnavailable, "The camera did not start")
      }
      adoptRunningFrameRate()
    }
    CapturePreviewHub.changed()
  }

  /// Swaps the input of the running session. The frame clock, the dropped-frame count and a
  /// running sitting carry on; the face is found again on the new camera under a new track id,
  /// and exposure is metered afresh.
  func switchCamera(to position: CameraPosition) throws {
    try sessionQueue.sync {
      guard session.isRunning, position != camera else { return }
      var next = settings
      next.camera = position
      let previous = settings
      do {
        try configure(next, restartsCounters: false)
      } catch {
        // Put the camera that was working back, so a phone without the other one keeps going.
        try? configure(previous, restartsCounters: false)
        throw error
      }
      adoptRunningFrameRate()
    }
    tracker.reset()
    CapturePreviewHub.changed()
  }

  func stop() {
    sessionQueue.sync {
      session.stopRunning()
      rotationObservation = nil
      rotationCoordinator = nil
      notificationTokens.forEach(NotificationCenter.default.removeObserver)
      notificationTokens = []
    }
    tracker.reset()
    let waiting = lock.withLock { () -> [(Result<EncodedImage, CaptureError>) -> Void] in
      defer { pendingCrops = [] }
      preview = nil
      return pendingCrops
    }
    waiting.forEach { $0(.failure(CaptureError(.notCapturing, "Capture stopped"))) }
  }

  /// Runs on the session queue. `restartsCounters` is false when the camera changes under a
  /// running capture, where the dropped-frame count must not go back to zero.
  private func configure(_ settings: CaptureSettings, restartsCounters: Bool) throws {
    let position: AVCaptureDevice.Position = settings.camera == .front ? .front : .back
    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position) else {
      throw CaptureError(.cameraUnavailable, "This device has no \(settings.camera.rawValue) camera")
    }
    guard let (format, rate) = Self.format(for: device, wanted: settings.frameRate) else {
      throw CaptureError(.cameraUnavailable, "The camera has no 4:2:0 video format")
    }

    do {
      try device.lockForConfiguration()
    } catch {
      throw CaptureError(.cameraUnavailable, "The camera is in use elsewhere")
    }
    // Declared before the commit below so that it runs after it: the format and frame
    // durations are applied at the commit, and a session that finds the device unlocked there
    // may put its own choice back.
    defer { device.unlockForConfiguration() }

    session.beginConfiguration()
    defer { session.commitConfiguration() }
    session.inputs.forEach(session.removeInput)
    session.outputs.forEach(session.removeOutput)
    // Wide colour would change what the 8-bit channel values mean from one device to the next.
    session.automaticallyConfiguresCaptureDeviceForWideColor = false

    guard let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else {
      throw CaptureError(.cameraUnavailable, "The camera could not be opened")
    }
    session.addInput(input)
    // The default preset (.high) picks the format itself and would replace the one set below.
    guard session.canSetSessionPreset(.inputPriority) else {
      throw CaptureError(.cameraUnavailable, "The camera does not accept a chosen video format")
    }
    session.sessionPreset = .inputPriority

    output.videoSettings = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
    ]
    // A late frame is dropped and counted, never queued: the engine works from timestamps.
    output.alwaysDiscardsLateVideoFrames = true
    output.setSampleBufferDelegate(self, queue: captureQueue)
    guard session.canAddOutput(output) else {
      throw CaptureError(.cameraUnavailable, "The camera output could not be attached")
    }
    session.addOutput(output)

    device.activeFormat = format
    let frameDuration = CMTime(value: 1, timescale: CMTimeScale(rate))
    device.activeVideoMinFrameDuration = frameDuration
    device.activeVideoMaxFrameDuration = frameDuration
    if format.isVideoHDRSupported {
      device.automaticallyAdjustsVideoHDREnabled = false
      device.isVideoHDREnabled = false
    }
    if device.isLowLightBoostSupported { device.automaticallyEnablesLowLightBoostWhenAvailable = false }
    if format.supportedColorSpaces.contains(.sRGB) { device.activeColorSpace = .sRGB }
    device.isSubjectAreaChangeMonitoringEnabled = false

    if let connection = output.connection(with: .video) {
      if connection.isVideoStabilizationSupported { connection.preferredVideoStabilizationMode = .off }
      // The preview mirrors the front camera the way a person expects. The frames that are
      // measured are never mirrored: left and right in a frame record mean the image as captured.
      if connection.isVideoMirroringSupported {
        connection.automaticallyAdjustsVideoMirroring = false
        connection.isVideoMirrored = false
      }
      followRotation(of: device, on: connection)
    }

    let exposure = ExposureController(device: device, queue: sessionQueue)
    exposure.reset()
    self.device = device
    self.settings = settings
    lock.withLock {
      self.exposure = exposure
      currentFrameRate = rate
      self.position = settings.camera
      activeDevice = device
    }
    observeSession()
    captureQueue.async { [self] in
      if restartsCounters { droppedFrames = 0 }
      framesThisSecond = 0
      slowSeconds = 0
      secondStartedAt = 0
      lastPreviewAt = -.infinity
      chestMotion.reset()
    }
  }

  /// Takes the frame rate from the running device instead of trusting the request, so the
  /// sitting file's nominal rate and the 60 fps check describe what the camera is doing.
  /// Runs on the session queue.
  private func adoptRunningFrameRate() {
    guard let device else { return }
    let frameDuration = device.activeVideoMinFrameDuration
    guard frameDuration.isNumeric, frameDuration.seconds > 0 else { return }
    let running = (1 / frameDuration.seconds).rounded()
    lock.withLock { currentFrameRate = running }
  }

  /// The 1080p `420f` format (720p failing that) that reaches the wanted rate, with the rate it
  /// will run at. Formats that only exist for slow motion are avoided by preferring the lowest
  /// maximum rate that is enough.
  private static func format(for device: AVCaptureDevice, wanted: Double) -> (AVCaptureDevice.Format, Double)? {
    func maxRate(_ format: AVCaptureDevice.Format) -> Double {
      format.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 0
    }
    func rank(_ format: AVCaptureDevice.Format) -> Int {
      let size = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
      switch (size.width, size.height) {
      case (1920, 1080): return 0
      case (1280, 720): return 1
      default: return 2 + abs(Int(size.width) * Int(size.height) - 1920 * 1080)
      }
    }
    let candidates = device.formats.filter {
      CMFormatDescriptionGetMediaSubType($0.formatDescription) == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
    }
    for rate in [wanted, fallbackFrameRate] {
      let able = candidates.filter { maxRate($0) >= rate }
      if let best = able.min(by: { (rank($0), maxRate($0)) < (rank($1), maxRate($1)) }) {
        return (best, rate)
      }
    }
    return nil
  }

  /// Keeps delivered buffers upright, so Vision, the samplers and the outlines all work in the
  /// frame as the operator sees it. Runs on the session queue.
  private func followRotation(of device: AVCaptureDevice, on connection: AVCaptureConnection) {
    if #available(iOS 17.0, *) {
      let coordinator = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: nil)
      rotationCoordinator = coordinator
      rotationObservation = coordinator.observe(\.videoRotationAngleForHorizonLevelCapture, options: [.initial, .new]) {
        [weak self, weak connection] coordinator, _ in
        let angle = coordinator.videoRotationAngleForHorizonLevelCapture
        self?.sessionQueue.async {
          guard let self, let connection, connection.isVideoRotationAngleSupported(angle) else { return }
          connection.videoRotationAngle = angle
          self.lock.withLock { self.rotationAngle = angle }
          self.tracker.reset()
        }
      }
    } else if connection.isVideoOrientationSupported {
      // Before iOS 17 the phone is assumed to sit in its mount: landscape, camera end to the left.
      connection.videoOrientation = .landscapeRight
    }
  }

  private func observeSession() {
    let center = NotificationCenter.default
    notificationTokens.forEach(center.removeObserver)
    notificationTokens = [
      center.addObserver(forName: AVCaptureSession.wasInterruptedNotification, object: session, queue: nil) { [weak self] _ in
        self?.fail(.captureInterrupted, "The camera was interrupted")
      },
      center.addObserver(forName: AVCaptureSession.runtimeErrorNotification, object: session, queue: nil) { [weak self] note in
        let reason = (note.userInfo?[AVCaptureSessionErrorKey] as? NSError)?.localizedDescription ?? "unknown error"
        self?.fail(.cameraUnavailable, "The camera stopped: \(reason)")
      },
    ]
  }

  private func fail(_ code: CaptureErrorCode, _ message: String) {
    delegate?.frameSource(self, didFail: CaptureError(code, message))
  }

  // MARK: Frames (capture queue)

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let t = CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds
    countFrame(at: t)

    tracker.submit(buffer, at: t)
    let track = tracker.current(at: t)
    let (exposureController, angle, camera) = lock.withLock { (exposure, rotationAngle, activeDevice) }

    var record = FrameRecord(t: t, facePresent: track != nil, exposure: .adjusting, droppedFrames: droppedFrames, faceTrackId: track?.id)
    // Recorded in the sitting file only, so that a replay can tell what moved: the face,
    // the light or the camera's own settings.
    if let box = track?.regions.face {
      record.face = FaceBox(x: Double(box.minX), y: Double(box.minY), width: Double(box.width), height: Double(box.height))
    }
    if let camera {
      record.iso = Double(camera.iso)
      let shutter = camera.exposureDuration.seconds
      if shutter.isFinite { record.exposureMs = shutter * 1000 }
    }
    var faceLuma: Double?
    var facePeak = 0.0
    let read: Void? = PlanarFrame.withLocked(buffer) { frame in
      lock.withLock { aspectRatio = Double(frame.width) / Double(frame.height) }
      guard let regions = track?.regions else {
        chestMotion.reset()
        return
      }
      let samples = [regions.forehead, regions.leftCheek, regions.rightCheek].map { sampler.sample($0, in: frame) }
      record.forehead = samples[0]?.color
      record.leftCheek = samples[1]?.color
      record.rightCheek = samples[2]?.color
      let lumas = samples.compactMap { $0?.luma }
      if !lumas.isEmpty { faceLuma = lumas.reduce(0, +) / Double(lumas.count) }
      facePeak = samples.compactMap { $0?.color }.map { max($0.r, $0.g, $0.b) }.max() ?? 0
      record.chestMotion = chestMotion.update(chest: regions.chest, in: frame)
    }
    if read == nil { chestMotion.reset() }

    let face = track.flatMap { track in
      faceLuma.map {
        ExposureController.Face(
          luma: $0, peak: facePeak, devicePoint: Self.devicePoint(track.regions.face, rotatedBy: angle))
      }
    }
    record.exposure = exposureController?.update(at: t, face: face) ?? .adjusting

    delegate?.frameSource(self, didProduce: record)
    encodePreviewIfDue(buffer, at: t)
    answerFaceCrops(buffer, face: track?.regions.face)
  }

  func captureOutput(_ output: AVCaptureOutput, didDrop sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    droppedFrames += 1
  }

  /// Counts delivered frames per second and gives up 60 fps when the phone cannot hold it.
  private func countFrame(at t: Double) {
    if secondStartedAt == 0 { secondStartedAt = t }
    framesThisSecond += 1
    guard t - secondStartedAt >= 1 else { return }
    let delivered = Double(framesThisSecond) / (t - secondStartedAt)
    secondStartedAt = t
    framesThisSecond = 0

    let (rate, held) = lock.withLock { (currentFrameRate, rateHeld) }
    guard rate > Self.fallbackFrameRate else { return }
    slowSeconds = delivered < Self.sustainedShare * rate ? slowSeconds + 1 : 0
    let throttled = ProcessInfo.processInfo.thermalState.rawValue >= ProcessInfo.ThermalState.serious.rawValue
    // A sitting keeps the rate it started with; the change waits for it to end.
    guard !held, slowSeconds >= Self.slowSecondsBeforeFallback || throttled else { return }
    slowSeconds = 0
    sessionQueue.async { [self] in
      guard let device, (try? device.lockForConfiguration()) != nil else { return }
      let frameDuration = CMTime(value: 1, timescale: CMTimeScale(Self.fallbackFrameRate))
      device.activeVideoMinFrameDuration = frameDuration
      device.activeVideoMaxFrameDuration = frameDuration
      device.unlockForConfiguration()
      lock.withLock { currentFrameRate = Self.fallbackFrameRate }
    }
  }

  /// Maps the centre of an upright, normalised rectangle to the sensor's own landscape
  /// coordinates, which is what points of interest are given in.
  private static func devicePoint(_ rect: CGRect, rotatedBy angle: CGFloat) -> CGPoint {
    let x = min(max(rect.midX, 0), 1), y = min(max(rect.midY, 0), 1)
    switch Int(angle.rounded()) {
    case 90: return CGPoint(x: y, y: 1 - x)
    case 180: return CGPoint(x: 1 - x, y: 1 - y)
    case 270: return CGPoint(x: 1 - y, y: x)
    default: return CGPoint(x: x, y: y)
    }
  }

  // MARK: Outlines, live view and face crop

  func outlines() -> FaceOutlines {
    let ratio = lock.withLock { aspectRatio }
    return FaceOutlines(aspectRatio: ratio, regions: tracker.current(at: CACurrentMediaTime())?.regions)
  }

  func setPreview(_ settings: PreviewSettings?) {
    lock.withLock { preview = settings }
  }

  private func encodePreviewIfDue(_ buffer: CVPixelBuffer, at t: Double) {
    guard let settings = lock.withLock({ preview }), t - lastPreviewAt >= 1 / settings.framesPerSecond else { return }
    let started = encoder.encodeIfIdle(buffer, maxLongSide: settings.maxLongSide, quality: settings.quality) { [weak self] image in
      guard let self, let image else { return }
      self.delegate?.frameSource(self, didEncodePreview: image)
    }
    if started { lastPreviewAt = t }
  }

  func captureFaceCrop(_ completion: @escaping (Result<EncodedImage, CaptureError>) -> Void) {
    lock.withLock { pendingCrops.append(completion) }
  }

  private func answerFaceCrops(_ buffer: CVPixelBuffer, face: CGRect?) {
    let waiting = lock.withLock { () -> [(Result<EncodedImage, CaptureError>) -> Void] in
      defer { pendingCrops = [] }
      return pendingCrops
    }
    guard !waiting.isEmpty else { return }
    guard let face else {
      waiting.forEach { $0(.failure(CaptureError(.noFace, "No face is being tracked"))) }
      return
    }
    let crop = face.insetBy(dx: -Self.faceCropMargin * face.width, dy: -Self.faceCropMargin * face.height)
    encoder.encodeCrop(buffer, crop: crop, maxLongSide: Self.faceCropMaxLongSide, quality: Self.faceCropQuality) { image in
      let result: Result<EncodedImage, CaptureError> = image.map { .success($0) }
        ?? .failure(CaptureError(.noFace, "The face could not be cropped from the frame"))
      waiting.forEach { $0(result) }
    }
  }
}
