import Foundation

/// The check that kept a one-second heart-rate reading from being valid. `EstimateReason` is
/// what the wire carries and folds several checks into one string; this names each check.
/// The cases are in the order the engine applies them: a window refused by one check was
/// never looked at by the later ones.
public enum PulseGate: String, Codable, Sendable, CaseIterable {
  /// A whole second passed without a frame. Reason `no_frames`.
  case noFrames = "no_frames"
  /// The newest frame has no face, or no skin region with a colour. Reason `no_face`.
  case noFace = "no_face"
  /// The newest frame was taken while exposure was adjusting. Reason `exposure_adjusting`.
  case exposureAdjusting = "exposure_adjusting"
  /// Less than `heartRateMinimumWindowSeconds` since the face was found, exposure locked or
  /// the face changed. Reason `warming_up` or `face_changed`.
  case warmingUp = "warming_up"
  /// A step between frames longer than `maximumGapSeconds` lies less than
  /// `heartRateMinimumWindowSeconds` back. Reason `gaps`.
  case recentGap = "recent_gap"
  /// The window holds under `minimumSampleShare` of the frames its median interval
  /// predicts, or fewer than `minimumFrameRate` frames per second. Reason `gaps`.
  case tooFewSamples = "too_few_samples"
  /// More than `maximumDisturbedShare` of the window had to be cut out around colour jumps
  /// and fast chest movement. Reason `motion`.
  case motion
  /// No skin region has a colour in every frame of the window. Reason `gaps`.
  case incompleteRegions = "incomplete_regions"
  /// The pulse band holds no power. Reason `low_quality`.
  case flat
  /// The peak, or half of it when it was taken for a second harmonic, is within
  /// `bandEdgeMarginBpm` of an end of `heartRateSearchBpm`. Reason `band_edge`.
  case bandEdge = "band_edge"
  /// The peak is within `flickerAliasMarginBpm` of where lamp flicker aliases at the
  /// delivered frame rate. Reason `low_quality`.
  case flicker
  /// Under `minimumProjectionYield` of the colour signal at the peak survives the
  /// projection. Reason `low_quality`.
  case illumination
  /// Quality at the peak is under `qualityThreshold`. Reason `low_quality`.
  case quality
  /// The last `agreeingWindows` windows did not all pass, or their rates differ by more
  /// than `agreementToleranceBpm`. Reason `awaiting_agreement`.
  case agreement
}

/// Why one one-second heart-rate reading came out as it did, and what the window would
/// have reported had nothing refused it. For tuning and field debugging only: collecting
/// these changes no reading and no summary.
public struct PulseDiagnostic: Codable, Sendable, Equatable {
  /// Seconds since the first frame of the sitting.
  public var elapsed = 0.0
  public var state = EstimateState.settling
  public var reason: EstimateReason?
  /// The reading's value. Set if and only if `state` is `valid`.
  public var value: Double?
  public var quality = 0.0
  /// The check that refused the reading. Nil if and only if `state` is `valid`.
  public var gate: PulseGate?

  /// Length of the window the checks looked at, in seconds. Nil when there was none.
  public var windowSeconds: Double?
  /// Frames in that window.
  public var frames: Int?
  /// Those frames as a share of what the window's median frame interval predicts
  /// (`minimumSampleShare`).
  public var sampleShare: Double?
  /// Those frames per second of window (`minimumFrameRate`).
  public var framesPerSecond: Double?
  /// Share of the window cut out of the analysis (`maximumDisturbedShare`): the frames
  /// around colour jumps and fast chest movement, and stretches between them too short to
  /// analyse.
  public var motionShare: Double?
  /// Share of the window's frames cut because the regions' colour jumped
  /// (`colourJumpDeviation`, `colourJumpNoiseRatio`, `colourJumpCeiling`).
  public var colourJumpShare: Double?
  /// Share cut because the chest moved fast while it was tracked (`motionChestSpeed`,
  /// `minimumChestTrackedShare`).
  public var chestMotionShare: Double?

  /// What the window would report with every check switched off, in bpm: its strongest
  /// spectral peak, or half of it when that was taken for a second harmonic. Nil when the
  /// window is too short to analyse or its pulse band is empty.
  public var candidateBpm: Double?
  /// Quality at `candidateBpm` (`qualityThreshold`).
  public var candidateQuality: Double?
  /// The strongest spectral peak before any harmonic correction, in bpm.
  public var strongestPeakBpm: Double?
  public var strongestPeakQuality: Double?
  /// The strongest peak was taken for a second harmonic and halved.
  public var halved: Bool?
  /// The strongest peak is where lamp flicker aliases at the delivered frame rate.
  public var flickerAlias: Bool?
  /// Share of the colour signal at the candidate that survives the projection
  /// (`minimumProjectionYield`). Nil when the check did not run.
  public var projectionYield: Double?
  /// How many of the last `agreeingWindows` windows passed every check before agreement,
  /// this one included.
  public var passingWindows: Int?
  /// Highest minus lowest rate of those windows, in bpm (`agreementToleranceBpm`). Nil
  /// unless all of them passed.
  public var agreementSpreadBpm: Double?

  public init() {}
}

extension PulseDiagnostic {
  /// Copies what the analysis found in a window.
  mutating func note(_ detail: PulseAnalyzer.Detail) {
    candidateBpm = detail.candidateHz.map { $0 * 60 }
    candidateQuality = detail.candidateQuality
    strongestPeakBpm = detail.strongest.map { $0.hz * 60 }
    strongestPeakQuality = detail.strongest?.quality
    guard detail.strongest != nil else { return }
    halved = detail.halved
    flickerAlias = detail.flickerAlias
    projectionYield = detail.projectionYield
  }
}
