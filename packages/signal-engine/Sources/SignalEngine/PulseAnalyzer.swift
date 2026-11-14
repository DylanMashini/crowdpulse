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

  struct Outcome {
    var peak: PeakOutcome
    /// Weight each region had in the combined signal; they sum to 1 when any region is usable.
    var weights: [Double]
  }

  /// POS (plane orthogonal to skin) projection with overlap-add. Each window is normalised
  /// by its own channel means, so brightness changes common to the three channels cancel.
  func project(_ region: RegionSeries, rate: Double) -> [Double] {
    let count = region.r.count
    let length = Int((PulseAnalyzer.projectionWindowSeconds * rate).rounded())
    var pulse = [Double](repeating: 0, count: count)
    guard count >= length, length > 1 else { return pulse }
    let scratch = UnsafeMutablePointer<Double>.allocate(capacity: 2 * length)
    defer { scratch.deallocate() }
    let s1 = scratch
    let s2 = scratch + length
    let n = vDSP_Length(length)

    region.r.withUnsafeBufferPointer { r in
      region.g.withUnsafeBufferPointer { g in
        region.b.withUnsafeBufferPointer { b in
          pulse.withUnsafeMutableBufferPointer { output in
            for start in 0...(count - length) {
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
  func analyse(_ regions: [RegionSeries], rate: Double, frameRate: Double?) -> Outcome {
    guard let count = regions.first?.r.count, count > 1 else { return Outcome(peak: .flat, weights: []) }
    let search = search(windowSeconds: Double(count) / rate)
    let band = configuration.heartRateBandHz
    let projected = regions.map { DSP.detrend(project($0, rate: rate)) }
    let waveforms = projected.map {
      fourier.bandPass($0, rate: rate, band: band, transitionHz: PulseAnalyzer.transitionHz)
    }
    let weights = regionWeights(waveforms, rate: rate, search: search)
    let scales = scales(waveforms, weights: weights)
    let combined = mix(waveforms, scales: scales)
    guard DSP.rootMeanSquare(combined) > 0 else { return Outcome(peak: .flat, weights: weights) }
    let narrow = spectrum(of: combined, rate: rate)
    let peak = narrow.strongestPeak(search)
    guard case .peak(let hz, _) = peak else { return Outcome(peak: peak, weights: weights) }

    if isFlickerAlias(hz, frameRate: frameRate) {
      return Outcome(peak: .flicker, weights: weights)
    }

    // The same mix of regions with the band opened downwards far enough to see half of any
    // rate in the search range. It is only ever used to overrule a peak, never to report one.
    let open = (band.lowerBound / 2)...band.upperBound
    let wide = spectrum(
      of: fourier.bandPass(
        mix(projected, scales: scales), rate: rate, band: open, transitionHz: PulseAnalyzer.transitionHz),
      rate: rate)
    let found = wide.hasSubharmonic(
      of: hz, toleranceHz: search.qualityHalfWidthHz / 2, floor: configuration.subharmonicPowerFloor,
      noiseRatio: configuration.subharmonicNoiseRatio, band: open)
    guard found else { return Outcome(peak: peak, weights: weights) }

    // The peak is a second harmonic. The heart rate is half of it, scored like any other
    // candidate: by its own share of the pulse band, or rejected when it lies outside.
    let fundamental = hz / 2
    let quality = narrow.quality(at: fundamental, halfWidthHz: search.qualityHalfWidthHz)
    let inside = (search.rangeHz.lowerBound + search.edgeMarginHz)...(search.rangeHz.upperBound - search.edgeMarginHz)
    return Outcome(
      peak: inside.contains(fundamental) ? .peak(hz: fundamental, quality: quality) : .bandEdge(quality: quality),
      weights: weights)
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
