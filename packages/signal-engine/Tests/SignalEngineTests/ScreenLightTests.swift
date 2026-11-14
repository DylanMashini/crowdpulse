import Foundation
import Testing

@testable import SignalEngine

/// QA round 3, R1: a screen facing the patient. Its light on the face switches between two
/// levels a few per cent apart, at a rate inside the heart-rate band, and it is coloured: red
/// moves further than green and blue a little the other way. Where that flicker is about
/// the size of the sensor's noise it came out as a confident heart rate at the screen's own
/// rate: too small to cancel in the projection, too coloured for the brightness checks.

/// `frames` lit by a screen that switches every `every` seconds between two levels `depth`
/// apart. Red moves `colour` times further than green, blue 0.3 of that the other way.
private func screenLit(_ frames: [FrameRecord], every: Double, depth: Double, colour: Double, origin: Double = 1000)
  -> [FrameRecord]
{
  recolour(frames) { t, _, c in
    let light = 1 + depth * (Int((t - origin) / every) % 2 == 0 ? -0.5 : 0.5)
    c = RegionColor(
      r: c.r * light * (1 + colour * (light - 1)), g: c.g * light, b: c.b * light * (1 - 0.3 * colour * (light - 1)))
  }
}

/// Skin with no pulse: sensor noise and slow drift only.
private func skin(seed: UInt64) -> [FrameRecord] {
  sitting {
    $0.subject = .noise
    $0.noise = 0.5
    $0.seed = seed
  }.frames()
}

@Suite struct AScreenFacingThePatient {
  /// Switch intervals of 0.4 to 0.6 s: 75, 67, 60 and 50 times a minute there and back.
  static let intervals = [0.4, 0.45, 0.5, 0.6]

  @Test func itsFlickerIsNotAHeartRate() {
    var withoutTheCheck = 0
    for every in Self.intervals {
      for (depth, colour) in [(0.005, 1.5), (0.01, 1.0), (0.01, 1.5), (0.02, 1.0)] {
        for seed in [UInt64(3), 4] {
          let frames = screenLit(skin(seed: seed), every: every, depth: depth, colour: colour)
          let result = replay(frames)
          let label = "every \(every) s, \(depth) deep, colour \(colour), seed \(seed)"
          #expect(result.summary.heartRate.value == nil, "\(label)")
          #expect(result.heartRates.count <= 2, "\(label)")
          if replay(frames, { $0.minimumColourPhase = -1 }).summary.heartRate.value != nil { withoutTheCheck += 1 }
        }
      }
    }
    // The control bites: without the check half of these and more end with the screen's rate.
    #expect(withoutTheCheck >= 16)
  }

  @Test func theTwoColourSignalsMoveAgainstEachOtherUnderIt() {
    let result = SittingReplay.run(screenLit(skin(seed: 3), every: 0.5, depth: 0.01, colour: 1), diagnostics: true)
    let phases = result.diagnostics.compactMap(\.colourPhase)
    #expect(phases.count >= 30)
    #expect(phases.filter { $0 < 0 }.count >= phases.count * 9 / 10)
    #expect(result.diagnostics.contains { $0.gate == .illumination })
  }

  @Test func bloodMovesThemTogether() {
    // A still person, at several rates and at a third of the usual size: the check costs nothing.
    for bpm in [50.0, 72, 103, 131] {
      for amplitude in [0.35, 0.12] {
        let person = sitting { $0.heartRateBpm = bpm; $0.pulseAmplitude = amplitude }
        let result = SittingReplay.run(person.frames(), diagnostics: true)
        let off = replay(person) { $0.minimumColourPhase = -1 }
        #expect(result.heartRates.count == off.heartRates.count, "\(bpm) bpm at \(amplitude)")
        let valid = result.diagnostics.filter { $0.state == .valid }.compactMap(\.colourPhase).sorted()
        #expect(!valid.isEmpty && valid[valid.count / 2] > 0.5, "\(bpm) bpm at \(amplitude)")
      }
    }
  }

  @Test func aPersonInFrontOfItIsNeverGivenItsRate() {
    // A real 72 bpm pulse under a screen at 60 and at 50 a minute: the right rate or none.
    for every in [0.5, 0.6] {
      for depth in [0.01, 0.03] {
        let frames = screenLit(sitting().frames(), every: every, depth: depth, colour: 1)
        let result = replay(frames)
        let label = "every \(every) s, \(depth) deep"
        #expect(result.heartRates.allSatisfy { abs($0.bpm - 72) <= 3 }, "\(label)")
        if let rate = result.summary.heartRate.value { #expect(abs(rate - 72) <= 3, "\(label)") }
      }
    }
  }
}
