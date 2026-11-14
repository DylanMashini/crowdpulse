import Foundation
import Testing

@testable import SignalEngine

// Synthetic sittings prove the maths: that a known rate comes back out and that the guards
// fire. They say nothing about a real phone, face, light or room.

@Suite struct HeartRateAccuracy {
  @Test(arguments: [30.0, 60.0])
  func recoversRatesAcrossTheRange(frameRate: Double) {
    for bpm in stride(from: 45.0, through: 170.0, by: 5.0) {
      let result = replay(sitting { $0.heartRateBpm = bpm; $0.frameRate = frameRate; $0.seed = UInt64(bpm) })
      let worst = result.heartRates.map { abs($0.bpm - bpm) }.max() ?? .infinity
      #expect(worst <= 2, "\(bpm) bpm at \(frameRate) fps: worst error \(worst)")
      #expect(result.summary.heartRate.coverage >= 0.75, "\(bpm) bpm at \(frameRate) fps")
      #expect(abs((result.summary.heartRate.value ?? 0) - bpm) <= 1)
      #expect((result.summary.timeToFirstReadingSeconds ?? .infinity) <= 12)
    }
  }

  @Test func recoversTheRateFromIrregularTimestampsAndDroppedFrames() {
    let result = replay(sitting {
      $0.heartRateBpm = 88
      $0.timestampJitter = 0.2
      $0.droppedFrameProbability = 0.05
    })
    #expect(result.summary.droppedFrames > 100)
    #expect(result.heartRates.count >= 40)
    #expect(result.heartRates.allSatisfy { abs($0.bpm - 88) <= 2 })
  }

  @Test func followsAStepFromSeventyToOneHundredAndTen() {
    let result = replay(sitting {
      $0.heartRateBpm = 70
      $0.heartRateChange = .init(atSeconds: 25, toBpm: 110)
    })
    #expect(result.heartRates.contains { $0.elapsed < 25 && abs($0.bpm - 70) <= 2 })
    let firstAtNewRate = result.heartRates.first { $0.elapsed > 25 && abs($0.bpm - 110) <= 5 }
    #expect((firstAtNewRate?.elapsed ?? .infinity) <= 45)
    // Requirement 11: nothing holds the old value once the signal has moved.
    let late = result.heartRates.filter { $0.elapsed >= 45 }
    #expect(late.count >= 13)
    #expect(late.allSatisfy { abs($0.bpm - 110) <= 5 })
    // While the window holds both rates the engine shows the old rate, nothing, or the new
    // rate: never a blend of the two.
    #expect(result.heartRates.allSatisfy { abs($0.bpm - 70) <= 5 || abs($0.bpm - 110) <= 5 })
  }

  @Test func followsARampWithoutLagging() {
    let result = replay(sitting {
      $0.heartRateBpm = 110
      $0.heartRateChange = .init(atSeconds: 15, toBpm: 80, overSeconds: 30)
    })
    let settled = result.heartRates.filter { $0.elapsed >= 52 }
    #expect(settled.count >= 6)
    #expect(settled.allSatisfy { abs($0.bpm - 80) <= 5 })
  }
}

@Suite struct NegativeControls {
  /// Share of one-second windows, over several seeds, that showed a reading.
  private func readingShare(
    _ change: (inout SyntheticSitting) -> Void
  ) -> (heart: Double, breathing: Double) {
    var windows = 0
    var heart = 0
    var breathing = 0
    for seed in 1...8 {
      let result = replay(sitting { $0.seed = UInt64(seed); change(&$0) })
      windows += result.readings.count
      heart += result.heartRates.count
      breathing += result.breathingRates.count
    }
    return (Double(heart) / Double(windows), Double(breathing) / Double(windows))
  }

  @Test func aWallGivesNoReading() {
    let share = readingShare { $0.subject = .wall }
    #expect(share.heart < 0.05)
    #expect(share.breathing < 0.05)
  }

  @Test func pureNoiseGivesNoReading() {
    for noise in [0.25, 1, 4] {
      let share = readingShare { $0.subject = .noise; $0.noise = noise }
      #expect(share.heart < 0.05, "noise \(noise)")
      #expect(share.breathing < 0.05, "noise \(noise)")
    }
  }

  /// Mains flicker (100 or 120 Hz) sampled by the camera lands anywhere, including inside
  /// the pulse band: 120 Hz at 59.3 fps aliases to 1.4 Hz, which would read as 84 bpm.
  @Test(arguments: [
    (120.0, 59.3, 0.01), (120.0, 59.3, 0.05), (100.0, 49.4, 0.01), (100.0, 30.0, 0.03), (120.0, 29.6, 0.01),
  ])
  func mainsFlickerGivesNoReading(hz: Double, frameRate: Double, depth: Double) {
    let share = readingShare {
      $0.subject = .wall
      $0.frameRate = frameRate
      $0.flicker = .init(hz: hz, depth: depth)
    }
    #expect(share.heart < 0.05)
  }

  /// Flicker that is stronger in one channel than another survives the projection. At
  /// 59.3 fps a 120 Hz lamp shows as a clean 1.4 Hz tone, which nothing in one spectrum
  /// tells from an 84 bpm pulse, so a peak where the alias falls is never shown.
  @Test(arguments: [(120.0, 59.3), (120.0, 59.0), (100.0, 49.4), (60.0, 58.8)])
  func colouredFlickerAliasedIntoThePulseBandGivesNoReading(hz: Double, frameRate: Double) {
    var valid = 0
    var total = 0
    for seed in UInt64(1)...4 {
      let wall = sitting { $0.subject = .wall; $0.frameRate = frameRate; $0.seed = seed }
      let frames = recolour(wall.frames()) { t, _, colour in
        let swing = sin(2 * .pi * hz * t)
        colour.r *= 1 + 0.01 * swing
        colour.g *= 1 + 0.006 * swing
        colour.b *= 1 + 0.002 * swing
      }
      let result = replay(frames)
      valid += result.heartRates.count
      total += result.readings.count
    }
    #expect(Double(valid) < 0.05 * Double(total), "\(valid) of \(total)")
  }

  @Test func flickerDoesNotMoveARealReading() {
    let result = replay(sitting {
      $0.heartRateBpm = 64
      $0.frameRate = 59.3
      $0.flicker = .init(hz: 120, depth: 0.01)
    })
    #expect(result.heartRates.count >= 40)
    #expect(result.heartRates.allSatisfy { abs($0.bpm - 64) <= 2 })
  }
}

@Suite struct BreathingRate {
  @Test(arguments: [8.0, 16.0, 28.0])
  func recoversTheRate(perMinute: Double) {
    let result = replay(sitting { $0.breathingRatePerMin = perMinute })
    #expect(result.breathingRates.count >= 10)
    #expect(result.breathingRates.allSatisfy { abs($0.perMinute - perMinute) <= 2 })
    #expect(abs((result.summary.breathingRate.value ?? 0) - perMinute) <= 2)
  }

  @Test func saysWhyThereIsNoReadingYet() {
    let result = replay(sitting { $0.durationSeconds = 30 })
    #expect(result.breathingRates.isEmpty)
    let last = result.readings.last!.breathingRate
    #expect(last.state == .settling)
    #expect(last.reason == .warmingUp)
    #expect(result.summary.breathingRate.value == nil)
    #expect(result.summary.breathingRate.reason == EstimateReason.warmingUp.rawValue)
  }

  @Test func reportsAnUntrackedChest() {
    let frames = sitting().frames().map { frame -> FrameRecord in
      var frame = frame
      frame.chestMotion = nil
      return frame
    }
    let result = replay(frames)
    #expect(result.breathingRates.isEmpty)
    #expect(result.readings.allSatisfy { $0.breathingRate.reason == .noChest })
    #expect(result.summary.breathingRate.reason == EstimateReason.noChest.rawValue)
    // The pulse does not depend on the chest.
    #expect(result.heartRates.count >= 40)
  }

  @Test func bodyMovementWithholdsTheReading() {
    let result = replay(sitting {
      $0.durationSeconds = 75
      $0.motionBursts = [.init(start: 50, end: 54)]
    })
    #expect(result.breathingRates.contains { $0.elapsed < 50 })
    for reading in result.readings where reading.elapsed >= 54 {
      #expect(reading.breathingRate.reason == .motion)
    }
    #expect(result.breathingRates.allSatisfy { abs($0.perMinute - 16) <= 2 })
  }
}

@Suite struct Variability {
  /// Stated tolerance: with 25 ms of beat-to-beat deviation and almost no sensor noise,
  /// RMSSD and SDNN come back within 20% of the values of the generated beat train, and
  /// never above them. The beat band holds the pulse's fundamental and second harmonic,
  /// which smooths the fastest beat-to-beat changes; the loss is the same for every pulse
  /// shape (next test).
  @Test(arguments: [60.0, 30.0])
  func recoversKnownVariability(frameRate: Double) throws {
    let source = sitting {
      $0.beatIntervalDeviationMs = 25
      $0.noise = 0.01
      $0.frameRate = frameRate
    }
    let truth = zip(source.beatTimes(), source.beatTimes().dropFirst())
      .filter { $0.0 >= 4 && $0.1 <= 58 }
      .map { ($1 - $0) * 1000 }
    let trueRmssd = rmssd(truth)
    let summary = replay(source).summary

    let measured = try #require(summary.rmssd.value)
    #expect((0.8...1.0).contains(measured / trueRmssd), "RMSSD \(measured) against \(trueRmssd)")
    let sdnn = try #require(summary.sdnn.value)
    #expect((20...25).contains(sdnn), "SDNN \(sdnn)")
    #expect(summary.rmssd.coverage >= 0.8)
    #expect(summary.rmssd.reason == nil)
    #expect(summary.beatIntervals.count >= 55)
    #expect(summary.beatIntervals.allSatisfy { $0.tMs > 0 && $0.tMs < 60_000 && $0.ms > 333 && $0.ms < 1429 })
  }

  /// The same beat train under three pulse shapes, from a pure sinusoid to a strong second
  /// harmonic, gives the same RMSSD.
  @Test func doesNotDependOnThePulseShape() throws {
    let values = try [0.0, 0.2, 0.5].map { harmonic in
      try #require(
        replay(sitting {
          $0.beatIntervalDeviationMs = 25
          $0.noise = 0
          $0.pulseHarmonic = harmonic
        }).summary.rmssd.value)
    }
    let spread = (values.max()! - values.min()!) / values.min()!
    #expect(spread <= 0.08, "\(values)")
  }

  /// Sensor noise that makes forehead and cheeks disagree by more than the fixed allowance
  /// is accepted while it stays small beside the variability being measured.
  @Test func isReportedWhenTimingNoiseIsSmallBesideTheVariability() throws {
    let source = sitting { $0.beatIntervalDeviationMs = 30; $0.noise = 0.05 }
    let truth = zip(source.beatTimes(), source.beatTimes().dropFirst())
      .filter { $0.0 >= 4 && $0.1 <= 58 }
      .map { ($1 - $0) * 1000 }
    let measured = try #require(replay(source).summary.rmssd.value)
    #expect(abs(measured - rmssd(truth)) <= 0.2 * rmssd(truth), "RMSSD \(measured) against \(rmssd(truth))")

    // The fixed allowance alone turns the same sitting down.
    let strict = replay(source) { $0.maximumBeatNoiseShare = 0 }.summary
    #expect(strict.rmssd.reason == SummaryReason.lowQuality.rawValue)
  }

  @Test func aSteadyBeatHasLittleVariability() throws {
    let summary = replay(sitting { $0.noise = 0.01 }).summary
    #expect(try #require(summary.rmssd.value) < 5)
  }

  @Test func isWithheldWhenBeatsAreSparse() {
    let summary = replay(sitting {
      $0.beatIntervalDeviationMs = 25
      $0.noise = 0.01
      $0.faceLoss = .init(start: 15, end: 40)
    }).summary
    #expect(summary.rmssd.value == nil)
    #expect(summary.sdnn.value == nil)
    #expect(summary.rmssd.coverage < 0.6)
    #expect(summary.rmssd.reason == SummaryReason.lowBeatCoverage.rawValue)
  }

  /// Ordinary sensor noise leaves the heart rate intact but moves single beats by tens of
  /// milliseconds. Unchecked, the default sitting reports an RMSSD of 84 ms for a true 36.
  @Test func isWithheldWhenSkinRegionsDisagreeAboutBeatTimes() throws {
    let noisy = sitting { $0.beatIntervalDeviationMs = 25 }
    let summary = replay(noisy).summary
    #expect(abs((summary.heartRate.value ?? 0) - 72) <= 2)
    #expect(summary.rmssd.value == nil)
    #expect(summary.sdnn.value == nil)
    #expect(summary.rmssd.reason == SummaryReason.lowQuality.rawValue)

    let unchecked = replay(noisy) { $0.maximumBeatDisagreementMs = .infinity }.summary
    #expect(try #require(unchecked.rmssd.value) > 60)
  }

  @Test func disagreementComparesTheSameIntervalsInTwoBeatTrains() {
    let forehead = [1.00, 1.80, 2.60, 3.40, 4.20, 5.00]
    // The cheeks see every beat 30 ms later, one of them 20 ms later still, and miss the fifth.
    let cheeks = [1.03, 1.83, 2.65, 3.43, 5.03]
    let disagreements = BeatAnalyzer.intervalDisagreements(forehead, cheeks, within: 0.2)
    #expect(disagreements.count == 3)
    for (measured, expected) in zip(disagreements, [0.0, -20, 20]) {
      #expect(abs(measured - expected) < 1e-6)
    }
    #expect(BeatAnalyzer.intervalDisagreements(forehead, [], within: 0.2).isEmpty)
  }

  @Test func isWithheldWithoutAHeartRate() {
    let summary = replay(sitting { $0.subject = .wall }).summary
    #expect(summary.rmssd.value == nil)
    #expect(summary.rmssd.reason == SummaryReason.noHeartRate.rawValue)
    #expect(summary.beatIntervals.isEmpty)
  }

  @Test func rejectsIntervalsThatDifferSharplyFromTheirNeighbours() {
    // A missed beat (one double interval), an extra beat (two half intervals) and a pause
    // no heart produces, in an otherwise steady train.
    let lengths: [Double] = [800, 810, 795, 1600, 805, 790, 400, 410, 800, 815, 2500, 805, 800]
    let accepted = BeatAnalyzer.acceptance(of: lengths, configuration: .default)
    let regular = [true, true, true, false, true, true, false, false, true, true, false, true, true]
    // Each rejected interval takes the one before and the one after with it.
    #expect(accepted == regular.indices.map { regular[max(0, $0 - 1)...min(12, $0 + 1)].allSatisfy { $0 } })
    #expect(accepted == [true, true, false, false, false, false, false, false, false, false, false, false, true])

    var loose = EngineConfiguration()
    loose.beatIntervalTolerance = 2
    // With the median rule switched off, only the two intervals no heart rate in the
    // search range could produce (1600 and 2500 ms) are left out, with the ones beside them.
    #expect(
      BeatAnalyzer.acceptance(of: lengths, configuration: loose)
        == [true, true, false, false, false, true, true, true, true, false, false, false, true])
  }

  /// A premature beat and its compensatory pause every twelfth beat. Neither they nor the
  /// intervals beside them, which the filter bends, may count as variability.
  @Test func ectopicBeatsDoNotCountAsVariability() {
    var beats = [-0.5]
    var index = 0
    while let last = beats.last, last < 62 {
      index += 1
      let normal = 60.0 / 70 + 0.01 * sin(Double(index))
      beats.append(last + normal * (index % 12 == 0 ? 0.6 : index % 12 == 1 ? 1.4 : 1))
    }
    let scene = qaScene { $0.beatTimes = beats; $0.noise = 0.05; $0.pulseAmp = 0.6 }
    let summary = replay(scene.frames()).summary
    #expect(summary.beatIntervals.allSatisfy { abs($0.ms - 857) < 40 }, "\(summary.beatIntervals.map(\.ms))")
    if let value = summary.rmssd.value { #expect(value < 15) }
  }
}

@Suite struct ReferenceAgreement {
  @Test func reportsThePlanSectionNineNumbers() throws {
    let result = replay(sitting { $0.heartRateBpm = 80 })
    let lines = (1...59).map { #"{"t":\#($0),"heartRate":\#($0 % 2 == 0 ? 83 : 77)}"# }
    let reference = try ReferenceFile.decode(
      Data(lines.joined(separator: "\n").utf8), sittingStartedAt: "2026-11-14T03:00:00.000Z")
    let comparison = ReferenceComparison(replay: result, reference: reference)

    #expect(comparison.pairedReadings == result.heartRates.count)
    #expect(abs(try #require(comparison.meanAbsoluteErrorBpm) - 3) < 0.6)
    #expect(abs(try #require(comparison.biasBpm)) < 0.6)
    #expect(comparison.within5BpmShare == 1)
    #expect(comparison.coverage == result.summary.heartRate.coverage)
    #expect(comparison.timeToFirstReadingSeconds == 10)
    #expect(comparison.longestDropoutSeconds == 0)
    #expect(comparison.referenceMeanBpm.map { abs($0 - 80) < 0.1 } == true)
  }

  @Test func readsWallClockReferenceTimes() throws {
    let data = Data(
      """
      {"t":"2026-11-14T03:00:12.500Z","heartRate":71,"source":"chest_strap"}
      {"t":"2026-11-14T03:00:11Z","heartRate":70}
      {"t":"2026-11-14T03:00:13Z","heartRate":null}
      """.utf8)
    let reference = try ReferenceFile.decode(data, sittingStartedAt: "2026-11-14T03:00:00.000Z")
    #expect(reference == [.init(elapsed: 11, heartRate: 70), .init(elapsed: 12.5, heartRate: 71)])
    #expect(throws: ReferenceFile.ReadError.malformedLine(1)) {
      try ReferenceFile.decode(Data("nope".utf8), sittingStartedAt: "")
    }
  }

  @Test func dropoutAndFirstReadingComeFromTheSitting() {
    let result = replay(sitting { $0.faceLoss = .init(start: 30, end: 33) })
    let comparison = ReferenceComparison(replay: result, reference: [])
    #expect(comparison.pairedReadings == 0)
    #expect(comparison.meanAbsoluteErrorBpm == nil)
    // Three seconds without a face, then a fresh window and three agreeing ones.
    #expect((10...13).contains(comparison.longestDropoutSeconds))
    #expect(comparison.coverage < 0.7)
  }
}
