import Foundation

public enum EstimateState: String, Codable, Sendable {
  /// History is still accumulating; no value has been accepted since the last reset.
  case settling
  /// `value` is set and passed every check.
  case valid
  /// The engine looked and declined. `reason` says why. Shown as "No reading".
  case none
  /// No frame has arrived for longer than `EngineConfiguration.staleAfterSeconds`.
  case stale
}

/// Why an estimate is not `valid`. Raw values are the wire strings.
public enum EstimateReason: String, Codable, Sendable {
  /// Not enough signal history yet for a first window.
  case warmingUp = "warming_up"
  /// Windows exist but three consecutive ones have not agreed yet.
  case awaitingAgreement = "awaiting_agreement"
  case noFace = "no_face"
  /// The tracked face changed and history was reset.
  case faceChanged = "face_changed"
  case exposureAdjusting = "exposure_adjusting"
  /// Quality at the reported frequency is below the threshold.
  case lowQuality = "low_quality"
  /// Motion made part of the analysis window unusable.
  case motion
  /// The window has gaps or too few samples (dropped frames).
  case gaps
  /// The spectral peak sits at the edge of the search band.
  case bandEdge = "band_edge"
  /// The chest region is not being tracked (breathing only).
  case noChest = "no_chest"
  /// Frames stopped arriving. Always paired with `stale`.
  case noFrames = "no_frames"
}

/// One vital sign at one moment.
public struct Estimate: Codable, Sendable, Equatable {
  /// Heart rate in beats per minute or breathing rate in breaths per minute.
  /// Set if and only if `state` is `valid`. Never the last good value.
  public var value: Double?
  public var state: EstimateState
  /// Nil if and only if `state` is `valid`.
  public var reason: EstimateReason?
  /// Signal quality at the reported frequency, 0 to 1. 0 when there is no candidate.
  public var quality: Double
  /// Share of the sitting so far, 0 to 1, in which this estimate was `valid`,
  /// counted over the one-second readings since the first frame.
  public var coverage: Double
  /// Milliseconds since this estimate was last `valid`. 0 while valid. Nil if it has not been
  /// valid in this sitting.
  public var ageMs: Int?

  public init(
    value: Double?, state: EstimateState, reason: EstimateReason?,
    quality: Double, coverage: Double, ageMs: Int?
  ) {
    self.value = value
    self.state = state
    self.reason = reason
    self.quality = quality
    self.coverage = coverage
    self.ageMs = ageMs
  }

  public static func unavailable(_ state: EstimateState, _ reason: EstimateReason) -> Estimate {
    Estimate(value: nil, state: state, reason: reason, quality: 0, coverage: 0, ageMs: nil)
  }
}

/// What the engine knows at one moment. The capture module reads one per second.
public struct Reading: Codable, Sendable, Equatable {
  /// Capture-clock seconds this reading describes (same clock as `FrameRecord.t`).
  public var t: Double
  /// Seconds since the first frame of the sitting. 0 before any frame.
  public var elapsed: Double
  public var heartRate: Estimate
  public var breathingRate: Estimate

  public init(t: Double, elapsed: Double, heartRate: Estimate, breathingRate: Estimate) {
    self.t = t
    self.elapsed = elapsed
    self.heartRate = heartRate
    self.breathingRate = breathingRate
  }
}
