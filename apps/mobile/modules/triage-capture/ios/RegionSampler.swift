import Accelerate
import CoreGraphics
import Foundation
import SignalEngine

struct RegionSample {
  let color: RegionColor
  /// Mean luma of the region, 0 to 255. Used to judge exposure.
  let luma: Double
}

/// Mean colour of a polygon, read straight from the pixel buffer's planes. Not thread-safe:
/// it keeps scratch storage and belongs to the capture queue.
final class RegionSampler {
  private var scratch: [Float] = []
  private var crossings: [Double] = []

  /// `polygon` is in normalised upright coordinates. Returns nil when it covers no pixel.
  func sample(_ polygon: [CGPoint], in frame: PlanarFrame) -> RegionSample? {
    guard
      let y = planeMean(polygon, base: frame.luma, stride: frame.lumaStride, width: frame.width, height: frame.height, channels: 1),
      let c = planeMean(polygon, base: frame.chroma, stride: frame.chromaStride, width: frame.chromaWidth, height: frame.chromaHeight, channels: 2)
    else { return nil }
    let rgb = frame.rgb(y: y[0], cb: c[0], cr: c[1])
    return RegionSample(color: RegionColor(r: rgb.r, g: rgb.g, b: rgb.b), luma: y[0])
  }

  /// Per-channel mean of the pixels whose centres fall inside the polygon (even-odd rule).
  private func planeMean(
    _ polygon: [CGPoint], base: UnsafePointer<UInt8>, stride: Int, width: Int, height: Int, channels: Int
  ) -> [Double]? {
    guard polygon.count >= 3, width > 0, height > 0 else { return nil }
    let points = polygon.map { CGPoint(x: $0.x * CGFloat(width), y: $0.y * CGFloat(height)) }
    let minY = points.map(\.y).min() ?? 0
    let maxY = points.map(\.y).max() ?? 0
    let firstRow = max(0, Int((minY - 0.5).rounded(.up)))
    let lastRow = min(height - 1, Int((maxY - 0.5).rounded(.down)))
    guard firstRow <= lastRow else { return nil }

    if scratch.count < width { scratch = [Float](repeating: 0, count: width) }
    var sums = [Double](repeating: 0, count: channels)
    var pixels = 0

    for row in firstRow...lastRow {
      let centre = Double(row) + 0.5
      crossings.removeAll(keepingCapacity: true)
      for index in points.indices {
        let p = points[index]
        let q = points[(index + 1) % points.count]
        let py = Double(p.y), qy = Double(q.y)
        guard (py <= centre) != (qy <= centre) else { continue }
        crossings.append(Double(p.x) + (centre - py) / (qy - py) * Double(q.x - p.x))
      }
      crossings.sort()

      var pair = 0
      while pair + 1 < crossings.count {
        let start = max(0, Int((crossings[pair] - 0.5).rounded(.up)))
        let end = min(width - 1, Int((crossings[pair + 1] - 0.5).rounded(.down)))
        pair += 2
        guard start <= end else { continue }
        let count = end - start + 1
        let rowStart = base + row * stride + start * channels
        for channel in 0..<channels {
          var sum: Float = 0
          scratch.withUnsafeMutableBufferPointer { buffer in
            vDSP_vfltu8(rowStart + channel, channels, buffer.baseAddress!, 1, vDSP_Length(count))
            vDSP_sve(buffer.baseAddress!, 1, &sum, vDSP_Length(count))
          }
          sums[channel] += Double(sum)
        }
        pixels += count
      }
    }

    guard pixels > 0 else { return nil }
    return sums.map { $0 / Double(pixels) }
  }
}
