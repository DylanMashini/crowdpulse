import CoreGraphics
import Foundation
import Vision

/// Builds the skin and chest regions from face landmarks. Everything is anchored to the eyes,
/// brows, mouth and face contour, in a frame that turns with the head, so the regions stay on
/// skin when the head rolls. A rectangle over the face box is never used for colour.
enum RegionGeometry {
  // Distances are in units of the distance between the eye centres.
  private static let foreheadGapAboveBrow = 0.12
  private static let foreheadTopAboveBrow = 0.50
  private static let foreheadHalfWidth = 0.50
  private static let cheekOuter = 0.30
  private static let cheekInner = 0.12
  private static let cheekMinWidth = 0.12
  private static let contourInset = 0.15
  // Shares of the distance from the eye line to the mouth.
  private static let cheekTop = 0.30
  private static let cheekBottom = 0.75
  // Shares of the face box.
  private static let chestGapBelowChin = 0.35
  private static let chestHeight = 0.80
  private static let chestWidth = 1.60
  private static let chestMinHeight = 0.30

  /// `imageSize` is the upright frame in pixels. Returns nil when a landmark group is missing.
  static func regions(for observation: VNFaceObservation, imageSize: CGSize) -> FaceRegions? {
    guard
      let landmarks = observation.landmarks,
      let eyeA = points(landmarks.leftEye, imageSize), let eyeB = points(landmarks.rightEye, imageSize),
      let browA = points(landmarks.leftEyebrow, imageSize), let browB = points(landmarks.rightEyebrow, imageSize),
      let lips = points(landmarks.outerLips, imageSize),
      let contour = points(landmarks.faceContour, imageSize)
    else { return nil }

    // Left and right mean "in the image", whatever Vision calls them.
    let eyes = [centroid(eyeA), centroid(eyeB)].sorted { $0.x < $1.x }
    let brows = [browA, browB].sorted { centroid($0).x < centroid($1).x }
    let leftEye = eyes[0], rightEye = eyes[1]
    let span = distance(leftEye, rightEye)
    guard span > 1 else { return nil }

    let across = CGVector(dx: (rightEye.x - leftEye.x) / span, dy: (rightEye.y - leftEye.y) / span)
    let middle = CGPoint(x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2)
    var down = CGVector(dx: -across.dy, dy: across.dx)
    var eyesToMouth = project(centroid(lips), from: middle, onto: down)
    if eyesToMouth < 0 {
      down = CGVector(dx: -down.dx, dy: -down.dy)
      eyesToMouth = -eyesToMouth
    }
    guard eyesToMouth > 0.3 * span else { return nil }

    /// A point given by its offsets from `origin` across the face and down it.
    func place(_ origin: CGPoint, across a: CGFloat, down d: CGFloat) -> CGPoint {
      CGPoint(x: origin.x + a * across.dx + d * down.dx, y: origin.y + a * across.dy + d * down.dy)
    }

    // Forehead: its lower edge follows the brows, its upper edge is a fixed height above them.
    let browTop = (brows[0] + brows[1]).map { -project($0, from: middle, onto: down) }.max() ?? 0
    let lowerEdge = brows.flatMap { brow -> [CGPoint] in
      let ordered = brow.sorted { project($0, from: middle, onto: across) < project($1, from: middle, onto: across) }
      return [ordered[ordered.count / 4], ordered[(3 * ordered.count) / 4]].map {
        place($0, across: 0, down: -foreheadGapAboveBrow * span)
      }
    }
    let top = -(browTop + foreheadTopAboveBrow * span)
    let forehead = lowerEdge + [
      place(middle, across: foreheadHalfWidth * span, down: top),
      place(middle, across: -foreheadHalfWidth * span, down: top),
    ]

    // Cheeks: below each eye, clear of the nose, and pulled in from the face contour so a turned
    // head does not put the outer edge on the background.
    let contourAcross = contour.map { project($0, from: middle, onto: across) }
    let leftLimit = (contourAcross.min() ?? -span) + contourInset * span
    let rightLimit = (contourAcross.max() ?? span) - contourInset * span
    let leftInner = project(leftEye, from: middle, onto: across) + cheekInner * span
    let rightInner = project(rightEye, from: middle, onto: across) - cheekInner * span
    let leftOuter = min(max(leftInner - (cheekOuter + cheekInner) * span, leftLimit), leftInner - cheekMinWidth * span)
    let rightOuter = max(min(rightInner + (cheekOuter + cheekInner) * span, rightLimit), rightInner + cheekMinWidth * span)
    let cheekTopOffset = cheekTop * eyesToMouth, cheekBottomOffset = cheekBottom * eyesToMouth

    func cheek(outer: CGFloat, inner: CGFloat) -> [CGPoint] {
      let edges = [min(outer, inner), max(outer, inner)]
      return [
        place(middle, across: edges[0], down: cheekTopOffset),
        place(middle, across: edges[1], down: cheekTopOffset),
        place(middle, across: edges[1], down: cheekBottomOffset),
        place(middle, across: edges[0], down: cheekBottomOffset),
      ]
    }

    let box = observation.boundingBox
    let face = CGRect(x: box.minX, y: 1 - box.maxY, width: box.width, height: box.height)
    let chin = (contour.map(\.y).max() ?? face.maxY * imageSize.height) / imageSize.height

    return FaceRegions(
      face: face,
      forehead: normalised(forehead, imageSize),
      leftCheek: normalised(cheek(outer: leftOuter, inner: leftInner), imageSize),
      rightCheek: normalised(cheek(outer: rightOuter, inner: rightInner), imageSize),
      chest: chest(below: chin, face: face)
    )
  }

  /// The upper chest: under the neck, as wide as the shoulders allow. Nil when too little of it
  /// is inside the frame to follow.
  private static func chest(below chin: CGFloat, face: CGRect) -> CGRect? {
    let wanted = CGRect(
      x: face.midX - chestWidth * face.width / 2,
      y: chin + chestGapBelowChin * face.height,
      width: chestWidth * face.width,
      height: chestHeight * face.height
    )
    let visible = wanted.intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
    guard !visible.isNull, visible.height >= chestMinHeight * face.height else { return nil }
    return visible
  }

  /// Landmark points in upright pixel coordinates (y down). Vision's are y up.
  private static func points(_ region: VNFaceLandmarkRegion2D?, _ size: CGSize) -> [CGPoint]? {
    guard let region, region.pointCount >= 2 else { return nil }
    return region.pointsInImage(imageSize: size).map { CGPoint(x: $0.x, y: size.height - $0.y) }
  }

  private static func normalised(_ points: [CGPoint], _ size: CGSize) -> [CGPoint] {
    points.map { CGPoint(x: $0.x / size.width, y: $0.y / size.height) }
  }

  private static func centroid(_ points: [CGPoint]) -> CGPoint {
    let sum = points.reduce(CGPoint.zero) { CGPoint(x: $0.x + $1.x, y: $0.y + $1.y) }
    return CGPoint(x: sum.x / CGFloat(points.count), y: sum.y / CGFloat(points.count))
  }

  private static func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat {
    hypot(a.x - b.x, a.y - b.y)
  }

  private static func project(_ point: CGPoint, from origin: CGPoint, onto axis: CGVector) -> CGFloat {
    (point.x - origin.x) * axis.dx + (point.y - origin.y) * axis.dy
  }
}

extension FaceRegions {
  /// Moves this set of regions a share `amount` (0 to 1) of the way toward `target`.
  func moved(toward target: FaceRegions, by amount: CGFloat) -> FaceRegions {
    func mix(_ a: CGFloat, _ b: CGFloat) -> CGFloat { a + (b - a) * amount }
    func mix(_ a: CGRect, _ b: CGRect) -> CGRect {
      CGRect(x: mix(a.minX, b.minX), y: mix(a.minY, b.minY), width: mix(a.width, b.width), height: mix(a.height, b.height))
    }
    func mix(_ a: [CGPoint], _ b: [CGPoint]) -> [CGPoint] {
      guard a.count == b.count else { return b }
      return zip(a, b).map { CGPoint(x: mix($0.x, $1.x), y: mix($0.y, $1.y)) }
    }
    var chestRect = target.chest
    if let from = chest, let to = target.chest { chestRect = mix(from, to) }
    return FaceRegions(
      face: mix(face, target.face),
      forehead: mix(forehead, target.forehead),
      leftCheek: mix(leftCheek, target.leftCheek),
      rightCheek: mix(rightCheek, target.rightCheek),
      chest: chestRect
    )
  }
}
