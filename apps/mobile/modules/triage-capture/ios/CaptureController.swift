import Foundation
import QuartzCore
import SignalEngine

/// Ties a frame source to a sitting and to the events JavaScript receives. Everything that
/// touches the engine or the sitting file happens on `queue`.
final class CaptureController: FrameSourceDelegate {
  typealias Emit = (_ event: String, _ body: [String: Any]) -> Void

  struct SittingStarted {
    let sittingId: String
    let startedAt: Date
  }

  struct SittingOutcome {
    let sittingId: String
    let endedAt: Date
    let summary: SittingSummary
    /// Nil when the file could not be written.
    let fileURL: URL?
  }

  private enum Viewfinder: String {
    case searching, locking, measuring, lost
  }

  private static let ticksPerSecond = 10
  /// `startSitting` waits this long for a frame before giving up.
  private static let firstFrameTimeout = 3.0
  /// A face that was being measured and has been gone this long is no longer "lost": the
  /// viewfinder goes back to searching for the next patient.
  private static let lostSeconds = 10.0
  private static let previewDefaults = PreviewSettings(framesPerSecond: 2, maxLongSide: 480, quality: 0.5)
  private static let previewLimits = PreviewSettings(framesPerSecond: 30, maxLongSide: 640, quality: 1)
  /// Where the camera choice is kept between launches.
  private static let cameraKey = "triagecam.capture.camera"

  private let queue = DispatchQueue(label: "triagecam.capture.engine", qos: .userInitiated)
  private let source: FrameSource
  private let emit: Emit
  private let sittingsDirectory: URL
  private let uploader = LiveUploader()

  private var capturing = false
  private var ticker: DispatchSourceTimer?
  private var tick = 0
  private var sitting: SittingSession?
  private var awaitingFirstFrame: (sittingId: String, since: Double, completion: (Result<SittingStarted, CaptureError>) -> Void)?
  private var framesThisSecond = 0
  private var latest: FrameRecord?
  private var measuredAt: Double?

  init(source: FrameSource = FrameSources.make(), emit: @escaping Emit) {
    self.source = source
    self.emit = emit
    sittingsDirectory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("TriageCamSittings", isDirectory: true)
    source.delegate = self
    CapturePreviewHub.source = source
  }

  // MARK: Camera choice

  /// The camera capture starts on: the last one chosen with `setCamera`, the back one until then.
  var camera: CameraPosition {
    UserDefaults.standard.string(forKey: Self.cameraKey).flatMap(CameraPosition.init(rawValue:)) ?? .back
  }

  /// Remembers the choice and, while capture runs, moves to that camera at once.
  func setCamera(_ position: CameraPosition, completion: @escaping (Result<Void, CaptureError>) -> Void) {
    queue.async { [self] in
      if capturing {
        do {
          try source.switchCamera(to: position)
        } catch {
          return completion(.failure(error as? CaptureError ?? CaptureError(.cameraUnavailable, "\(error)")))
        }
        // What the old camera last saw says nothing about the new one.
        latest = nil
        measuredAt = nil
      }
      UserDefaults.standard.set(position.rawValue, forKey: Self.cameraKey)
      completion(.success(()))
    }
  }

  var sourceName: String { source.kind.rawValue }

  func permission() -> PermissionStatus { source.permission() }

  func requestPermission(_ completion: @escaping (PermissionStatus) -> Void) {
    source.requestPermission(completion)
  }

  // MARK: Capture

  func startCapture(_ settings: CaptureSettings, completion: @escaping (Result<Void, CaptureError>) -> Void) {
    queue.async { [self] in
      guard !capturing else { return completion(.success(())) }
      do {
        try source.start(settings)
      } catch {
        return completion(.failure(error as? CaptureError ?? CaptureError(.cameraUnavailable, "\(error)")))
      }
      capturing = true
      tick = 0
      framesThisSecond = 0
      latest = nil
      measuredAt = nil
      startTicker()
      completion(.success(()))
    }
  }

  func stopCapture(completion: @escaping () -> Void) {
    queue.async { [self] in
      stop()
      completion()
    }
  }

  /// Blocks until capture has stopped. For module teardown.
  func shutdown() {
    queue.sync { stop() }
  }

  private func stop() {
    uploader.setTarget(nil)
    guard capturing else { return }
    capturing = false
    ticker?.cancel()
    ticker = nil
    source.stop()
    source.holdsFrameRate = false
    sitting?.abandon()
    sitting = nil
    awaitingFirstFrame?.completion(.failure(CaptureError(.notCapturing, "Capture stopped before the sitting began")))
    awaitingFirstFrame = nil
  }

  // MARK: Sitting

  func startSitting(_ sittingId: String, completion: @escaping (Result<SittingStarted, CaptureError>) -> Void) {
    queue.async { [self] in
      guard capturing else {
        return completion(.failure(CaptureError(.notCapturing, "Start capture before a sitting")))
      }
      guard sitting == nil, awaitingFirstFrame == nil else {
        return completion(.failure(CaptureError(.sittingRunning, "A sitting is already running")))
      }
      // The sitting file is named after the id, so the id must be a plain file name.
      let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
      guard !sittingId.isEmpty, sittingId.unicodeScalars.allSatisfy(allowed.contains) else {
        return completion(.failure(CaptureError(.file, "The sitting id is not usable as a file name")))
      }
      source.holdsFrameRate = true
      awaitingFirstFrame = (sittingId, CACurrentMediaTime(), completion)
    }
  }

  func stopSitting(completion: @escaping (Result<SittingOutcome, CaptureError>) -> Void) {
    queue.async { [self] in
      guard let sitting else {
        return completion(.failure(CaptureError(.noSitting, "No sitting is running")))
      }
      self.sitting = nil
      source.holdsFrameRate = false
      let (summary, endedAt, fileError) = sitting.finish()
      if let fileError {
        emit("onError", Payloads.error(CaptureError(.file, "The sitting file could not be written: \(fileError.localizedDescription)")))
      }
      completion(.success(SittingOutcome(
        sittingId: sitting.sittingId, endedAt: endedAt, summary: summary,
        fileURL: fileError == nil ? sitting.fileURL : nil
      )))
    }
  }

  /// Only files this module wrote can be removed through it.
  func deleteSittingFile(_ uri: String) throws {
    guard let url = URL(string: uri), url.isFileURL,
          url.standardizedFileURL.deletingLastPathComponent().path == sittingsDirectory.standardizedFileURL.path
    else {
      throw CaptureError(.file, "Not a sitting file: \(uri)")
    }
    do {
      try FileManager.default.removeItem(at: url)
    } catch CocoaError.fileNoSuchFile {
      return
    } catch {
      throw CaptureError(.file, "The sitting file could not be removed: \(error.localizedDescription)")
    }
  }

  // MARK: Live view and face crop

  /// Nil turns the live view off. Values are clamped to the limits of the contract. With an
  /// upload target the frames are posted from here and `onLiveUpload` reports on them once a
  /// second; without one they are handed to JavaScript as `onPreviewFrame`.
  func setLivePreview(
    framesPerSecond: Double?, maxLongSide: Double?, quality: Double?, enabled: Bool, upload: LiveUploadTarget? = nil
  ) {
    uploader.setTarget(enabled ? upload : nil)
    guard enabled else { return source.setPreview(nil) }
    let defaults = Self.previewDefaults, limits = Self.previewLimits
    source.setPreview(PreviewSettings(
      framesPerSecond: min(max(framesPerSecond ?? defaults.framesPerSecond, 1), limits.framesPerSecond),
      maxLongSide: min(max(maxLongSide ?? defaults.maxLongSide, 64), limits.maxLongSide),
      quality: min(max(quality ?? defaults.quality, 0), limits.quality)
    ))
  }

  func captureFaceCrop(_ completion: @escaping (Result<EncodedImage, CaptureError>) -> Void) {
    queue.async { [self] in
      guard capturing else {
        return completion(.failure(CaptureError(.notCapturing, "Start capture before asking for a face crop")))
      }
      source.captureFaceCrop(completion)
    }
  }

  // MARK: FrameSourceDelegate

  func frameSource(_ source: FrameSource, didProduce record: FrameRecord) {
    queue.async { [self] in
      guard capturing else { return }
      framesThisSecond += 1
      latest = record
      if let waiting = awaitingFirstFrame {
        awaitingFirstFrame = nil
        begin(waiting.sittingId, with: record, completion: waiting.completion)
      } else {
        sitting?.ingest(record)
      }
    }
  }

  func frameSource(_ source: FrameSource, didEncodePreview image: EncodedImage) {
    if uploader.hasTarget { return uploader.upload(image, capturedAt: Date()) }
    var body = Payloads.image(image)
    body["t"] = Timestamps.string(from: Date())
    emit("onPreviewFrame", body)
  }

  func frameSource(_ source: FrameSource, didFail error: CaptureError) {
    emit("onError", Payloads.error(error))
  }

  private func begin(_ sittingId: String, with frame: FrameRecord, completion: (Result<SittingStarted, CaptureError>) -> Void) {
    do {
      let session = try SittingSession(
        sittingId: sittingId, firstFrame: frame, source: source.kind, frameRate: source.frameRate,
        wallClockOffset: Date().timeIntervalSince1970 - CACurrentMediaTime(), directory: sittingsDirectory
      )
      sitting = session
      completion(.success(SittingStarted(sittingId: sittingId, startedAt: session.startedAt)))
    } catch {
      source.holdsFrameRate = false
      completion(.failure(CaptureError(.file, "The sitting file could not be created: \(error.localizedDescription)")))
    }
  }

  // MARK: Once-per-second and ten-per-second events

  private func startTicker() {
    let timer = DispatchSource.makeTimerSource(queue: queue)
    let interval = 1.0 / Double(Self.ticksPerSecond)
    timer.schedule(deadline: .now() + interval, repeating: interval, leeway: .milliseconds(5))
    timer.setEventHandler { [weak self] in self?.onTick() }
    timer.resume()
    ticker = timer
  }

  private func onTick() {
    let now = CACurrentMediaTime()
    emit("onFaceRegions", Payloads.outlines(source.outlines()))

    if let sitting, let reading = sitting.readingIfDue(now: now) {
      emit("onReading", Payloads.reading(reading, in: sitting))
    }

    if let waiting = awaitingFirstFrame, now - waiting.since > Self.firstFrameTimeout {
      awaitingFirstFrame = nil
      source.holdsFrameRate = false
      waiting.completion(.failure(CaptureError(.captureInterrupted, "No frame arrived from the camera")))
    }

    tick += 1
    if tick % Self.ticksPerSecond == 0 {
      emit("onStatus", status(at: now))
      if let report = uploader.takeReport() {
        emit("onLiveUpload", [
          "delivered": report.delivered, "failed": report.failed, "viewers": report.viewers.map { $0 as Any } ?? NSNull(),
        ])
      }
      framesThisSecond = 0
    }
  }

  private func status(at now: Double) -> [String: Any] {
    // A frame older than a second says nothing about what is in front of the camera now.
    let recent = latest.flatMap { now - $0.t <= 1 ? $0 : nil }
    let facePresent = recent?.facePresent ?? false
    let locked = recent?.exposure == .locked
    return [
      "source": source.kind.rawValue,
      "fps": framesThisSecond,
      "droppedFrames": sitting?.droppedFrames ?? latest?.droppedFrames ?? 0,
      "exposureLocked": locked,
      "thermalState": Payloads.thermalState(ProcessInfo.processInfo.thermalState),
      "facePresent": facePresent,
      "viewfinder": viewfinder(facePresent: facePresent, locked: locked, at: now).rawValue,
      "sittingId": sitting.map { $0.sittingId as Any } ?? NSNull(),
      "sittingElapsedMs": sitting.map { Int(($0.elapsedSeconds * 1000).rounded()) as Any } ?? NSNull(),
    ]
  }

  private func viewfinder(facePresent: Bool, locked: Bool, at now: Double) -> Viewfinder {
    if facePresent {
      guard locked else { return .locking }
      measuredAt = now
      return .measuring
    }
    guard let measuredAt, now - measuredAt <= Self.lostSeconds else {
      self.measuredAt = nil
      return .searching
    }
    return .lost
  }
}
