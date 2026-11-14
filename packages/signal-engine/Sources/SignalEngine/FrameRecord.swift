import Foundation

/// Mean colour of one skin region in one frame.
///
/// Each channel is the arithmetic mean of the 8-bit channel values (0 to 255) of every pixel
/// inside the region, taken from the camera's output after conversion to full-range RGB, with
/// no gamma change, white-balance correction or normalisation applied by the capture module.
public struct RegionColor: Codable, Sendable, Equatable {
  public var r: Double
  public var g: Double
  public var b: Double

  public init(r: Double, g: Double, b: Double) {
    self.r = r
    self.g = g
    self.b = b
  }
}

/// Where the tracked face is in the upright frame, as fractions of the frame's width and
/// height: the top-left corner and the size of the face box.
public struct FaceBox: Codable, Sendable, Equatable {
  public var x: Double
  public var y: Double
  public var width: Double
  public var height: Double

  public init(x: Double, y: Double, width: Double, height: Double) {
    self.x = x
    self.y = y
    self.width = width
    self.height = height
  }
}

public enum ExposureState: String, Codable, Sendable {
  /// Exposure, white balance or focus is still moving. Colour means are not comparable between frames.
  case adjusting
  /// Shutter, ISO, white balance and focus are fixed.
  case locked
}

/// One camera frame reduced to numbers. This is the only thing the capture module hands to the
/// engine, and one line of a sitting file. See docs/CONTRACTS.md section 1.
public struct FrameRecord: Codable, Sendable, Equatable {
  /// Seconds on the capture clock: the frame's presentation timestamp (host time base).
  /// Monotonic, strictly increasing within a sitting, unrelated to wall-clock time.
  public var t: Double
  /// A face is tracked in this frame. When false, the three colour means and `faceTrackId` are nil.
  public var facePresent: Bool
  public var forehead: RegionColor?
  /// The cheek on the left of the image as captured (the patient's right cheek on the rear camera).
  public var leftCheek: RegionColor?
  /// The cheek on the right of the image as captured.
  public var rightCheek: RegionColor?
  /// Vertical displacement of the upper-chest region between the previous delivered frame and
  /// this one, as a fraction of frame height. Positive is downward in the image. Nil on the
  /// first frame of a sitting and whenever the region cannot be tracked.
  public var chestMotion: Double?
  public var exposure: ExposureState
  /// Frames the camera dropped since the sitting started. Cumulative, never decreases.
  public var droppedFrames: Int
  /// Identifies the tracked face. A new value means a different face (or a re-acquired one)
  /// and the engine resets its signal history. Nil when no face is present.
  public var faceTrackId: Int?
  /// The face box, for telling a face that moved from light that changed, and a face too
  /// small or off-centre from one well placed. Recorded only: the engine does not read it.
  /// Nil when no face is tracked and in files written before it was added.
  public var face: FaceBox?
  /// What the camera was set to when it took the frame: sensitivity (ISO) and shutter time
  /// in milliseconds. With `exposure` locked they must not change; if they do, the camera
  /// moved the picture and not the patient. Recorded only. Nil when the source does not
  /// report them (simulated frames, dataset video) and in older files.
  public var iso: Double?
  public var exposureMs: Double?

  public init(
    t: Double,
    facePresent: Bool,
    forehead: RegionColor? = nil,
    leftCheek: RegionColor? = nil,
    rightCheek: RegionColor? = nil,
    chestMotion: Double? = nil,
    exposure: ExposureState,
    droppedFrames: Int,
    faceTrackId: Int? = nil,
    face: FaceBox? = nil,
    iso: Double? = nil,
    exposureMs: Double? = nil
  ) {
    self.t = t
    self.facePresent = facePresent
    self.forehead = forehead
    self.leftCheek = leftCheek
    self.rightCheek = rightCheek
    self.chestMotion = chestMotion
    self.exposure = exposure
    self.droppedFrames = droppedFrames
    self.faceTrackId = faceTrackId
    self.face = face
    self.iso = iso
    self.exposureMs = exposureMs
  }
}
