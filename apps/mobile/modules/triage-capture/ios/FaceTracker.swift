import CoreVideo
import Foundation
import Vision

/// Finds the face and its landmarks with Vision on its own queue, and keeps the smoothed
/// regions the capture queue samples. The capture queue never waits for Vision: a frame is
/// only handed over when the previous request has finished, and otherwise uses the regions
/// already known.
final class FaceTracker {
  struct Track {
    /// Changes whenever a different face, or the same face after a gap, is picked up.
    let id: Int
    let regions: FaceRegions
  }

  /// Vision is asked at most this often. Faces in a chair move slowly and the regions are smoothed.
  private static let minInterval = 1.0 / 15
  /// With no detection for this long the face is treated as gone.
  private static let lostAfter = 0.5
  /// Time constant of the region smoothing, in seconds.
  private static let smoothing = 0.15
  /// A detection further than this share of the face width from the track is another face.
  private static let maxJump: CGFloat = 0.6
  private static let maxScaleChange: CGFloat = 1.6

  private let queue = DispatchQueue(label: "triagecam.capture.vision", qos: .userInitiated)
  private let lock = NSLock()
  private var busy = false
  private var lastSubmitted = -Double.infinity
  private var track: Track?
  private var trackUpdatedAt = -Double.infinity
  private var nextId = 1

  /// Called on the capture queue for every frame. Returns at once.
  func submit(_ buffer: CVPixelBuffer, at t: Double) {
    lock.lock()
    let accept = !busy && t - lastSubmitted >= Self.minInterval
    if accept {
      busy = true
      lastSubmitted = t
    }
    lock.unlock()
    guard accept else { return }

    queue.async { [self] in
      let detected = detect(in: buffer)
      lock.lock()
      update(with: detected, at: t)
      busy = false
      lock.unlock()
    }
  }

  /// The face being tracked at capture time `t`, or nil.
  func current(at t: Double) -> Track? {
    lock.lock()
    defer { lock.unlock() }
    guard let track, t - trackUpdatedAt <= Self.lostAfter else { return nil }
    return track
  }

  func reset() {
    lock.lock()
    track = nil
    trackUpdatedAt = -.infinity
    lastSubmitted = -.infinity
    lock.unlock()
  }

  private func detect(in buffer: CVPixelBuffer) -> FaceRegions? {
    let request = VNDetectFaceLandmarksRequest()
    // The capture connection delivers upright buffers, so no orientation is passed on.
    let handler = VNImageRequestHandler(cvPixelBuffer: buffer, orientation: .up, options: [:])
    guard (try? handler.perform([request])) != nil, let faces = request.results, !faces.isEmpty else { return nil }
    let size = CGSize(width: CVPixelBufferGetWidth(buffer), height: CVPixelBufferGetHeight(buffer))
    // The patient sits nearest the camera, so the largest face is theirs.
    let largest = faces.max { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height }
    return largest.flatMap { RegionGeometry.regions(for: $0, imageSize: size) }
  }

  /// Caller holds the lock.
  private func update(with detected: FaceRegions?, at t: Double) {
    guard let detected else { return }
    if let track, t - trackUpdatedAt <= Self.lostAfter, Self.sameFace(track.regions.face, detected.face) {
      let amount = 1 - exp(-(t - trackUpdatedAt) / Self.smoothing)
      self.track = Track(id: track.id, regions: track.regions.moved(toward: detected, by: CGFloat(amount)))
    } else {
      track = Track(id: nextId, regions: detected)
      nextId += 1
    }
    trackUpdatedAt = t
  }

  private static func sameFace(_ a: CGRect, _ b: CGRect) -> Bool {
    let jump = hypot(a.midX - b.midX, a.midY - b.midY)
    let scale = max(a.width, b.width) / max(min(a.width, b.width), .leastNonzeroMagnitude)
    return jump <= maxJump * max(a.width, b.width) && scale <= maxScaleChange
  }
}
