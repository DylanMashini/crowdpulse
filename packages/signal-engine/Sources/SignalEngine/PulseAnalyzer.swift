import Accelerate
import Foundation

/// Colour means of one skin region on a uniform time grid.
struct RegionSeries {
  var r: [Double]
  var g: [Double]
  var b: [Double]
}

/// Turns region colour series into a pulse waveform and a heart-rate candidate.
struct PulseAnalyzer {
  let configuration: EngineConfiguration
  let fourier: Fourier

  /// Roll-off outside the pulse band, in Hz.
  static let transitionHz = 0.1
  /// Length of the sliding POS window, in seconds (Wang et al. 2017 use 1.6 s).
  static let projectionWindowSeconds = 1.6
  /// Spectra are zero-padded to this size so bins are under 1 bpm apart at 60 Hz.
  static let spectrumSize = 4096
  /// Half-width of the main lobe of a Hann-windowed peak, as a multiple of the window's
  /// frequency resolution (1 / window length).
  static let mainLobeResolutions = 2.0

  struct Outcome {
    var peak: PeakOutcome
    /// Weight each region had in the combined signal; they sum to 1 when any region is usable.
    var weights: [Double]
    /// What the window held before the checks that can overrule it. Diagnostics only:
    /// nothing in the engine decides anything from it.
    var detail = Detail()
  }

  struct Detail: Equatable {
    /// The strongest peak of the combined signal. Nil when the pulse band holds no power.
    var strongest: PeakCandidate?
    /// What the window would report if nothing refused it: the strongest peak, or half of
    /// it when it was taken for a second harmonic.
    var candidateHz: Double?
    var candidateQuality: Double?
    /// The strongest peak is where lamp flicker would appear at this frame rate.
    var flickerAlias = false
    /// The strongest peak was taken for a second harmonic.
    var halved = false
    /// Share of what the colour-difference signals hold at the candidate that survives the
    /// projection. Nil when the check did not run.
    var projectionYield: Double?
    /// Quality at the candidate in the newest `recentEvidenceSeconds` of the window alone.
    /// Nil when there is no candidate to report or the window is too short to have a
    /// newest part.
    var recentQuality: Double?
  }

  /// POS (plane orthogonal to skin) projection with overlap-add. Each window is normalised
  /// by its own channel means, so brightness changes common to the three channels cancel.
  ///
  /// `usable` marks the samples that may be analysed. Every stretch of them is projected on
  /// its own, so no window straddles a cut and the level the colour settles at afterwards
  /// does not matter; the samples cut are left at zero. Each sample is the mean of the
  /// windows that cover it, so a stretch keeps its amplitude up to its ends.
  func project(_ region: RegionSeries, rate: Double, usable: [Bool]? = nil) -> [Double] {
    let count = region.r.count
    let length = Int((PulseAnalyzer.projectionWindowSeconds * rate).rounded())
    var pulse = [Double](repeating: 0, count: count)
    guard count >= length, length > 1 else { return pulse }
    let scratch = UnsafeMutablePointer<Double>.allocate(capacity: 2 * length)
    defer { scratch.deallocate() }
    let s1 = scratch
    let s2 = scratch + length
    let n = vDSP_Length(length)

    var runs: [Range<Int>] = []
    if let usable {
      var runStart: Int?
      for index in 0...count {
        let open = index < count && usable[index]
        if open, runStart == nil { runStart = index }
        if !open, let from = runStart {
          if index - from >= length { runs.append(from..<index) }
          runStart = nil
        }
      }
    } else {
      runs = [0..<count]
    }

    region.r.withUnsafeBufferPointer { r in
      region.g.withUnsafeBufferPointer { g in
        region.b.withUnsafeBufferPointer { b in
          pulse.withUnsafeMutableBufferPointer { output in
            for run in runs {
              for start in run.lowerBound...(run.upperBound - length) {
                let red = r.baseAddress! + start
                let green = g.baseAddress! + start
                let blue = b.baseAddress! + start
                let target = output.baseAddress! + start
                var meanR = 0.0
                var meanG = 0.0
                var meanB = 0.0
                vDSP_meanvD(red, 1, &meanR, n)
                vDSP_meanvD(green, 1, &meanG, n)
                vDSP_meanvD(blue, 1, &meanB, n)
                guard meanR > 0, meanG > 0, meanB > 0 else { continue }
                var inverseG = 1 / meanG
                var inverseB = 1 / meanB
                var negativeInverseB = -inverseB
                var minusTwoInverseR = -2 / meanR
                // s1 = G - B, s2 = G + B - 2R on mean-normalised channels; both have zero mean.
                vDSP_vsmsmaD(green, 1, &inverseG, blue, 1, &negativeInverseB, s1, 1, n)
                vDSP_vsmsmaD(green, 1, &inverseG, blue, 1, &inverseB, s2, 1, n)
                vDSP_vsmaD(red, 1, &minusTwoInverseR, s2, 1, s2, 1, n)
                var deviation1 = 0.0
                var deviation2 = 0.0
                vDSP_rmsqvD(s1, 1, &deviation1, n)
                vDSP_rmsqvD(s2, 1, &deviation2, n)
                guard deviation2 > 0 else { continue }
                var alpha = deviation1 / deviation2
                vDSP_vsmaD(s2, 1, &alpha, s1, 1, s1, 1, n)
                vDSP_vaddD(s1, 1, target, 1, target, 1, n)
              }
              // Windows covering a sample: fewer towards the ends of the stretch.
              let windows = run.count - length + 1
              var mean = 0.0
              for index in run {
                let covering = min(index - run.lowerBound + 1, run.upperBound - index, length, windows)
                output[index] /= Double(covering)
                mean += output[index]
              }
              mean /= Double(run.count)
              for index in run { output[index] -= mean }
            }
          }
        }
      }
    }
    return pulse
  }

  /// Projected, detrended and band-passed pulse waveform of one region.
  func waveform(_ region: RegionSeries, rate: Double, band: ClosedRange<Double>) -> [Double] {
    let detrended = DSP.detrend(project(region, rate: rate))
    return fourier.bandPass(detrended, rate: rate, band: band, transitionHz: PulseAnalyzer.transitionHz)
  }

  /// Scores each region on its own, then adds the regions' waveforms weighted by the square
  /// of that score, so a clean region is not diluted by a poor one.
  func regionWeights(_ waveforms: [[Double]], rate: Double, search: PeakSearch) -> [Double] {
    let scores = waveforms.map { waveform -> Double in
      guard DSP.rootMeanSquare(waveform) > 0 else { return 0 }
      let quality = spectrum(of: waveform, rate: rate).strongestPeak(search).quality
      return quality * quality
    }
    let total = scores.reduce(0, +)
    return total > 0 ? scores.map { $0 / total } : scores
  }

  /// Weighted sum of the waveforms, each scaled to unit RMS first.
  func combine(_ waveforms: [[Double]], weights: [Double]) -> [Double] {
    mix(waveforms, scales: scales(waveforms, weights: weights))
  }

  private func scales(_ waveforms: [[Double]], weights: [Double]) -> [Double] {
    zip(waveforms, weights).map { waveform, weight in
      let level = DSP.rootMeanSquare(waveform)
      return weight > 0 && level > 0 ? weight / level : 0
    }
  }

  private func mix(_ signals: [[Double]], scales: [Double]) -> [Double] {
    var mixed = [Double](repeating: 0, count: signals.first?.count ?? 0)
    for (signal, scale) in zip(signals, scales) where scale > 0 {
      mixed = vDSP.add(mixed, vDSP.multiply(scale, signal))
    }
    return mixed
  }

  func search(windowSeconds: Double) -> PeakSearch {
    PeakSearch(
      rangeHz: (configuration.heartRateSearchBpm.lowerBound / 60)...(configuration.heartRateSearchBpm.upperBound / 60),
      edgeMarginHz: configuration.bandEdgeMarginBpm / 60,
      tieRatio: configuration.harmonicTieRatio,
      qualityHalfWidthHz: configuration.qualityHalfWidthResolutions / windowSeconds
    )
  }

  /// Heart-rate candidate for one analysis window.
  /// - Parameter frameRate: frames per second the camera delivered in this window, or nil
  ///   when its timestamps are too irregular for lamp flicker to alias into a steady tone.
  /// - Parameter usable: samples that may be analysed; the others were cut out around a
  ///   colour jump or a movement. Nil when all of them may.
  func analyse(_ regions: [RegionSeries], rate: Double, frameRate: Double?, usable: [Bool]? = nil) -> Outcome {
    guard let count = regions.first?.r.count, count > 1 else { return Outcome(peak: .flat, weights: []) }
    let search = search(windowSeconds: Double(count) / rate)
    let band = configuration.heartRateBandHz
    let kept = usable.map { $0.map { $0 ? 1.0 : 0.0 } }
    // What the band-pass rings into a cut is not signal.
    func cut(_ signal: [Double]) -> [Double] {
      kept.map { vDSP.multiply(signal, $0) } ?? signal
    }
    let projected = regions.map { DSP.detrend(project($0, rate: rate, usable: usable)) }
    let waveforms = projected.map {
      cut(fourier.bandPass($0, rate: rate, band: band, transitionHz: PulseAnalyzer.transitionHz))
    }
    let weights = regionWeights(waveforms, rate: rate, search: search)
    let scales = scales(waveforms, weights: weights)
    let combined = mix(waveforms, scales: scales)
    guard DSP.rootMeanSquare(combined) > 0 else { return Outcome(peak: .flat, weights: weights) }
    let narrow = spectrum(of: combined, rate: rate)
    guard let strongest = narrow.strongestCandidate(search) else { return Outcome(peak: .flat, weights: weights) }
    var detail = Detail(strongest: strongest, candidateHz: strongest.hz, candidateQuality: strongest.quality)
    guard !strongest.atEdge else {
      return Outcome(peak: .bandEdge(quality: strongest.quality), weights: weights, detail: detail)
    }
    let hz = strongest.hz
    let peak = PeakOutcome.peak(hz: hz, quality: strongest.quality)

    if isFlickerAlias(hz, frameRate: frameRate) {
      detail.flickerAlias = true
      return Outcome(peak: .flicker, weights: weights, detail: detail)
    }

    // The same mix of regions with the band opened downwards far enough to see half of any
    // rate in the search range. It is only ever used to overrule a peak, never to report one.
    let open = (band.lowerBound / 2)...band.upperBound
    let wide = spectrum(
      of: cut(
        fourier.bandPass(
          mix(projected, scales: scales), rate: rate, band: open, transitionHz: PulseAnalyzer.transitionHz)),
      rate: rate)
    let found = wide.hasSubharmonic(
      of: hz, toleranceHz: search.qualityHalfWidthHz / 2, floor: configuration.subharmonicPowerFloor,
      noiseRatio: configuration.subharmonicNoiseRatio, band: open,
      lobeHalfWidthHz: PulseAnalyzer.mainLobeResolutions * rate / Double(count))

    // A peak with a subharmonic is a second harmonic. The heart rate is half of it, scored
    // like any other candidate: by its own share of the pulse band, or rejected when it lies
    // outside.
    var reported = peak
    var reportedHz = hz
    if found {
      reportedHz = hz / 2
      let quality = narrow.quality(at: reportedHz, halfWidthHz: search.qualityHalfWidthHz)
      let inside = (search.rangeHz.lowerBound + search.edgeMarginHz)...(search.rangeHz.upperBound - search.edgeMarginHz)
      reported = inside.contains(reportedHz) ? .peak(hz: reportedHz, quality: quality) : .bandEdge(quality: quality)
      detail.halved = true
      detail.candidateHz = reportedHz
      detail.candidateQuality = quality
    }
    if case .peak = reported {
      detail.projectionYield = projectionYield(regions, weights: weights, at: reportedHz, rate: rate)
      if let yield = detail.projectionYield, yield < configuration.minimumProjectionYield {
        return Outcome(peak: .illumination, weights: weights, detail: detail)
      }
      detail.recentQuality = recentQuality(combined, usable: usable, at: reportedHz, rate: rate)
    }
    return Outcome(peak: reported, weights: weights, detail: detail)
  }

  /// Quality at `hz` in the newest `recentEvidenceSeconds` of the combined waveform. 0 when
  /// more than half of them were cut: what cannot be seen does not vouch for the rate.
  private func recentQuality(_ combined: [Double], usable: [Bool]?, at hz: Double, rate: Double) -> Double? {
    let tail = Int((configuration.recentEvidenceSeconds * rate).rounded())
    guard tail > 1, 2 * combined.count >= 3 * tail else { return nil }
    if let usable, 2 * usable.suffix(tail).reduce(0, { $0 + ($1 ? 1 : 0) }) < tail { return 0 }
    let newest = Array(combined.suffix(tail))
    guard DSP.rootMeanSquare(newest) > 0 else { return 0 }
    return spectrum(of: newest, rate: rate).quality(
      at: hz, halfWidthHz: configuration.qualityHalfWidthResolutions * rate / Double(tail))
  }

  /// Whether what the regions carry at `hz` is something the projection cancels. The
  /// projection adds two colour-difference signals, green minus blue and green plus blue
  /// minus twice red, the second scaled so that the two are equally strong. Blood moves them
  /// together and they add. A change in the colour of the light, such as a screen or a sign
  /// cycling, moves them against each other and they cancel, but never completely: sensor
  /// noise detunes the scale, and the remainder keeps the rhythm of the light and can pass
  /// for a pulse on quality alone. So when less than `minimumProjectionYield` of what the
  /// two signals hold at `hz` survives their sum, the peak is that remainder.
  ///
  /// Returns the share that survives, or nil when the regions hold nothing at `hz`.
  private func projectionYield(_ regions: [RegionSeries], weights: [Double], at hz: Double, rate: Double) -> Double? {
    var kept = 0.0
    var held = 0.0
    for (region, weight) in zip(regions, weights) where weight > 0 {
      let meanR = vDSP.mean(region.r)
      let meanG = vDSP.mean(region.g)
      let meanB = vDSP.mean(region.b)
      guard meanR > 0, meanG > 0, meanB > 0 else { continue }
      let count = region.r.count
      var s1 = [Double](repeating: 0, count: count)
      var s2 = [Double](repeating: 0, count: count)
      for index in 0..<count {
        let r = region.r[index] / meanR
        let g = region.g[index] / meanG
        let b = region.b[index] / meanB
        s1[index] = g - b
        s2[index] = g + b - 2 * r
      }
      s1 = DSP.detrend(s1)
      s2 = DSP.detrend(s2)
      let deviation2 = DSP.rootMeanSquare(s2)
      guard deviation2 > 0 else { continue }
      let alpha = DSP.rootMeanSquare(s1) / deviation2
      let window = DSP.hann(count)
      let a = DSP.component(of: vDSP.multiply(s1, window), at: hz, rate: rate)
      let b = DSP.component(of: vDSP.multiply(s2, window), at: hz, rate: rate)
      let sum = (re: a.re + alpha * b.re, im: a.im + alpha * b.im)
      kept += weight * (sum.re * sum.re + sum.im * sum.im).squareRoot()
      held += weight
        * ((a.re * a.re + a.im * a.im).squareRoot() + alpha * (b.re * b.re + b.im * b.im).squareRoot())
    }
    guard held > 0 else { return nil }
    return kept / held
  }

  /// Lamps flicker at the mains frequency and twice it. A camera whose frame rate is not an
  /// exact divisor of that frequency samples the flicker as a slow, clean oscillation that
  /// can fall anywhere in the pulse band, and one spectrum cannot tell it from a pulse.
  private func isFlickerAlias(_ hz: Double, frameRate: Double?) -> Bool {
    guard let frameRate, frameRate > 0 else { return false }
    return configuration.flickerFrequenciesHz.contains { flicker in
      let remainder = flicker.truncatingRemainder(dividingBy: frameRate)
      let alias = min(remainder, frameRate - remainder)
      return abs(hz - alias) <= configuration.flickerAliasMarginBpm / 60
    }
  }

  func spectrum(of waveform: [Double], rate: Double) -> PowerSpectrum {
    let windowed = vDSP.multiply(waveform, DSP.hann(waveform.count))
    let size = max(PulseAnalyzer.spectrumSize, DSP.powerOfTwo(atLeast: waveform.count))
    return PowerSpectrum(fourier.forward(windowed, size: size, rate: rate))
  }
}
