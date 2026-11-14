import Accelerate
import Foundation

/// Breathing-rate state for one sitting. Integrates the per-frame chest displacement into a
/// position, and once per second looks for the strongest component in the breathing band.
struct BreathingTracker {
  private let configuration: EngineConfiguration
  private let fourier: Fourier

  /// Uniform rate the chest position is resampled to. Breathing is far below 5 Hz.
  static let resampleRateHz = 10.0
  /// Roll-off outside the breathing band, in Hz.
  static let transitionHz = 0.03
  static let spectrumSize = 4096
  /// Slowest frequency the drift check looks at, as a multiple of the window's frequency
  /// resolution. Below two resolutions a Hann-windowed spectrum cannot tell a component
  /// from the constant term.
  static let slowestResolvedResolutions = 2.0

  private var times: [Double] = []
  private var positions: [Double] = []
  private var motion: [Bool] = []
  private var position = 0.0
  /// True when the frame before this one was a fast move.
  private var afterFastMove = false
  private var warmUpReason = EstimateReason.warmingUp
  private var gate: AgreementGate
  private var acceptedSinceReset = false

  init(configuration: EngineConfiguration, fourier: Fourier) {
    self.configuration = configuration
    self.fourier = fourier
    gate = AgreementGate(
      required: configuration.agreeingWindows,
      tolerance: configuration.breathingAgreementTolerancePerMin)
  }

  /// True while the chest is tracked, allowing for a short lapse.
  private func isTracking(at now: Double) -> Bool {
    guard let last = times.last else { return false }
    return now - last <= configuration.chestGapSeconds
  }

  mutating func ingest(_ frame: FrameRecord, interval: Double?, faceChanged: Bool) {
    if faceChanged {
      restart()
      warmUpReason = .faceChanged
    }
    guard let displacement = frame.chestMotion, let interval else { return }
    if !times.isEmpty, !isTracking(at: frame.t) { restart() }
    // A fast move is the body shifting, not a breath: it is counted but not integrated. The
    // frame after it is left out with it. A tracking glitch moves the chest one way and
    // straight back, and leaving out only the first half would keep the second as a step the
    // size of the glitch, which is a third of a breath or more.
    let fast = abs(displacement) / interval > configuration.motionChestSpeed
    let inMotion = fast || afterFastMove
    afterFastMove = fast
    if !times.isEmpty, !inMotion { position += displacement }
    times.append(frame.t)
    positions.append(position)
    motion.append(inMotion)

    let keep = configuration.breathingWindowSeconds
    if frame.t - times[0] > 2 * keep, let cut = times.firstIndex(where: { $0 >= frame.t - keep }) {
      times.removeFirst(cut)
      positions.removeFirst(cut)
      motion.removeFirst(cut)
    }
  }

  private mutating func restart() {
    times.removeAll()
    positions.removeAll()
    motion.removeAll()
    position = 0
    afterFastMove = false
    acceptedSinceReset = false
    gate.reset()
  }

  /// Why the newest frames cannot be used, or nil when the chest is tracked.
  func blocked(at now: Double) -> EstimateReason? {
    isTracking(at: now) ? nil : .noChest
  }

  mutating func missedTick() {
    gate.push(nil)
  }

  mutating func tick(at now: Double) -> TickEstimate {
    guard isTracking(at: now), let first = times.first else {
      return .withheld(.none, .noChest)
    }
    guard now - first >= configuration.breathingMinimumWindowSeconds else {
      return .withheld(.settling, warmUpReason)
    }
    warmUpReason = .warmingUp
    let windowSeconds = min(now - first, configuration.breathingWindowSeconds)
    let start = times.firstIndex(where: { $0 >= now - windowSeconds }) ?? 0
    let range = start..<times.count

    let moving = motion[range].reduce(0) { $0 + ($1 ? 1 : 0) }
    if Double(moving) / Double(range.count) > configuration.maximumMotionShare {
      gate.push(nil)
      return .withheld(.none, .motion)
    }
    if Double(range.count) / windowSeconds < configuration.minimumFrameRate {
      gate.push(nil)
      return .withheld(.none, .gaps)
    }

    switch analyse(range) {
    case .flat, .flicker, .drift, .illumination:
      gate.push(nil)
      return .withheld(.none, .lowQuality)
    case .bandEdge(let quality):
      gate.push(nil)
      return .withheld(.none, .bandEdge, quality: quality)
    case .peak(_, let quality) where quality < configuration.breathingQualityThreshold:
      gate.push(nil)
      return .withheld(.none, .lowQuality, quality: quality)
    case .peak(let hz, let quality):
      let perMinute = hz * 60
      gate.push(perMinute)
      guard gate.agreed else {
        return .withheld(acceptedSinceReset ? .none : .settling, .awaitingAgreement, quality: quality)
      }
      acceptedSinceReset = true
      return .valid(perMinute, quality: quality)
    }
  }

  private func analyse(_ range: Range<Int>) -> PeakOutcome {
    let rate = BreathingTracker.resampleRateHz
    let end = times[range.upperBound - 1]
    let count = Int(((end - times[range.lowerBound]) * rate).rounded(.down)) + 1
    let uniform = DSP.resample(
      times: times, values: positions, range: range,
      start: end - Double(count - 1) / rate, rate: rate, count: count)
    let detrended = DSP.detrend(uniform)
    let filtered = fourier.bandPass(
      detrended, rate: rate, band: configuration.breathingBandHz,
      transitionHz: BreathingTracker.transitionHz)
    guard DSP.rootMeanSquare(filtered) > 0 else { return .flat }
    let window = DSP.hann(count)
    let size = max(BreathingTracker.spectrumSize, DSP.powerOfTwo(atLeast: count))
    let spectrum = PowerSpectrum(fourier.forward(vDSP.multiply(filtered, window), size: size, rate: rate))
    let resolution = rate / Double(count)
    let halfWidthHz = configuration.breathingQualityHalfWidthResolutions * resolution
    let outcome = spectrum.strongestPeak(
      PeakSearch(
        rangeHz: configuration.breathingBandHz,
        edgeMarginHz: configuration.breathingBandEdgeMarginPerMin / 60,
        tieRatio: configuration.harmonicTieRatio,
        qualityHalfWidthHz: halfWidthHz))
    guard case .peak(let hz, _) = outcome else { return outcome }

    // The same chest position with nothing filtered away. It is only ever used to overrule a
    // peak, never to report one. A chest that drifts, or is shifted in steps, has more power
    // the slower the frequency, all the way down, and the band-pass cuts a peak out of that
    // slope at the lower edge of the band. A breath is a peak of its own: nothing slower than
    // it is stronger than it.
    let open = PowerSpectrum(fourier.forward(vDSP.multiply(detrended, window), size: size, rate: rate))
    let slowest = BreathingTracker.slowestResolvedResolutions * resolution
    if open.hasStrongerComponent(below: hz, from: slowest, clearanceHz: halfWidthHz) { return .drift }
    return outcome
  }
}
