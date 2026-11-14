import Foundation
import Testing

@testable import SignalEngine

// The whole-sitting estimate: a heart rate for the sitting from all of it at once, for when
// too few one-second readings passed. It must find a faint, steady pulse, and it must find
// nothing where there is no pulse.

/// A pulse a quarter of the usual size: a one-second reading passes now and then at most.
private func faint(_ bpm: Double, _ change: (inout SyntheticSitting) -> Void = { _ in }) -> SyntheticSitting {
  sitting {
    $0.pulseAmplitude = 0.08
    $0.heartRateBpm = bpm
    $0.seed = 3
    change(&$0)
  }
}

@Suite struct WholeSittingFindsAFaintPulse {
  @Test(arguments: [58.0, 72, 96, 131])
  func theSittingEndsWithTheRightRate(bpm: Double) {
    let result = replay(faint(bpm))
    #expect(result.summary.heartRate.coverage < 0.15, "\(bpm) bpm")
    #expect(abs((result.summary.heartRate.value ?? 0) - bpm) <= 2, "\(bpm) bpm")
    let whole = try! #require(result.summary.wholeSitting)
    #expect(whole.accepted)
    #expect(abs((whole.heartRate ?? 0) - bpm) <= 2)
    #expect(result.summary.heartRateSource != nil)
  }

  @Test func itIsTheSourceWhenTheReadingsAreTooFew() {
    let result = replay(faint(131))
    #expect(result.heartRates.count < 3)
    #expect(result.summary.heartRateSource == .wholeSitting)
    #expect(result.summary.heartRate.reason == nil)
    // Coverage still says how little of the sitting gave a reading.
    #expect(result.summary.heartRate.coverage == Double(result.heartRates.count) / Double(result.readings.count))
  }

  @Test func itNeverFeedsAOneSecondReading() {
    let frames = faint(131).frames()
    let with = replay(frames)
    let without = replay(frames) { $0.wholeSittingWindows = .max }
    #expect(without.summary.heartRate.value == nil)
    #expect(with.readings == without.readings)
    #expect(with.summary.timeToFirstReadingSeconds == without.summary.timeToFirstReadingSeconds)
  }

  @Test func aGoodSittingKeepsTheMedianOfItsReadings() {
    let result = replay(sitting())
    #expect(result.summary.heartRateSource == .readings)
    let median = try! #require(DSP.median(result.heartRates.map(\.bpm)))
    #expect(result.summary.heartRate.value == median)
    #expect(result.summary.wholeSitting?.accepted == true)
    #expect(abs((result.summary.wholeSitting?.heartRate ?? 0) - 72) <= 1)
  }

  @Test func theFieldFailurePatternWithAFaintPulseStillEndsWithTheRightRate() {
    let result = replay(fieldFailurePattern { $0.pulseAmplitude = 0.1 })
    #expect(abs((result.summary.heartRate.value ?? 0) - 72) <= 2)
  }
}

@Suite struct WholeSittingRefusesWhatIsNotAPulse {
  @Test(arguments: [SyntheticSitting.Subject.noise, .wall])
  func whiteNoiseAndAWall(subject: SyntheticSitting.Subject) {
    for (index, noise) in [0.25, 0.5, 1, 2].enumerated() {
      for frameRate in [30.0, 60] {
        let result = replay(
          sitting {
            $0.subject = subject
            $0.noise = noise
            $0.frameRate = frameRate
            $0.seed = UInt64(100 + 10 * index) + UInt64(frameRate)
          })
        #expect(result.summary.heartRate.value == nil, "\(subject) noise \(noise) at \(frameRate) fps")
        #expect(result.summary.wholeSitting?.accepted != true)
      }
    }
  }

  /// Noise that wanders is the hard case: it piles up at the bottom of the pulse band in
  /// every window alike, and it gives the odd run of agreeing windows.
  @Test(arguments: [0.5, 0.9, 0.97, 0.99])
  func colourThatWanders(memory: Double) {
    var seed = UInt64(memory * 1000)
    for percent in [0.2, 0.6, 1.5] {
      for frameRate in [30.0, 60] {
        for steps in [false, true] {
          seed += 1
          let result = replay(
            colouredNoiseControl(seed: seed, frameRate: frameRate, memory: memory, percent: percent, steps: steps))
          let label = "memory \(memory) size \(percent)% at \(frameRate) fps, steps \(steps)"
          #expect(result.summary.heartRate.value == nil, "\(label)")
          #expect(result.summary.wholeSitting?.accepted != true, "\(label)")
        }
      }
    }
  }

  @Test func aSlowPeakIsLeftToTheReadings() {
    // Under `wholeSittingMinimumBpm` the estimate says nothing, right or not: that is
    // where drift gathers.
    let result = replay(faint(48))
    #expect(result.summary.wholeSitting?.accepted == false)
    #expect((result.summary.heartRate.value.map { abs($0 - 48) <= 2 }) ?? true)
    // A slow heart with a pulse of the usual size still gets its readings.
    let strong = replay(sitting { $0.heartRateBpm = 48 })
    #expect(abs((strong.summary.heartRate.value ?? 0) - 48) <= 1)
    #expect(strong.summary.heartRateSource == .readings)
  }

  /// A second harmonic as strong as the fundamental is not taken for the heart rate.
  /// One that is stronger than the fundamental, on a pulse this faint, is: the fundamental
  /// is then under the noise and nothing in the signal says the peak is a harmonic. The
  /// one-second readings have always had that limit (engine-reliability-results.md).
  @Test(arguments: [45.0, 50, 55, 60, 66])
  func theSecondHarmonicOfASlowHeartIsNotReported(bpm: Double) {
    for harmonic in [0.5, 1.0] {
      let result = replay(faint(bpm) { $0.pulseHarmonic = harmonic })
      if let value = result.summary.heartRate.value {
        #expect(abs(value - bpm) <= 2, "\(bpm) bpm, harmonic \(harmonic): \(value)")
      }
    }
  }

  @Test func tooFewWindowsAreNotASitting() {
    let result = replay(faint(96) { $0.durationSeconds = 20 })
    #expect(result.summary.wholeSitting?.accepted != true)
    #expect(result.summary.heartRate.value == nil)
  }
}

@Suite struct AHandfulOfReadingsNeedsTheSittingToAgree {
  /// A person for fourteen seconds, then the same skin with no pulse: a few readings at
  /// the start and forty-six seconds of nothing.
  private var briefPulse: [FrameRecord] {
    let person = sitting().frames()
    let empty = sitting { $0.subject = .noise }.frames()
    return zip(person, empty).map { $0.t - 1000 < 14 ? $0 : $1 }
  }

  @Test func theyDoNotStandForTheSittingOnTheirOwn() {
    let result = replay(briefPulse)
    #expect((3..<10).contains(result.heartRates.count))
    #expect(result.summary.heartRate.value == nil)
    #expect(result.summary.heartRate.reason == SummaryReason.tooFewReadings.rawValue)
    #expect(result.summary.heartRateSource == nil)
    // The readings themselves were shown as they came.
    #expect(result.heartRates.allSatisfy { abs($0.bpm - 72) <= 2 })
  }

  @Test func theLimitIsAParameter() {
    let result = replay(briefPulse) { $0.minimumUncorroboratedReadings = 0 }
    #expect(abs((result.summary.heartRate.value ?? 0) - 72) <= 2)
    #expect(result.summary.heartRateSource == .readings)
  }

  @Test func theyDoWhenTheSittingAgrees() {
    // Faint all the way through: few readings, and the whole sitting holds the same rate.
    let result = replay(faint(96))
    let readings = result.heartRates.count
    #expect((3..<10).contains(readings))
    #expect(result.summary.heartRateSource == .readings)
    #expect(abs((result.summary.heartRate.value ?? 0) - 96) <= 2)
  }
}

@Suite struct WholeSittingOnTheWire {
  @Test func theSummaryCarriesTheEstimateAndOldSummariesStillDecode() throws {
    let summary = replay(faint(131)).summary
    let data = try JSONEncoder().encode(summary)
    let object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    #expect(object["heartRateSource"] as? String == "whole_sitting")
    #expect((object["wholeSitting"] as? [String: Any])?["accepted"] as? Bool == true)
    #expect(try JSONDecoder().decode(SittingSummary.self, from: data) == summary)

    // A summary written before these fields existed.
    var old = object
    old["heartRateSource"] = nil
    old["wholeSitting"] = nil
    let decoded = try JSONDecoder().decode(SittingSummary.self, from: JSONSerialization.data(withJSONObject: old))
    #expect(decoded.heartRateSource == nil)
    #expect(decoded.wholeSitting == nil)
    #expect(decoded.heartRate == summary.heartRate)
  }
}
