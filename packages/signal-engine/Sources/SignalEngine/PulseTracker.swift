import Foundation

/// What one vital sign looked like at one whole second of the sitting.
struct TickEstimate {
  var state: EstimateState
  var reason: EstimateReason?
  var value: Double?
  var quality: Double

  static func valid(_ value: Double, quality: Double) -> TickEstimate {
    TickEstimate(state: .valid, reason: nil, value: value, quality: quality)
  }

  static func withheld(_ state: EstimateState, _ reason: EstimateReason, quality: Double = 0) -> TickEstimate {
    TickEstimate(state: state, reason: reason, value: nil, quality: quality)
  }
}

/// Passes a rate only when the last `required` windows all produced one and they agree.
struct AgreementGate {
  let required: Int
  let tolerance: Double
  private var recent: [Double?] = []

  init(required: Int, tolerance: Double) {
    self.required = max(1, required)
    self.tolerance = tolerance
  }

  mutating func push(_ rate: Double?) {
    recent.append(rate)
    if recent.count > required { recent.removeFirst() }
  }

  var agreed: Bool {
    let rates = recent.compactMap { $0 }
    guard rates.count == required, let low = rates.min(), let high = rates.max() else { return false }
    return high - low <= tolerance
  }

  mutating func reset() {
    recent.removeAll()
  }
}

/// Usable frames of the sitting: face present, exposure locked. Missing regions are NaN.
struct PulseHistory {
  static let regionCount = 3

  private(set) var times: [Double] = []
  /// Nine series: region (forehead, left cheek, right cheek) times channel (r, g, b).
  private(set) var channels = [[Double]](repeating: [], count: 3 * PulseHistory.regionCount)
  private(set) var motion: [Bool] = []

  mutating func append(time: Double, frame: FrameRecord, motion inMotion: Bool) {
    times.append(time)
    for (region, colour) in [frame.forehead, frame.leftCheek, frame.rightCheek].enumerated() {
      channels[3 * region].append(colour?.r ?? .nan)
      channels[3 * region + 1].append(colour?.g ?? .nan)
      channels[3 * region + 2].append(colour?.b ?? .nan)
    }
    motion.append(inMotion)
  }

  /// Index of the first frame at or after `time`.
  func index(atOrAfter time: Double) -> Int {
    var low = 0
    var high = times.count
    while low < high {
      let middle = (low + high) / 2
      if times[middle] < time { low = middle + 1 } else { high = middle }
    }
    return low
  }

  mutating func removeFrames(before time: Double) {
    let count = index(atOrAfter: time)
    guard count > 0 else { return }
    times.removeFirst(count)
    motion.removeFirst(count)
    for series in channels.indices { channels[series].removeFirst(count) }
  }

  /// Regions with a colour in every frame of `range`, resampled to a uniform grid that ends
  /// at the last frame of the range.
  func regions(in range: Range<Int>, rate: Double) -> [(region: Int, series: RegionSeries)] {
    guard range.count >= 2 else { return [] }
    let end = times[range.upperBound - 1]
    let count = Int(((end - times[range.lowerBound]) * rate).rounded(.down)) + 1
    let start = end - Double(count - 1) / rate
    return (0..<PulseHistory.regionCount).compactMap { region in
      let series = (0..<3).map { channels[3 * region + $0] }
      guard !series[0][range].contains(where: \.isNaN) else { return nil }
      let resampled = series.map {
        DSP.resample(times: times, values: $0, range: range, start: start, rate: rate, count: count)
      }
      return (region, RegionSeries(r: resampled[0], g: resampled[1], b: resampled[2]))
    }
  }
}

/// A window that produced a valid heart-rate reading. `finish()` looks for beats inside these.
struct ValidPulseWindow {
  var start: Double
  var end: Double
  var rateHz: Double
}

/// Heart-rate state for one sitting: the frame history, the checks that decide whether a
/// window may be analysed, and the agreement gate.
struct PulseTracker {
  /// Frame intervals may stray this far from whole frame periods (RMS, in periods) and
  /// still count as a regular grid.
  static let maximumGridDeviation = 0.15

  private let configuration: EngineConfiguration
  private let analyzer: PulseAnalyzer

  private(set) var history = PulseHistory()
  private(set) var validWindows: [ValidPulseWindow] = []
  /// Sum over valid windows of each region's weight in the combined signal.
  private(set) var regionWeightSums = [Double](repeating: 0, count: PulseHistory.regionCount)

  /// Why the newest frame cannot be used, or nil when it can.
  private(set) var blocked: EstimateReason?
  private var segmentStart: Double?
  private var warmUpReason = EstimateReason.warmingUp
  private var trackId: Int?
  private var brightnessBaseline: Double?
  private var gate: AgreementGate
  private var acceptedSinceReset = false

  init(configuration: EngineConfiguration, fourier: Fourier) {
    self.configuration = configuration
    analyzer = PulseAnalyzer(configuration: configuration, fourier: fourier)
    gate = AgreementGate(
      required: configuration.agreeingWindows, tolerance: configuration.agreementToleranceBpm)
  }

  /// Returns true when the tracked face changed with this frame.
  mutating func ingest(_ frame: FrameRecord, interval: Double?) -> Bool {
    var faceChanged = false
    if let id = frame.faceTrackId {
      if let previous = trackId, previous != id {
        endSegment()
        warmUpReason = .faceChanged
        faceChanged = true
      }
      trackId = id
    }

    let regions = [frame.forehead, frame.leftCheek, frame.rightCheek].compactMap { $0 }
    guard frame.facePresent, !regions.isEmpty else {
      endSegment()
      blocked = .noFace
      return faceChanged
    }
    guard frame.exposure == .locked else {
      endSegment()
      blocked = .exposureAdjusting
      return faceChanged
    }
    blocked = nil
    if segmentStart == nil { segmentStart = frame.t }

    let brightness = regions.reduce(0) { $0 + $1.r + $1.g + $1.b } / Double(regions.count)
    var inMotion = false
    if let baseline = brightnessBaseline, let interval, baseline > 0 {
      inMotion = abs(brightness - baseline) / baseline > configuration.motionColourDeviation
      let blend = min(1, interval / configuration.motionBaselineSeconds)
      brightnessBaseline = baseline + blend * (brightness - baseline)
    } else {
      brightnessBaseline = brightness
    }
    if let chest = frame.chestMotion, let interval, abs(chest) / interval > configuration.motionChestSpeed {
      inMotion = true
    }
    history.append(time: frame.t, frame: frame, motion: inMotion)

    if frame.t - history.times[0] > 2 * configuration.maximumHistorySeconds {
      history.removeFrames(before: frame.t - configuration.maximumHistorySeconds)
    }
    return faceChanged
  }

  /// Signal history never carries across a lost face, an exposure change or a new face.
  private mutating func endSegment() {
    segmentStart = nil
    brightnessBaseline = nil
    acceptedSinceReset = false
    gate.reset()
  }

  /// The second passed with no frame.
  mutating func missedTick() {
    gate.push(nil)
  }

  /// Analyses the window that ends at the newest frame. Called once per second.
  mutating func tick(at now: Double) -> TickEstimate {
    if let blocked {
      return .withheld(.none, blocked)
    }
    guard let segmentStart, now - segmentStart >= configuration.heartRateMinimumWindowSeconds else {
      return .withheld(.settling, warmUpReason)
    }
    warmUpReason = .warmingUp
    var windowSeconds = min(now - segmentStart, configuration.heartRateWindowSeconds)
    var range = history.index(atOrAfter: now - windowSeconds)..<history.times.count

    // A window never spans a gap: it starts after the newest one, and is rejected until
    // enough gap-free signal has built up again.
    if let afterGap = range.dropFirst().last(where: {
      history.times[$0] - history.times[$0 - 1] > configuration.maximumGapSeconds
    }) {
      range = afterGap..<range.upperBound
      windowSeconds = now - history.times[afterGap]
      if windowSeconds < configuration.heartRateMinimumWindowSeconds {
        gate.push(nil)
        return .withheld(.none, .gaps)
      }
    }
    if let rejection = rejection(of: range, windowSeconds: windowSeconds) {
      gate.push(nil)
      return .withheld(.none, rejection)
    }
    let regions = history.regions(in: range, rate: configuration.resampleRateHz)
    guard !regions.isEmpty else {
      gate.push(nil)
      return .withheld(.none, .gaps)
    }
    let outcome = analyzer.analyse(
      regions.map(\.series), rate: configuration.resampleRateHz, frameRate: frameRate(of: range))

    switch outcome.peak {
    case .flat, .flicker, .drift, .illumination:
      gate.push(nil)
      return .withheld(.none, .lowQuality)
    case .bandEdge(let quality):
      gate.push(nil)
      return .withheld(.none, .bandEdge, quality: quality)
    case .peak(_, let quality) where quality < configuration.qualityThreshold:
      gate.push(nil)
      return .withheld(.none, .lowQuality, quality: quality)
    case .peak(let hz, let quality):
      // The value shown is this window's own rate. Earlier windows only vouch for it; they
      // are never averaged in, so the reading cannot lag behind a rate that has moved.
      let bpm = hz * 60
      gate.push(bpm)
      guard gate.agreed else {
        return .withheld(acceptedSinceReset ? .none : .settling, .awaitingAgreement, quality: quality)
      }
      acceptedSinceReset = true
      validWindows.append(
        ValidPulseWindow(start: history.times[range.lowerBound], end: now, rateHz: hz))
      for (entry, weight) in zip(regions, outcome.weights) {
        regionWeightSums[entry.region] += weight
      }
      return .valid(bpm, quality: quality)
    }
  }

  /// Frames per second the camera delivered over `range`, counting a dropped frame as the
  /// slot it left empty. Nil when the timestamps do not sit on a regular grid: flicker
  /// sampled that unevenly spreads out as noise instead of aliasing into a steady tone, so
  /// there is no alias to place.
  private func frameRate(of range: Range<Int>) -> Double? {
    let times = history.times
    let intervals = range.dropFirst().map { times[$0] - times[$0 - 1] }
    guard let typical = DSP.median(intervals), typical > 0 else { return nil }
    let slots = intervals.map { max(1, ($0 / typical).rounded()) }
    let period = (times[range.upperBound - 1] - times[range.lowerBound]) / slots.reduce(0, +)
    let offGrid = zip(intervals, slots).map { $0 / period - $1 }
    guard DSP.rootMeanSquare(offGrid) <= PulseTracker.maximumGridDeviation else { return nil }
    return 1 / period
  }

  /// Checks that look at every frame of the window, not only the newest ones.
  private func rejection(of range: Range<Int>, windowSeconds: Double) -> EstimateReason? {
    guard range.count >= 2 else { return .gaps }
    let times = history.times
    var intervals: [Double] = []
    intervals.reserveCapacity(range.count)
    for index in range.dropFirst() {
      intervals.append(times[index] - times[index - 1])
    }
    guard let typical = DSP.median(intervals) else { return .gaps }
    let expected = windowSeconds / typical
    if Double(range.count) < configuration.minimumSampleShare * expected
      || Double(range.count) / windowSeconds < configuration.minimumFrameRate
    {
      return .gaps
    }
    let moving = history.motion[range].reduce(0) { $0 + ($1 ? 1 : 0) }
    if Double(moving) / Double(range.count) > configuration.maximumMotionShare {
      return .motion
    }
    return nil
  }
}
