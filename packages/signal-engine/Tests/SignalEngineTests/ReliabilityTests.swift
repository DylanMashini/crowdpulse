import Foundation
import Testing

@testable import SignalEngine

// A still, seated person must get a heart rate even when the light on the face is not
// steady and the chest is barely in the picture, and what is not a pulse must still be
// refused. See docs/research/engine-no-reading-diagnosis.md and engine-reliability-results.md.

@Suite struct FieldFailurePattern {
  @Test func coloursThatStepAndABarelyTrackedChestAreCutOutNotRefused() {
    let result = SittingReplay.run(fieldFailurePattern(), diagnostics: true)
    // The check this replaced refused 49 of the 60 seconds of the real sitting as motion.
    // Three steps within five seconds still leave too little of a window to read.
    #expect(result.diagnostics.filter { $0.gate == .motion }.count <= 6)
    #expect(result.diagnostics.allSatisfy { ($0.chestMotionShare ?? 0) == 0 })
    // The steps that change the balance of the colours are cut out, and only those frames.
    let cut = result.diagnostics.compactMap(\.motionShare)
    #expect(cut.contains { $0 > 0 })
    #expect(DSP.median(cut)! <= 0.2)
  }

  @Test func theSittingGetsAHeartRateAndItIsTheRightOne() {
    let result = replay(fieldFailurePattern())
    #expect(abs((result.summary.heartRate.value ?? 0) - 72) <= 2)
    #expect(result.heartRates.count >= 20)
    #expect(result.heartRates.allSatisfy { abs($0.bpm - 72) <= 3 })
  }

  @Test(arguments: [50.0, 64, 88, 103, 131])
  func theRateComesBackAcrossTheRange(bpm: Double) {
    let result = replay(fieldFailurePattern { $0.heartRateBpm = bpm; $0.seed = UInt64(bpm) })
    #expect(abs((result.summary.heartRate.value ?? 0) - bpm) <= 2, "\(bpm) bpm")
    #expect(result.heartRates.allSatisfy { abs($0.bpm - bpm) <= 3 }, "\(bpm) bpm")
  }

  @Test func theSamePatternWithNoPulseGivesNothing() {
    for subject in [SyntheticSitting.Subject.noise, .wall] {
      let result = replay(fieldFailurePattern { $0.subject = subject })
      #expect(result.heartRates.isEmpty, "\(subject)")
      #expect(result.summary.heartRate.value == nil, "\(subject)")
    }
  }
}

@Suite struct ChestSpeedCountsOnlyWhenTheChestIsTracked {
  /// A chest that moves fast between seconds 20 and 22, in a region that has a value in
  /// `trackedShare` of the frames.
  private func fastChest(trackedShare: Double) -> [FrameRecord] {
    var index = 0
    return sitting().frames().map { frame in
      var frame = frame
      let elapsed = frame.t - 1000
      if elapsed >= 20, elapsed < 22 { frame.chestMotion = (index % 2 == 0 ? 1 : -1) * 0.004 }
      if Double(index % 20) >= 20 * trackedShare { frame.chestMotion = nil }
      index += 1
      return frame
    }
  }

  @Test func aFastChestInATrackedRegionIsCutOut() {
    let result = SittingReplay.run(fastChest(trackedShare: 1), diagnostics: true)
    #expect((result.diagnostics[24].chestMotionShare ?? 0) > 0.1)
    #expect(result.heartRates.allSatisfy { abs($0.bpm - 72) <= 2 })
  }

  @Test func theSameValuesFromARegionFoundHalfTheTimeAreIgnored() {
    let result = SittingReplay.run(fastChest(trackedShare: 0.5), diagnostics: true)
    #expect(result.diagnostics.allSatisfy { ($0.chestMotionShare ?? 0) == 0 })
    #expect(result.diagnostics.allSatisfy { ($0.motionShare ?? 0) == 0 })
    #expect(result.heartRates.count >= 48)
  }
}

@Suite struct ColourJumps {
  private func changes(_ frames: [FrameRecord]) -> [Double] {
    var detector = ColourChangeDetector(seconds: 0.25)
    return frames.filter(\.facePresent).map { detector.push(time: $0.t, frame: $0) }
  }

  private let limit = EngineConfiguration.default.colourJumpDeviation

  @Test func aStillPersonChangesColourByLessThanTheLimit() {
    #expect((changes(sitting().frames()).max() ?? 1) < limit / 2)
  }

  @Test func brightnessCommonToTheChannelsIsNotAColourChange() {
    let still = sitting()
    let stepped = recolour(still.frames()) { t, _, colour in
      guard t - still.startTime >= 20 else { return }
      colour = RegionColor(r: colour.r * 1.15, g: colour.g * 1.15, b: colour.b * 1.15)
    }
    #expect((changes(stepped).max() ?? 1) < limit / 2)
  }

  @Test func aChangeInTheBalanceOfTheColoursIs() {
    let still = sitting()
    let stepped = recolour(still.frames()) { t, _, colour in
      guard t - still.startTime >= 20 else { return }
      colour.r *= 1.05
    }
    let measured = changes(stepped)
    #expect((measured.max() ?? 0) > limit)
    // It is over within half a second of the step.
    let times = stepped.filter(\.facePresent).map { $0.t - still.startTime }
    let flagged = zip(times, measured).filter { $0.1 > limit }.map(\.0)
    #expect((flagged.min() ?? 0) >= 20 && (flagged.max() ?? 99) <= 20.5)
  }

  @Test func aRegionWithoutAColourIsLeftOutNotCounted() {
    var index = 0
    let frames = sitting().frames().map { frame -> FrameRecord in
      var frame = frame
      if index % 7 == 0 { frame.rightCheek = nil }
      index += 1
      return frame
    }
    #expect((changes(frames).max() ?? 1) < limit / 2)
  }
}
