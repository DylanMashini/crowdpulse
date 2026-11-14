import Foundation

/// A heart rate for the sitting taken from all of it at once, and the evidence for it.
///
/// A one-second reading is shown only when its own window passes every check and agrees
/// with its neighbours, which a weak but steady pulse may never do. Here the spectra of all
/// the windows are added up: a pulse is at about the same frequency in each of them and
/// adds, while noise is somewhere else every few seconds and averages out. The estimate is
/// accepted only when the summed peak is strong enough and enough separate stretches of the
/// sitting put their own strongest peak at it. It never feeds a live reading.
public struct WholeSittingEstimate: Codable, Sendable, Equatable {
  /// The strongest peak of the summed spectrum, in bpm, whether or not it was accepted. Nil
  /// when there were no windows to add or the peak is at the edge of the search range.
  public var heartRate: Double?
  /// Share of the summed spectrum's power within the quality interval of that peak, 0 to 1.
  public var quality: Double
  /// How far the peak stands above its surroundings: the power within the quality interval
  /// of the peak over the power in the stronger of the two intervals of the same width
  /// beside it. A peak that is only the top of a slope scores near 1.
  public var prominence: Double = 0
  /// Share of the windows whose own candidate is within `agreementToleranceBpm` of the peak.
  public var support: Double
  /// How many ten-second stretches of the sitting hold at least one such window.
  public var supportingStretches: Int
  /// Windows added up.
  public var windows: Int
  /// The estimate passed `wholeSittingQuality`, `wholeSittingProminence`,
  /// `wholeSittingSupport` and `wholeSittingStretches`.
  public var accepted: Bool

  public init(
    heartRate: Double?, quality: Double, support: Double, supportingStretches: Int, windows: Int, accepted: Bool
  ) {
    self.heartRate = heartRate
    self.quality = quality
    self.support = support
    self.supportingStretches = supportingStretches
    self.windows = windows
    self.accepted = accepted
  }

  static let none = WholeSittingEstimate(
    heartRate: nil, quality: 0, support: 0, supportingStretches: 0, windows: 0, accepted: false)
}

struct WholeSittingAnalyzer {
  let configuration: EngineConfiguration
  /// Length of the stretches support is counted in, in seconds: the longest window, so two
  /// stretches share no frame.
  var stretchSeconds: Double { configuration.heartRateWindowSeconds }

  func estimate(_ evidence: [WindowEvidence], origin: Double) -> WholeSittingEstimate {
    // Only full-length windows: shorter ones have a coarser spectrum and would blur the sum.
    let windows = evidence.filter { $0.seconds >= configuration.heartRateWindowSeconds - 0.5 }
    guard let first = windows.first else { return .none }
    let bins = first.spectrum.count
    let usable = windows.filter { $0.spectrum.count == bins && $0.binHz == first.binHz }

    // Each region is summed over the sitting and weighted by how clear its own summed peak
    // is. A window's own weights are too noisy to choose between regions when the pulse is
    // weak; the sitting's are not.
    let search = PeakSearch(
      rangeHz: (configuration.heartRateSearchBpm.lowerBound / 60)...(configuration.heartRateSearchBpm.upperBound / 60),
      edgeMarginHz: configuration.bandEdgeMarginBpm / 60,
      tieRatio: configuration.harmonicTieRatio,
      qualityHalfWidthHz: configuration.qualityHalfWidthResolutions / configuration.heartRateWindowSeconds)
    var summed = [Double](repeating: 0, count: bins)
    if configuration.wholeSittingWeighsRegions {
      var total = 0.0
      for region in 0..<PulseHistory.regionCount {
        var sum = [Double](repeating: 0, count: bins)
        var count = 0
        for window in usable {
          guard let at = window.regions.firstIndex(of: region), let spectrum = window.regionSpectra[at],
            spectrum.count == bins
          else { continue }
          for bin in 0..<bins { sum[bin] += spectrum[bin] }
          count += 1
        }
        // A region missing from most of the sitting does not speak for it.
        guard 2 * count >= usable.count, count > 0 else { continue }
        let mean = sum.map { $0 / Double(count) }
        guard let peak = PowerSpectrum(power: mean, binHz: first.binHz).strongestCandidate(search) else { continue }
        let weight = peak.quality * peak.quality
        for bin in 0..<bins { summed[bin] += weight * mean[bin] }
        total += weight
      }
      guard total > 0 else { return .none }
      summed = summed.map { $0 / total }
    } else {
      for window in usable {
        for bin in 0..<bins { summed[bin] += window.spectrum[bin] / Double(usable.count) }
      }
    }

    let spectrum = PowerSpectrum(power: summed, binHz: first.binHz)
    guard let peak = spectrum.strongestCandidate(search) else { return .none }
    var estimate = WholeSittingEstimate(
      heartRate: nil, quality: peak.quality, support: 0, supportingStretches: 0, windows: usable.count,
      accepted: false)
    guard !peak.atEdge else { return estimate }
    let bpm = peak.hz * 60
    estimate.heartRate = bpm
    // The peak is the strongest of the whole search range. If that is down where drift
    // gathers, there is no estimate; nothing higher up is looked for, because the second
    // harmonic of a slow heart is up there and is just as steady as its fundamental.
    guard bpm >= configuration.wholeSittingMinimumBpm else { return estimate }
    // Quality is the peak's share of the band above that floor: what drift adds below it
    // says nothing about how clear the peak is.
    let floorBin = max(
      1, Int(((configuration.wholeSittingMinimumBpm / 60 - search.qualityHalfWidthHz) / first.binHz).rounded(.down)))
    var above = summed
    for bin in 0..<min(floorBin, bins) { above[bin] = 0 }
    estimate.quality = PowerSpectrum(power: above, binHz: first.binHz).quality(
      at: peak.hz, halfWidthHz: search.qualityHalfWidthHz)
    func power(from low: Double, to high: Double) -> Double {
      let first = max(1, Int((low / spectrum.binHz).rounded(.up)))
      let last = min(bins - 1, Int((high / spectrum.binHz).rounded(.down)))
      return first <= last ? summed[first...last].reduce(0, +) : 0
    }
    let half = search.qualityHalfWidthHz
    let beside = max(
      power(from: peak.hz - 3 * half, to: peak.hz - half), power(from: peak.hz + half, to: peak.hz + 3 * half))
    estimate.prominence = beside > 0 ? power(from: peak.hz - half, to: peak.hz + half) / beside : 0

    let supporting = usable.filter { window in
      window.candidateHz.map { abs($0 * 60 - bpm) <= configuration.agreementToleranceBpm } ?? false
    }
    estimate.support = Double(supporting.count) / Double(usable.count)
    estimate.supportingStretches = Set(supporting.map { Int(($0.end - origin) / stretchSeconds) }).count
    estimate.accepted =
      usable.count >= configuration.wholeSittingWindows
      && estimate.quality >= configuration.wholeSittingQuality
      && estimate.prominence >= configuration.wholeSittingProminence
      && estimate.support >= configuration.wholeSittingSupport
      && estimate.supportingStretches >= configuration.wholeSittingStretches
    return estimate
  }
}
