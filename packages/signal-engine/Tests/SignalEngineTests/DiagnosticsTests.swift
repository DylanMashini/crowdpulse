import Foundation
import Testing

@testable import SignalEngine

// `PulseDiagnostic` says which check refused each one-second heart-rate reading and what the
// window would have reported unrefused. It must describe the engine without changing it.

private func diagnosed(
  _ frames: [FrameRecord], _ change: (inout EngineConfiguration) -> Void = { _ in }
) -> SittingReplay.Result {
  var configuration = EngineConfiguration()
  change(&configuration)
  return SittingReplay.run(frames, configuration: configuration, diagnostics: true)
}

/// A still person whose light becomes `factor` times as bright at `second`, the same in
/// every channel and region, and stays there.
private func brightnessStep(at second: Double, factor: Double) -> [FrameRecord] {
  let still = sitting()
  return recolour(still.frames()) { t, _, colour in
    guard t - still.startTime >= second else { return }
    colour = RegionColor(r: colour.r * factor, g: colour.g * factor, b: colour.b * factor)
  }
}

@Suite struct DiagnosticsChangeNothing {
  static let sittings: [SyntheticSitting] = [
    sitting(),
    sitting { $0.motionBursts = [.init(start: 20, end: 21.5)] },
    sitting { $0.faceLoss = .init(start: 30, end: 35) },
    sitting { $0.frameGap = .init(start: 30, end: 33.4) },
    sitting { $0.frameRate = 30; $0.droppedFrameProbability = 0.5 },
    sitting { $0.subject = .wall },
    sitting { $0.subject = .noise; $0.noise = 1 },
    sitting { $0.subject = .wall; $0.frameRate = 29.5; $0.flicker = .init(hz: 60, depth: 0.02) },
    sitting { $0.heartRateBpm = 44 },
    sitting { $0.heartRateChange = .init(atSeconds: 30, toBpm: 110) },
  ]

  @Test(arguments: sittings)
  func readingsAndSummaryAreTheSameWithDiagnosticsOn(_ sitting: SyntheticSitting) {
    let frames = sitting.frames()
    let plain = SittingReplay.run(frames)
    let withDiagnostics = SittingReplay.run(frames, diagnostics: true)
    #expect(plain.diagnostics.isEmpty)
    #expect(withDiagnostics.readings == plain.readings)
    #expect(withDiagnostics.summary == plain.summary)
  }

  @Test func aBrightnessStepReadsTheSameWithDiagnosticsOn() {
    let frames = brightnessStep(at: 20, factor: 1.06)
    #expect(SittingReplay.run(frames, diagnostics: true).readings == SittingReplay.run(frames).readings)
  }

  @Test func resetClearsDiagnosticsAndKeepsCollecting() {
    let engine = SignalEngine()
    engine.collectsDiagnostics = true
    let frames = sitting { $0.durationSeconds = 12 }.frames()
    frames.forEach(engine.ingest)
    let first = engine.diagnostics
    #expect(first.count == 11)
    engine.reset()
    #expect(engine.diagnostics.isEmpty)
    frames.forEach(engine.ingest)
    #expect(engine.diagnostics == first)
  }
}

@Suite struct DiagnosticsDescribeTheReading {
  /// With no silent stretch, reading k is taken on the frame that made tick k.
  @Test(arguments: [
    sitting(),
    sitting { $0.motionBursts = [.init(start: 20, end: 21.5)] },
    sitting { $0.faceLoss = .init(start: 30, end: 35) },
    sitting { $0.subject = .wall },
  ])
  func thereIsOnePerReadingAndItCarriesTheReading(_ sitting: SyntheticSitting) {
    let result = diagnosed(sitting.frames())
    #expect(result.diagnostics.count == result.readings.count)
    for (diagnostic, reading) in zip(result.diagnostics, result.readings) {
      #expect(abs(diagnostic.elapsed - reading.elapsed) < 1e-6)
      #expect(diagnostic.state == reading.heartRate.state)
      #expect(diagnostic.reason == reading.heartRate.reason)
      #expect(diagnostic.value == reading.heartRate.value)
      #expect((diagnostic.gate == nil) == (reading.heartRate.state == .valid))
    }
  }

  @Test func aValidReadingIsItsOwnCandidate() {
    let valid = diagnosed(sitting().frames()).diagnostics.filter { $0.state == .valid }
    #expect(valid.count > 40)
    for diagnostic in valid {
      #expect(diagnostic.candidateBpm == diagnostic.value)
      #expect(diagnostic.candidateQuality == diagnostic.quality)
      #expect(diagnostic.passingWindows == 3)
      #expect((diagnostic.agreementSpreadBpm ?? .infinity) <= 5)
      #expect((diagnostic.motionShare ?? 1) <= 0.3)
    }
  }

  @Test func theStartOfASittingNamesWarmUpThenAgreement() {
    // The face is found and exposure locks 2 s in; the first window is 6 s after that.
    let diagnostics = diagnosed(sitting().frames()).diagnostics
    #expect(diagnostics[0].gate == .exposureAdjusting || diagnostics[0].gate == .noFace)
    #expect(diagnostics[4].gate == .warmingUp)
    #expect(diagnostics[7].gate == .agreement)
    #expect(diagnostics[7].passingWindows == 1)
    #expect(diagnostics[8].gate == .agreement)
    #expect(diagnostics[8].passingWindows == 2)
    #expect(diagnostics[9].gate == nil)
    // A window still warming up is analysed for the diagnostic once it is long enough to be.
    #expect(abs((diagnostics[6].candidateBpm ?? 0) - 72) < 5)
  }
}

@Suite struct DiagnosticsNameTheCheck {
  @Test func motionIsNamedWithItsShareAndWhatTheWindowHeld() {
    let result = diagnosed(sitting { $0.motionBursts = [.init(start: 20, end: 21.5)] }.frames())
    let refused = result.diagnostics.filter { $0.gate == .motion }
    #expect(!refused.isEmpty)
    for diagnostic in refused {
      #expect(diagnostic.reason == .motion)
      #expect((diagnostic.motionShare ?? 0) > 0.3)
      #expect(diagnostic.windowSeconds != nil)
      #expect(diagnostic.candidateBpm != nil)
    }
  }

  /// The case that failed in the field: the light on a still face changes by a few per
  /// cent. Brightness common to the three channels is what the projection cancels, so the
  /// pulse is untouched, nothing is cut and nothing is refused. The brightness check this
  /// replaced refused ten seconds for every such step.
  @Test func aBrightnessStepOnAStillFaceIsNotMotion() {
    let result = diagnosed(brightnessStep(at: 20, factor: 1.06))
    #expect(!result.diagnostics.contains { $0.gate == .motion })
    #expect(result.diagnostics.allSatisfy { ($0.motionShare ?? 0) == 0 })
    #expect(result.heartRates.filter { $0.elapsed > 19.5 && $0.elapsed < 32.5 }.count == 13)
    #expect(result.heartRates.allSatisfy { abs($0.bpm - 72) <= 2 })
  }

  /// What the motion check does refuse: a window that is mostly movement. It names how
  /// much it had to cut and which check asked for it.
  @Test func aWindowThatIsMostlyMovementIsRefusedAsMotionWithWhatWasCut() {
    let result = diagnosed(sitting { $0.motionBursts = [.init(start: 20, end: 26)] }.frames())
    let refused = result.diagnostics.filter { $0.gate == .motion }
    #expect(refused.count >= 9)
    for diagnostic in refused {
      #expect((diagnostic.motionShare ?? 0) > 0.3)
      #expect((diagnostic.colourJumpShare ?? 0) > 0)
      #expect((diagnostic.motionShare ?? 0) >= (diagnostic.colourJumpShare ?? 1))
    }
    #expect(result.heartRates.allSatisfy { abs($0.bpm - 72) <= 2 })
  }

  @Test func aRecentGapIsNamed() {
    let diagnostics = diagnosed(sitting { $0.frameGap = .init(start: 30, end: 30.6) }.frames()).diagnostics
    let refused = diagnostics.filter { $0.gate == .recentGap }
    #expect(!refused.isEmpty)
    #expect(refused.allSatisfy { $0.reason == .gaps && ($0.windowSeconds ?? 10) < 6 })
  }

  @Test func aSilentSecondIsNamed() {
    let diagnostics = diagnosed(sitting { $0.frameGap = .init(start: 30, end: 33.4) }.frames()).diagnostics
    #expect(diagnostics.count == 59 || diagnostics.count == 60)
    #expect(diagnostics.contains { $0.gate == .noFrames && $0.state == .stale && $0.reason == .noFrames })
  }

  @Test func tooFewSamplesAreNamedWithTheirShare() {
    let diagnostics = diagnosed(sitting { $0.frameRate = 30; $0.droppedFrameProbability = 0.5 }.frames()).diagnostics
    let refused = diagnostics.filter { $0.gate == .tooFewSamples }
    #expect(!refused.isEmpty)
    #expect(refused.allSatisfy { $0.reason == .gaps })
    #expect(refused.allSatisfy { ($0.sampleShare ?? 1) < 0.85 || ($0.framesPerSecond ?? 99) < 20 })
  }

  @Test func faceLossIsNamed() {
    let diagnostics = diagnosed(sitting { $0.faceLoss = .init(start: 30, end: 35) }.frames()).diagnostics
    #expect(diagnostics[31].gate == .noFace)
    #expect(diagnostics[31].candidateBpm == nil)
    #expect(diagnostics[36].gate == .warmingUp)
    #expect(diagnostics[36].reason == .faceChanged)
  }

  @Test func aWallIsRefusedOnQualityOrAnEmptyBandAndNeverPasses() {
    let diagnostics = diagnosed(sitting { $0.subject = .wall }.frames()).diagnostics
    #expect(diagnostics.allSatisfy { $0.gate != nil })
    let analysed = diagnostics.filter { $0.windowSeconds != nil && $0.gate != .warmingUp }
    #expect(!analysed.isEmpty)
    for diagnostic in analysed where diagnostic.gate == .quality {
      #expect((diagnostic.candidateQuality ?? 1) < 0.5)
      #expect(diagnostic.candidateQuality == diagnostic.quality)
    }
  }

  @Test func flickerIsNamedWithThePeakItRefused() {
    // A 120 Hz lamp at 59.3 fps aliases to 1.4 Hz: 84 bpm. Stronger in red than in blue, it
    // survives the projection.
    let wall = sitting { $0.subject = .wall; $0.frameRate = 59.3 }
    let frames = recolour(wall.frames()) { t, _, colour in
      let swing = sin(2 * .pi * 120 * t)
      colour.r *= 1 + 0.01 * swing
      colour.g *= 1 + 0.006 * swing
      colour.b *= 1 + 0.002 * swing
    }
    let refused = diagnosed(frames).diagnostics.filter { $0.gate == .flicker }
    #expect(!refused.isEmpty)
    for diagnostic in refused {
      #expect(diagnostic.flickerAlias == true)
      #expect(diagnostic.reason == .lowQuality)
      #expect(abs((diagnostic.strongestPeakBpm ?? 0) - 84) <= 6)
    }
  }

  @Test func aPeakAtTheEdgeIsNamedWithItsFrequency() {
    let diagnostics = diagnosed(sitting { $0.heartRateBpm = 43 }.frames()).diagnostics
    let refused = diagnostics.filter { $0.gate == .bandEdge }
    #expect(!refused.isEmpty)
    #expect(refused.allSatisfy { $0.reason == .bandEdge && abs(($0.candidateBpm ?? 0) - 43) < 3 })
  }
}

@Suite struct DiagnosticsWire {
  @Test func gatesUseTheirWireStrings() throws {
    #expect(PulseGate.tooFewSamples.rawValue == "too_few_samples")
    #expect(PulseGate.recentGap.rawValue == "recent_gap")
    var diagnostic = PulseDiagnostic()
    diagnostic.gate = .motion
    diagnostic.reason = .motion
    diagnostic.state = EstimateState.none
    diagnostic.motionShare = 0.25
    let data = try JSONEncoder().encode(diagnostic)
    let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    #expect(object["gate"] as? String == "motion")
    #expect(object["motionShare"] as? Double == 0.25)
    #expect(object["candidateBpm"] == nil)
    #expect(try JSONDecoder().decode(PulseDiagnostic.self, from: data) == diagnostic)
  }

  @Test func theReferenceNearestInTimePairsWithinALimit() {
    let reference = [ReferenceSample(elapsed: 10, heartRate: 70), ReferenceSample(elapsed: 12, heartRate: 80)]
    #expect(ReferenceComparison.reference(at: 10.4, in: reference) == 70)
    #expect(ReferenceComparison.reference(at: 13.5, in: reference) == 80)
    #expect(ReferenceComparison.reference(at: 14, in: reference) == nil)
    #expect(ReferenceComparison.reference(at: 1, in: []) == nil)
  }
}
