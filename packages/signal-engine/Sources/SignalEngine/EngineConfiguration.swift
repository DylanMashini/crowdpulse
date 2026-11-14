import Foundation

/// Tunable parameters. The defaults are the plan's numbers (sections 4 and 7) where the plan
/// gives one. Every other default is a starting guess to be calibrated on real recordings
/// (Gate A for heart rate, B for breathing, C for variability).
public struct EngineConfiguration: Codable, Sendable, Equatable {
  /// Expected capture rate in frames per second. Timestamps, not this value, drive the maths.
  public var nominalFrameRate: Double = 60
  /// Pulse band-pass in Hz.
  public var heartRateBandHz: ClosedRange<Double> = 0.7...3.0
  /// Range the heart-rate peak search may report, in bpm.
  public var heartRateSearchBpm: ClosedRange<Double> = 42...180
  /// Breathing band-pass in Hz.
  public var breathingBandHz: ClosedRange<Double> = 0.1...0.7
  /// Quality (0 to 1) an estimate needs to be valid. Calibrated on negative controls.
  public var qualityThreshold: Double = 0.5
  /// Consecutive agreeing windows needed before a reading is shown.
  public var agreeingWindows: Int = 3
  /// Windows agree when their rates differ by no more than this, in bpm.
  public var agreementToleranceBpm: Double = 5
  /// With no frame for this long, `reading(at:)` reports `stale`.
  public var staleAfterSeconds: Double = 2

  // MARK: Sampling

  /// Uniform rate the irregular frame timestamps are resampled to, in Hz.
  public var resampleRateHz: Double = 60
  /// A step between neighbouring frames longer than this is a gap, in seconds.
  public var maximumGapSeconds: Double = 0.25
  /// A window needs at least this share of the frames its median frame interval predicts.
  public var minimumSampleShare: Double = 0.85
  /// A window delivered at fewer frames per second than this has too few samples.
  public var minimumFrameRate: Double = 20
  /// Frames older than this are dropped from the history that `finish()` reads beat
  /// intervals from, in seconds.
  public var maximumHistorySeconds: Double = 300

  // MARK: Heart rate

  /// Longest analysis window, in seconds.
  public var heartRateWindowSeconds: Double = 10
  /// Shortest analysis window; the window grows from this to `heartRateWindowSeconds`.
  public var heartRateMinimumWindowSeconds: Double = 6
  /// A peak closer than this to either end of `heartRateSearchBpm` is rejected.
  public var bandEdgeMarginBpm: Double = 2
  /// Two spectral peaks whose powers are within this ratio are tied; only then does a
  /// harmonic relation choose between them.
  public var harmonicTieRatio: Double = 0.8
  /// A peak is taken for a second harmonic when the spectrum also has a peak at half its
  /// frequency with at least this share of its power. The search for that peak reaches
  /// below `heartRateBandHz`, down to half its lower edge.
  public var subharmonicPowerFloor: Double = 0.02
  /// That peak must also stand this many times above the noise: the median power of the
  /// spectrum away from the two peaks.
  public var subharmonicNoiseRatio: Double = 16
  /// Frequencies lamps flicker at, in Hz: mains (50 or 60) and twice mains.
  public var flickerFrequenciesHz: [Double] = [50, 60, 100, 120]
  /// A peak closer than this to where one of `flickerFrequenciesHz` appears at the frame
  /// rate the camera delivered is rejected, in bpm.
  public var flickerAliasMarginBpm: Double = 6
  /// Half-width of the interval the quality score integrates around the reported
  /// frequency, as a multiple of the window's frequency resolution (1 / window length).
  public var qualityHalfWidthResolutions: Double = 1.25
  /// Share of what the two colour-difference signals hold at the reported frequency that
  /// must survive the projection's sum. Blood keeps nearly all of it; a change in the colour
  /// of the light keeps a few per cent.
  public var minimumProjectionYield: Double = 0.1

  // MARK: Motion

  /// The colour of a skin region is compared over two neighbouring stretches of this length,
  /// in seconds: its mean share of red, green and blue in the newest one against the one
  /// before. Blood changes those shares by a fraction of a per cent; skin sliding under the
  /// region, or light of another colour, changes them by more.
  public var colourJumpSeconds: Double = 0.25
  /// A change of that share smaller than this fraction is never a jump.
  public var colourJumpDeviation: Double = 0.012
  /// Nor is one smaller than this many times the window's median change, which is the
  /// recording's own noise.
  public var colourJumpNoiseRatio: Double = 4
  /// A change larger than this fraction is a jump however noisy the window is, so that a
  /// subject who never stops moving cannot raise the bar.
  public var colourJumpCeiling: Double = 0.03
  /// A frame is in motion when the chest moves faster than this, in frame heights per second.
  /// For heart rate this counts only while the chest is tracked (`minimumChestTrackedShare`).
  public var motionChestSpeed: Double = 0.08
  /// Chest speed says something about the patient only when the chest region is followed
  /// steadily: it must have a value in this share of the frames of the last
  /// `chestTrackingSeconds`. A region found for a few frames at a time reports its search
  /// limit, not a movement.
  public var minimumChestTrackedShare: Double = 0.9
  public var chestTrackingSeconds: Double = 2
  /// Frames around a colour jump or a fast chest are cut out of the heart-rate window and
  /// the rest is analysed. The window is rejected as motion only when more than this share
  /// of it is cut.
  public var maximumDisturbedShare: Double = 0.3
  /// A breathing window is rejected when more than this share of its frames are in motion.
  public var maximumMotionShare: Double = 0.05

  // MARK: Breathing

  /// Longest breathing window, in seconds.
  public var breathingWindowSeconds: Double = 45
  /// Chest signal needed before the first breathing window, in seconds.
  public var breathingMinimumWindowSeconds: Double = 40
  /// Quality (0 to 1) a breathing estimate needs to be valid.
  public var breathingQualityThreshold: Double = 0.5
  /// Breathing windows agree when their rates differ by no more than this, in breaths per minute.
  public var breathingAgreementTolerancePerMin: Double = 2
  /// A breathing peak closer than this to either end of the band is rejected, in breaths per minute.
  public var breathingBandEdgeMarginPerMin: Double = 0.75
  /// As `qualityHalfWidthResolutions`, for breathing. Wider because breaths are less regular.
  public var breathingQualityHalfWidthResolutions: Double = 2
  /// The chest history restarts when the chest is untracked for longer than this, in seconds.
  public var chestGapSeconds: Double = 0.5

  // MARK: Beat intervals

  /// Rate the pulse waveform is interpolated to before beats are located, in Hz.
  public var beatUpsampleRateHz: Double = 250
  /// An interval is rejected when it differs from the median of its neighbours by more
  /// than this fraction.
  public var beatIntervalTolerance: Double = 0.2
  /// RMSSD and SDNN are reported only when accepted intervals span at least this share of
  /// the sitting.
  public var minimumBeatCoverage: Double = 0.6
  /// RMSSD and SDNN need at least this many accepted intervals.
  public var minimumBeatIntervals: Int = 20
  /// The forehead and the cheeks, timed separately, may disagree about the length of the
  /// same beat intervals by this much (RMS, in ms) whatever the variability is. Timing
  /// noise inflates RMSSD and SDNN long before it moves the heart rate.
  public var maximumBeatDisagreementMs: Double = 12
  /// Beyond `maximumBeatDisagreementMs`, RMSSD and SDNN are withheld when the timing noise
  /// estimated from the disagreement makes up more than this share of the squared RMSSD.
  /// At 0.25 the noise adds at most 15% to RMSSD.
  public var maximumBeatNoiseShare: Double = 0.25
  /// RMSSD and SDNN are withheld when more than this share of the beat intervals found
  /// were rejected.
  public var maximumRejectedBeatShare: Double = 0.25

  // MARK: Summary

  /// The sitting's heart or breathing rate needs at least this many valid one-second readings.
  public var minimumSummaryReadings: Int = 3

  public init() {}

  public static let `default` = EngineConfiguration()
}
