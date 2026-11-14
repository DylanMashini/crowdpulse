import Foundation

/// A value for the whole sitting with the share of the sitting that supports it.
public struct SummaryValue: Codable, Sendable, Equatable {
  /// Nil when the sitting did not produce an acceptable value: "No reading".
  public var value: Double?
  /// 0 to 1. For heart and breathing rate, the share of one-second readings that were valid.
  /// For RMSSD and SDNN, the share of the sitting spanned by accepted beat intervals.
  public var coverage: Double
  /// Why `value` is nil; nil when there is a value. For heart and breathing rate this is the
  /// most frequent `EstimateReason` wire string among the readings that were not valid, or
  /// `too_few_readings`. For RMSSD and SDNN it is a `SummaryReason` wire string.
  public var reason: String?

  public init(value: Double?, coverage: Double, reason: String? = nil) {
    self.value = value
    self.coverage = coverage
    self.reason = reason
  }
}

/// Why a whole-sitting value is withheld, beyond the per-reading `EstimateReason`s.
public enum SummaryReason: String, Codable, Sendable {
  /// Valid one-second readings were too few to stand for the sitting.
  case tooFewReadings = "too_few_readings"
  /// No heart-rate reading was valid, so there was nowhere to look for beats.
  case noHeartRate = "no_heart_rate"
  /// The pulse was good enough for a rate, but skin regions disagree about when single
  /// beats fell, so their timing is noise.
  case lowQuality = "low_quality"
  case tooFewBeats = "too_few_beats"
  /// Accepted beat intervals span too little of the sitting.
  case lowBeatCoverage = "low_beat_coverage"
}

/// One accepted beat-to-beat interval.
public struct BeatInterval: Codable, Sendable, Equatable {
  /// Milliseconds from the first frame of the sitting to the beat that ends this interval.
  public var tMs: Double
  /// Interval length in milliseconds.
  public var ms: Double

  public init(tMs: Double, ms: Double) {
    self.tMs = tMs
    self.ms = ms
  }
}

/// Where a sitting's heart rate came from.
public enum HeartRateSource: String, Codable, Sendable {
  /// The median of the valid one-second readings.
  case readings
  /// The whole-sitting estimate: too few one-second readings were valid, but the sitting as
  /// a whole holds one rhythm clearly enough. Lower confidence than `readings`.
  case wholeSitting = "whole_sitting"
}

public struct SittingSummary: Codable, Sendable, Equatable {
  /// First frame to last frame, in seconds.
  public var durationSeconds: Double
  public var frameCount: Int
  public var droppedFrames: Int
  /// Median of the valid one-second heart-rate readings, in bpm. With too few of them, the
  /// whole-sitting estimate when it was accepted (`heartRateSource`); `coverage` is the share
  /// of valid one-second readings either way.
  public var heartRate: SummaryValue
  /// Median of the valid one-second breathing-rate readings, in breaths per minute.
  public var breathingRate: SummaryValue
  /// Root mean square of successive differences of accepted beat intervals, in ms. Experimental.
  public var rmssd: SummaryValue
  /// Standard deviation of accepted beat intervals, in ms. Experimental.
  public var sdnn: SummaryValue
  /// Accepted intervals in time order, after outlier rejection.
  public var beatIntervals: [BeatInterval]
  /// Seconds from the first frame to the first valid heart-rate reading. Nil if there was none.
  public var timeToFirstReadingSeconds: Double?
  /// Longest run without a valid heart-rate reading after the first one, in seconds.
  public var longestDropoutSeconds: Double
  /// Which path `heartRate.value` came from. Nil when there is no heart rate.
  public var heartRateSource: HeartRateSource?
  /// The whole-sitting estimate and its evidence, whether or not it was needed or
  /// accepted. Nil when no window of the sitting could be analysed.
  public var wholeSitting: WholeSittingEstimate?

  public init(
    durationSeconds: Double, frameCount: Int, droppedFrames: Int,
    heartRate: SummaryValue, breathingRate: SummaryValue,
    rmssd: SummaryValue, sdnn: SummaryValue,
    beatIntervals: [BeatInterval],
    timeToFirstReadingSeconds: Double?, longestDropoutSeconds: Double
  ) {
    self.durationSeconds = durationSeconds
    self.frameCount = frameCount
    self.droppedFrames = droppedFrames
    self.heartRate = heartRate
    self.breathingRate = breathingRate
    self.rmssd = rmssd
    self.sdnn = sdnn
    self.beatIntervals = beatIntervals
    self.timeToFirstReadingSeconds = timeToFirstReadingSeconds
    self.longestDropoutSeconds = longestDropoutSeconds
  }
}
