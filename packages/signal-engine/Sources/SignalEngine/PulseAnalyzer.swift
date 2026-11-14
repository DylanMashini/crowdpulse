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
    /// Power spectrum of the combined waveform from 0 Hz to the top of the pulse band,
    /// scaled to sum to 1, and the same for each region on its own (nil for a region with
    /// no signal). The whole-sitting estimate adds these up over the sitting. Nil when the
    /// window held no signal.
    var spectrum: [Double]?
    var regionSpectra: [[Double]?] = []
    var binHz = 0.0
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
    /// Size of the rhythm at the candidate in those newest seconds, as a share of its
    /// size over the whole window. Nil with `recentQuality`.
    var recentAmplitudeShare: Double?
    /// How many times stronger the regions' brightness is than their pulse signal at the
    /// candidate, in the same mix of regions (`maximumBrightnessRatio`). Nil when the
    /// check did not run.
    var brightnessRatio: Double?
    /// Size of the pulse signal's swing at the candidate, as a fraction of the regions'
    /// colour (`maximumPulseAmplitude`). Nil when the check did not run.
    var pulseAmplitude: Double?
  }

  /// Brightness of one region, treated as `project` treats its colour: in each sliding
  /// window the three channels are divided by their own means and averaged, the windows
  /// are overlap-added, and every stretch of usable samples stands on its own. What comes
  /// out is the part of the region's change that is common to the three channels, which is
  /// what the projection throws away: a head moving towards the light, a lamp dimming.
  func brightness(_ region: RegionSeries, rate: Double, usable: [Bool]? = nil) -> [Double] {
    let count = region.r.count
    let length = Int((PulseAnalyzer.projectionWindowSeconds * rate).rounded())
    var output = [Double](repeating: 0, count: count)
    guard count >= length, length > 1 else { return output }
    for run in runs(count: count, length: length, usable: usable) {
      var sumR = 0.0
      var sumG = 0.0
      var sumB = 0.0
      for index in run.lowerBound..<(run.lowerBound + length) {
        sumR += region.r[index]
        sumG += region.g[index]
        sumB += region.b[index]
      }
      for start in run.lowerBound...(run.upperBound - length) {
        if start > run.lowerBound {
          sumR += region.r[start + length - 1] - region.r[start - 1]
          sumG += region.g[start + length - 1] - region.g[start - 1]
          sumB += region.b[start + length - 1] - region.b[start - 1]
        }
        guard sumR > 0, sumG > 0, sumB > 0 else { continue }
        let scaleR = Double(length) / (3 * sumR)
        let scaleG = Double(length) / (3 * sumG)
        let scaleB = Double(length) / (3 * sumB)
        for index in start..<(start + length) {
          output[index] += region.r[index] * scaleR + region.g[index] * scaleG + region.b[index] * scaleB - 1
        }
      }
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
    return output
  }

  /// The stretches of usable samples long enough to hold one projection window.
  private func runs(count: Int, length: Int, usable: [Bool]?) -> [Range<Int>] {
    guard let usable else { return [0..<count] }
    var runs: [Range<Int>] = []
    var runStart: Int?
    for index in 0...count {
      let open = index < count && usable[index]
      if open, runStart == nil { runStart = index }
      if !open, let from = runStart {
        if index - from >= length { runs.append(from..<index) }
        runStart = nil
      }
    }
    return runs
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

    let runs = runs(count: count, length: length, usable: usable)

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
    analyse(regions, rate: rate, frameRate: frameRate, masks: [[Bool]?](repeating: usable, count: regions.count))
  }

  /// A region with the level of each channel carried across its cuts: from each cut on,
  /// the channel is scaled so that its mean over the `levelSeconds` after the cut equals its
  /// mean over the `levelSeconds` before, and the cut is filled with a straight line. The
  /// pulse rides on the level as a fraction of it, so scaling does not change it; what goes
  /// is the step, which the projection's sliding normalisation would otherwise smear over
  /// every window that straddles it.
  func levelled(_ region: RegionSeries, usable: [Bool]?, rate: Double) -> RegionSeries {
    guard let usable, usable.contains(false), usable.contains(true) else { return region }
    let count = usable.count
    let span = max(2, Int((configuration.levelSeconds * rate).rounded()))
    var channels = [region.r, region.g, region.b]
    var index = 0
    var previousEnd: Int?  // one past the last usable sample before the cut being handled
    while index < count {
      guard !usable[index] else {
        index += 1
        previousEnd = index
        continue
      }
      let cutStart = index
      while index < count, !usable[index] { index += 1 }
      let cutEnd = index  // first usable sample after the cut, or count
      guard let before = previousEnd, cutStart == before else {
        // The window starts inside a cut: hold the first usable value back over it.
        if cutEnd < count {
          for channel in 0..<3 {
            for sample in cutStart..<cutEnd { channels[channel][sample] = channels[channel][cutEnd] }
          }
        }
        continue
      }
      guard cutEnd < count else {
        // The window ends inside a cut: hold the last usable value.
        for channel in 0..<3 {
          for sample in cutStart..<count { channels[channel][sample] = channels[channel][before - 1] }
        }
        break
      }
      // Usable samples on each side, no further than `span` and not into the next cut.
      var from = before
      while from > 0, before - from < span, usable[from - 1] { from -= 1 }
      var to = cutEnd
      while to < count, to - cutEnd < span, usable[to] { to += 1 }
      for channel in 0..<3 {
        let levelBefore = vDSP.mean(channels[channel][from..<before])
        let levelAfter = vDSP.mean(channels[channel][cutEnd..<to])
        if levelBefore > 0, levelAfter > 0 {
          let gain = levelBefore / levelAfter
          for sample in cutEnd..<count { channels[channel][sample] *= gain }
        }
        let start = channels[channel][before - 1]
        let end = channels[channel][cutEnd]
        let steps = Double(cutEnd - before + 1)
        for sample in cutStart..<cutEnd {
          channels[channel][sample] = start + (end - start) * Double(sample - before + 1) / steps
        }
      }
    }
    return RegionSeries(r: channels[0], g: channels[1], b: channels[2])
  }

  /// As above, with each region's own usable samples (`masks[i]` belongs to `regions[i]`).
  func analyse(_ regions: [RegionSeries], rate: Double, frameRate: Double?, masks: [[Bool]?]) -> Outcome {
    guard configuration.levelsAcrossCuts, masks.contains(where: { $0 != nil }) else {
      return analyse(regions, rate: rate, frameRate: frameRate, masks: masks, runs: masks)
    }
    // Levelled regions are projected in one piece; the cuts are still blanked afterwards.
    let levelled = regions.indices.map { levelled(regions[$0], usable: masks[$0], rate: rate) }
    return analyse(
      levelled, rate: rate, frameRate: frameRate, masks: masks, runs: [[Bool]?](repeating: nil, count: masks.count))
  }

  /// `masks` blank the samples that were cut; `runs` are the stretches projected on their
  /// own (nil: the whole window in one piece).
  private func analyse(
    _ regions: [RegionSeries], rate: Double, frameRate: Double?, masks: [[Bool]?], runs: [[Bool]?]
  ) -> Outcome {
    guard let count = regions.first?.r.count, count > 1 else { return Outcome(peak: .flat, weights: []) }
    let search = search(windowSeconds: Double(count) / rate)
    let band = configuration.heartRateBandHz
    let kept = masks.map { $0.map { $0.map { $0 ? 1.0 : 0.0 } } }
    // What the band-pass rings into a cut is not signal.
    func cut(_ signal: [Double], _ region: Int) -> [Double] {
      kept[region].map { vDSP.multiply(signal, $0) } ?? signal
    }
    let projected = regions.indices.map { DSP.detrend(project(regions[$0], rate: rate, usable: runs[$0])) }
    let waveforms = projected.indices.map {
      cut(fourier.bandPass(projected[$0], rate: rate, band: band, transitionHz: PulseAnalyzer.transitionHz), $0)
    }
    let weights = regionWeights(waveforms, rate: rate, search: search)
    let scales = scales(waveforms, weights: weights)
    let combined = mix(waveforms, scales: scales)
    guard DSP.rootMeanSquare(combined) > 0 else { return Outcome(peak: .flat, weights: weights) }
    let narrow = spectrum(of: combined, rate: rate)
    guard let strongest = narrow.strongestCandidate(search) else { return Outcome(peak: .flat, weights: weights) }
    var detail = Detail(strongest: strongest, candidateHz: strongest.hz, candidateQuality: strongest.quality)
    let top = min(narrow.power.count - 1, Int(((band.upperBound + PulseAnalyzer.transitionHz) / narrow.binHz).rounded(.up)))
    func scaled(_ spectrum: PowerSpectrum) -> [Double]? {
      let total = spectrum.power[1...top].reduce(0, +)
      return total > 0 ? [0] + spectrum.power[1...top].map { $0 / total } : nil
    }
    let fused = scaled(narrow)
    let single = waveforms.map { waveform in
      DSP.rootMeanSquare(waveform) > 0 ? scaled(self.spectrum(of: waveform, rate: rate)) : nil
    }
    func finished(_ peak: PeakOutcome) -> Outcome {
      Outcome(
        peak: peak, weights: weights, detail: detail, spectrum: fused, regionSpectra: single,
        binHz: narrow.binHz)
    }
    guard !strongest.atEdge else { return finished(.bandEdge(quality: strongest.quality)) }
    let hz = strongest.hz
    let peak = PeakOutcome.peak(hz: hz, quality: strongest.quality)

    if isFlickerAlias(hz, frameRate: frameRate) {
      detail.flickerAlias = true
      return finished(.flicker)
    }

    // The same mix of regions with the band opened downwards far enough to see half of any
    // rate in the search range. It is only ever used to overrule a peak, never to report one.
    let open = (band.lowerBound / 2)...band.upperBound
    let wide = spectrum(
      of: mix(
        projected.indices.map {
          cut(fourier.bandPass(projected[$0], rate: rate, band: open, transitionHz: PulseAnalyzer.transitionHz), $0)
        }, scales: scales),
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
        return finished(.illumination)
      }
      // A sample counts as seen when the regions that carry half the weight could use it.
      var usable: [Bool]?
      if kept.contains(where: { $0 != nil }) {
        var share = [Double](repeating: 0, count: count)
        for (region, weight) in weights.enumerated() where weight > 0 {
          if let mask = kept[region] {
            for index in 0..<count { share[index] += weight * mask[index] }
          } else {
            for index in 0..<count { share[index] += weight }
          }
        }
        usable = share.map { $0 >= 0.5 }
      }
      detail.recentQuality = recentQuality(combined, usable: usable, at: reportedHz, rate: rate)
      detail.recentAmplitudeShare = recentAmplitudeShare(combined, at: reportedHz, rate: rate)

      // The same mix of regions, of their brightness instead of their pulse signal.
      let bright = mix(
        regions.indices.map {
          cut(
            fourier.bandPass(
              DSP.detrend(brightness(regions[$0], rate: rate, usable: runs[$0])), rate: rate, band: band,
              transitionHz: PulseAnalyzer.transitionHz), $0)
        }, scales: scales)
      let window = DSP.hann(count)
      func size(_ signal: [Double]) -> Double {
        let part = DSP.component(of: vDSP.multiply(signal, window), at: reportedHz, rate: rate)
        return (part.re * part.re + part.im * part.im).squareRoot()
      }
      let pulse = size(combined)
      if pulse > 0 {
        detail.brightnessRatio = size(bright) / pulse
        // `combined` is in units of the regions' own deviation; undo that for a fraction
        // of the colour. Twice the coefficient over the window's sum is a sine's amplitude.
        let scale = scales.reduce(0, +)
        if scale > 0 { detail.pulseAmplitude = 2 * pulse / (scale * window.reduce(0, +)) }
      }
    }
    return finished(reported)
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

  /// Size of the rhythm at `hz` in the newest `recentEvidenceSeconds` of the combined
  /// waveform, as a share of its size over the whole window. A pulse that is still there
  /// is about as strong at the end of the window as over all of it; once it has left the
  /// picture, what the newest seconds hold at its rate is noise, and much smaller.
  private func recentAmplitudeShare(_ combined: [Double], at hz: Double, rate: Double) -> Double? {
    let tail = Int((configuration.recentEvidenceSeconds * rate).rounded())
    guard tail > 1, 2 * combined.count >= 3 * tail else { return nil }
    func size(_ signal: [Double]) -> Double {
      let window = DSP.hann(signal.count)
      let part = DSP.component(of: vDSP.multiply(signal, window), at: hz, rate: rate)
      return (part.re * part.re + part.im * part.im).squareRoot() / window.reduce(0, +)
    }
    let whole = size(combined)
    return whole > 0 ? size(Array(combined.suffix(tail))) / whole : 0
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
