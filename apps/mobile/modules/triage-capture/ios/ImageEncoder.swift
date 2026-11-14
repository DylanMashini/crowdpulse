import CoreImage
import CoreVideo
import Foundation

/// Scales and JPEG-encodes frames for the live view and the face crop, on its own queue so the
/// capture queue only ever hands a buffer over. Nothing is written to disk.
final class ImageEncoder {
  private let queue = DispatchQueue(label: "triagecam.capture.encode", qos: .utility)
  private let context = CIContext(options: [.cacheIntermediates: false])
  private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
  private let lock = NSLock()
  private var encoding = false

  /// Encodes a live-view frame unless the previous one is still being encoded, in which case
  /// the frame is skipped and false is returned.
  func encodeIfIdle(
    _ buffer: CVPixelBuffer, maxLongSide: Double, quality: Double, completion: @escaping (EncodedImage?) -> Void
  ) -> Bool {
    let idle = lock.withLock { () -> Bool in
      guard !encoding else { return false }
      encoding = true
      return true
    }
    guard idle else { return false }
    queue.async { [self] in
      let image = encode(buffer, crop: nil, maxLongSide: maxLongSide, quality: quality)
      lock.withLock { encoding = false }
      completion(image)
    }
    return true
  }

  /// `crop` is in normalised upright coordinates (origin top-left).
  func encodeCrop(
    _ buffer: CVPixelBuffer, crop: CGRect, maxLongSide: Double, quality: Double, completion: @escaping (EncodedImage?) -> Void
  ) {
    queue.async { [self] in
      completion(encode(buffer, crop: crop, maxLongSide: maxLongSide, quality: quality))
    }
  }

  private func encode(_ buffer: CVPixelBuffer, crop: CGRect?, maxLongSide: Double, quality: Double) -> EncodedImage? {
    var image = CIImage(cvPixelBuffer: buffer)
    if let crop {
      let full = image.extent
      // Core Image's origin is the bottom-left corner.
      let rect = CGRect(
        x: crop.minX * full.width, y: (1 - crop.maxY) * full.height,
        width: crop.width * full.width, height: crop.height * full.height
      ).intersection(full).integral
      guard !rect.isEmpty else { return nil }
      image = image.cropped(to: rect).transformed(by: CGAffineTransform(translationX: -rect.minX, y: -rect.minY))
    }

    let scale = min(1, maxLongSide / Double(max(image.extent.width, image.extent.height)))
    if scale < 1 {
      image = image.applyingFilter("CILanczosScaleTransform", parameters: [kCIInputScaleKey: scale, kCIInputAspectRatioKey: 1])
    }
    let width = Int(image.extent.width.rounded(.down)), height = Int(image.extent.height.rounded(.down))
    guard width > 0, height > 0 else { return nil }
    let bounds = CGRect(x: image.extent.minX, y: image.extent.minY, width: CGFloat(width), height: CGFloat(height))
    let options = [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: quality]
    guard let jpeg = context.jpegRepresentation(of: image.cropped(to: bounds), colorSpace: colorSpace, options: options) else {
      return nil
    }
    return EncodedImage(jpeg: jpeg, width: width, height: height)
  }
}
