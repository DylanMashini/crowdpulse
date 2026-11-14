import CoreVideo
import Foundation

/// A locked view of a bi-planar 4:2:0 pixel buffer (`420f`, or `420v` if the camera insists).
/// Valid only inside `PlanarFrame.withLocked`.
struct PlanarFrame {
  enum Matrix {
    case bt601, bt709
  }

  let width: Int
  let height: Int
  let luma: UnsafePointer<UInt8>
  let lumaStride: Int
  /// Interleaved Cb, Cr at half resolution in both directions.
  let chroma: UnsafePointer<UInt8>
  let chromaStride: Int
  let chromaWidth: Int
  let chromaHeight: Int
  let fullRange: Bool
  let matrix: Matrix

  /// Returns nil when the buffer is not bi-planar 4:2:0 or cannot be locked.
  static func withLocked<T>(_ buffer: CVPixelBuffer, _ body: (PlanarFrame) -> T) -> T? {
    let format = CVPixelBufferGetPixelFormatType(buffer)
    let fullRange = format == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
    guard fullRange || format == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange else { return nil }
    guard CVPixelBufferLockBaseAddress(buffer, .readOnly) == kCVReturnSuccess else { return nil }
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    guard
      let luma = CVPixelBufferGetBaseAddressOfPlane(buffer, 0),
      let chroma = CVPixelBufferGetBaseAddressOfPlane(buffer, 1)
    else { return nil }

    return body(
      PlanarFrame(
        width: CVPixelBufferGetWidthOfPlane(buffer, 0),
        height: CVPixelBufferGetHeightOfPlane(buffer, 0),
        luma: luma.assumingMemoryBound(to: UInt8.self),
        lumaStride: CVPixelBufferGetBytesPerRowOfPlane(buffer, 0),
        chroma: chroma.assumingMemoryBound(to: UInt8.self),
        chromaStride: CVPixelBufferGetBytesPerRowOfPlane(buffer, 1),
        chromaWidth: CVPixelBufferGetWidthOfPlane(buffer, 1),
        chromaHeight: CVPixelBufferGetHeightOfPlane(buffer, 1),
        fullRange: fullRange,
        matrix: matrix(of: buffer)
      )
    )
  }

  private static func matrix(of buffer: CVPixelBuffer) -> Matrix {
    guard let value = CVBufferCopyAttachment(buffer, kCVImageBufferYCbCrMatrixKey, nil) else { return .bt709 }
    let name = value as? String
    return name == (kCVImageBufferYCbCrMatrix_ITU_R_601_4 as String) ? .bt601 : .bt709
  }

  /// Full-range RGB (0 to 255) of mean Y, Cb and Cr values. The conversion is affine, so
  /// converting the means equals the mean of the converted pixels, apart from per-pixel clipping.
  func rgb(y: Double, cb: Double, cr: Double) -> (r: Double, g: Double, b: Double) {
    let luma = fullRange ? y : (y - 16) * 255 / 219
    let scale = fullRange ? 1.0 : 255.0 / 224.0
    let u = (cb - 128) * scale
    let v = (cr - 128) * scale
    let r: Double, g: Double, b: Double
    switch matrix {
    case .bt709:
      r = luma + 1.5748 * v
      g = luma - 0.1873 * u - 0.4681 * v
      b = luma + 1.8556 * u
    case .bt601:
      r = luma + 1.402 * v
      g = luma - 0.344136 * u - 0.714136 * v
      b = luma + 1.772 * u
    }
    return (min(max(r, 0), 255), min(max(g, 0), 255), min(max(b, 0), 255))
  }
}
