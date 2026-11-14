import CoreGraphics

/// Same shape as the capture module's `FaceRegions` (CaptureTypes.swift), which cannot be linked
/// here because that file also names the camera classes.
struct FaceRegions {
  var face: CGRect
  var forehead: [CGPoint]
  var leftCheek: [CGPoint]
  var rightCheek: [CGPoint]
  var chest: CGRect?
}
