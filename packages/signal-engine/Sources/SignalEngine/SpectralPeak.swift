import Foundation

/// One-sided power spectrum of a windowed, band-passed signal.
struct PowerSpectrum {
  /// Power in bins 0 to size / 2.
  var power: [Double]
  var binHz: Double

  init(_ spectrum: Fourier.Spectrum) {
    let half = spectrum.real.count / 2
    power = (0...half).map { spectrum.real[$0] * spectrum.real[$0] + spectrum.imaginary[$0] * spectrum.imaginary[$0] }
    binHz = spectrum.binHz
  }

  /// Share of the signal's power (everything but the constant term) that lies within
  /// `halfWidthHz` of `frequency`. This is the quality score: it is always evaluated at the
  /// frequency that is going to be reported.
  func quality(at frequency: Double, halfWidthHz: Double) -> Double {
    let total = power.dropFirst().reduce(0, +)
    guard total > 0 else { return 0 }
    let low = max(1, Int(((frequency - halfWidthHz) / binHz).rounded(.up)))
    let high = min(power.count - 1, Int(((frequency + halfWidthHz) / binHz).rounded(.down)))
    guard low <= high else { return 0 }
    return min(1, power[low...high].reduce(0, +) / total)
  }
}

struct PeakSearch {
  /// Frequencies a peak may be reported in.
  var rangeHz: ClosedRange<Double>
  /// A peak closer than this to either end of `rangeHz` is rejected.
  var edgeMarginHz: Double
  /// Two peaks whose powers are within this ratio count as tied.
  var tieRatio: Double
  /// Half-width of the interval the quality score integrates around the peak.
  var qualityHalfWidthHz: Double
}

enum PeakOutcome: Equatable {
  case peak(hz: Double, quality: Double)
  /// The strongest component sits at the edge of the search range, so the true peak is
  /// probably outside it.
  case bandEdge(quality: Double)
  /// No power in the search range.
  case flat
  /// The strongest peak is where lamp flicker would appear at this frame rate, so there is
  /// no candidate that can be trusted.
  case flicker
  /// The peak was cut by the band-pass out of a spectrum that keeps rising below it: drift,
  /// not a rhythm.
  case drift

  var quality: Double {
    switch self {
    case .peak(_, let quality), .bandEdge(let quality): return quality
    case .flat, .flicker, .drift: return 0
    }
  }
}

extension PowerSpectrum {
  /// The strongest peak in the search range. A harmonic relation never adds to a peak's
  /// score; it only decides between two peaks that are tied in power, where the lower one
  /// (the fundamental) wins.
  func strongestPeak(_ search: PeakSearch) -> PeakOutcome {
    let low = max(1, Int((search.rangeHz.lowerBound / binHz).rounded(.up)))
    let high = min(power.count - 2, Int((search.rangeHz.upperBound / binHz).rounded(.down)))
    guard low < high else { return .flat }
    var best = low
    for bin in low...high where power[bin] > power[best] { best = bin }
    guard power[best] > 0 else { return .flat }

    var chosen = best
    let tieFloor = power[best] * search.tieRatio
    for bin in low..<best
    where bin > low && power[bin] >= tieFloor && power[bin] > power[bin - 1] && power[bin] >= power[bin + 1] {
      if abs(2 * Double(bin) - Double(best)) * binHz <= search.qualityHalfWidthHz {
        chosen = bin
        break
      }
    }

    let frequency = interpolatedFrequency(around: chosen)
    let quality = quality(at: frequency, halfWidthHz: search.qualityHalfWidthHz)
    let atEdge =
      chosen == low || chosen == high
      || frequency < search.rangeHz.lowerBound + search.edgeMarginHz
      || frequency > search.rangeHz.upperBound - search.edgeMarginHz
    return atEdge ? .bandEdge(quality: quality) : .peak(hz: frequency, quality: quality)
  }

  /// Whether the spectrum has a peak of its own within `toleranceHz` of half of `frequency`.
  /// A heart has no component at half its rate, so a peak there means `frequency` is the
  /// second harmonic of a pulse whose fundamental is weaker than the harmonic, or was
  /// filtered away. The peak has to stand `noiseRatio` times above the median power in
  /// `band`, which is what noise alone rarely does, and hold at least `floor` times the
  /// power at `frequency`, which a side lobe of a clean peak never does.
  func hasSubharmonic(
    of frequency: Double, toleranceHz: Double, floor: Double, noiseRatio: Double, band: ClosedRange<Double>
  ) -> Bool {
    guard let harmonic = strongestBin(near: frequency, toleranceHz: toleranceHz),
      let fundamental = strongestBin(near: frequency / 2, toleranceHz: toleranceHz),
      fundamental > 0, fundamental < power.count - 1,
      power[fundamental] > power[fundamental - 1], power[fundamental] >= power[fundamental + 1]
    else { return false }
    let low = max(1, Int((band.lowerBound / binHz).rounded(.up)))
    let high = min(power.count - 1, Int((band.upperBound / binHz).rounded(.down)))
    guard low <= high, let noise = DSP.median(Array(power[low...high])) else { return false }
    return power[fundamental] >= floor * power[harmonic] && power[fundamental] >= noiseRatio * noise
  }

  /// Whether anything from `from` up to `clearanceHz` short of `frequency` is at least as
  /// strong as the strongest bin within `clearanceHz` of `frequency`.
  func hasStrongerComponent(below frequency: Double, from: Double, clearanceHz: Double) -> Bool {
    guard let peak = strongestBin(near: frequency, toleranceHz: clearanceHz) else { return false }
    let low = max(1, Int((from / binHz).rounded(.up)))
    let high = min(power.count - 1, Int(((frequency - clearanceHz) / binHz).rounded(.down)))
    guard low <= high, let slower = power[low...high].max() else { return false }
    return slower >= power[peak]
  }

  private func strongestBin(near frequency: Double, toleranceHz: Double) -> Int? {
    let low = max(1, Int(((frequency - toleranceHz) / binHz).rounded(.up)))
    let high = min(power.count - 1, Int(((frequency + toleranceHz) / binHz).rounded(.down)))
    guard low <= high else { return nil }
    return (low...high).max { power[$0] < power[$1] }
  }

  /// Parabola through the log power of the peak bin and its neighbours.
  private func interpolatedFrequency(around bin: Int) -> Double {
    let left = power[bin - 1]
    let centre = power[bin]
    let right = power[bin + 1]
    guard left > 0, right > 0 else { return Double(bin) * binHz }
    let a = log(left)
    let b = log(centre)
    let c = log(right)
    let curvature = a - 2 * b + c
    guard curvature < 0 else { return Double(bin) * binHz }
    let offset = min(0.5, max(-0.5, 0.5 * (a - c) / curvature))
    return (Double(bin) + offset) * binHz
  }
}
