import Foundation
import Testing

@testable import SignalEngine

/// What the owner's phone sittings held that the webcam recordings do not (results,
/// section 11): one region that keeps jumping while the others are steady, light that
/// steps every second or two, and a face the tracker loses for a moment.

/// A still person whose forehead region settles on a new colour every `every` seconds, as
/// a region does that touches the hairline, while the cheeks never move.
private func jumpingForehead(every: Double = 2, _ change: (inout SyntheticSitting) -> Void = { _ in }) -> [FrameRecord] {
  let still = sitting(change)
  return recolour(still.frames()) { t, region, colour in
    guard region == 0 else { return }
    let step = Int((t - still.startTime) / every)
    // Brightness and redness both move, by a few per cent, differently at each step.
    let level = 1 + 0.08 * sin(Double(step) * 2.4)
    let red = 1 + 0.04 * cos(Double(step) * 1.7)
    colour = RegionColor(r: colour.r * level * red, g: colour.g * level, b: colour.b * level)
  }
}

@Suite struct OneRegionJumpsTheOthersAreSteady {
  @Test func theSteadyRegionsKeepTheReading() {
    let result = replay(jumpingForehead())
    #expect(result.heartRates.count >= 40)
    #expect(result.heartRates.allSatisfy { abs($0.bpm - 72) <= 2 })
    #expect(abs((result.summary.heartRate.value ?? 0) - 72) <= 2)
    #expect(result.summary.heartRateConfidence == .normal)
  }

  @Test func cutTogetherTheyLoseMostOfIt() {
    // The behaviour before: a jump in any region cut every region, each stretch between
    // two cuts stood alone. Kept as a switch, and as the measure of what the change buys.
    let together = replay(jumpingForehead()) {
      $0.cutsRegionsSeparately = false
      $0.levelsAcrossCuts = false
    }
    let apart = replay(jumpingForehead())
    #expect(together.heartRates.count < apart.heartRates.count / 2)
  }

  @Test func withNoPulseThereIsStillNoReading() {
    for subject in [SyntheticSitting.Subject.noise, .wall] {
      let result = replay(jumpingForehead { $0.subject = subject })
      #expect(result.heartRates.count <= 2, "\(subject)")
      #expect(result.summary.heartRate.value == nil, "\(subject)")
    }
  }

  @Test func whenEveryRegionJumpsTooOftenTheWindowIsStillMotion() {
    let still = sitting()
    let frames = recolour(still.frames()) { t, _, colour in
      let step = Int((t - still.startTime) / 0.6)
      let red = 1 + 0.06 * sin(Double(step) * 2.4)
      colour = RegionColor(r: colour.r * red, g: colour.g, b: colour.b)
    }
    let result = SittingReplay.run(frames, diagnostics: true)
    #expect(result.heartRates.isEmpty)
    #expect(result.diagnostics.contains { $0.gate == .motion })
  }
}

/// Light that steps: every region settles at a new brightness and a new redness, as a face
/// lit partly by a screen does when the screen changes.
private func steppingLight(every: Double, _ change: (inout SyntheticSitting) -> Void = { _ in }) -> [FrameRecord] {
  let still = sitting(change)
  return recolour(still.frames()) { t, _, colour in
    let step = Int((t - still.startTime) / every)
    let level = 1 + 0.10 * sin(Double(step) * 2.4)
    let red = 1 + 0.05 * cos(Double(step) * 1.7)
    colour = RegionColor(r: colour.r * level * red, g: colour.g * level, b: colour.b * level)
  }
}

@Suite struct LevelsAreCarriedAcrossCuts {
  @Test func aStepEveryTwoSecondsStillGivesTheRate() {
    // Stretches of two seconds between steps: with each stretch standing alone, and the
    // half second around each step cut, too little of a window was left.
    let result = replay(steppingLight(every: 2))
    #expect(result.heartRates.count >= 20)
    #expect(result.heartRates.allSatisfy { abs($0.bpm - 72) <= 3 })
    #expect(abs((result.summary.heartRate.value ?? 0) - 72) <= 2)

    let alone = replay(steppingLight(every: 2)) { $0.levelsAcrossCuts = false }
    #expect(alone.heartRates.count < result.heartRates.count)
  }

  @Test func atOtherRatesToo() {
    for bpm in [50.0, 64, 88, 103, 131] {
      let result = replay(steppingLight(every: 2.5) { $0.heartRateBpm = bpm })
      #expect(abs((result.summary.heartRate.value ?? 0) - bpm) <= 2, "\(bpm) bpm")
    }
  }

  @Test func theStepsThemselvesAreNotAPulse() {
    // No pulse, and steps at intervals whose rate or a multiple of it lies in the band.
    for every in [0.9, 1.3, 2, 2.5] {
      for subject in [SyntheticSitting.Subject.noise, .wall] {
        let result = replay(steppingLight(every: every) { $0.subject = subject })
        #expect(result.heartRates.count <= 2, "\(subject), a step every \(every) s")
        #expect(result.summary.heartRate.value == nil, "\(subject), a step every \(every) s")
      }
    }
  }

  @Test func levellingLeavesAnUncutRegionAlone() {
    let analyzer = PulseAnalyzer(configuration: .default, fourier: Fourier())
    let series = RegionSeries(r: [150, 151, 152, 153], g: [100, 101, 102, 103], b: [80, 81, 82, 83])
    #expect(analyzer.levelled(series, usable: nil, rate: 60).r == series.r)
    #expect(analyzer.levelled(series, usable: [true, true, true, true], rate: 60).g == series.g)
  }

  @Test func levellingRemovesAStepAndKeepsTheRipple() {
    let analyzer = PulseAnalyzer(configuration: .default, fourier: Fourier())
    let count = 600
    // A 1.2 Hz ripple of 0.5% on a level that steps up by 10% (red by 15%) at sample 300.
    func channel(_ level: Double, _ step: Double) -> [Double] {
      (0..<count).map { index in
        level * (index >= 300 ? step : 1) * (1 + 0.005 * sin(2 * .pi * 1.2 * Double(index) / 60))
      }
    }
    let series = RegionSeries(r: channel(150, 1.15), g: channel(100, 1.1), b: channel(80, 1.1))
    var usable = [Bool](repeating: true, count: count)
    for index in 290..<310 { usable[index] = false }
    let levelled = analyzer.levelled(series, usable: usable, rate: 60)
    // The level after the cut is the level before it, to well under the ripple.
    let before = levelled.r[200..<260].reduce(0, +) / 60
    let after = levelled.r[400..<460].reduce(0, +) / 60
    #expect(abs(after / before - 1) < 0.002)
    // The ripple is still there, the same share of the level.
    let swing = (levelled.r[400..<460].max()! - levelled.r[400..<460].min()!) / after
    #expect(abs(swing - 0.01) < 0.002)
    // Across the cut the series is a straight line between its neighbours.
    #expect(levelled.r[300] > min(levelled.r[289], levelled.r[310]) - 1e-9)
    #expect(levelled.r[300] < max(levelled.r[289], levelled.r[310]) + 1e-9)
  }
}

@Suite struct AFaceLostForAMomentIsBridged {
  @Test func theReadingComesBackWithoutAWarmUp() {
    // Lost for 0.8 s at 30 s; found again under the next track id.
    let result = replay(sitting { $0.faceLoss = .init(start: 30, end: 30.8) })
    // No second is spent warming up again.
    let after = result.heartReasons(in: 31...40)
    #expect(!after.contains(.faceChanged))
    #expect(!after.contains(.warmingUp))
    // And the readings are back within four seconds, where a new segment needs eight.
    #expect(result.heartRates.contains { $0.elapsed > 31 && $0.elapsed <= 35 })
    #expect(result.heartRates.allSatisfy { abs($0.bpm - 72) <= 2 })

    let unbridged = replay(sitting { $0.faceLoss = .init(start: 30, end: 30.8) }) { $0.bridgeSeconds = 0 }
    #expect(unbridged.heartRates.count < result.heartRates.count)
    #expect(!unbridged.heartRates.contains { $0.elapsed > 31 && $0.elapsed <= 37 })
  }

  @Test func whileItIsLostThereIsNoReading() {
    let result = replay(sitting { $0.faceLoss = .init(start: 30, end: 31.5) })
    #expect(result.heartRate(at: 31).state != .valid)
    #expect(result.heartRate(at: 31).reason == .noFace)
  }

  @Test func aFaceGoneForLongerStartsAgain() {
    let result = replay(sitting { $0.faceLoss = .init(start: 30, end: 34) })
    #expect(result.heartReasons(in: 35...39).contains(.faceChanged))
    #expect(!result.heartRates.contains { $0.elapsed > 30 && $0.elapsed < 41 })
  }

  @Test func anotherFaceWithNoFrameBetweenIsNeverBridged() {
    // Requirement 10, from the side of this change: a new track id with the face in every
    // frame is someone else, however short the moment.
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
    for second in 30...35 { #expect(result.heartRate(at: second).reason == .faceChanged) }
    #expect(result.heartRates.filter { $0.elapsed > 30 }.allSatisfy { abs($0.bpm - 120) <= 2 })
  }

  /// Two people, the second found `gap` seconds after the first was lost, under a new track
  /// id. `boxes` are the face boxes each is recorded with; nil leaves the frames without one.
  private func swap(gap: Double, boxes: (FaceBox, FaceBox)?) -> [FrameRecord] {
    let first = sitting { $0.heartRateBpm = 70; $0.durationSeconds = 30 }
    let second = sitting {
      $0.heartRateBpm = 120
      $0.durationSeconds = 30
      $0.settleSeconds = 0
      $0.startTime = first.startTime + 30 + gap
      $0.faceTrackId = 2
      $0.seed = 2
    }
    var lost: [FrameRecord] = []
    var t = first.startTime + 30
    while t < second.startTime - 0.5 / 60 {
      lost.append(FrameRecord(t: t, facePresent: false, exposure: .locked, droppedFrames: 0))
      t += 1.0 / 60
    }
    func boxed(_ frames: [FrameRecord], _ box: FaceBox?) -> [FrameRecord] {
      frames.map { frame in
        var frame = frame
        if frame.facePresent { frame.face = box }
        return frame
      }
    }
    return boxed(first.frames(), boxes?.0) + lost + boxed(second.frames(), boxes?.1)
  }

  @Test func aFaceThatComesBackSomewhereElseIsAnotherFace() {
    // QA round 3, R3: the patient's face is lost and a face elsewhere in the picture is
    // found within the two seconds. The box says it is not the same face: nothing is bridged.
    let patient = FaceBox(x: 0.35, y: 0.3, width: 0.3, height: 0.25)
    let bystander = FaceBox(x: 0.72, y: 0.2, width: 0.2, height: 0.17)
    for gap in [0.1, 0.6, 1.5] {
      let result = replay(swap(gap: gap, boxes: (patient, bystander)))
      #expect(result.heartReasons(in: 32...35).contains(.faceChanged), "gap \(gap)")
      #expect(!result.heartRates.contains { $0.elapsed > 30.5 && abs($0.bpm - 70) <= 10 }, "gap \(gap)")
      #expect(result.heartRates.contains { $0.elapsed > 40 && abs($0.bpm - 120) <= 2 }, "gap \(gap)")
    }
    // A face that comes back much larger or smaller is not the same one either.
    let near = FaceBox(x: 0.25, y: 0.2, width: 0.5, height: 0.42)
    #expect(replay(swap(gap: 0.6, boxes: (patient, near))).heartReasons(in: 32...35).contains(.faceChanged))
  }

  @Test func aFaceThatComesBackWhereItWasIsStillBridged() {
    // The same place, a fifth of a face to one side, a little larger: bridged as before.
    let before = FaceBox(x: 0.35, y: 0.3, width: 0.3, height: 0.25)
    let after = FaceBox(x: 0.41, y: 0.31, width: 0.33, height: 0.27)
    for boxes in [(before, after), (before, before)] {
      var frames = sitting { $0.faceLoss = .init(start: 30, end: 30.8) }.frames()
      frames = frames.map { frame in
        var frame = frame
        if frame.facePresent { frame.face = frame.t < 1030.4 ? boxes.0 : boxes.1 }
        return frame
      }
      let result = replay(frames)
      #expect(!result.heartReasons(in: 31...40).contains(.faceChanged))
      #expect(result.heartRates.contains { $0.elapsed > 31 && $0.elapsed <= 35 })
    }
    // And a file with no boxes, or with a box on one side of the gap only, is bridged as before.
    let unboxed = replay(swap(gap: 0.6, boxes: nil))
    #expect(!unboxed.heartReasons(in: 31...36).contains(.faceChanged))
  }

  @Test func aLostFaceWithNoPulseBehindItGivesNothing() {
    let result = replay(sitting { $0.subject = .noise; $0.faceLoss = .init(start: 30, end: 30.8) })
    #expect(result.heartRates.count <= 2)
    #expect(result.summary.heartRate.value == nil)
  }
}

@Suite struct WhatTheWholeSittingEstimateMayVouchFor {
  /// A faint pulse: too weak for more than a few one-second readings.
  private func faint(_ bpm: Double, _ change: (inout SyntheticSitting) -> Void = { _ in }) -> SyntheticSitting {
    sitting {
      $0.heartRateBpm = bpm
      $0.pulseAmplitude = 0.2
      change(&$0)
    }
  }

  @Test func everyRegionOfAStillPersonSaysTheSame() {
    let whole = replay(faint(84)).summary.wholeSitting
    #expect(whole?.regions == 3)
    #expect(whole?.agreeingRegions == 3)
    // Counted, and by default not rewarded.
    #expect(whole?.evidence == whole?.rawEvidence)
    let rewarded = replay(faint(84)) { $0.wholeSittingRegionAgreement = 1.5 }.summary.wholeSitting
    #expect((rewarded?.evidence ?? 0) > (rewarded?.rawEvidence ?? 0))
  }

  @Test func regionsOfNoiseDoNotAllAgree() {
    var agreed = 0
    for seed in 1...12 {
      let whole = replay(sitting { $0.subject = .noise; $0.seed = UInt64(seed) }).summary.wholeSitting
      if let whole, whole.regions >= 2, whole.agreeingRegions == whole.regions { agreed += 1 }
    }
    #expect(agreed <= 1)
  }

  @Test func thePeakAboveTheDriftIsJudgedNotIgnored() {
    // A faint 90 bpm pulse under slow colour wander that piles up at the bottom of the band.
    let estimate = replay(faint(90) { $0.illuminationDrift = 0.2 }).summary.wholeSitting
    #expect(abs((estimate?.heartRate ?? 0) - 90) <= 3)
  }

  @Test func threeStretchesVouchOnlyWithTheirShareOfTheWindows() {
    var configuration = EngineConfiguration.default
    configuration.wholeSittingCorroboratingStretches = 3
    let analyzer = WholeSittingAnalyzer(configuration: configuration)
    let bins = 300
    let binHz = 60.0 / 4096
    func window(end: Double, bpm: Double?) -> WindowEvidence {
      var spectrum = [Double](repeating: 0.5 / Double(bins), count: bins)
      if let bpm {
        let bin = Int((bpm / 60 / binHz).rounded())
        for offset in -2...2 { spectrum[bin + offset] += 0.1 }
      }
      return WindowEvidence(
        end: end, seconds: 10, candidateHz: bpm.map { $0 / 60 }, regions: [0, 1, 2], spectrum: spectrum,
        regionSpectra: [spectrum, spectrum, spectrum], binHz: binHz)
    }
    // Windows ending at 10 to 59 s. A pulse in all of the first three stretches and
    // nothing after: 30 of 50 windows.
    let steady = (10..<60).map { window(end: Double($0), bpm: $0 < 40 ? 78 : nil) }
    let steadyEstimate = analyzer.estimate(steady, origin: 0)
    #expect(steadyEstimate.supportingStretches == 3)
    #expect(steadyEstimate.corroborates)
    #expect(!steadyEstimate.accepted)
    // The same three stretches touched by a quarter of a minute of pulse: 15 of 50.
    let brief = (10..<60).map { window(end: Double($0), bpm: (18..<33).contains($0) ? 78 : nil) }
    let briefEstimate = analyzer.estimate(brief, origin: 0)
    #expect(briefEstimate.supportingStretches == 3)
    #expect(!briefEstimate.corroborates)
    // As shipped, three stretches vouch for nothing.
    #expect(!WholeSittingAnalyzer(configuration: .default).estimate(steady, origin: 0).corroborates)
  }
}

@Suite struct WhatTheFrameRecordCarriesForReplay {
  @Test func theNewFieldsRoundTripAndOlderFilesStillRead() throws {
    var frame = FrameRecord(t: 12.5, facePresent: true, exposure: .locked, droppedFrames: 0, faceTrackId: 3)
    frame.face = FaceBox(x: 0.31, y: 0.22, width: 0.28, height: 0.41)
    frame.iso = 320
    frame.exposureMs = 8.3
    let decoded = try JSONDecoder().decode(FrameRecord.self, from: JSONEncoder().encode(frame))
    #expect(decoded == frame)

    let older = #"{"t":1,"facePresent":false,"exposure":"adjusting","droppedFrames":0}"#
    let read = try JSONDecoder().decode(FrameRecord.self, from: Data(older.utf8))
    #expect(read.face == nil)
    #expect(read.iso == nil)
    // A frame without them writes no key for them.
    let plain = FrameRecord(t: 1, facePresent: false, exposure: .adjusting, droppedFrames: 0)
    let text = String(decoding: try JSONEncoder().encode(plain), as: UTF8.self)
    #expect(!text.contains("iso") && !text.contains("face\""))
  }

  @Test func theEngineReadsTheSameWithOrWithoutThem() {
    let frames = sitting().frames()
    let tagged = frames.map { frame -> FrameRecord in
      var frame = frame
      frame.iso = 250
      frame.exposureMs = 10
      if frame.facePresent { frame.face = FaceBox(x: 0.3, y: 0.2, width: 0.3, height: 0.4) }
      return frame
    }
    #expect(replay(frames).heartRates.map(\.bpm) == replay(tagged).heartRates.map(\.bpm))
  }
}
