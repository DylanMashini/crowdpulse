import Foundation

/// What one vital sign looked like at one whole second of the sitting.
struct TickEstimate {
  var state: EstimateState
  var reason: EstimateReason?
  var value: Double?
  var quality: Double
  /// Valid for the screen only (`EngineConfiguration.showsProvisionalReadings`).
  var provisional = false
  /// Why a provisional reading is not one the sitting records. Nil otherwise.
  var unrecorded: EstimateReason?

  /// The value, when it is one the sitting records.
  var confirmedValue: Double? { provisional ? nil : value }
  var isConfirmed: Bool { state == .valid && !provisional }

  static func valid(_ value: Double, quality: Double) -> TickEstimate {
    TickEstimate(state: .valid, reason: nil, value: value, quality: quality)
  }

  /// A value for the screen. `unrecorded` is the reason it would have been withheld with.
  static func shown(_ value: Double, quality: Double, unrecorded: EstimateReason) -> TickEstimate {
    TickEstimate(
      state: .valid, reason: nil, value: value, quality: quality, provisional: true, unrecorded: unrecorded)
  }

  static func withheld(_ state: EstimateState, _ reason: EstimateReason, quality: Double = 0) -> TickEstimate {
    TickEstimate(state: state, reason: reason, value: nil, quality: quality)
  }
}

/// Passes the newest window's rate only when `required` of the newest `span` windows, the
/// newest among them, produced rates that all lie within `tolerance` of each other.
struct AgreementGate {
  let required: Int
  let span: Int
  let tolerance: Double
  private var recent: [Double?] = []

  init(required: Int, span: Int, tolerance: Double) {
    self.required = max(1, required)
    self.span = max(self.required, span)
    self.tolerance = tolerance
  }

  mutating func push(_ rate: Double?) {
    recent.append(rate)
    if recent.count > span { recent.removeFirst() }
  }

  /// The largest set of rates held that includes the newest window's and spans no more
  /// than `tolerance`. Empty when the newest window produced none.
  private var agreeing: [Double] {
    guard let newest = recent.last ?? nil else { return [] }
    let rates = recent.compactMap { $0 }
    var best: [Double] = []
    for lowest in rates where lowest <= newest && newest - lowest <= tolerance {
      let set = rates.filter { $0 >= lowest && $0 - lowest <= tolerance }
      if set.count > best.count { best = set }
    }
    return best
  }

  var agreed: Bool { agreeing.count >= required }

  /// How many of the windows held produced a rate. For diagnostics.
  var passing: Int { recent.compactMap { $0 }.count }

  /// Highest minus lowest of the agreeing rates when there are enough of them. For
  /// diagnostics.
  var spread: Double? {
    let rates = agreeing
    guard rates.count >= required, let low = rates.min(), let high = rates.max() else { return nil }
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
  /// How far the regions' colour moved over the last half second (`ColourChangeDetector`):
  /// the largest of the three regions.
  private(set) var colourChange: [Double] = []
  /// The same for each region on its own.
  private(set) var regionColourChange = [[Double]](repeating: [], count: PulseHistory.regionCount)
  /// The chest moved fast in this frame while it was tracked steadily.
  private(set) var chestMotion: [Bool] = []
  /// This frame is the first after the face was lost for a moment or its track changed, and
  /// the segment carried on across it (`bridgeSeconds`). The frames around it are cut.
  private(set) var bridge: [Bool] = []

  mutating func append(
    time: Double, frame: FrameRecord, colourChange: Double, chestMotion: Bool,
    regionChanges: [Double]? = nil, bridge: Bool = false
  ) {
    self.colourChange.append(colourChange)
    for region in 0..<PulseHistory.regionCount {
      regionColourChange[region].append(regionChanges?[region] ?? colourChange)
    }
    self.chestMotion.append(chestMotion)
    self.bridge.append(bridge)
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
    for region in regionColourChange.indices { regionColourChange[region].removeFirst(count) }
    chestMotion.removeFirst(count)
    bridge.removeFirst(count)
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
    /// A colour jump in any region.
    var colour: [Bool]
    var chest: [Bool]
    /// A colour jump in each region on its own.
    var regionColour: [[Bool]] = []
    /// Frames around a bridged interruption: no region may use them.
    var bridged: [Bool] = []

    var frames: [Bool] {
      colour.indices.map { colour[$0] || chest[$0] || (bridged.isEmpty ? false : bridged[$0]) }
    }

    /// The frames one region must do without: its own colour jumps, a fast chest, and the
    /// frames around a bridged interruption.
    func frames(of region: Int) -> [Bool] {
      guard region < regionColour.count else { return frames }
      let own = regionColour[region]
      return own.indices.map { own[$0] || chest[$0] || (bridged.isEmpty ? false : bridged[$0]) }
    }

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
    let half = configuration.colourJumpSeconds
    func jumps(_ change: [Double]) -> [Bool] {
      var colour = [Bool](repeating: false, count: range.count)
      let noise = DSP.median(Array(change[range])) ?? 0
      let limit = min(
        configuration.colourJumpCeiling,
        max(configuration.colourJumpDeviation, configuration.colourJumpNoiseRatio * noise))
      var from = range.lowerBound
      for index in range where change[index] > limit {
        let earliest = times[index] - 1.5 * half
        let latest = times[index] - 0.5 * half
        while from < index, times[from] < earliest { from += 1 }
        var frame = from
        while frame <= index, times[frame] <= latest {
          colour[frame - range.lowerBound] = true
          frame += 1
        }
      }
      return colour
    }
    var disturbance = Disturbance(colour: jumps(colourChange), chest: Array(chestMotion[range]))
    if configuration.cutsRegionsSeparately {
      disturbance.regionColour = regionColourChange.map(jumps)
    }
    // Around a bridged interruption: the face was leaving before it and the regions are
    // settling after it. The frame before the gap and the first after it are always cut,
    // so that no sample between them is analysed.
    if bridge[range].contains(true) {
      var bridged = [Bool](repeating: false, count: range.count)
      for index in range.dropFirst() where bridge[index] {
        let earliest = times[index - 1] - half
        let latest = times[index] + half
        var frame = index - 1
        while frame >= range.lowerBound, times[frame] >= earliest {
          bridged[frame - range.lowerBound] = true
          frame -= 1
        }
        frame = index
        while frame < range.upperBound, times[frame] <= latest {
          bridged[frame - range.lowerBound] = true
          frame += 1
        }
      }
      disturbance.bridged = bridged
    }
    return disturbance
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
  /// What the newest `push` found for each region on its own; 0 for a region left out.
  private(set) var lastChanges = [Double](repeating: 0, count: 3)

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
    lastChanges = [0, 0, 0]
    guard older >= 2, newer >= 2, times[head] <= time - 1.5 * half else { return 0 }
    for region in 0..<3 where olderMissing[region] == 0 && newerMissing[region] == 0 {
      for series in (3 * region)..<(3 * region + 3) {
        let before = olderSums[series] / Double(older)
        let after = newerSums[series] / Double(newer)
        if before > 0 { lastChanges[region] = max(lastChanges[region], abs(after - before) / before) }
      }
    }
    return lastChanges.max() ?? 0
  }
}

/// A window that produced a valid heart-rate reading. `finish()` looks for beats inside these.
struct ValidPulseWindow {
  var start: Double
  var end: Double
  var rateHz: Double
}

/// What one analysis window held, kept for the whole-sitting estimate whether or not the
/// window gave a reading.
struct WindowEvidence {
  /// Capture-clock time of the window's newest frame.
  var end: Double
  var seconds: Double
  /// What the window would report with nothing refusing it, in Hz.
  var candidateHz: Double?
  /// Region indices (forehead, left cheek, right cheek) of `regionSpectra`.
  var regions: [Int]
  var spectrum: [Double]
  var regionSpectra: [[Double]?]
  var binHz: Double
}

/// Heart-rate state for one sitting: the frame history, the checks that decide whether a
/// window may be analysed, and the agreement gate.
struct PulseTracker {
  /// Frame intervals may stray this far from whole frame periods (RMS, in periods) and
  /// still count as a regular grid.
  static let maximumGridDeviation = 0.15
  /// Windows kept for the whole-sitting estimate: ten minutes of them.
  static let maximumEvidenceWindows = 600

  private let configuration: EngineConfiguration
  private let analyzer: PulseAnalyzer

  private(set) var history = PulseHistory()
  private(set) var validWindows: [ValidPulseWindow] = []
  /// Every window that was analysed, in time order.
  private(set) var evidence: [WindowEvidence] = []
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
  /// The display tier's own agreement, over windows that passed the display checks.
  private var displayGate: AgreementGate
  private var shownSinceReset = false
  /// The newest reading that windows agreed on, recorded or provisional, and when: the rate
  /// a later window may follow (`displayTrackingSeconds`).
  private var lastShown: (bpm: Double, time: Double)?
  /// The newest valid reading from a window whose rhythm could not be movement
  /// (`movesInRhythm`), and when it was read.
  private var steadyRate: (bpm: Double, time: Double)?
  /// The face was lost since the last usable frame of this segment.
  /// If it is back within `bridgeSeconds` the segment carries on and the moment is cut out.
  private var interrupted = false
  /// The face box of the newest usable frame of this segment, when the frame carried one.
  private var lastFace: FaceBox?

  /// When true, every `tick` and `missedTick` leaves a `lastDiagnostic`, and a window that a
  /// check refuses before the analysis is analysed all the same, for the diagnostic only.
  var collectsDiagnostics = false
  private(set) var lastDiagnostic: PulseDiagnostic?

  init(configuration: EngineConfiguration, fourier: Fourier) {
    self.configuration = configuration
    analyzer = PulseAnalyzer(configuration: configuration, fourier: fourier)
    colourChange = ColourChangeDetector(seconds: configuration.colourJumpSeconds)
    gate = AgreementGate(
      required: configuration.agreeingWindows, span: configuration.agreementSpanWindows,
      tolerance: configuration.agreementToleranceBpm)
    displayGate = AgreementGate(
      required: configuration.displayAgreeingWindows, span: configuration.agreementSpanWindows,
      tolerance: configuration.agreementToleranceBpm)
  }

  /// The window gave nothing either gate may count.
  private mutating func refuse() {
    gate.push(Double?.none)
    displayGate.push(nil)
  }

  /// Returns true when the tracked face changed with this frame.
  mutating func ingest(_ frame: FrameRecord, interval: Double?) -> Bool {
    var faceChanged = false
    if let id = frame.faceTrackId {
      if let previous = trackId, previous != id {
        faceChanged = true
        // A new track with no frame in between is another face in the picture: history
        // never carries over to it. A new track after the face was lost for a moment is
        // what the tracker gives the same face when it finds it again, and is bridged,
        // unless its box says it is somewhere else in the picture.
        if !(interrupted && bridges(at: frame.t) && isWhereTheFaceWas(frame.face)) {
          endSegment()
          warmUpReason = .faceChanged
        }
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
      if bridges(at: frame.t) { interrupted = true } else { endSegment() }
      blocked = .noFace
      return faceChanged
    }
    guard frame.exposure == .locked else {
      endSegment()
      blocked = .exposureAdjusting
      return faceChanged
    }
    blocked = nil
    var bridge = false
    if segmentStart == nil {
      segmentStart = frame.t
    } else if interrupted {
      if bridges(at: frame.t), isWhereTheFaceWas(frame.face) {
        bridge = true
      } else {
        if bridges(at: frame.t) { warmUpReason = .faceChanged }
        endSegment()
        segmentStart = frame.t
      }
    }
    interrupted = false
    lastFace = frame.face

    let change = colourChange.push(time: frame.t, frame: frame)
    var chestMoving = false
    if let chest = frame.chestMotion, let interval, abs(chest) / interval > configuration.motionChestSpeed {
      chestMoving = chestIsTracked(at: frame.t)
    }
    history.append(
      time: frame.t, frame: frame, colourChange: change, chestMotion: chestMoving,
      regionChanges: colourChange.lastChanges, bridge: bridge)

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

  /// Whether a face lost at `now` may still be bridged: a segment is running and its last
  /// usable frame is no more than `bridgeSeconds` old. The face tracker gives up a face
  /// after half a second without a detection and numbers it anew when it is found again,
  /// so a blink of the detector would otherwise cost six seconds of warm-up and the
  /// readings on either side of it. Time alone cannot tell the patient from someone who
  /// takes their place within those seconds: a face in the same place is bridged whoever
  /// it is, and the previous rate can stay on screen for a second or a few (QA round 3, R3).
  /// A face somewhere else in the picture is not (`isWhereTheFaceWas`).
  private func bridges(at now: Double) -> Bool {
    guard configuration.bridgeSeconds > 0, segmentStart != nil, let last = history.times.last else { return false }
    return now - last <= configuration.bridgeSeconds
  }

  /// Whether a face found again at `box` can be the one that was lost: no further from where
  /// that one was than the capture module lets one face move between two detections, and
  /// about the same size. True when either side has no box to compare.
  private func isWhereTheFaceWas(_ box: FaceBox?) -> Bool {
    guard let before = lastFace, let box, before.width > 0, box.width > 0 else { return true }
    let jump = hypot(
      (box.x + box.width / 2) - (before.x + before.width / 2),
      (box.y + box.height / 2) - (before.y + before.height / 2))
    let wider = max(before.width, box.width)
    return jump <= configuration.bridgeMaximumJump * wider
      && wider <= configuration.bridgeMaximumScaleChange * min(before.width, box.width)
  }

  /// Signal history never carries across an exposure change, a face lost for longer than
  /// `bridgeSeconds`, or a face found again somewhere else.
  private mutating func endSegment() {
    interrupted = false
    lastFace = nil
    segmentStart = nil
    colourChange.reset()
    acceptedSinceReset = false
    steadyRate = nil
    gate.reset()
    shownSinceReset = false
    lastShown = nil
    displayGate.reset()
  }

  /// The second passed with no frame.
  mutating func missedTick() {
    refuse()
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
    // The shortest window the screen may be shown a rate from. The record needs
    // `heartRateMinimumWindowSeconds`.
    let shortest =
      configuration.showsProvisionalReadings
      ? min(configuration.displayMinimumWindowSeconds, configuration.heartRateMinimumWindowSeconds)
      : configuration.heartRateMinimumWindowSeconds
    guard let segmentStart, now - segmentStart >= shortest else {
      diagnostic.gate = .warmingUp
      if collectsDiagnostics, let segmentStart {
        describeRefused(
          history.index(atOrAfter: segmentStart)..<history.times.count,
          windowSeconds: now - segmentStart, in: &diagnostic)
      }
      return .withheld(.settling, warmUpReason)
    }
    // Set when a check has refused this window for the record: what it is withheld with.
    // The window may still be analysed for the screen.
    var unrecorded: TickEstimate?
    if now - segmentStart < configuration.heartRateMinimumWindowSeconds {
      diagnostic.gate = .warmingUp
      unrecorded = .withheld(.settling, warmUpReason)
    } else {
      warmUpReason = .warmingUp
    }
    var windowSeconds = min(now - segmentStart, configuration.heartRateWindowSeconds)
    var range = history.index(atOrAfter: now - windowSeconds)..<history.times.count
    if unrecorded != nil, collectsDiagnostics {
      describeRefused(range, windowSeconds: windowSeconds, in: &diagnostic)
    }

    // A window never spans a gap: it starts after the newest one, and is rejected until
    // enough gap-free signal has built up again.
    if let afterGap = range.dropFirst().last(where: {
      !history.bridge[$0] && history.times[$0] - history.times[$0 - 1] > configuration.maximumGapSeconds
    }) {
      range = afterGap..<range.upperBound
      windowSeconds = now - history.times[afterGap]
      if windowSeconds < shortest, let unrecorded {
        displayGate.push(nil)
        return unrecorded
      }
      if windowSeconds < configuration.heartRateMinimumWindowSeconds, unrecorded == nil {
        diagnostic.gate = .recentGap
        if collectsDiagnostics { describeRefused(range, windowSeconds: windowSeconds, in: &diagnostic) }
        guard windowSeconds >= shortest else {
          refuse()
          return .withheld(.none, .gaps)
        }
        gate.push(Double?.none)
        unrecorded = .withheld(.none, .gaps)
      }
    }
    if let rejection = rejection(of: range, windowSeconds: windowSeconds) {
      if let unrecorded {
        displayGate.push(nil)
        return unrecorded
      }
      refuse()
      diagnostic.gate = .tooFewSamples
      if collectsDiagnostics { describeRefused(range, windowSeconds: windowSeconds, in: &diagnostic) }
      return .withheld(.none, rejection)
    }
    let complete = history.regions(in: range, rate: configuration.resampleRateHz)
    let masks = usableSamples(of: range)
    // A region that had to be cut too much is left out of this window; the window is
    // refused as motion only when that leaves none.
    let regions = complete.filter {
      PulseTracker.share(cutFrom: masks[$0.region]) <= configuration.maximumDisturbedShare
    }
    let leastCut = masks.map { PulseTracker.share(cutFrom: $0) }.min() ?? 0
    if unrecorded == nil, regions.isEmpty, !complete.isEmpty || leastCut > configuration.maximumDisturbedShare {
      gate.push(Double?.none)
      diagnostic.gate = .motion
      if collectsDiagnostics { describeRefused(range, windowSeconds: windowSeconds, in: &diagnostic) }
      unrecorded = .withheld(.none, .motion)
    }
    if let unrecorded {
      // Not a window the sitting records. The screen may still be shown its rate, from the
      // regions that were cut by no more than the display tier allows.
      let usable = complete.filter {
        PulseTracker.share(cutFrom: masks[$0.region]) <= configuration.displayMaximumDisturbedShare
      }
      return showRefused(range, regions: usable, masks: masks, at: now, otherwise: unrecorded)
    }
    if collectsDiagnostics { measure(range, windowSeconds: windowSeconds, in: &diagnostic) }
    guard !regions.isEmpty else {
      refuse()
      diagnostic.gate = .incompleteRegions
      return .withheld(.none, .gaps)
    }
    let outcome = analyzer.analyse(
      regions.map(\.series), rate: configuration.resampleRateHz, frameRate: frameRate(of: range),
      masks: regions.map { masks[$0.region] })
    diagnostic.note(outcome.detail)
    if let spectrum = outcome.spectrum {
      // A window whose strongest peak is where lamp flicker aliases, or is what the
      // projection left of a change in the light, is evidence of the lamp, not of a pulse.
      switch outcome.peak {
      case .flicker, .illumination, .flat, .drift: break
      case .peak where movesInRhythm(outcome.detail) || lightChangesColour(outcome.detail): break
      case .peak, .bandEdge:
        evidence.append(
          WindowEvidence(
            end: now, seconds: windowSeconds, candidateHz: outcome.detail.candidateHz,
            regions: regions.map(\.region), spectrum: spectrum, regionSpectra: outcome.regionSpectra,
            binHz: outcome.binHz))
        if evidence.count > PulseTracker.maximumEvidenceWindows { evidence.removeFirst() }
      }
    }

    switch outcome.peak {
    case .flicker:
      // Where a lamp's flicker would appear. The record never takes a rate from there. The
      // screen keeps one it was already showing: a heart can beat at that rate too.
      gate.push(Double?.none)
      diagnostic.gate = .flicker
      if let hz = outcome.detail.candidateHz, let quality = outcome.detail.candidateQuality,
        displays(hz * 60, quality: quality, detail: outcome.detail, at: now, onlyFollowing: true)
      {
        return .shown(hz * 60, quality: quality, unrecorded: .lowQuality)
      }
      return .withheld(.none, .lowQuality)
    case .flat, .drift, .illumination:
      refuse()
      if case .illumination = outcome.peak { diagnostic.gate = .illumination } else { diagnostic.gate = .flat }
      return .withheld(.none, .lowQuality)
    case .bandEdge(let quality):
      refuse()
      diagnostic.gate = .bandEdge
      return .withheld(.none, .bandEdge, quality: quality)
    case .peak(let hz, let quality) where movesInRhythm(outcome.detail) && !vouchedFor(hz * 60, at: now):
      // A rhythm that could be movement. As with flicker, the screen keeps a rate it was
      // already showing and never starts one here.
      gate.push(Double?.none)
      diagnostic.gate = .rhythmicMovement
      if displays(hz * 60, quality: quality, detail: outcome.detail, at: now, onlyFollowing: true) {
        return .shown(hz * 60, quality: quality, unrecorded: .motion)
      }
      return .withheld(.none, .motion, quality: quality)
    case .peak where lightChangesColour(outcome.detail):
      refuse()
      diagnostic.gate = .illumination
      return .withheld(.none, .lowQuality)
    case .peak(let hz, let quality):
      // The value shown is this window's own rate. Earlier windows only vouch for it; they
      // are never averaged in, so the reading cannot lag behind a rate that has moved.
      let bpm = hz * 60
      let recentQuality = outcome.detail.recentQuality ?? 1
      let recentShare = outcome.detail.recentAmplitudeShare ?? 1
      let confirms =
        quality >= configuration.qualityThreshold
        && recentQuality >= configuration.minimumRecentQuality
        && recentShare >= configuration.minimumRecentAmplitudeShare
      gate.push(confirms ? bpm : nil)
      let shows = displays(bpm, quality: quality, detail: outcome.detail, at: now, confirms: confirms)

      if confirms, gate.agreed {
        acceptedSinceReset = true
        lastShown = (bpm, now)
        // Only a window whose rhythm cannot be movement may vouch for later ones.
        if !movesInRhythm(outcome.detail) { steadyRate = (bpm, now) }
        validWindows.append(
          ValidPulseWindow(start: history.times[range.lowerBound], end: now, rateHz: hz))
        for (entry, weight) in zip(regions, outcome.weights) {
          regionWeightSums[entry.region] += weight
        }
        return .valid(bpm, quality: quality)
      }
      diagnostic.gate = confirms ? .agreement : .quality
      if shows {
        return .shown(bpm, quality: quality, unrecorded: confirms ? .awaitingAgreement : .lowQuality)
      }
      guard confirms else {
        return .withheld(.none, .lowQuality, quality: quality)
      }
      return .withheld(
        acceptedSinceReset || shownSinceReset ? .none : .settling, .awaitingAgreement, quality: quality)
    }
  }

  /// The display tier (`EngineConfiguration`, "Live display"): whether the screen may show
  /// `bpm` from this window, under looser limits than the record's, or because it follows a
  /// rate shown a moment ago. Counts the window in the display tier's agreement either way.
  /// - Parameters:
  ///   - confirms: the window passed the record's own quality checks.
  ///   - onlyFollowing: the window may only carry on a rate already shown, never start one.
  private mutating func displays(
    _ bpm: Double, quality: Double, detail: PulseAnalyzer.Detail, at now: Double,
    confirms: Bool = false, onlyFollowing: Bool = false
  ) -> Bool {
    guard configuration.showsProvisionalReadings else {
      displayGate.push(nil)
      return false
    }
    let recentEnough = (detail.recentAmplitudeShare ?? 1) >= configuration.displayMinimumRecentAmplitudeShare
    let tracks = recentEnough && quality >= configuration.displayTrackingQuality && follows(bpm, at: now)
    // A window that stands on its own counts towards agreement and, once agreed, becomes
    // the rate later windows may follow. One that is only following does neither: a rate
    // cannot be carried from window to window further than `displayTrackingSeconds` from
    // the last one that agreed, nor wander off in steps of the tolerance.
    let stands =
      !onlyFollowing
      && (confirms
        || (recentEnough && quality >= configuration.displayQualityThreshold
          && (detail.recentQuality ?? 1) >= configuration.displayMinimumRecentQuality))
    displayGate.push(stands ? bpm : nil)
    let agreed = stands && displayGate.agreed
    guard agreed || tracks else { return false }
    shownSinceReset = true
    if agreed { lastShown = (bpm, now) }
    return true
  }

  /// A window refused for the record before the analysis (too short yet, too soon after a
  /// gap, cut too much around movement), analysed for the screen alone. Nothing the sitting
  /// records is touched: not the agreement gate, the whole-sitting evidence or the windows
  /// beats are read from. Returns `otherwise`, what the record withholds the second with,
  /// when the screen is shown nothing either.
  private mutating func showRefused(
    _ range: Range<Int>, regions: [(region: Int, series: RegionSeries)], masks: [[Bool]?],
    at now: Double, otherwise: TickEstimate
  ) -> TickEstimate {
    guard configuration.showsProvisionalReadings, !regions.isEmpty else {
      displayGate.push(nil)
      return otherwise
    }
    let outcome = analyzer.analyse(
      regions.map(\.series), rate: configuration.resampleRateHz, frameRate: frameRate(of: range),
      masks: regions.map { masks[$0.region] })
    guard case .peak(let hz, let quality) = outcome.peak, !lightChangesColour(outcome.detail) else {
      displayGate.push(nil)
      return otherwise
    }
    let moves = movesInRhythm(outcome.detail)
    guard displays(hz * 60, quality: quality, detail: outcome.detail, at: now, onlyFollowing: moves) else {
      return otherwise
    }
    return .shown(hz * 60, quality: quality, unrecorded: otherwise.reason ?? .lowQuality)
  }

  /// Whether `bpm` is the rate windows agreed on no longer ago than `displayTrackingSeconds`.
  private func follows(_ bpm: Double, at now: Double) -> Bool {
    guard let lastShown, now - lastShown.time <= configuration.displayTrackingSeconds else { return false }
    return abs(bpm - lastShown.bpm) <= configuration.agreementToleranceBpm
  }

  /// Whether the rhythm a window holds is the subject moving, not blood. A head that nods,
  /// rocks or bobs changes the regions' brightness in a rhythm, and a little of that always
  /// leaks into their colour, where it is indistinguishable from a pulse. But blood barely
  /// changes brightness: at a pulse's own rate the brightness swings about as far as the
  /// pulse signal does. When it swings several times further, or the "pulse" is larger
  /// than blood makes it, the rhythm is the movement's.
  private func movesInRhythm(_ detail: PulseAnalyzer.Detail) -> Bool {
    (detail.brightnessRatio ?? 0) > configuration.maximumBrightnessRatio
      || (detail.pulseAmplitude ?? 0) > configuration.maximumPulseAmplitude
  }

  /// Whether the rhythm a window holds is the light changing colour, not blood: the two
  /// colour-difference signals move against each other at its rate (`minimumColourPhase`).
  /// A reading already established does not excuse it, as it may excuse movement: light
  /// that flickers at the patient's own heart rate is still not a measurement of it.
  private func lightChangesColour(_ detail: PulseAnalyzer.Detail) -> Bool {
    (detail.colourPhase ?? 1) < configuration.minimumColourPhase
  }

  /// A rhythm that could be movement is believed only where one that could not be was read
  /// at the same rate a moment ago: a heart beating hard enough to rock the head moves the
  /// brightness at its own rate, and that is no reason to lose a reading already
  /// established. It never establishes one.
  private func vouchedFor(_ bpm: Double, at now: Double) -> Bool {
    guard let steadyRate, now - steadyRate.time <= configuration.steadyRateSeconds else { return false }
    return abs(bpm - steadyRate.bpm) <= configuration.agreementToleranceBpm
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
  private func usableSamples(of range: Range<Int>) -> [[Bool]?] {
    let rate = configuration.resampleRateHz
    let disturbance = history.disturbance(in: range, configuration: configuration)
    // A stretch between two cuts must hold a projection window, or, when levels are
    // carried across cuts, enough samples to measure a level from.
    let run = Int(
      ((configuration.levelsAcrossCuts ? configuration.levelSeconds : PulseAnalyzer.projectionWindowSeconds)
        * rate).rounded())
    guard configuration.cutsRegionsSeparately else {
      let all = history.usableSamples(in: range, disturbed: disturbance.frames, rate: rate, minimumRun: run)
      return [[Bool]?](repeating: all, count: PulseHistory.regionCount)
    }
    return (0..<PulseHistory.regionCount).map {
      history.usableSamples(in: range, disturbed: disturbance.frames(of: $0), rate: rate, minimumRun: run)
    }
  }

  /// The share cut from the region that lost least.
  private func leastCutShare(of range: Range<Int>) -> Double {
    usableSamples(of: range).map { PulseTracker.share(cutFrom: $0) }.min() ?? 0
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
    diagnostic.motionShare = leastCutShare(of: range)
    diagnostic.colourJumpShare = disturbance.share(disturbance.colour)
    diagnostic.chestMotionShare = disturbance.share(disturbance.chest)
  }

  /// For a window a check refused before the analysis: its measurements, and the analysis
  /// it was denied, so that the candidate it held can be compared with a reference.
  private func describeRefused(_ range: Range<Int>, windowSeconds: Double, in diagnostic: inout PulseDiagnostic) {
    measure(range, windowSeconds: windowSeconds, in: &diagnostic)
    let regions = history.regions(in: range, rate: configuration.resampleRateHz)
    guard !regions.isEmpty else { return }
    let masks = usableSamples(of: range)
    let outcome = analyzer.analyse(
      regions.map(\.series), rate: configuration.resampleRateHz, frameRate: frameRate(of: range),
      masks: regions.map { masks[$0.region] })
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
    // Time inside a bridged interruption holds no frames by design.
    var covered = windowSeconds
    for index in range.dropFirst() where history.bridge[index] {
      covered -= max(0, times[index] - times[index - 1] - typical)
    }
    guard covered > 0 else { return .gaps }
    let windowSeconds = covered
    let expected = windowSeconds / typical
    if Double(range.count) < configuration.minimumSampleShare * expected
      || Double(range.count) / windowSeconds < configuration.minimumFrameRate
    {
      return .gaps
    }
    return nil
  }
}
