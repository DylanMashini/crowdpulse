import Accelerate
import CoreGraphics
import Foundation

/// Vertical displacement of the upper-chest region between consecutive frames.
///
/// Each frame is reduced to one number per row of the region (the row's mean luma). The shift
/// between two such profiles is found by an integer search followed by a gradient (Lucas-Kanade)
/// refinement, which resolves the small fractions of a pixel that breathing moves per frame.
/// Not thread-safe: it belongs to the capture queue.
final class ChestMotionEstimator {
  private struct PixelRect: Equatable {
    var x: Int, y: Int, width: Int, height: Int
  }

  /// Largest whole-row shift searched, in rows. Breathing is far below this; more is body motion.
  private static let maxLag = 6
  private static let minRows = 48
  private static let minColumns = 32
  /// Sampling every second column halves the work and loses nothing a row mean needs.
  private static let columnStep = 2
  /// Mean squared gradient below this means the region has no horizontal edges to follow.
  private static let minTexture: Float = 0.1
  /// The region is re-anchored once the tracked one has moved or resized by this share of its size.
  private static let reanchorShare = 0.15

  private var anchor: PixelRect?
  private var frameSize: (width: Int, height: Int) = (0, 0)
  private var previous: [Float] = []
  private var scratch: [Float] = []

  func reset() {
    anchor = nil
    previous = []
  }

  /// `chest` is in normalised upright coordinates. Returns the displacement as a fraction of
  /// frame height, positive downward, or nil when there is no previous frame to compare with
  /// or the region cannot be followed.
  func update(chest: CGRect?, in frame: PlanarFrame) -> Double? {
    guard let chest, let target = pixelRect(chest, in: frame) else {
      reset()
      return nil
    }
    guard let current = anchor, frameSize == (frame.width, frame.height) else {
      frameSize = (frame.width, frame.height)
      anchor = target
      previous = profile(of: target, in: frame)
      return nil
    }

    let now = profile(of: current, in: frame)
    let rows = Self.shift(from: previous, to: now)

    // The comparison needs both frames read over the same rows, so the region only follows the
    // face in steps, and the frame that steps is read twice.
    if Self.drifted(current, from: target) {
      anchor = target
      previous = profile(of: target, in: frame)
    } else {
      previous = now
    }
    return rows.map { Double($0) / Double(frame.height) }
  }

  private func pixelRect(_ rect: CGRect, in frame: PlanarFrame) -> PixelRect? {
    let bounds = CGRect(x: 0, y: 0, width: frame.width, height: frame.height)
    let scaled = CGRect(
      x: rect.minX * CGFloat(frame.width), y: rect.minY * CGFloat(frame.height),
      width: rect.width * CGFloat(frame.width), height: rect.height * CGFloat(frame.height)
    ).intersection(bounds).integral
    guard !scaled.isNull, Int(scaled.height) >= Self.minRows, Int(scaled.width) >= Self.minColumns else { return nil }
    let width = min(Int(scaled.width), frame.width - Int(scaled.minX))
    let height = min(Int(scaled.height), frame.height - Int(scaled.minY))
    return PixelRect(x: Int(scaled.minX), y: Int(scaled.minY), width: width, height: height)
  }

  private static func drifted(_ anchor: PixelRect, from target: PixelRect) -> Bool {
    let dx = Double(abs(anchor.x - target.x)), dy = Double(abs(anchor.y - target.y))
    let dw = Double(abs(anchor.width - target.width)), dh = Double(abs(anchor.height - target.height))
    let w = Double(anchor.width), h = Double(anchor.height)
    return dx > reanchorShare * w || dw > reanchorShare * w || dy > reanchorShare * h || dh > reanchorShare * h
  }

  /// Mean luma of each row of the region, with the overall mean removed so that a change in
  /// brightness between frames does not read as movement.
  private func profile(of rect: PixelRect, in frame: PlanarFrame) -> [Float] {
    let columns = (rect.width + Self.columnStep - 1) / Self.columnStep
    if scratch.count < columns { scratch = [Float](repeating: 0, count: columns) }
    var rows = [Float](repeating: 0, count: rect.height)
    scratch.withUnsafeMutableBufferPointer { buffer in
      for row in 0..<rect.height {
        let start = frame.luma + (rect.y + row) * frame.lumaStride + rect.x
        vDSP_vfltu8(start, Self.columnStep, buffer.baseAddress!, 1, vDSP_Length(columns))
        vDSP_meanv(buffer.baseAddress!, 1, &rows[row], vDSP_Length(columns))
      }
    }
    var mean: Float = 0
    vDSP_meanv(rows, 1, &mean, vDSP_Length(rows.count))
    var offset = -mean
    vDSP_vsadd(rows, 1, &offset, &rows, 1, vDSP_Length(rows.count))
    return rows
  }

  /// Rows by which the content of `before` has moved down to give `after`. Nil when the
  /// profiles cannot be compared or have nothing to lock on to.
  static func shift(from before: [Float], to after: [Float]) -> Float? {
    let count = before.count
    guard count == after.count, count >= minRows else { return nil }
    let length = count - 2 * maxLag - 2
    let origin = maxLag + 1

    return before.withUnsafeBufferPointer { a in
      after.withUnsafeBufferPointer { b in
        var bestLag = 0
        var bestCost = Float.greatestFiniteMagnitude
        for lag in -maxLag...maxLag {
          var cost: Float = 0
          vDSP_distancesq(a.baseAddress! + origin, 1, b.baseAddress! + origin + lag, 1, &cost, vDSP_Length(length))
          if cost < bestCost {
            bestCost = cost
            bestLag = lag
          }
        }

        // after(y + lag) is about before(y) - d * before'(y) for the remaining fraction d.
        var numerator: Float = 0
        var texture: Float = 0
        for index in 0..<length {
          let gradient = (a[origin + index + 1] - a[origin + index - 1]) / 2
          let difference = b[origin + index + bestLag] - a[origin + index]
          numerator += gradient * difference
          texture += gradient * gradient
        }
        guard texture / Float(length) >= minTexture else { return nil }
        let fraction = min(max(-numerator / texture, -1), 1)
        return Float(bestLag) + fraction
      }
    }
  }
}
