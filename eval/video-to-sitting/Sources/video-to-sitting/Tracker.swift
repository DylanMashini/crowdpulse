import CoreGraphics
import CoreVideo
import Foundation
import Vision

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
