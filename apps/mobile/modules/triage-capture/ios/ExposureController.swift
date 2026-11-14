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

  init(device: AVCaptureDevice, queue: DispatchQueue) {
    self.device = device
    self.queue = queue
  }

  /// Called on the capture queue for every frame. Returns the state that frame was taken in.
  func update(at t: Double, face: Face?) -> ExposureState {
    lock.lock()
    defer { lock.unlock() }
    if face != nil { lastFaceAt = t }
    let good = face.map { Self.wellExposed.contains($0.luma) } ?? false

    switch phase {
    case .metering(let goodSince):
      guard let face else {
        phase = .metering(goodSince: nil)
        return .adjusting
      }
      aim(at: face.devicePoint, t)
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
    queue.async { self.configure { device in
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
