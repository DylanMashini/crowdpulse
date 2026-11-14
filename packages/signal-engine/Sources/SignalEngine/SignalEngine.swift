import Foundation

/// Streaming estimator for one sitting. Create one per sitting, feed it every frame record in
/// capture order, read `reading(at:)` once per second, and call `finish()` at the end.
///
/// `ingest` only stores the frame. The spectral work runs once per second of capture time,
/// on the first frame at or after each whole second since the first frame.
///
/// Not thread-safe: call every method from the same queue.
public final class SignalEngine {
  public let configuration: EngineConfiguration

  private struct Tick {
    /// Capture-clock time the tick describes.
    var time: Double
    var heart: TickEstimate
    var breathing: TickEstimate
  }

  private let fourier = Fourier()
  private var pulse: PulseTracker
  private var breathing: BreathingTracker
  private var ticks: [Tick] = []
  private var firstFrameTime: Double?
  private var lastFrameTime: Double?
  private var frameCount = 0
  private var droppedFrames = 0

  /// Set before the first frame to keep a `PulseDiagnostic` for every one-second heart-rate
  /// reading. For tuning and field debugging: readings and the summary are the same with it
  /// on or off, and it costs one more analysis for each window a check refuses early.
  public var collectsDiagnostics = false {
    didSet { pulse.collectsDiagnostics = collectsDiagnostics }
  }
  /// One entry per whole second since the first frame, in time order. Empty unless
  /// `collectsDiagnostics` is set.
  public private(set) var diagnostics: [PulseDiagnostic] = []

  public init(configuration: EngineConfiguration = .default) {
    self.configuration = configuration
    pulse = PulseTracker(configuration: configuration, fourier: fourier)
    breathing = BreathingTracker(configuration: configuration, fourier: fourier)
  }

  /// Adds one frame. Frames must arrive with strictly increasing `t`; a frame at or before the
  /// previous `t` is ignored.
  public func ingest(_ frame: FrameRecord) {
    if let last = lastFrameTime, frame.t <= last { return }
    let interval = lastFrameTime.map { frame.t - $0 }
    let first = firstFrameTime ?? frame.t
    firstFrameTime = first
    lastFrameTime = frame.t
    frameCount += 1
    droppedFrames = max(droppedFrames, frame.droppedFrames)

    let faceChanged = pulse.ingest(frame, interval: interval)
    breathing.ingest(frame, interval: interval, faceChanged: faceChanged)

    while frame.t >= first + Double(ticks.count + 1) {
      let time = first + Double(ticks.count + 1)
      if frame.t < time + 1 {
        ticks.append(Tick(time: time, heart: pulse.tick(at: frame.t), breathing: breathing.tick(at: frame.t)))
      } else {
        // Whole seconds that passed without a frame.
        pulse.missedTick()
        breathing.missedTick()
        let silent = TickEstimate.withheld(.stale, .noFrames)
        ticks.append(Tick(time: time, heart: silent, breathing: silent))
      }
      if collectsDiagnostics, var diagnostic = pulse.lastDiagnostic, let heart = ticks.last?.heart {
        diagnostic.elapsed = time - first
        diagnostic.state = heart.state
        diagnostic.reason = heart.reason
        diagnostic.value = heart.value
        diagnostic.quality = heart.quality
        diagnostics.append(diagnostic)
      }
    }
  }

  /// The current reading. `t` is "now" on the capture clock; pass nil to use the newest frame's
  /// time. Passing the real current time is what lets the engine report `stale` when the camera
  /// goes silent.
  public func reading(at t: Double? = nil) -> Reading {
    let now = t ?? lastFrameTime ?? 0
    guard let first = firstFrameTime, let last = lastFrameTime else {
      let waiting = Estimate.unavailable(.settling, .warmingUp)
      return Reading(t: now, elapsed: 0, heartRate: waiting, breathingRate: waiting)
    }
    let elapsed = max(0, now - first)
    let silent = now - last > configuration.staleAfterSeconds
    // Seconds of silence count against coverage even though no frame arrived to tick them.
    let seconds = silent ? max(ticks.count, Int(elapsed)) : ticks.count

    func estimate(_ vital: KeyPath<Tick, TickEstimate>, blocked: EstimateReason?) -> Estimate {
      let valid = ticks.filter { $0[keyPath: vital].state == .valid }
      let coverage = seconds > 0 ? Double(valid.count) / Double(seconds) : 0
      let age = valid.last.map { max(0, Int(((now - $0.time) * 1000).rounded())) }
      let current: TickEstimate
      if silent {
        current = .withheld(.stale, .noFrames)
      } else if let blocked {
        // The newest frame already rules a reading out; do not wait for the next tick.
        current = .withheld(.none, blocked)
      } else {
        current = ticks.last?[keyPath: vital] ?? .withheld(.settling, .warmingUp)
      }
      return Estimate(
        value: current.value, state: current.state, reason: current.reason,
        quality: min(1, max(0, current.quality)), coverage: coverage,
        ageMs: current.state == .valid ? 0 : age)
    }

    return Reading(
      t: now, elapsed: elapsed,
      heartRate: estimate(\.heart, blocked: pulse.blocked),
      breathingRate: estimate(\.breathing, blocked: breathing.blocked(at: last)))
  }

  /// Ends the sitting and returns its summary. The engine can be reused after `reset()`.
  public func finish() -> SittingSummary {
    guard let first = firstFrameTime, let last = lastFrameTime else {
      let none = SummaryValue(value: nil, coverage: 0, reason: EstimateReason.noFrames.rawValue)
      return SittingSummary(
        durationSeconds: 0, frameCount: 0, droppedFrames: 0,
        heartRate: none, breathingRate: none, rmssd: none, sdnn: none,
        beatIntervals: [], timeToFirstReadingSeconds: nil, longestDropoutSeconds: 0)
    }
    let duration = last - first
    let beats = BeatAnalyzer(
      configuration: configuration,
      pulse: PulseAnalyzer(configuration: configuration, fourier: fourier)
    ).analyse(
      history: pulse.history, windows: pulse.validWindows, weights: pulse.regionWeightSums,
      origin: first, duration: duration)

    let firstValid = ticks.firstIndex { $0.heart.state == .valid }
    var longestDropout = 0
    var dropout = 0
    for tick in ticks.dropFirst(firstValid ?? ticks.count) {
      dropout = tick.heart.state == .valid ? 0 : dropout + 1
      longestDropout = max(longestDropout, dropout)
    }

    func positive(_ value: Double?) -> Double? {
      value.flatMap { $0 > 0 ? $0 : nil }
    }
    // The sitting's heart rate is the median of its valid readings. When there are too few
    // of those, the whole sitting is asked instead.
    var heartRate = summary(\.heart)
    var source: HeartRateSource? = heartRate.value == nil ? nil : .readings
    var confidence: HeartRateConfidence? = heartRate.value == nil ? nil : .normal
    let whole = WholeSittingAnalyzer(configuration: configuration).estimate(pulse.evidence, origin: first)
    let valid = ticks.compactMap(\.heart.value)
    func near(_ bpm: Double, _ other: Double) -> Bool {
      abs(bpm - other) <= configuration.agreementToleranceBpm
    }
    if let median = heartRate.value {
      // A handful of readings is what noise produces now and then. They stand for the
      // sitting only if the sitting as a whole says the same, and then with less confidence.
      if valid.count < configuration.minimumUncorroboratedReadings {
        if whole.corroborates, let bpm = whole.heartRate, near(bpm, median) {
          confidence = .low
        } else {
          heartRate = SummaryValue(
            value: nil, coverage: heartRate.coverage, reason: SummaryReason.tooFewReadings.rawValue)
          source = nil
          confidence = nil
        }
      }
    } else if whole.accepted, let bpm = whole.heartRate, valid.allSatisfy({ near(bpm, $0) }) {
      // No readings to speak of, and the one or two there were do not say otherwise.
      heartRate = SummaryValue(value: bpm, coverage: heartRate.coverage)
      source = .wholeSitting
      confidence = .low
    }
    var summary = SittingSummary(
      durationSeconds: duration,
      frameCount: frameCount,
      droppedFrames: droppedFrames,
      heartRate: heartRate,
      breathingRate: summary(\.breathing),
      rmssd: SummaryValue(value: positive(beats.rmssd), coverage: beats.coverage, reason: beats.withheld?.rawValue),
      sdnn: SummaryValue(value: positive(beats.sdnn), coverage: beats.coverage, reason: beats.withheld?.rawValue),
      beatIntervals: beats.intervals,
      timeToFirstReadingSeconds: firstValid.map { ticks[$0].time - first },
      longestDropoutSeconds: firstValid == nil ? duration : Double(longestDropout)
    )
    summary.heartRateSource = source
    summary.heartRateConfidence = confidence
    summary.wholeSitting = whole.windows > 0 ? whole : nil
    return summary
  }

  /// Median of the valid one-second readings, or the commonest reason there were too few.
  private func summary(_ vital: KeyPath<Tick, TickEstimate>) -> SummaryValue {
    let estimates = ticks.map { $0[keyPath: vital] }
    let values = estimates.compactMap(\.value)
    let coverage = ticks.isEmpty ? 0 : Double(values.count) / Double(ticks.count)
    if values.count >= configuration.minimumSummaryReadings, let median = DSP.median(values) {
      return SummaryValue(value: median, coverage: coverage)
    }
    var counts: [EstimateReason: Int] = [:]
    for reason in estimates.compactMap(\.reason) { counts[reason, default: 0] += 1 }
    let commonest = counts.max { ($0.value, $0.key.rawValue) < ($1.value, $1.key.rawValue) }?.key
    let reason = values.isEmpty
      ? (commonest ?? .warmingUp).rawValue
      : SummaryReason.tooFewReadings.rawValue
    return SummaryValue(value: nil, coverage: coverage, reason: reason)
  }

  /// Discards all history, as if newly created.
  public func reset() {
    pulse = PulseTracker(configuration: configuration, fourier: fourier)
    pulse.collectsDiagnostics = collectsDiagnostics
    breathing = BreathingTracker(configuration: configuration, fourier: fourier)
    ticks.removeAll()
    diagnostics.removeAll()
    firstFrameTime = nil
    lastFrameTime = nil
    frameCount = 0
    droppedFrames = 0
  }
}
