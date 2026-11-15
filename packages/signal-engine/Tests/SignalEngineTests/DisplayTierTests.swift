import Foundation
import Testing

@testable import SignalEngine

// The display tier (`EngineConfiguration`, "Live display"): readings that are shown during
// a sitting under looser checks than the record's. They must put a value on screen sooner
// and keep it there more of the time, and must change nothing the sitting records.

/// The sittings the tier is checked on: a still person, a faint pulse, the pattern that gave
/// no reading on a real phone, a head that rocks, a face that is lost and found, and two
/// with no pulse at all.
private let sittings: [(name: String, frames: [FrameRecord])] = [
  ("still person", sitting().frames()),
  ("faint pulse", sitting { $0.pulseAmplitude = 0.08; $0.seed = 7 }.frames()),
  ("slow at 30 fps", sitting { $0.heartRateBpm = 45; $0.frameRate = 30; $0.seed = 45 }.frames()),
  ("stepping light", fieldFailurePattern()),
  ("rocking head", swaying(sitting().frames(), hz: 1.2, brightness: 0.02, colour: 0.004, seed: 21, from: 20)),
  ("face lost", sitting { $0.faceLoss = .init(start: 30, end: 34) }.frames()),
  ("movement", sitting { $0.motionBursts = [.init(start: 20, end: 24)] }.frames()),
  ("noise", sitting { $0.subject = .noise; $0.seed = 3 }.frames()),
  ("wall", sitting { $0.subject = .wall; $0.seed = 3 }.frames()),
]

@Suite struct TheDisplayTierChangesNothingTheSittingRecords {
  @Test func theSummaryIsTheSameWithItOnOrOff() {
    for (name, frames) in sittings {
      let on = replay(frames)
      let off = replay(frames) { $0.showsProvisionalReadings = false }
      #expect(on.summary == off.summary, "\(name)")
    }
  }

  @Test func theRecordedReadingsAreTheSameWithItOnOrOff() {
    for (name, frames) in sittings {
      let on = replay(frames)
      let off = replay(frames) { $0.showsProvisionalReadings = false }
      #expect(on.heartRates.map(\.elapsed) == off.heartRates.map(\.elapsed), "\(name)")
      #expect(on.heartRates.map(\.bpm) == off.heartRates.map(\.bpm), "\(name)")
      #expect(on.breathingRates.map(\.elapsed) == off.breathingRates.map(\.elapsed), "\(name)")
      #expect(on.breathingRates.map(\.perMinute) == off.breathingRates.map(\.perMinute), "\(name)")
      #expect(off.shownHeartRates(provisional: true).isEmpty, "\(name)")
      #expect(off.shownBreathingRates(provisional: true).isEmpty, "\(name)")
      // A second that was not provisional reads the same either way. (Its age may not, nor
      // whether it is still called settling: both count what was shown.)
      for (shown, recorded) in zip(on.readings, off.readings) where !shown.heartRate.provisional {
        #expect(shown.heartRate.value == recorded.heartRate.value, "\(name) at \(shown.elapsed) s")
        #expect(shown.heartRate.reason == recorded.heartRate.reason, "\(name) at \(shown.elapsed) s")
        #expect(shown.heartRate.quality == recorded.heartRate.quality, "\(name) at \(shown.elapsed) s")
        #expect(shown.heartRate.coverage == recorded.heartRate.coverage, "\(name) at \(shown.elapsed) s")
      }
    }
  }

  @Test func coverageCountsRecordedReadingsOnly() {
    let result = replay(sitting { $0.pulseAmplitude = 0.08; $0.seed = 7 })
    let last = try! #require(result.readings.last)
    let recorded = result.readings.filter { $0.heartRate.state == .valid && !$0.heartRate.provisional }.count
    #expect(abs(last.heartRate.coverage - Double(recorded) / Double(result.readings.count)) < 1e-9)
    #expect(result.summary.heartRate.coverage == last.heartRate.coverage)
  }

  @Test func aProvisionalReadingIsAlwaysAValidOneWithAValue() {
    for (name, frames) in sittings {
      for reading in replay(frames).readings {
        for estimate in [reading.heartRate, reading.breathingRate] where estimate.provisional {
          #expect(estimate.state == .valid, "\(name)")
          #expect(estimate.value != nil, "\(name)")
          #expect(estimate.reason == nil, "\(name)")
          #expect(estimate.ageMs == 0, "\(name)")
        }
      }
    }
  }
}

@Suite struct TheDisplayTierShowsMore {
  @Test func aHeartRateIsOnScreenBeforeTheFirstRecordedOne() {
    let result = replay(sitting())
    let shown = try! #require(result.shownHeartRates().first)
    let recorded = try! #require(result.heartRates.first)
    #expect(shown.elapsed < recorded.elapsed)
    #expect(abs(shown.bpm - 72) <= 3)
  }

  @Test func aBreathingRateIsOnScreenLongBeforeTheRecordHasAWindowForIt() {
    let result = replay(sitting())
    let shown = try! #require(result.shownBreathingRates().first)
    let recorded = try! #require(result.breathingRates.first)
    #expect(shown.elapsed <= 26)
    #expect(recorded.elapsed >= 40)
    #expect(result.shownBreathingRates(provisional: true).allSatisfy { abs($0.perMinute - 16) <= 2 })
  }

  @Test func aSittingTooShortForARecordedBreathingRateStillShowsOne() {
    let result = replay(sitting { $0.durationSeconds = 30 })
    #expect(result.breathingRates.isEmpty)
    #expect(!result.shownBreathingRates().isEmpty)
    #expect(result.summary.breathingRate.value == nil)
    #expect(result.summary.breathingRate.reason == EstimateReason.warmingUp.rawValue)
  }

  @Test func whatIsShownOfAPersonIsTheirRate() {
    for bpm in [50.0, 72, 95, 128] {
      let result = replay(sitting { $0.heartRateBpm = bpm; $0.seed = UInt64(bpm) })
      #expect(result.shownHeartRates().allSatisfy { abs($0.bpm - bpm) <= 3 }, "\(bpm) bpm")
    }
  }

  @Test func aFaintPulseIsOnScreenForMoreOfTheSitting() {
    var shown = 0
    var recorded = 0
    for seed in 1...4 {
      let result = replay(sitting { $0.pulseAmplitude = 0.08; $0.seed = UInt64(seed) })
      shown += result.shownHeartRates().count
      recorded += result.heartRates.count
      #expect(result.shownHeartRates().count >= result.heartRates.count)
    }
    #expect(shown > recorded)
  }

  @Test func aReadingInterruptedByMovementComesBackSooner() {
    let frames = sitting { $0.motionBursts = [.init(start: 20, end: 24)] }.frames()
    #expect(replay(frames).shownHeartRates().count >= replay(frames).heartRates.count)
  }
}

@Suite struct TheDisplayTierStillRefusesWhatIsNotAPulse {
  /// What the tier costs: a sitting with no pulse in it now and then shows a rate for a
  /// few seconds, where the record shows none. Bounded here so that a looser setting
  /// cannot slip in unnoticed.
  @Test func noPulseShowsNextToNothing() {
    var shown = 0
    var sittingsWithAValue = 0
    for subject in [SyntheticSitting.Subject.noise, .wall] {
      for seed in 1...6 {
        let result = replay(sitting { $0.subject = subject; $0.seed = UInt64(seed) })
        #expect(result.heartRates.isEmpty, "\(subject) seed \(seed)")
        #expect(result.summary.heartRate.value == nil, "\(subject) seed \(seed)")
        shown += result.shownHeartRates().count
        sittingsWithAValue += result.shownHeartRates().isEmpty ? 0 : 1
      }
    }
    #expect(shown <= 12)
    #expect(sittingsWithAValue <= 4)
  }

  @Test func aChestWithNoBreathInItShowsNoBreathingRate() {
    for subject in [SyntheticSitting.Subject.noise, .wall] {
      for seed in 1...6 {
        let result = replay(sitting { $0.subject = subject; $0.seed = UInt64(seed) })
        #expect(result.shownBreathingRates().isEmpty, "\(subject) seed \(seed)")
      }
    }
  }

  @Test func movementNeverStartsAReading() {
    // A head that bobs with no pulse under it: nothing was shown before, so there is no
    // rate for the movement to carry on.
    for hz in [1.0, 1.4, 2.0] {
      let bobbing = swaying(
        sitting { $0.subject = .noise; $0.seed = 5 }.frames(), hz: hz, brightness: 0.03, colour: 0.006, seed: 9)
      #expect(replay(bobbing).shownHeartRates().count <= 3, "\(hz) Hz")
    }
  }

  @Test func anotherFaceStartsEmpty() {
    let first = sitting { $0.heartRateBpm = 70; $0.durationSeconds = 30 }
    let second = sitting {
      $0.heartRateBpm = 120
      $0.durationSeconds = 30
      $0.settleSeconds = 0
      $0.startTime = first.startTime + 30
      $0.faceTrackId = 2
      $0.seed = 2
    }
    let result = replay(first.frames() + second.frames())
    // Nothing of the first face's rate is shown for the second.
    #expect(result.shownHeartRates().filter { $0.elapsed > 30 }.allSatisfy { abs($0.bpm - 120) <= 3 })
    #expect(!result.shownHeartRates().contains { $0.elapsed > 30 && $0.elapsed < 35 })
  }
}

@Suite struct ProvisionalOnTheWire {
  @Test func aReadingWrittenBeforeTheFieldExistedStillDecodes() throws {
    let old = #"{"value":72,"state":"valid","quality":0.8,"coverage":0.5,"ageMs":0}"#
    let estimate = try JSONDecoder().decode(Estimate.self, from: Data(old.utf8))
    #expect(estimate.provisional == false)
    #expect(estimate.value == 72)
  }

  @Test func theComparisonKeepsRecordedAndShownApart() throws {
    let result = replay(sitting { $0.heartRateBpm = 80 })
    let lines = (1...59).map { #"{"t":\#($0),"heartRate":80}"# }
    let reference = try ReferenceFile.decode(
      Data(lines.joined(separator: "\n").utf8), sittingStartedAt: "2026-11-14T03:00:00.000Z")
    let comparison = ReferenceComparison(replay: result, reference: reference)
    let shown = try #require(comparison.shown)
    #expect(comparison.pairedReadings == result.heartRates.count)
    #expect(shown.pairedReadings == result.shownHeartRates().count)
    #expect(shown.provisionalPairedReadings == result.shownHeartRates(provisional: true).count)
    #expect(shown.provisionalPairedReadings > 0)
    #expect(shown.coverage > comparison.coverage)
    #expect(try #require(shown.timeToFirstReadingSeconds) < (try #require(comparison.timeToFirstReadingSeconds)))
  }
}

@Suite struct WhatTheDisplayTierCostsOnTheAdversarialScenes {
  /// The record drops a rate within three seconds of the pulse leaving the picture. The
  /// screen may carry it on for as long as a window still holds it and no longer.
  @Test func aPulseThatLeavesThePictureIsNotShownForLong() {
    var latest = 0.0
    var worst = 0.0
    for seed in [7, 8, 9, 10, 11, 12] as [UInt64] {
      let person = qaScene { $0.seed = seed }.frames()
      let empty = qaScene { $0.seed = seed; $0.pulseAmp = 0 }.frames()
      let frames = zip(person, empty).map { $0.t - 5000 < 30 ? $0 : $1 }
      let shown = QAStats(result: SittingReplay.run(frames)).shownHr
      latest = max(latest, shown.map(\.0).max() ?? 0)
      worst = max(worst, shown.map { abs($0.1 - 72) }.max() ?? 0)
    }
    print("DISPLAY: pulse gone at 30: last shown at \(latest) s, worst error \(worst) bpm")
    #expect(latest <= 40)
    #expect(worst <= 5)
  }

  /// The cost is at the faintest pulses, where the record shows next to nothing: measured
  /// over six sittings each, 2 of 7 seconds shown were more than 5 bpm off at an amplitude
  /// of 0.02 and 4 of 11 at 0.05, none of 61 at 0.1 and none of 243 at 0.15.
  @Test func aFaintPulseIsMostlyRightWhenItIsShown() {
    for amp in [0.02, 0.05, 0.1, 0.15] {
      var all: [(Double, Double)] = []
      var recorded = 0
      for seed in UInt64(1)...6 {
        let s = qa(qaScene { $0.pulseAmp = amp; $0.noise = 0.3; $0.seed = seed; $0.bpm = { _ in 78 } })
        all += s.shownHr
        recorded += s.hr.count
      }
      let wrong = all.filter { abs($0.1 - 78) > 5 }
      print("DISPLAY: faint amp \(amp): shown \(all.count) recorded \(recorded) wrong \(wrong.count)")
      #expect(wrong.count <= max(4, all.count / 20), "amplitude \(amp)")
    }
  }

  @Test func flickerOnAWallIsRarelyShown() {
    for (hz, fps) in [(120.0, 59.94), (120.0, 29.97), (100.0, 60.0), (100.0, 29.0)] {
      var shown = 0
      var seconds = 0
      for seed in UInt64(1)...4 {
        let s = qa(qaScene {
          $0.seed = seed
          $0.person = false
          $0.fps = fps
          $0.light = { t in
            let f = sin(2 * .pi * hz * t)
            return (1 + 0.01 * f, 1 + 0.006 * f, 1 + 0.002 * f)
          }
        })
        shown += s.shownHr.count
        seconds += s.result.readings.count
      }
      print("DISPLAY: coloured flicker \(hz) Hz at \(fps) fps: shown \(shown) of \(seconds) s")
      #expect(Double(shown) / Double(seconds) < 0.1, "\(hz) Hz at \(fps) fps")
    }
  }
}
