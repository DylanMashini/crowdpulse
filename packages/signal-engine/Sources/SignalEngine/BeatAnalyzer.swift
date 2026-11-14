import Accelerate
import Foundation

/// Beat-to-beat intervals and the variability numbers for a finished sitting.
struct BeatAnalysis {
  /// Accepted intervals in time order.
  var intervals: [BeatInterval] = []
  var rmssd: Double?
  var sdnn: Double?
  /// Share of the sitting spanned by accepted intervals.
  var coverage: Double = 0
  /// Why `rmssd` and `sdnn` are nil.
  var withheld: SummaryReason?
}

struct BeatAnalyzer {
  let configuration: EngineConfiguration
  let pulse: PulseAnalyzer

  /// Beats this close to the end of a stretch are dropped: the filter rings there.
  static let edgeSeconds = 1.0
  /// The server accepts at most this many intervals per sitting.
  static let maximumIntervals = 600
  /// Share of the squared disagreement between forehead and cheeks that ends up in the
  /// squared RMSSD. With independent timing errors of variance v per beat in each of two
  /// equally weighted halves, the disagreement of an interval has variance 4v, the combined
  /// beat time v / 2, and a successive difference of intervals (three beat times, weights
  /// 1, -2, 1) 6 * v / 2 = 3v: three quarters of the disagreement.
  static let disagreementShareInRmssd = 0.75

  private struct Stretch {
    var start: Double
    var end: Double
    var lowHz: Double
    var highHz: Double
  }

  private struct Candidate {
    /// Capture-clock time of the beat that ends the interval.
    var end: Double
    var ms: Double
    var stretch: Int
    var accepted: Bool
  }

  /// - Parameters:
  ///   - windows: the analysis windows that produced a valid heart-rate reading. Beats are
  ///     looked for only inside them, so noise never contributes an interval.
  ///   - weights: each region's share in the combined waveform.
  ///   - origin: capture-clock time of the first frame of the sitting.
  func analyse(
    history: PulseHistory, windows: [ValidPulseWindow], weights: [Double],
    origin: Double, duration: Double
  ) -> BeatAnalysis {
    guard !windows.isEmpty, duration > 0 else { return BeatAnalysis(withheld: .noHeartRate) }
    let shares = weights.contains { $0 > 0 } ? weights : weights.map { _ in 1 }

    var candidates: [Candidate] = []
    var disagreements: [Double] = []
    for (index, stretch) in stretches(windows).enumerated() {
      guard let pulses = RegionPulses(stretch, history: history, analyzer: self) else { continue }
      let beats = pulses.beatTimes(weights: shares)
      let lengths = zip(beats, beats.dropFirst()).map { ($1 - $0) * 1000 }
      let accepted = BeatAnalyzer.acceptance(of: lengths, configuration: configuration)
      for (offset, length) in lengths.enumerated() {
        candidates.append(
          Candidate(end: beats[offset + 1], ms: length, stretch: index, accepted: accepted[offset]))
      }
      // The same beats timed twice, from the forehead alone and from the cheeks alone.
      disagreements += BeatAnalyzer.intervalDisagreements(
        pulses.beatTimes(weights: [shares[0], 0, 0]),
        pulses.beatTimes(weights: [0, shares[1], shares[2]]),
        within: 0.25 / stretch.highHz)
    }

    let accepted = candidates.filter(\.accepted)
    var analysis = BeatAnalysis()
    analysis.intervals = accepted.suffix(BeatAnalyzer.maximumIntervals).map {
      BeatInterval(tMs: ($0.end - origin) * 1000, ms: $0.ms)
    }
    analysis.coverage = min(1, accepted.reduce(0) { $0 + $1.ms } / (duration * 1000))

    // Successive differences only between intervals that are neighbours in the beat train.
    var differences: [Double] = []
    for (first, second) in zip(candidates, candidates.dropFirst())
    where first.accepted && second.accepted && first.stretch == second.stretch {
      differences.append(second.ms - first.ms)
    }

    if accepted.count < configuration.minimumBeatIntervals || differences.count < 2 {
      analysis.withheld = .tooFewBeats
    } else if analysis.coverage < configuration.minimumBeatCoverage {
      analysis.withheld = .lowBeatCoverage
    } else if disagreements.count < configuration.minimumBeatIntervals
      || Double(candidates.count - accepted.count)
        > configuration.maximumRejectedBeatShare * Double(candidates.count)
    {
      // A disturbance that reaches every region alike cannot be seen by comparing regions,
      // but it shows as intervals that had to be thrown out. The ones left are no cleaner.
      analysis.withheld = .lowQuality
    } else {
      // The heart is one clock. Where two patches of skin disagree about when it ticked,
      // the difference is timing noise, and that noise is counted as variability.
      let disagreement = vDSP.rootMeanSquare(disagreements)
      let rmssd = vDSP.rootMeanSquare(differences)
      let noise = BeatAnalyzer.disagreementShareInRmssd * disagreement * disagreement
      if disagreement > configuration.maximumBeatDisagreementMs
        && noise > configuration.maximumBeatNoiseShare * rmssd * rmssd
      {
        analysis.withheld = .lowQuality
      } else {
        let lengths = accepted.map(\.ms)
        let mean = vDSP.mean(lengths)
        let variance = lengths.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(lengths.count - 1)
        analysis.rmssd = rmssd
        analysis.sdnn = variance.squareRoot()
      }
    }
    return analysis
  }

  /// Differences, in ms, between the lengths of the same beat intervals in two beat trains.
  /// A beat in one train matches the nearest beat in the other when they are closer than
  /// `within` seconds.
  static func intervalDisagreements(_ first: [Double], _ second: [Double], within: Double) -> [Double] {
    var matches: [(first: Int, second: Int)] = []
    var candidate = 0
    for (index, beat) in first.enumerated() {
      while candidate + 1 < second.count, abs(second[candidate + 1] - beat) <= abs(second[candidate] - beat) {
        candidate += 1
      }
      if candidate < second.count, abs(second[candidate] - beat) < within {
        matches.append((index, candidate))
      }
    }
    return zip(matches, matches.dropFirst()).compactMap { earlier, later in
      guard later.first == earlier.first + 1, later.second == earlier.second + 1 else { return nil }
      let firstLength = first[later.first] - first[earlier.first]
      let secondLength = second[later.second] - second[earlier.second]
      return (firstLength - secondLength) * 1000
    }
  }

  /// Merges overlapping windows into unbroken stretches of accepted signal.
  private func stretches(_ windows: [ValidPulseWindow]) -> [Stretch] {
    var merged: [Stretch] = []
    for window in windows.sorted(by: { $0.start < $1.start }) {
      if var last = merged.last, window.start <= last.end {
        last.end = max(last.end, window.end)
        last.lowHz = min(last.lowHz, window.rateHz)
        last.highHz = max(last.highHz, window.rateHz)
        merged[merged.count - 1] = last
      } else {
        merged.append(Stretch(start: window.start, end: window.end, lowHz: window.rateHz, highHz: window.rateHz))
      }
    }
    return merged
  }

  /// The pulse waveform of each region over one stretch, ready to be combined and searched
  /// for beats.
  private struct RegionPulses {
    var regions: [Int]
    var waveforms: [[Double]]
    /// Capture-clock time of the first sample.
    var start: Double
    var highHz: Double
    let analyzer: BeatAnalyzer

    init?(_ stretch: Stretch, history: PulseHistory, analyzer: BeatAnalyzer) {
      let rate = analyzer.configuration.resampleRateHz
      let range = history.index(atOrAfter: stretch.start)..<history.index(atOrAfter: stretch.end.nextUp)
      let series = history.regions(in: range, rate: rate)
      guard let count = series.first?.series.r.count,
        Double(count) / rate > 2 * BeatAnalyzer.edgeSeconds
      else { return nil }

      // The fundamental and the second harmonic, each with the sidebands that carry
      // beat-to-beat changes (half the rate on either side). Taking both whole makes the
      // beat times independent of the shape of the pulse; cutting through the harmonic's
      // sidebands biases them one way or the other. Wider than this only adds noise.
      let band = analyzer.configuration.heartRateBandHz
      let around = max(band.lowerBound / 2, 0.5 * stretch.lowHz)...(2.5 * stretch.highHz)
      regions = series.map(\.region)
      waveforms = series.map { analyzer.pulse.waveform($0.series, rate: rate, band: around) }
      start = history.times[range.upperBound - 1] - Double(count - 1) / rate
      highHz = stretch.highHz
      self.analyzer = analyzer
    }

    /// Capture-clock times of the pulse peaks in the regions' weighted sum. `weights` has
    /// one entry per region of the face; a region with no weight is left out.
    func beatTimes(weights: [Double]) -> [Double] {
      let used = waveforms.indices.filter {
        weights[regions[$0]] > 0 && DSP.rootMeanSquare(waveforms[$0]) > 0
      }
      guard !used.isEmpty else { return [] }
      let combined = analyzer.pulse.combine(used.map { waveforms[$0] }, weights: used.map { weights[regions[$0]] })

      let fineRate = analyzer.configuration.beatUpsampleRateHz
      let fine = DSP.cubicUpsample(combined, rate: analyzer.configuration.resampleRateHz, targetRate: fineRate)
      let separation = Int((0.6 / highHz * fineRate).rounded())
      let edge = max(1, Int(BeatAnalyzer.edgeSeconds * fineRate))
      guard fine.count > 2 * edge + 2 else { return [] }

      var peaks: [Int] = []
      for index in edge..<(fine.count - edge)
      where fine[index] > 0 && fine[index] > fine[index - 1] && fine[index] >= fine[index + 1] {
        if let last = peaks.last, index - last < separation {
          if fine[index] > fine[last] { peaks[peaks.count - 1] = index }
        } else {
          peaks.append(index)
        }
      }
      return peaks.map { index in
        let left = fine[index - 1]
        let centre = fine[index]
        let right = fine[index + 1]
        let curvature = left - 2 * centre + right
        let offset = curvature < 0 ? 0.5 * (left - right) / curvature : 0
        return start + (Double(index) + offset) / fineRate
      }
    }
  }

  /// For each interval of one unbroken beat train, in ms: whether it is a possible heartbeat,
  /// close to the median of the (up to) three intervals on each side of it, and not next to
  /// an interval that fails either test. An ectopic beat or a mislocated peak also bends
  /// the filtered waveform under the beats beside it, so their intervals are not clean.
  static func acceptance(of lengths: [Double], configuration: EngineConfiguration) -> [Bool] {
    let shortest = 60_000 / configuration.heartRateSearchBpm.upperBound
    let longest = 60_000 / configuration.heartRateSearchBpm.lowerBound
    let regular = lengths.indices.map { index -> Bool in
      let length = lengths[index]
      guard (shortest...longest).contains(length) else { return false }
      let neighbours = (max(0, index - 3)...min(lengths.count - 1, index + 3))
        .filter { $0 != index }
        .map { lengths[$0] }
      guard let typical = DSP.median(neighbours) else { return false }
      return abs(length - typical) <= configuration.beatIntervalTolerance * typical
    }
    return regular.indices.map { index in
      regular[max(0, index - 1)...min(regular.count - 1, index + 1)].allSatisfy { $0 }
    }
  }
}
