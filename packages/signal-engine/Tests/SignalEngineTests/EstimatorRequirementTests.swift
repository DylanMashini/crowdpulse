import Foundation
import Testing

@testable import SignalEngine

// One suite per estimator requirement in plan section 7. Requirement 8 (landmark-anchored,
// smoothed regions) belongs to the capture module and has no test here.

/// A power spectrum of the given tones, as the pulse analyser would see a 10 s window.
private func spectrum(_ tones: [(hz: Double, amplitude: Double)], seconds: Double = 10) -> PowerSpectrum {
  let rate = 60.0
  let count = Int(seconds * rate)
  let signal = (0..<count).map { index in
    tones.reduce(0) { $0 + $1.amplitude * sin(2 * .pi * $1.hz * Double(index) / rate) }
  }
  let analyzer = PulseAnalyzer(configuration: .default, fourier: Fourier())
  return analyzer.spectrum(of: signal, rate: rate)
}

private let search = PulseAnalyzer(configuration: .default, fourier: Fourier()).search(windowSeconds: 10)

@Suite struct Requirement1QualityAtTheReportedFrequency {
  @Test func qualityIsThePowerShareAtTheReportedPeak() {
    // 1.2 Hz carries 80% of the power, 2.0 Hz carries 20%.
    let mixed = spectrum([(1.2, 2), (2.0, 1)])
    guard case .peak(let hz, let quality) = mixed.strongestPeak(search) else {
      Issue.record("no peak")
      return
    }
    #expect(abs(hz - 1.2) < 0.01)
    #expect(abs(quality - 0.8) < 0.03)
    #expect(abs(mixed.quality(at: 2.0, halfWidthHz: search.qualityHalfWidthHz) - 0.2) < 0.03)
    #expect(mixed.quality(at: 1.6, halfWidthHz: search.qualityHalfWidthHz) < 0.01)
  }

  @Test func aSharpSpectrumIsNotEnoughWhenThePowerIsElsewhere() {
    // Three clean tones: every peak is narrow, yet none holds half the power.
    let outcome = spectrum([(1.0, 1), (1.6, 1.05), (2.3, 1)]).strongestPeak(search)
    guard case .peak(let hz, let quality) = outcome else {
      Issue.record("no peak")
      return
    }
    #expect(abs(hz - 1.6) < 0.01)
    #expect(quality < EngineConfiguration.default.qualityThreshold)
  }

  @Test func theReadingCarriesTheQualityOfItsOwnWindow() {
    let result = replay(sitting())
    for reading in result.readings where reading.heartRate.state == .valid {
      #expect(reading.heartRate.quality >= EngineConfiguration.default.qualityThreshold)
    }
    for reading in result.readings where reading.heartRate.reason == .warmingUp {
      #expect(reading.heartRate.quality == 0)
    }
  }
}

@Suite struct Requirement2CalibratableThreshold {
  /// A pulse a seventh of the usual size: present, but under the default threshold.
  private let faint = sitting { $0.pulseAmplitude = 0.05 }

  @Test func theThresholdDecidesWhetherAFaintPulseIsShown() {
    let strict = replay(faint)
    #expect(strict.heartRates.isEmpty)
    #expect(strict.heartReasons(in: 12...59).isSubset(of: [.lowQuality, .awaitingAgreement]))
    #expect(strict.summary.heartRate.reason == EstimateReason.lowQuality.rawValue)

    let loose = replay(faint) {
      $0.qualityThreshold = 0.2
      $0.minimumRecentQuality = 0
    }
    #expect(loose.heartRates.count >= 10)
  }

  @Test func raisingTheThresholdSilencesAGoodSignal() {
    #expect(replay(sitting()) { $0.qualityThreshold = 0.99 }.heartRates.isEmpty)
  }
}

@Suite struct Requirement3AgreeingWindows {
  @Test func theFirstReadingWaitsForThreeAgreeingWindows() {
    let three = replay(sitting(), recordOnly)
    let firstValid = try! #require(three.readings.firstIndex { $0.heartRate.state == .valid })
    #expect(three.readings[firstValid - 1].heartRate.reason == .awaitingAgreement)
    #expect(three.readings[firstValid - 2].heartRate.reason == .awaitingAgreement)
    #expect(three.readings[firstValid - 1].heartRate.state == .settling)
    #expect(three.readings[firstValid - 3].heartRate.reason == .warmingUp)

    let one = replay(sitting()) { $0.agreeingWindows = 1; $0.showsProvisionalReadings = false }
    #expect(one.summary.timeToFirstReadingSeconds == three.summary.timeToFirstReadingSeconds.map { $0 - 2 })
  }

  @Test func threeOfTheNewestFiveWindowsMustAgreeAndTheNewestIsOneOfThem() {
    var gate = AgreementGate(required: 3, span: 5, tolerance: 5)
    gate.push(70)
    gate.push(72)
    #expect(!gate.agreed)
    gate.push(74)
    #expect(gate.agreed)
    #expect(gate.spread == 4)
    // A rate that agrees with nothing is not shown, whatever came before it.
    gate.push(80)
    #expect(!gate.agreed)
    // Nor is a window that was refused.
    gate.push(nil)
    #expect(!gate.agreed)
    // One refused window and one stray rate do not cost the reading after them: 72, 74
    // and 73 are three of the newest five.
    gate.push(73)
    #expect(gate.agreed)
    // Five windows on, the old rates are gone.
    for _ in 0..<3 { gate.push(nil) }
    gate.push(73)
    #expect(!gate.agreed)
  }

  @Test func ratesThatSpanMoreThanTheToleranceDoNotAgree() {
    // 70 and 78 are each within 5 of 74, but not of each other.
    var gate = AgreementGate(required: 3, span: 5, tolerance: 5)
    gate.push(70)
    gate.push(78)
    gate.push(74)
    #expect(!gate.agreed)
    #expect(gate.spread == nil)
    gate.push(75)
    #expect(gate.agreed)
    #expect((gate.spread ?? 9) <= 5)
  }

  @Test func aSpanOfThreeIsThreeInARow() {
    var gate = AgreementGate(required: 3, span: 3, tolerance: 5)
    gate.push(70)
    gate.push(72)
    gate.push(74)
    #expect(gate.agreed)
    gate.push(nil)
    gate.push(80)
    gate.push(81)
    #expect(!gate.agreed)
    gate.push(82)
    #expect(gate.agreed)
  }

  /// 45 bpm at 30 frames per second: one early window lands within the margin of the
  /// search edge and is refused. Three in a row then starts counting again.
  @Test func oneRefusedWindowDoesNotRestartTheCount() {
    let slow = sitting { $0.heartRateBpm = 45; $0.frameRate = 30; $0.seed = 45 }
    let fiveWide = replay(slow)
    let inARow = replay(slow) { $0.agreementSpanWindows = 3 }
    #expect(fiveWide.heartRates.count > inARow.heartRates.count)
    #expect(fiveWide.heartRates.allSatisfy { abs($0.bpm - 45) <= 2 })
    let diagnostics = SittingReplay.run(slow.frames(), diagnostics: true).diagnostics
    #expect(diagnostics.filter { $0.state == .valid && !$0.provisional }.allSatisfy { ($0.passingWindows ?? 0) >= 3 })
  }
}

@Suite struct Requirement4BlankingAndFreshness {
  @Test func faceLossBlanksAtOnce() {
    let frames = sitting { $0.faceLoss = .init(start: 30, end: 40) }.frames()
    let engine = SignalEngine()
    for frame in frames where frame.t < 1030 { engine.ingest(frame) }
    #expect(engine.reading().heartRate.state == .valid)

    // One frame without a face is enough; the engine does not wait for the next second.
    engine.ingest(frames.first { $0.t >= 1030 }!)
    let blanked = engine.reading()
    #expect(blanked.heartRate.value == nil)
    #expect(blanked.heartRate.state == .none)
    #expect(blanked.heartRate.reason == .noFace)
    #expect(blanked.heartRate.ageMs != nil)
  }

  @Test func faceLossBlanksWithinTwoSecondsAndTheReadingComesBack() {
    let result = replay(sitting { $0.faceLoss = .init(start: 30, end: 35) })
    #expect(result.heartRate(at: 29).state == .valid)
    // The face goes at 30.0 s: the reading taken at that very second is already blank.
    for second in 30...34 {
      #expect(result.heartRate(at: second).value == nil)
      #expect(result.heartRate(at: second).reason == .noFace)
    }
    #expect(result.heartRate(at: 36).state == .settling)
    #expect(result.heartRate(at: 36).reason == .faceChanged)
    #expect(result.heartRates.contains { $0.elapsed > 35 && abs($0.bpm - 72) <= 2 })
  }

  @Test func exposureChangeBlanks() {
    let frames = sitting().frames().map { frame -> FrameRecord in
      var frame = frame
      if (1030..<1032).contains(frame.t) { frame.exposure = .adjusting }
      return frame
    }
    let result = replay(frames)
    #expect(result.heartRate(at: 31).reason == .exposureAdjusting)
    #expect(result.heartRate(at: 31).value == nil)
    #expect(result.heartRate(at: 33).reason == .warmingUp)
  }

  @Test func aSilentCameraTurnsAValidReadingStale() {
    let engine = SignalEngine()
    let frames = sitting().frames().prefix { $0.t < 1030 }
    for frame in frames { engine.ingest(frame) }
    let last = frames.last!.t
    #expect(engine.reading(at: last + 1.9).heartRate.state == .valid)

    let silent = engine.reading(at: last + 2.1)
    #expect(silent.heartRate.state == .stale)
    #expect(silent.heartRate.reason == .noFrames)
    #expect(silent.heartRate.value == nil)
    #expect(silent.breathingRate.state == .stale)
    #expect((2000...3200).contains(silent.heartRate.ageMs ?? 0))
    // Silent seconds count against coverage.
    #expect(engine.reading(at: last + 30).heartRate.coverage < engine.reading(at: last).heartRate.coverage / 1.5)
  }
}

@Suite struct Requirement5GapsAndSampleCount {
  @Test func aWindowNeverSpansAGap() {
    let result = replay(sitting { $0.frameGap = .init(start: 30, end: 30.6) })
    #expect(result.summary.droppedFrames == 36)
    #expect(result.heartRate(at: 29).state == .valid)
    #expect(result.heartReasons(in: 30...36) == [.gaps])
    #expect(result.heartRates.contains { $0.elapsed > 36 && abs($0.bpm - 72) <= 2 })

    let tolerant = replay(sitting { $0.frameGap = .init(start: 30, end: 30.6) }) { $0.maximumGapSeconds = 1 }
    #expect(tolerant.heartRates.contains { (31...36).contains($0.elapsed) })
  }

  @Test func tooFewSamplesRejectTheWindow() {
    // Half of a 30 fps stream: about 15 frames per second, under the 20 the engine needs.
    let result = replay(sitting { $0.frameRate = 30; $0.droppedFrameProbability = 0.5 })
    #expect(result.heartRates.isEmpty)
    #expect(result.heartReasons(in: 12...59) == [.gaps])
  }

  @Test func aStreamThatThinsOutIsRejected() {
    // Regular 60 fps for most of the window, then four frames in five missing.
    var kept = 0
    let frames = sitting().frames().filter { frame in
      guard frame.t >= 1030 else { return true }
      kept += 1
      return kept % 5 == 0
    }
    let result = replay(frames)
    #expect(result.heartRate(at: 29).state == .valid)
    #expect(result.heartRate(at: 34).reason == .gaps)
  }
}

@Suite struct Requirement6HarmonicsAndBandEdges {
  @Test func peakPickingDoesNotRewardHarmonics() {
    // Power at 2.2 Hz is more than twice the power at 1.1 Hz. Picking reports what is
    // strongest; a peak gains nothing from having a harmonic above it.
    guard case .peak(let hz, _) = spectrum([(1.1, 1), (2.2, 1.5)]).strongestPeak(search) else {
      Issue.record("no peak")
      return
    }
    #expect(abs(hz - 2.2) < 0.01)
  }

  /// A pulse wave with a second harmonic stronger than its fundamental. The harmonic is the
  /// strongest peak and holds most of the power, but the peak at half its frequency gives it
  /// away, and the fundamental does not hold enough of the band to be shown either.
  @Test(arguments: [1.2, 1.6, 2.5])
  func aHarmonicStrongerThanItsFundamentalIsNotReadAsTheRate(harmonic: Double) {
    let result = replay(sitting { $0.heartRateBpm = 62; $0.pulseHarmonic = harmonic })
    #expect(result.heartRates.allSatisfy { abs($0.bpm - 62) <= 2 }, "\(result.heartRates.map(\.bpm))")
    #expect(result.heartReasons(in: 12...59).contains(.lowQuality))
  }

  /// A rate below the search band loses its fundamental to the band-pass, leaving the
  /// second harmonic alone in the band: 36 bpm would read as a healthy 72.
  @Test(arguments: [30.0, 36.0, 40.0])
  func aRateBelowTheBandIsNotReadAsItsHarmonic(bpm: Double) {
    let result = replay(sitting { $0.heartRateBpm = bpm; $0.pulseHarmonic = 0.5 })
    #expect(result.heartRates.isEmpty, "\(bpm) bpm read as \(result.heartRates.map(\.bpm))")
    #expect(result.heartReasons(in: 12...59) == [.bandEdge], "\(bpm) bpm")
  }

  @Test func theSubharmonicCheckNeedsAPeakThatStandsOutOfTheNoise() {
    let band = 0.35...3.0
    let clean = spectrum([(1.0, 0.3), (2.0, 1)])
    #expect(clean.hasSubharmonic(of: 2.0, toleranceHz: 0.06, floor: 0.02, noiseRatio: 16, band: band, lobeHalfWidthHz: 0.2))
    // Nothing at half the frequency.
    #expect(!spectrum([(2.0, 1)]).hasSubharmonic(of: 2.0, toleranceHz: 0.06, floor: 0.02, noiseRatio: 16, band: band, lobeHalfWidthHz: 0.2))
    // A peak near, but not at, half the frequency.
    #expect(!spectrum([(1.2, 0.3), (2.0, 1)]).hasSubharmonic(of: 2.0, toleranceHz: 0.06, floor: 0.02, noiseRatio: 16, band: band, lobeHalfWidthHz: 0.2))
    // Too weak to be told from a side lobe.
    #expect(!spectrum([(1.0, 0.05), (2.0, 1)]).hasSubharmonic(of: 2.0, toleranceHz: 0.06, floor: 0.02, noiseRatio: 16, band: band, lobeHalfWidthHz: 0.2))
  }

  @Test func aHarmonicRelationOnlyBreaksATie() {
    // Fundamental and second harmonic within 10% in amplitude: a tie, so the lower wins.
    guard case .peak(let tied, _) = spectrum([(1.1, 1), (2.2, 1.08)]).strongestPeak(search) else {
      Issue.record("no peak")
      return
    }
    #expect(abs(tied - 1.1) < 0.01)

    // The same near-tie between unrelated frequencies is left alone.
    guard case .peak(let unrelated, _) = spectrum([(1.1, 1), (1.9, 1.08)]).strongestPeak(search) else {
      Issue.record("no peak")
      return
    }
    #expect(abs(unrelated - 1.9) < 0.01)
  }

  @Test func peaksAtTheEdgeOfTheSearchBandAreRejected() {
    #expect(spectrum([(0.705, 1)]).strongestPeak(search) == .bandEdge(quality: spectrum([(0.705, 1)]).strongestPeak(search).quality))
    for bpm in [40.0, 42.5, 179.5, 184.0] {
      let result = replay(sitting { $0.heartRateBpm = bpm; $0.pulseHarmonic = 0 })
      #expect(result.heartRates.isEmpty, "\(bpm) bpm")
      #expect(result.heartReasons(in: 12...59).contains(.bandEdge), "\(bpm) bpm")
    }
  }
}

@Suite struct Requirement7BandPass {
  @Test func theFilterPassesThePulseBandAndNothingElse() {
    let fourier = Fourier()
    let rate = 60.0
    func gain(_ hz: Double) -> Double {
      let tone = (0..<1024).map { sin(2 * .pi * hz * Double($0) / rate) }
      let filtered = fourier.bandPass(tone, rate: rate, band: 0.7...3.0, transitionHz: 0.1)
      return DSP.rootMeanSquare(Array(filtered[200..<824])) / DSP.rootMeanSquare(Array(tone[200..<824]))
    }
    for hz in [0.8, 1.2, 2.0, 2.9] { #expect(abs(gain(hz) - 1) < 0.03, "\(hz) Hz") }
    for hz in [0.1, 0.3, 0.5, 3.4, 6.0, 12.0] { #expect(gain(hz) < 0.05, "\(hz) Hz") }
  }

  @Test func energyOutsideThePulseBandDoesNotHideThePulse() {
    // Skin colour swinging with slow sway and a fast tremor, both far stronger than the
    // pulse and each in different channels, so the projection cannot cancel them.
    // Unfiltered, they would take most of the power and the quality would collapse.
    let source = sitting { $0.heartRateBpm = 66 }
    let frames = recolour(source.frames()) { t, _, colour in
      let sway = 1.2 * sin(2 * .pi * 0.31 * t)
      let tremor = 1.0 * sin(2 * .pi * 6.3 * t)
      colour.g += sway
      colour.b += tremor
      colour.r -= 0.5 * sway
    }
    let result = replay(frames)
    #expect(result.heartRates.count >= 40)
    #expect(result.heartRates.allSatisfy { abs($0.bpm - 66) <= 2 })
  }
}

@Suite struct Requirement9MotionOverTheWholeWindow {
  private let moved = sitting { $0.motionBursts = [.init(start: 20, end: 21.5)] }

  @Test func motionEarlierInTheWindowIsCutOutForAsLongAsItIsInside() {
    let result = SittingReplay.run(moved.frames(), diagnostics: true)
    #expect(result.heartRate(at: 19).state == .valid)
    // The movement stopped at 21.5 s. Seconds later it is still inside the window, and it
    // is still kept out of the analysis: the window is read around it.
    for second in 23...30 {
      #expect((result.diagnostics[second - 1].motionShare ?? 0) >= 0.14, "second \(second)")
    }
    #expect(result.diagnostics[33].motionShare == 0)
    #expect(result.heartRates.filter { $0.elapsed > 22.5 && $0.elapsed < 31.5 }.count >= 2)
    #expect(result.heartRates.allSatisfy { abs($0.bpm - 72) <= 2 })
  }

  @Test func aWindowThatIsMostlyMovementIsRejected() {
    let result = replay(sitting { $0.motionBursts = [.init(start: 20, end: 26)] })
    // More than `maximumDisturbedShare` of every window from here to there is movement.
    #expect(result.heartReasons(in: 24...32) == [.motion])
    #expect(result.heartRates.contains { $0.elapsed > 36 && abs($0.bpm - 72) <= 2 })
    #expect(result.heartRates.allSatisfy { abs($0.bpm - 72) <= 2 })
  }

  /// The check this replaced compared brightness with a running average, so a lamp
  /// dimming on a still face was "motion". Brightness common to the channels is not.
  @Test func brightnessAloneIsNotMotion() {
    let still = sitting()
    let dimmed = recolour(still.frames()) { t, _, colour in
      guard t - still.startTime >= 25 else { return }
      colour = RegionColor(r: colour.r * 0.9, g: colour.g * 0.9, b: colour.b * 0.9)
    }
    let result = replay(dimmed)
    #expect(!result.heartReasons(in: 20...40).contains(.motion))
    #expect(result.heartRates.allSatisfy { abs($0.bpm - 72) <= 2 })
  }

  @Test func theMotionLimitsAreParameters() {
    let blind = replay(moved) {
      $0.colourJumpDeviation = 10
      $0.colourJumpCeiling = 10
      $0.motionChestSpeed = 10
    }
    #expect(!blind.heartReasons(in: 20...40).contains(.motion))
  }
}

@Suite struct Requirement10FaceChangeResetsHistory {
  /// One person for 30 s, then another with a different pulse, with no frame in between.
  private var twoPeople: [FrameRecord] {
    let first = sitting { $0.heartRateBpm = 70; $0.durationSeconds = 30 }
    let second = sitting {
      $0.heartRateBpm = 120
      $0.durationSeconds = 30
      $0.settleSeconds = 0
      $0.startTime = first.startTime + 30
      $0.faceTrackId = 2
      $0.seed = 2
    }
    return first.frames() + second.frames()
  }

  @Test func theFirstFacesSignalIsNotReadAsTheSeconds() {
    let result = replay(twoPeople)
    #expect(abs((result.heartRate(at: 29).value ?? 0) - 70) <= 2)
    // The window that was valid a second ago is gone, not carried over to the new face.
    for second in 30...35 {
      #expect(result.heartRate(at: second).state == .settling)
      #expect(result.heartRate(at: second).reason == .faceChanged)
    }
    #expect(result.heartRates.filter { $0.elapsed > 30 }.allSatisfy { abs($0.bpm - 120) <= 2 })
    #expect(result.heartRates.contains { $0.elapsed > 30 })
    #expect(result.readings[31].breathingRate.reason == .faceChanged)
    #expect(result.breathingRates.isEmpty)
  }

  @Test func withoutATrackChangeTheOldWindowWouldLinger() {
    // The same frames with the track id left alone: the engine has no way to know, and the
    // old rate stays up while the window still holds mostly the first person.
    let frames = twoPeople.map { frame -> FrameRecord in
      var frame = frame
      if frame.faceTrackId != nil { frame.faceTrackId = 1 }
      return frame
    }
    let result = replay(frames)
    #expect(result.heartRates.contains { (31...36).contains($0.elapsed) && abs($0.bpm - 70) <= 5 })
  }
}

@Suite struct RegionCombination {
  /// A sitting whose right cheek is buried in noise (a strand of hair, a shadow edge).
  private var oneBadRegion: [FrameRecord] {
    var generator = SplitMix64(state: 99)
    return recolour(sitting().frames()) { _, region, colour in
      guard region == 2 else { return }
      colour.r += 6 * generator.nextGaussian()
      colour.g += 6 * generator.nextGaussian()
      colour.b += 6 * generator.nextGaussian()
    }
  }

  @Test func aPoorRegionIsWeightedDownNotAveragedIn() {
    let analyzer = PulseAnalyzer(configuration: .default, fourier: Fourier())
    var history = PulseHistory()
    for frame in oneBadRegion where frame.facePresent && frame.t < 1020 {
      history.append(time: frame.t, frame: frame, colourChange: 0, chestMotion: false)
    }
    let range = history.index(atOrAfter: 1010)..<history.times.count
    let regions = history.regions(in: range, rate: 60).map(\.series)
    let weighted = analyzer.analyse(regions, rate: 60, frameRate: 60)
    #expect(weighted.weights[2] < 0.1)
    #expect(weighted.peak.quality >= 0.7)

    // The plain average of the same three waveforms.
    let waveforms = regions.map { analyzer.waveform($0, rate: 60, band: 0.7...3.0) }
    let average = waveforms[0].indices.map { index in waveforms.reduce(0) { $0 + $1[index] } / 3 }
    let plain = analyzer.spectrum(of: average, rate: 60).strongestPeak(search)
    #expect(plain.quality < EngineConfiguration.default.qualityThreshold)
  }

  @Test func theReadingSurvivesOnePoorRegion() {
    let result = replay(oneBadRegion) { $0.colourJumpDeviation = 10; $0.colourJumpCeiling = 10 }
    #expect(result.heartRates.count >= 40)
    #expect(result.heartRates.allSatisfy { abs($0.bpm - 72) <= 2 })
  }

  @Test func aMissingRegionIsLeftOut() {
    let frames = sitting().frames().map { frame -> FrameRecord in
      var frame = frame
      frame.leftCheek = nil
      return frame
    }
    let result = replay(frames)
    #expect(result.heartRates.count >= 40)
    #expect(result.heartRates.allSatisfy { abs($0.bpm - 72) <= 2 })
  }
}

@Suite struct Bookkeeping {
  @Test func coverageCountsValidSeconds() {
    let result = replay(sitting())
    let valid = result.readings.filter { $0.heartRate.isRecorded }.count
    #expect(result.summary.heartRate.coverage == Double(valid) / Double(result.readings.count))
    #expect(result.readings.last?.heartRate.coverage == result.summary.heartRate.coverage)
    #expect(result.summary.timeToFirstReadingSeconds == result.heartRates.first?.elapsed)
    #expect(result.summary.heartRate.reason == nil)
  }

  @Test func everyWithheldReadingHasAReasonAndNoValue() {
    let awkward = sitting {
      $0.faceLoss = .init(start: 20, end: 23)
      $0.motionBursts = [.init(start: 40, end: 42)]
      $0.frameGap = .init(start: 50, end: 50.5)
    }
    for reading in replay(awkward).readings {
      for estimate in [reading.heartRate, reading.breathingRate] {
        #expect((estimate.state == .valid) == (estimate.value != nil))
        #expect((estimate.state == .valid) == (estimate.reason == nil))
        #expect((0...1).contains(estimate.quality))
        #expect((0...1).contains(estimate.coverage))
        if estimate.state == .valid { #expect(estimate.ageMs == 0) }
      }
    }
  }

  @Test func ingestIsCheapAndTheSpectralWorkRunsOncePerSecond() {
    let frames = sitting().frames()
    let engine = SignalEngine()
    let seconds = frames.map { frame -> Double in
      let start = DispatchTime.now().uptimeNanoseconds
      engine.ingest(frame)
      return Double(DispatchTime.now().uptimeNanoseconds - start) / 1e9
    }
    // The typical frame only appends to the history. This holds unoptimised and with other
    // tests running; a 60 fps frame lasts 16,700 microseconds.
    #expect(DSP.median(seconds)! < 0.0001)
    // The expensive ingests are the 59 that cross a whole second, and nothing else.
    let slowest = seconds.indices.sorted { seconds[$0] > seconds[$1] }.prefix(59)
    #expect(slowest.filter { $0 % 60 == 0 }.count >= 50)
  }
}
