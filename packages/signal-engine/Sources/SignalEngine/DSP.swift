import Accelerate
import Foundation

/// Building blocks shared by the pulse, breathing and beat analysis.
enum DSP {
  /// Linear interpolation of irregularly timed samples onto a uniform grid.
  /// `times[range]` must be increasing and hold at least two samples.
  static func resample(
    times: [Double], values: [Double], range: Range<Int>,
    start: Double, rate: Double, count: Int
  ) -> [Double] {
    var output = [Double](repeating: 0, count: count)
    var index = range.lowerBound
    let lastSegment = range.upperBound - 2
    for k in 0..<count {
      let time = start + Double(k) / rate
      while index < lastSegment, times[index + 1] <= time { index += 1 }
      let t0 = times[index]
      let t1 = times[index + 1]
      let weight = min(1, max(0, (time - t0) / (t1 - t0)))
      output[k] = values[index] + weight * (values[index + 1] - values[index])
    }
    return output
  }

  /// Removes the least-squares straight line.
  static func detrend(_ signal: [Double]) -> [Double] {
    let count = signal.count
    guard count > 1 else { return signal.map { _ in 0 } }
    let centre = Double(count - 1) / 2
    let mean = vDSP.mean(signal)
    var covariance = 0.0
    var variance = 0.0
    for (index, value) in signal.enumerated() {
      let x = Double(index) - centre
      covariance += x * (value - mean)
      variance += x * x
    }
    let slope = covariance / variance
    var output = signal
    for index in 0..<count {
      output[index] -= mean + slope * (Double(index) - centre)
    }
    return output
  }

  static func hann(_ count: Int) -> [Double] {
    vDSP.window(ofType: Double.self, usingSequence: .hanningDenormalized, count: count, isHalfWindow: false)
  }

  static func median(_ values: [Double]) -> Double? {
    guard !values.isEmpty else { return nil }
    let sorted = values.sorted()
    let middle = sorted.count / 2
    return sorted.count % 2 == 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  }

  static func rootMeanSquare(_ signal: [Double]) -> Double {
    signal.isEmpty ? 0 : vDSP.rootMeanSquare(signal)
  }

  static func powerOfTwo(atLeast count: Int) -> Int {
    var size = 8
    while size < count { size *= 2 }
    return size
  }

  /// Catmull-Rom cubic interpolation from `rate` to `targetRate`. The output starts at the
  /// first input sample and ends at the last.
  static func cubicUpsample(_ signal: [Double], rate: Double, targetRate: Double) -> [Double] {
    let count = signal.count
    guard count > 1 else { return signal }
    let step = rate / targetRate
    let outputCount = Int((Double(count - 1) / step).rounded(.down)) + 1
    var output = [Double](repeating: 0, count: outputCount)
    for k in 0..<outputCount {
      let position = Double(k) * step
      let i1 = min(Int(position), count - 2)
      let u = position - Double(i1)
      let p0 = signal[max(i1 - 1, 0)]
      let p1 = signal[i1]
      let p2 = signal[i1 + 1]
      let p3 = signal[min(i1 + 2, count - 1)]
      let a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3
      let b = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3
      let c = -0.5 * p0 + 0.5 * p2
      output[k] = ((a * u + b) * u + c) * u + p1
    }
    return output
  }
}

/// Complex discrete Fourier transforms of power-of-two sizes, with the vDSP setups cached.
final class Fourier {
  private var forwardSetups: [Int: vDSP.DiscreteFourierTransform<Double>] = [:]
  private var inverseSetups: [Int: vDSP.DiscreteFourierTransform<Double>] = [:]

  struct Spectrum {
    var real: [Double]
    var imaginary: [Double]
    /// Hz between neighbouring bins.
    var binHz: Double
  }

  private func setup(_ size: Int, _ direction: vDSP.FourierTransformDirection) -> vDSP.DiscreteFourierTransform<Double> {
    let cached = direction == .forward ? forwardSetups[size] : inverseSetups[size]
    if let cached { return cached }
    guard
      let created = try? vDSP.DiscreteFourierTransform(
        count: size, direction: direction, transformType: .complexComplex, ofType: Double.self)
    else {
      preconditionFailure("vDSP has no transform of size \(size)")
    }
    if direction == .forward { forwardSetups[size] = created } else { inverseSetups[size] = created }
    return created
  }

  /// Transform of `signal` zero-padded to `size`, a power of two no smaller than the signal.
  func forward(_ signal: [Double], size: Int, rate: Double) -> Spectrum {
    var padded = signal
    padded.append(contentsOf: repeatElement(0, count: size - signal.count))
    let zeros = [Double](repeating: 0, count: size)
    let output = setup(size, .forward).transform(real: padded, imaginary: zeros)
    return Spectrum(real: output.real, imaginary: output.imaginary, binHz: rate / Double(size))
  }

  /// Real part of the inverse transform.
  func inverse(_ spectrum: Spectrum) -> [Double] {
    let size = spectrum.real.count
    let output = setup(size, .inverse).transform(real: spectrum.real, imaginary: spectrum.imaginary)
    return vDSP.divide(output.real, Double(size))
  }

  /// Zero-phase band-pass: unity gain inside `band`, raised-cosine roll-off over `transitionHz`
  /// outside each edge, nothing beyond. Flat inside the band so a peak near an edge is not
  /// pulled towards the middle.
  func bandPass(_ signal: [Double], rate: Double, band: ClosedRange<Double>, transitionHz: Double) -> [Double] {
    let size = DSP.powerOfTwo(atLeast: signal.count)
    var spectrum = forward(signal, size: size, rate: rate)
    for bin in 0..<size {
      let frequency = Double(min(bin, size - bin)) * spectrum.binHz
      let gain = Fourier.gain(at: frequency, band: band, transitionHz: transitionHz)
      spectrum.real[bin] *= gain
      spectrum.imaginary[bin] *= gain
    }
    return Array(inverse(spectrum).prefix(signal.count))
  }

  static func gain(at frequency: Double, band: ClosedRange<Double>, transitionHz: Double) -> Double {
    if band.contains(frequency) { return 1 }
    let distance = frequency < band.lowerBound ? band.lowerBound - frequency : frequency - band.upperBound
    guard distance < transitionHz else { return 0 }
    return 0.5 * (1 + cos(.pi * distance / transitionHz))
  }
}
