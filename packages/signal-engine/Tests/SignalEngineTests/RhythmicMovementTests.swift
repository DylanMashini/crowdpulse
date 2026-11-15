import Foundation
import Testing

@testable import SignalEngine

// A head that moves in a rhythm is not a pulse. The colour-jump detector does not see smooth
// movement, and a little of every movement leaks into the regions' colour, where the
// projection takes it for blood. What tells the two apart is brightness: blood barely moves
// it, a moving head moves it many times further than the colour. See QA round 1, finding 1
// (docs/research/engine-reliability-qa1.md) and engine-reliability-results.md.

/// Skin with no pulse, 30 frames a second, as in QA's control.
private func emptySkin(seed: UInt64) -> [FrameRecord] {
  sitting {
    $0.subject = .noise
    $0.frameRate = 30
    $0.seed = seed
    $0.illuminationDrift = 0
  }.frames()
}

@Suite struct RhythmicMovementIsNotAPulse {
  /// QA's control: 3% or 6% of brightness at 1.0, 1.3 or 1.8 Hz, with 0.2% or 0.6% of colour
  /// moving with it. 21 of 24 of these ended with the movement's rate as a heart rate.
  @Test(arguments: [1.0, 1.3, 1.8])
  func aBobbingHeadWithNoPulseGivesNoHeartRate(hz: Double) {
    for brightness in [0.03, 0.06] {
      for colour in [0.002, 0.006] {
        for copy in [0, 1] as [UInt64] {
          let seed = UInt64(hz * 1000 + brightness * 1e4 + colour * 1e5) + copy
          let result = SittingReplay.run(
            swaying(emptySkin(seed: seed), hz: hz, brightness: brightness, colour: colour, seed: seed + 50),
            diagnostics: true)
          let label = "\(hz) Hz, brightness \(brightness), colour \(colour), copy \(copy)"
          #expect(result.heartRates.isEmpty, "\(label)")
          #expect(result.summary.heartRate.value == nil, "\(label)")
          #expect(result.summary.wholeSitting?.corroborates != true, "\(label)")
          // The windows that held the movement's rate were refused for being movement.
          let held = result.diagnostics.filter { abs(($0.candidateBpm ?? 0) - hz * 60) <= 3 }
          #expect(held.contains { $0.gate == .rhythmicMovement && $0.reason == .motion }, "\(label)")
        }
      }
    }
  }

  @Test func theSameWithMoreOfItInTheColourIsLargerThanAPulse() {
    // 3% of colour is ten times what blood does: refused on size, whatever the brightness.
    for (index, hz) in [1.0, 1.3, 1.8].enumerated() {
      let seed = UInt64(900 + index)
      let result = replay(swaying(emptySkin(seed: seed), hz: hz, brightness: 0.03, colour: 0.03, seed: seed))
      #expect(result.heartRates.isEmpty, "\(hz) Hz")
      #expect(result.summary.heartRate.value == nil, "\(hz) Hz")
    }
  }

  @Test func aPersonWhoBobsNeverReadsTheMovement() {
    // 72 bpm, bobbing at 1.5 Hz (90 a minute). No reading is better than the wrong one.
    for seed in [11, 12, 13] as [UInt64] {
      let person = sitting { $0.frameRate = 30; $0.seed = seed }.frames()
      let result = replay(swaying(person, hz: 1.5, brightness: 0.04, colour: 0.004, seed: seed))
      #expect(result.heartRates.allSatisfy { abs($0.bpm - 72) <= 3 }, "seed \(seed)")
      if let value = result.summary.heartRate.value { #expect(abs(value - 72) <= 2, "seed \(seed)") }
    }
  }

  @Test func aStillPersonIsNowhereNearTheLimit() {
    let result = SittingReplay.run(sitting().frames(), diagnostics: true)
    let ratios = result.diagnostics.filter { $0.state == .valid }.compactMap(\.brightnessRatio)
    #expect(ratios.count >= 48)
    #expect(ratios.allSatisfy { $0 < 1.5 })
    let sizes = result.diagnostics.filter { $0.state == .valid }.compactMap(\.pulseAmplitude)
    #expect(sizes.allSatisfy { $0 < 0.005 })
    #expect(result.diagnostics.allSatisfy { $0.gate != .rhythmicMovement })
  }

  @Test func theFieldFailurePatternIsNotTakenForMovement() {
    // Brightness that steps is not brightness that swings at the pulse's rate.
    let result = SittingReplay.run(fieldFailurePattern(), diagnostics: true)
    #expect(result.diagnostics.allSatisfy { $0.gate != .rhythmicMovement })
  }
}

@Suite struct ARhythmInTheBrightnessAtTheHeartsOwnRate {
  /// A heart that rocks the head: brightness swings at the pulse's own rate, with no colour
  /// of its own. Real sittings do this (two of the UBFC tuning set).
  private func rocking(from: Double, until: Double = .infinity, seed: UInt64) -> [FrameRecord] {
    let person = sitting { $0.seed = seed; $0.illuminationDrift = 0 }
    return swaying(person.frames(), hz: 1.2, brightness: 0.015, colour: 0, seed: seed, from: from, until: until)
  }

  @Test func doesNotLoseAReadingAlreadyEstablished() {
    // Twelve seconds of it in the middle of a sitting.
    let result = SittingReplay.run(rocking(from: 20, until: 32, seed: 21), diagnostics: true)
    let during = result.heartRates.filter { $0.elapsed >= 22 && $0.elapsed < 42 }
    #expect(during.count >= 18)
    #expect(result.heartRates.allSatisfy { abs($0.bpm - 72) <= 2 })
    // Those windows were over the limit and were kept because a steady one vouched.
    #expect(result.diagnostics.contains { $0.state == .valid && ($0.brightnessRatio ?? 0) > 3 })
    #expect(abs((result.summary.heartRate.value ?? 0) - 72) <= 2)
    #expect(result.summary.heartRateConfidence == .normal)
  }

  @Test func doesNotEstablishOne() {
    let result = replay(rocking(from: 0, seed: 22))
    #expect(result.heartRates.isEmpty)
    #expect(result.heartRate(at: 30).reason == .motion)
  }

  @Test func theVouchingRunsOut() {
    // Rocking that never stops: the reading established before it is believed for
    // `steadyRateSeconds`, not for the rest of the sitting.
    let result = replay(rocking(from: 20, seed: 21), recordOnly)
    #expect(result.heartRates.contains { $0.elapsed >= 30 })
    #expect(result.heartRates.filter { $0.elapsed >= 46 }.isEmpty)
    #expect(result.heartRate(at: 50).reason == .motion)
  }
}
