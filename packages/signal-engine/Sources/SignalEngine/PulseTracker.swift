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

  /// How many of the windows held produced a rate. For diagnostics.
  var passing: Int { recent.compactMap { $0 }.count }

  /// Highest minus lowest rate when every one of the `required` windows produced one. For
  /// diagnostics.
  var spread: Double? {
    let rates = recent.compactMap { $0 }
    guard rates.count == required, let low = rates.min(), let high = rates.max() else { return nil }
    return high - low
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
  /// How far the regions' colour moved over the last half second (`ColourChangeDetector`).
  private(set) var colourChange: [Double] = []
  /// The chest moved fast in this frame while it was tracked steadily.
  private(set) var chestMotion: [Bool] = []

  mutating func append(time: Double, frame: FrameRecord, colourChange: Double, chestMotion: Bool) {
    self.colourChange.append(colourChange)
    self.chestMotion.append(chestMotion)
    times.append(time)
    for (region, colour) in [frame.forehead, frame.leftCheek, frame.rightCheek].enumerated() {
      channels[3 * region].append(colour?.r ?? .nan)
      channels[3 * region + 1].append(colour?.g ?? .nan)
      channels[3 * region + 2].append(colour?.b ?? .nan)
    }
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
    colourChange.removeFirst(count)
    chestMotion.removeFirst(count)
    for series in channels.indices { channels[series].removeFirst(count) }
  }

  /// The uniform grid a window is resampled to: it ends at the last frame of the range.
  private func grid(of range: Range<Int>, rate: Double) -> (start: Double, count: Int) {
    let end = times[range.upperBound - 1]
    let count = Int(((end - times[range.lowerBound]) * rate).rounded(.down)) + 1
    return (end - Double(count - 1) / rate, count)
  }

  /// Frames of a window to cut out of the analysis, and which check asked for each.
  struct Disturbance {
    var colour: [Bool]
    var chest: [Bool]

    var frames: [Bool] { zip(colour, chest).map { $0 || $1 } }

    func share(_ flags: [Bool]) -> Double {
      flags.isEmpty ? 0 : Double(flags.reduce(0) { $0 + ($1 ? 1 : 0) }) / Double(flags.count)
    }
  }

  /// A colour change stands out against the window's own noise: it is a jump when it is
  /// over `colourJumpNoiseRatio` times the median change, and never under
  /// `colourJumpDeviation` or over `colourJumpCeiling`. `colourChange` at a frame compares
  /// the half second before it, so the jump itself lies a quarter of a second back, and the
  /// frames cut are the ones around that moment.
  func disturbance(in range: Range<Int>, configuration: EngineConfiguration) -> Disturbance {
    var colour = [Bool](repeating: false, count: range.count)
    let noise = DSP.median(Array(colourChange[range])) ?? 0
    let limit = min(
      configuration.colourJumpCeiling,
      max(configuration.colourJumpDeviation, configuration.colourJumpNoiseRatio * noise))
    let half = configuration.colourJumpSeconds
    var from = range.lowerBound
    for index in range where colourChange[index] > limit {
      let earliest = times[index] - 1.5 * half
      let latest = times[index] - 0.5 * half
      while from < index, times[from] < earliest { from += 1 }
      var frame = from
      while frame <= index, times[frame] <= latest {
        colour[frame - range.lowerBound] = true
        frame += 1
      }
    }
    return Disturbance(colour: colour, chest: Array(chestMotion[range]))
  }

  /// Which samples of the window's grid may be analysed: those between two undisturbed
  /// frames, in runs of at least `minimumRun` samples. Nil when that is all of them.
  func usableSamples(in range: Range<Int>, disturbed: [Bool], rate: Double, minimumRun: Int) -> [Bool]? {
    guard range.count >= 2, disturbed.contains(true) else { return nil }
    let (start, count) = grid(of: range, rate: rate)
    var usable = [Bool](repeating: true, count: count)
    var index = range.lowerBound
    let lastSegment = range.upperBound - 2
    for sample in 0..<count {
      let time = start + Double(sample) / rate
      while index < lastSegment, times[index + 1] <= time { index += 1 }
      usable[sample] = !(disturbed[index - range.lowerBound] || disturbed[index + 1 - range.lowerBound])
    }
    var runStart = 0
    for sample in 0...count {
      if sample == count || !usable[sample] {
        if sample - runStart < minimumRun {
          for short in runStart..<sample { usable[short] = false }
        }
        runStart = sample + 1
      }
    }
    return usable
  }

  /// Regions with a colour in every frame of `range`, resampled to a uniform grid that ends
  /// at the last frame of the range.
  func regions(in range: Range<Int>, rate: Double) -> [(region: Int, series: RegionSeries)] {
    guard range.count >= 2 else { return [] }
    let (start, count) = grid(of: range, rate: rate)
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

/// Measures how far the colour of the skin regions moved in the last half second.
///
/// This replaces a test of brightness against a running average. Brightness common to the
/// three channels is what the projection cancels, so a lamp dimming or a cloud passing does
/// not hurt the pulse signal and is not motion. What does hurt is the regions' colour
/// changing: skin sliding under a region when the head turns, or light of another colour
/// arriving. So the detector looks at each channel's share of the region's brightness.
struct ColourChangeDetector {
  private let half: Double
  private var times: [Double] = []
  /// Each channel's share of its region's brightness, nine per frame, frame after frame.
  /// 0 where the region has no colour, which `missing` records, three per frame.
  private var shares: [Double] = []
  private var missing: [Bool] = []
  /// Frames from `head` up to `split` are the older stretch, from `split` on the newer.
  private var head = 0
  private var split = 0
  /// Running sums of the shares in each stretch, and how many of its frames lack each region.
  private var olderSums = [Double](repeating: 0, count: 9)
  private var newerSums = [Double](repeating: 0, count: 9)
  private var olderMissing = [Int](repeating: 0, count: 3)
  private var newerMissing = [Int](repeating: 0, count: 3)

  init(seconds: Double) {
    half = seconds
  }

  mutating func reset() {
    self = ColourChangeDetector(seconds: half)
  }

  /// Adds a frame and returns the largest relative change, over regions and channels,
  /// between the mean share in the newest `seconds` and in the `seconds` before. 0 until
  /// both stretches hold frames. A region without a colour anywhere in the two stretches
  /// is left out.
  mutating func push(time: Double, frame: FrameRecord) -> Double {
    var region = 0
    for colour in [frame.forehead, frame.leftCheek, frame.rightCheek] {
      if let colour, colour.r + colour.g + colour.b > 0 {
        let sum = colour.r + colour.g + colour.b
        for share in [colour.r / sum, colour.g / sum, colour.b / sum] {
          newerSums[shares.count % 9] += share
          shares.append(share)
        }
        missing.append(false)
      } else {
        shares.append(contentsOf: [0, 0, 0])
        missing.append(true)
        newerMissing[region] += 1
      }
      region += 1
    }
    times.append(time)

    while split < times.count - 1, times[split] <= time - half {
      for series in 0..<9 {
        let share = shares[9 * split + series]
        newerSums[series] -= share
        olderSums[series] += share
      }
      for region in 0..<3 where missing[3 * split + region] {
        newerMissing[region] -= 1
        olderMissing[region] += 1
      }
      split += 1
    }
    while head < split, times[head] <= time - 2 * half {
      for series in 0..<9 { olderSums[series] -= shares[9 * head + series] }
      for region in 0..<3 where missing[3 * head + region] { olderMissing[region] -= 1 }
      head += 1
    }
    if head > 512 {
      times.removeFirst(head)
      shares.removeFirst(9 * head)
      missing.removeFirst(3 * head)
      split -= head
      head = 0
    }

    let older = split - head
    let newer = times.count - split
    // The older stretch must be at least half full, or the first frames after a reset
    // would compare a mean with a single frame.
    guard older >= 2, newer >= 2, times[head] <= time - 1.5 * half else { return 0 }
    var largest = 0.0
    for region in 0..<3 where olderMissing[region] == 0 && newerMissing[region] == 0 {
      for series in (3 * region)..<(3 * region + 3) {
        let before = olderSums[series] / Double(older)
        let after = newerSums[series] / Double(newer)
        if before > 0 { largest = max(largest, abs(after - before) / before) }
      }
    }
    return largest
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
  private var colourChange: ColourChangeDetector
  /// Times of the frames of the last `chestTrackingSeconds` and whether each carried a
  /// chest value, newest last, from `chestHead` on.
  private var chestTimes: [Double] = []
  private var chestTracked: [Bool] = []
  private var chestHead = 0
  private var chestTrackedCount = 0
  private var gate: AgreementGate
  private var acceptedSinceReset = false

  /// When true, every `tick` and `missedTick` leaves a `lastDiagnostic`, and a window that a
  /// check refuses before the analysis is analysed all the same, for the diagnostic only.
  var collectsDiagnostics = false
  private(set) var lastDiagnostic: PulseDiagnostic?

  init(configuration: EngineConfiguration, fourier: Fourier) {
    self.configuration = configuration
    analyzer = PulseAnalyzer(configuration: configuration, fourier: fourier)
    colourChange = ColourChangeDetector(seconds: configuration.colourJumpSeconds)
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

    chestTimes.append(frame.t)
    chestTracked.append(frame.chestMotion != nil)
    if frame.chestMotion != nil { chestTrackedCount += 1 }
    while chestHead < chestTimes.count - 1, chestTimes[chestHead] <= frame.t - configuration.chestTrackingSeconds {
      if chestTracked[chestHead] { chestTrackedCount -= 1 }
      chestHead += 1
    }
    if chestHead > 512 {
      chestTimes.removeFirst(chestHead)
      chestTracked.removeFirst(chestHead)
      chestHead = 0
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

    let change = colourChange.push(time: frame.t, frame: frame)
    var chestMoving = false
    if let chest = frame.chestMotion, let interval, abs(chest) / interval > configuration.motionChestSpeed {
      chestMoving = chestIsTracked(at: frame.t)
    }
    history.append(time: frame.t, frame: frame, colourChange: change, chestMotion: chestMoving)

    if frame.t - history.times[0] > 2 * configuration.maximumHistorySeconds {
      history.removeFrames(before: frame.t - configuration.maximumHistorySeconds)
    }
    return faceChanged
  }

  /// Whether the chest region has been followed steadily enough for its speed to mean
  /// something: a value in `minimumChestTrackedShare` of the frames of the last
  /// `chestTrackingSeconds`, which must have passed.
  private func chestIsTracked(at now: Double) -> Bool {
    guard chestHead < chestTimes.count,
      now - chestTimes[chestHead] >= 0.9 * configuration.chestTrackingSeconds
    else { return false }
    return Double(chestTrackedCount)
      >= configuration.minimumChestTrackedShare * Double(chestTimes.count - chestHead)
  }

  /// Signal history never carries across a lost face, an exposure change or a new face.
  private mutating func endSegment() {
    segmentStart = nil
    colourChange.reset()
    acceptedSinceReset = false
    gate.reset()
  }

  /// The second passed with no frame.
  mutating func missedTick() {
    gate.push(nil)
    if collectsDiagnostics {
      var diagnostic = PulseDiagnostic()
      diagnostic.gate = .noFrames
      lastDiagnostic = diagnostic
    }
  }

  /// Analyses the window that ends at the newest frame. Called once per second.
  mutating func tick(at now: Double) -> TickEstimate {
    var diagnostic = PulseDiagnostic()
    let estimate = tick(at: now, diagnostic: &diagnostic)
    if collectsDiagnostics {
      diagnostic.state = estimate.state
      diagnostic.reason = estimate.reason
      diagnostic.value = estimate.value
      diagnostic.quality = estimate.quality
      diagnostic.passingWindows = gate.passing
      diagnostic.agreementSpreadBpm = gate.spread
      lastDiagnostic = diagnostic
    }
    return estimate
  }

  /// `tick(at:)` itself. What it writes to `diagnostic` never feeds back into the estimate
  /// or into the tracker's state.
  private mutating func tick(at now: Double, diagnostic: inout PulseDiagnostic) -> TickEstimate {
    if let blocked {
      diagnostic.gate = blocked == .exposureAdjusting ? .exposureAdjusting : .noFace
      return .withheld(.none, blocked)
    }
    guard let segmentStart, now - segmentStart >= configuration.heartRateMinimumWindowSeconds else {
      diagnostic.gate = .warmingUp
      if collectsDiagnostics, let segmentStart {
        describeRefused(
          history.index(atOrAfter: segmentStart)..<history.times.count,
          windowSeconds: now - segmentStart, in: &diagnostic)
      }
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
        diagnostic.gate = .recentGap
        if collectsDiagnostics { describeRefused(range, windowSeconds: windowSeconds, in: &diagnostic) }
        return .withheld(.none, .gaps)
      }
    }
    if let rejection = rejection(of: range, windowSeconds: windowSeconds) {
      gate.push(nil)
      diagnostic.gate = .tooFewSamples
      if collectsDiagnostics { describeRefused(range, windowSeconds: windowSeconds, in: &diagnostic) }
      return .withheld(.none, rejection)
    }
    let usable = usableSamples(of: range)
    if PulseTracker.share(cutFrom: usable) > configuration.maximumDisturbedShare {
      gate.push(nil)
      diagnostic.gate = .motion
      if collectsDiagnostics { describeRefused(range, windowSeconds: windowSeconds, in: &diagnostic) }
      return .withheld(.none, .motion)
    }
    if collectsDiagnostics { measure(range, windowSeconds: windowSeconds, in: &diagnostic) }
    let regions = history.regions(in: range, rate: configuration.resampleRateHz)
    guard !regions.isEmpty else {
      gate.push(nil)
      diagnostic.gate = .incompleteRegions
      return .withheld(.none, .gaps)
    }
    let outcome = analyzer.analyse(
      regions.map(\.series), rate: configuration.resampleRateHz, frameRate: frameRate(of: range),
      usable: usable)
    diagnostic.note(outcome.detail)

    switch outcome.peak {
    case .flat, .flicker, .drift, .illumination:
      gate.push(nil)
      switch outcome.peak {
      case .flicker: diagnostic.gate = .flicker
      case .illumination: diagnostic.gate = .illumination
      default: diagnostic.gate = .flat
      }
      return .withheld(.none, .lowQuality)
    case .bandEdge(let quality):
      gate.push(nil)
      diagnostic.gate = .bandEdge
      return .withheld(.none, .bandEdge, quality: quality)
    case .peak(_, let quality) where quality < configuration.qualityThreshold:
      gate.push(nil)
      diagnostic.gate = .quality
      return .withheld(.none, .lowQuality, quality: quality)
    case .peak(_, let quality)
    where (outcome.detail.recentQuality ?? 1) < configuration.minimumRecentQuality:
      gate.push(nil)
      diagnostic.gate = .quality
      return .withheld(.none, .lowQuality, quality: quality)
    case .peak(let hz, let quality):
      // The value shown is this window's own rate. Earlier windows only vouch for it; they
      // are never averaged in, so the reading cannot lag behind a rate that has moved.
      let bpm = hz * 60
      gate.push(bpm)
      guard gate.agreed else {
        diagnostic.gate = .agreement
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

  /// The samples of the window's grid left after the frames around a colour jump or a fast
  /// chest are cut. Nil when nothing is cut.
  private func usableSamples(of range: Range<Int>) -> [Bool]? {
    let rate = configuration.resampleRateHz
    return history.usableSamples(
      in: range, disturbed: history.disturbance(in: range, configuration: configuration).frames, rate: rate,
      minimumRun: Int((PulseAnalyzer.projectionWindowSeconds * rate).rounded()))
  }

  static func share(cutFrom usable: [Bool]?) -> Double {
    guard let usable, !usable.isEmpty else { return 0 }
    return Double(usable.reduce(0) { $0 + ($1 ? 0 : 1) }) / Double(usable.count)
  }

  // MARK: Diagnostics

  /// The numbers the sample and motion checks compare with their thresholds.
  private func measure(_ range: Range<Int>, windowSeconds: Double, in diagnostic: inout PulseDiagnostic) {
    diagnostic.windowSeconds = windowSeconds
    diagnostic.frames = range.count
    guard range.count >= 2, windowSeconds > 0 else { return }
    let times = history.times
    if let typical = DSP.median(range.dropFirst().map({ times[$0] - times[$0 - 1] })), typical > 0 {
      diagnostic.sampleShare = Double(range.count) / (windowSeconds / typical)
    }
    diagnostic.framesPerSecond = Double(range.count) / windowSeconds
    let disturbance = history.disturbance(in: range, configuration: configuration)
    diagnostic.motionShare = PulseTracker.share(cutFrom: usableSamples(of: range))
    diagnostic.colourJumpShare = disturbance.share(disturbance.colour)
    diagnostic.chestMotionShare = disturbance.share(disturbance.chest)
  }

  /// For a window a check refused before the analysis: its measurements, and the analysis
  /// it was denied, so that the candidate it held can be compared with a reference.
  private func describeRefused(_ range: Range<Int>, windowSeconds: Double, in diagnostic: inout PulseDiagnostic) {
    measure(range, windowSeconds: windowSeconds, in: &diagnostic)
    let regions = history.regions(in: range, rate: configuration.resampleRateHz)
    guard !regions.isEmpty else { return }
    let outcome = analyzer.analyse(
      regions.map(\.series), rate: configuration.resampleRateHz, frameRate: frameRate(of: range),
      usable: usableSamples(of: range))
    diagnostic.note(outcome.detail)
  }

  /// The sample checks, which look at every frame of the window, not only the newest ones.
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
    return nil
  }
}
