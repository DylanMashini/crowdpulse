import AVFoundation
import Foundation
import SignalEngine

/// Meters on the face, then fixes shutter, ISO, white balance and focus. Nothing is locked
/// until a face is present and correctly exposed, and the lock is given up when the face has
/// gone or is no longer correctly exposed, so the next patient is metered afresh.
final class ExposureController {
  struct Face {
    /// Mean luma of the skin regions, 0 to 255.
    let luma: Double
    /// The highest channel mean of any skin region, 0 to 255. Skin is reddest, so this is
    /// red: when it nears 255 the red channel is clipping although the luma looks fine, and
    /// a clipped channel carries no pulse.
    let peak: Double
    /// Centre of the face in the camera's own coordinates (AVCaptureDevice points of interest).
    let devicePoint: CGPoint
  }

  private enum Phase {
    case metering(goodSince: Double?)
    case locking
    case locked(badSince: Double?)
  }

  /// Skin that reads outside this range is clipped or buried in noise.
  private static let wellExposed = 50.0...215.0
  /// A region whose strongest channel averages more than this has pixels at the ceiling.
  /// (A sitting recorded at a red mean of 242 gave nothing; the others sat at 110 to 180.)
  private static let clipped = 235.0
  /// While metering a face that clips, the exposure target is lowered by this much, in
  /// stops, no more often than `biasInterval`, down to `lowestBias`. A face that still clips
  /// there (a lamp close to it) is never locked on, because a clipped channel carries no
  /// pulse: the frames stay `adjusting`, and after `EXPOSURE_STUCK_AFTER_SECONDS` of that
  /// the camera screen and the check-in page tell the operator to move the light
  /// (`EXPOSURE_STUCK` in packages/contracts/src/copy.ts). Nothing here times out by itself.
  private static let biasStep: Float = 1.0 / 3
  private static let lowestBias: Float = -2
  private static let biasInterval = 0.5
  private static let settleSeconds = 0.5
  private static let badExposureSeconds = 1.0
  private static let faceGoneSeconds = 3.0
  private static let aimInterval = 0.5
  private static let aimDistance: CGFloat = 0.05

  private let device: AVCaptureDevice
  /// Device configuration blocks briefly, so it runs here and never on the capture queue.
  private let queue: DispatchQueue
  private let lock = NSLock()
  private var phase = Phase.metering(goodSince: nil)
  private var lastFaceAt = -Double.infinity
  private var lastAimAt = -Double.infinity
  private var lastAim = CGPoint(x: 0.5, y: 0.5)
  private var bias: Float = 0
  private var lastBiasAt = -Double.infinity

  init(device: AVCaptureDevice, queue: DispatchQueue) {
    self.device = device
    self.queue = queue
  }

  /// Called on the capture queue for every frame. Returns the state that frame was taken in.
  func update(at t: Double, face: Face?) -> ExposureState {
    lock.lock()
    defer { lock.unlock() }
    if face != nil { lastFaceAt = t }
    let good = face.map { Self.wellExposed.contains($0.luma) && $0.peak <= Self.clipped } ?? false

    switch phase {
    case .metering(let goodSince):
      guard let face else {
        phase = .metering(goodSince: nil)
        return .adjusting
      }
      aim(at: face.devicePoint, t)
      if face.peak > Self.clipped { darken(t) }
      guard good, !device.isAdjustingExposure else {
        phase = .metering(goodSince: nil)
        return .adjusting
      }
      let since = goodSince ?? t
      if t - since >= Self.settleSeconds {
        phase = .locking
        queue.async { self.fix() }
      } else {
        phase = .metering(goodSince: since)
      }
      return .adjusting

    case .locking:
      return .adjusting

    case .locked(let badSince):
      if face == nil {
        if t - lastFaceAt > Self.faceGoneSeconds { release() }
        return .locked
      }
      if good {
        phase = .locked(badSince: nil)
      } else if t - (badSince ?? t) > Self.badExposureSeconds {
        release()
      } else {
        phase = .locked(badSince: badSince ?? t)
      }
      return .locked
    }
  }

  /// Back to automatic exposure, white balance and focus. Called when capture starts.
  func reset() {
    lock.withLock { release() }
  }

  /// Caller holds the lock.
  private func release() {
    phase = .metering(goodSince: nil)
    lastAimAt = -.infinity
    bias = 0
    lastBiasAt = -.infinity
    queue.async { self.configure { device in
      device.setExposureTargetBias(0, completionHandler: nil)
      if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
      if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) { device.whiteBalanceMode = .continuousAutoWhiteBalance }
      if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
    } }
  }

  /// Caller holds the lock.
  private func aim(at point: CGPoint, _ t: Double) {
    let moved = hypot(point.x - lastAim.x, point.y - lastAim.y) > Self.aimDistance
    guard lastAimAt == -.infinity || (moved && t - lastAimAt >= Self.aimInterval) else { return }
    lastAimAt = t
    lastAim = point
    queue.async { self.configure { device in
      if device.isExposurePointOfInterestSupported {
        device.exposurePointOfInterest = point
        if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
      }
      if device.isFocusPointOfInterestSupported {
        device.focusPointOfInterest = point
        if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
      }
    } }
  }

  /// Asks automatic exposure for a darker picture, one step at a time, while the face
  /// clips. Caller holds the lock.
  private func darken(_ t: Double) {
    guard t - lastBiasAt >= Self.biasInterval, bias > Self.lowestBias else { return }
    lastBiasAt = t
    bias = max(Self.lowestBias, bias - Self.biasStep)
    let target = bias
    queue.async { self.configure { device in
      device.setExposureTargetBias(max(device.minExposureTargetBias, target), completionHandler: nil)
    } }
  }

  /// Freezes what automatic exposure settled on.
  private func fix() {
    let applied = configure { device in
      let format = device.activeFormat
      // A shutter longer than a frame would lower the frame rate.
      let frame = device.activeVideoMinFrameDuration
      var duration = device.exposureDuration
      var iso = device.iso
      if frame.isNumeric, CMTimeCompare(duration, frame) > 0 {
        iso *= Float(duration.seconds / frame.seconds)
        duration = frame
      }
      duration = CMTimeClampToRange(duration, range: CMTimeRange(start: format.minExposureDuration, end: format.maxExposureDuration))
      iso = min(max(iso, format.minISO), format.maxISO)

      if device.isExposureModeSupported(.custom) {
        device.setExposureModeCustom(duration: duration, iso: iso) { [weak self] _ in self?.didFix() }
      } else {
        if device.isExposureModeSupported(.locked) { device.exposureMode = .locked }
        self.didFix()
      }
      if device.isWhiteBalanceModeSupported(.locked) { device.whiteBalanceMode = .locked }
      if device.isFocusModeSupported(.locked) { device.focusMode = .locked }
    }
    if !applied {
      lock.withLock { phase = .metering(goodSince: nil) }
    }
  }

  private func didFix() {
    lock.withLock {
      if case .locking = phase { phase = .locked(badSince: nil) }
    }
  }

  @discardableResult
  private func configure(_ change: (AVCaptureDevice) -> Void) -> Bool {
    guard (try? device.lockForConfiguration()) != nil else { return false }
    change(device)
    device.unlockForConfiguration()
    return true
  }
}
