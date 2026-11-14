import Foundation
import Testing

@testable import SignalEngine

// QA adversarial scenarios. The frames come from QAScene, a generator written independently
// of SyntheticSitting, so these tests do not share the build's assumptions about the signal.
// Each test states the plan requirement it checks. Lines starting "QA:" are diagnostics.

struct QARandom {
  var state: UInt64
  mutating func next() -> UInt64 {
    state &+= 0x9E37_79B9_7F4A_7C15
    var z = state
    z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
    z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
    return z ^ (z >> 31)
  }
  mutating func unit() -> Double { Double(next() >> 11) / Double(1 << 53) }
  mutating func gaussian() -> Double {
    let u = max(unit(), 1e-12)
    return (-2 * log(u)).squareRoot() * cos(2 * .pi * unit())
  }
}

/// A sitting described by functions of elapsed time.
struct QAScene {
  var seconds = 60.0
  var fps = 60.0
  var seed: UInt64 = 7
  var startTime = 5000.0
  var person = true
  /// Heart rate at elapsed seconds.
  var bpm: (Double) -> Double = { _ in 72 }
  /// Pulse harmonic amplitudes, index 0 is the fundamental.
  var harmonics: [Double] = [1, 0.3]
  /// Green-channel pulse amplitude in counts.
  var pulseAmp = 0.4
  var noise = 0.2
  /// Independent beat-interval noise, ms SD.
  var beatJitterMs = 0.0
  /// Extra beat-time error applied to all regions alike (ms SD), as common-mode timing noise.
  var beatTimes: [Double]? = nil
  var jitter = 0.0
  var dropProbability = 0.0
  var breathingPerMin = 15.0
  var chestAmp = 0.004
  var chestNoise = 0.00002
  /// Breathing-locked colour modulation (all regions), relative, per channel (r,g,b),
  /// with its waveform's harmonic amplitudes.
  var breathingColour: (r: Double, g: Double, b: Double) = (0, 0, 0)
  var breathingHarmonics: [Double] = [1]
  /// Breathing waveform harmonics for the chest.
  var chestHarmonics: [Double] = [1]
  /// Multiplicative illumination per channel at elapsed seconds.
  var light: (Double) -> (r: Double, g: Double, b: Double) = { _ in (1, 1, 1) }
  /// Additive in-band coloured disturbance common to all regions (counts), at elapsed seconds.
  var common: (Double) -> (r: Double, g: Double, b: Double) = { _ in (0, 0, 0) }
  var face: (Double) -> Bool = { _ in true }
  var track: (Double) -> Int = { _ in 1 }
  var locked: (Double) -> Bool = { $0 >= 1 }
  /// Head motion: random large colour and chest jumps.
  var moving: (Double) -> Bool = { _ in false }

  func beats() -> [Double] {
    if let beatTimes { return beatTimes }
    var rng = QARandom(state: seed &* 31 &+ 5)
    var b = [-0.5]
    while b.last! < seconds + 2 {
      let interval = 60 / bpm(b.last!) + beatJitterMs / 1000 * rng.gaussian()
      b.append(b.last! + max(0.3, interval))
    }
    return b
  }

  func frames() -> [FrameRecord] {
    var rng = QARandom(state: seed)
    let beat = beats()
    var bi = 0
    let bases: [(Double, Double, Double)] = person
      ? [(180, 134, 116), (175, 127, 111), (173, 125, 109)]
      : [(150, 150, 146), (148, 148, 144), (152, 152, 148)]
    let signature = (r: 0.33 / 0.77, g: 1.0, b: 0.53 / 0.77)
    var out: [FrameRecord] = []
    var dropped = 0
    var prevChest: Double?
    var prevT = -1.0
    let n = Int(seconds * fps)
    var headOffset = (0.0, 0.0, 0.0)
    for i in 0..<n {
      let nominal = Double(i) / fps
      var e = nominal + jitter * rng.gaussian() / fps
      e = max(e, prevT + 0.05 / fps)
      if nominal > 1, dropProbability > 0, rng.unit() < dropProbability {
        dropped += 1
        continue
      }
      prevT = e
      var p = 0.0
      if person {
        while bi + 2 < beat.count, beat[bi + 1] <= e { bi += 1 }
        let phase = 2 * .pi * (e - beat[bi]) / (beat[bi + 1] - beat[bi])
        for (k, h) in harmonics.enumerated() { p += h * cos(Double(k + 1) * phase) }
      }
      let bPhase = 2 * .pi * breathingPerMin / 60 * e
      var bw = 0.0
      for (k, h) in breathingHarmonics.enumerated() { bw += h * sin(Double(k + 1) * bPhase) }
      var cw = 0.0
      for (k, h) in chestHarmonics.enumerated() { cw += h * sin(Double(k + 1) * bPhase) }
      let l = light(e)
      let c = common(e)
      let mv = moving(e)
      if mv { headOffset = (rng.gaussian() * 4, rng.gaussian() * 4, rng.gaussian() * 4) }
      let present = face(e)
      var regions: [RegionColor] = []
      for (k, base) in bases.enumerated() {
        let gain = k == 0 ? 1.0 : 0.85
        let pr = person ? pulseAmp * gain * p : 0
        let r = base.0 * l.r * (1 + breathingColour.r * bw) + pr * signature.r * base.0 / base.1 + c.r
          + noise * rng.gaussian() + (mv ? headOffset.0 : 0)
        let g = base.1 * l.g * (1 + breathingColour.g * bw) + pr * signature.g + c.g
          + noise * rng.gaussian() + (mv ? headOffset.1 : 0)
        let b = base.2 * l.b * (1 + breathingColour.b * bw) + pr * signature.b * base.2 / base.1 + c.b
          + noise * rng.gaussian() + (mv ? headOffset.2 : 0)
        regions.append(RegionColor(r: r, g: g, b: b))
      }
      var chest = person ? chestAmp * cw : 0
      chest += chestNoise * rng.gaussian()
      if mv { chest += 0.01 * rng.gaussian() }
      let motion = prevChest.map { chest - $0 }
      prevChest = chest
      out.append(
        FrameRecord(
          t: startTime + e, facePresent: present,
          forehead: present ? regions[0] : nil, leftCheek: present ? regions[1] : nil,
          rightCheek: present ? regions[2] : nil, chestMotion: motion,
          exposure: locked(e) ? .locked : .adjusting, droppedFrames: dropped,
          faceTrackId: present ? track(e) : nil))
    }
    return out
  }
}

struct QAStats {
  let result: SittingReplay.Result
  var hr: [(Double, Double)] {
    result.readings.compactMap { r in r.heartRate.value.map { (r.elapsed, $0) } }
  }
  var br: [(Double, Double)] {
    result.readings.compactMap { r in r.breathingRate.value.map { (r.elapsed, $0) } }
  }
  func line(_ label: String, truth: (Double) -> Double) -> String {
    let errs = hr.map { abs($0.1 - truth($0.0)) }
    let within5 = errs.isEmpty ? 0 : Double(errs.filter { $0 <= 5 }.count) / Double(errs.count)
    var reasons: [String: Int] = [:]
    for r in result.readings { if let x = r.heartRate.reason { reasons[x.rawValue, default: 0] += 1 } }
    return "QA: \(label): valid \(hr.count)/\(result.readings.count) worst \(String(format: "%.1f", errs.max() ?? -1)) within5 \(String(format: "%.2f", within5)) first \(result.summary.timeToFirstReadingSeconds.map { String($0) } ?? "nil") values \(Set(hr.map { Int($0.1.rounded()) }).sorted()) reasons \(reasons)"
  }
}

func qa(_ scene: QAScene, _ change: (inout EngineConfiguration) -> Void = { _ in }) -> QAStats {
  var c = EngineConfiguration()
  change(&c)
  return QAStats(result: SittingReplay.run(scene.frames(), configuration: c))
}

func qaScene(_ change: (inout QAScene) -> Void) -> QAScene {
  var s = QAScene()
  change(&s)
  return s
}

@Suite struct QAHarmonics {
  // Req 6: harmonics only as tie-break. A strong second harmonic (dicrotic pulse shape) with a
  // weak fundamental is a real waveform; the requirement says the engine must not show a
  // confident wrong number.
  @Test(arguments: [0.8, 1.2, 1.6, 2.5])
  func strongSecondHarmonic(ratio: Double) {
    let s = qa(qaScene { $0.bpm = { _ in 62 }; $0.harmonics = [1, ratio] })
    print(s.line("harmonic ratio \(ratio) at 62 bpm", truth: { _ in 62 }))
    let wrong = s.hr.filter { abs($0.1 - 62) > 5 }
    #expect(wrong.isEmpty, "harmonic \(ratio): \(wrong.count) readings off by >5 bpm, e.g. \(wrong.first?.1 ?? 0)")
  }

  // A rate below the search band whose harmonic is inside it: the honest answer is no reading.
  @Test(arguments: [36.0, 38.0, 40.0])
  func bradycardiaBelowBandWithHarmonic(bpm: Double) {
    let s = qa(qaScene { $0.bpm = { _ in bpm }; $0.harmonics = [1, 0.5] })
    print(s.line("\(bpm) bpm harmonic 0.5", truth: { _ in bpm }))
    #expect(s.hr.allSatisfy { abs($0.1 - bpm) <= 5 }, "\(bpm) bpm shown as \(Set(s.hr.map { Int($0.1) }))")
  }
}

@Suite struct QABandEdges {
  @Test(arguments: [44.5, 46.0, 48.0, 175.0, 177.5])
  func insideTheBandNearEdges(bpm: Double) {
    let s = qa(qaScene { $0.bpm = { _ in bpm }; $0.harmonics = [1, 0.25] })
    print(s.line("edge \(bpm)", truth: { _ in bpm }))
    #expect(s.hr.allSatisfy { abs($0.1 - bpm) <= 5 })
    #expect(s.hr.count >= 30, "\(bpm): only \(s.hr.count) readings")
  }

  @Test(arguments: [41.0, 43.0, 179.0, 182.0, 190.0])
  func atOrBeyondEdge(bpm: Double) {
    let s = qa(qaScene { $0.bpm = { _ in bpm }; $0.harmonics = [1] })
    print(s.line("beyond edge \(bpm)", truth: { _ in bpm }))
    #expect(s.hr.allSatisfy { abs($0.1 - bpm) <= 5 }, "\(bpm): wrong values \(Set(s.hr.map { Int($0.1) }))")
  }
}

@Suite struct QARateChanges {
  @Test func suddenStepUpIsTrackedWithin20s() {
    let s = qa(qaScene { $0.seconds = 70; $0.bpm = { $0 < 30 ? 68 : 125 } })
    print(s.line("step 68->125 at 30", truth: { $0 < 30 ? 68 : 125 }))
    let firstNew = s.hr.first { $0.0 > 30 && abs($0.1 - 125) <= 5 }?.0 ?? .infinity
    #expect(firstNew <= 50, "first reading at new rate at \(firstNew)")
    // After the first new reading nothing near the old value.
    #expect(s.hr.filter { $0.0 >= firstNew }.allSatisfy { abs($0.1 - 125) <= 5 })
    // Nothing in between the two rates (no blend).
    #expect(s.hr.allSatisfy { abs($0.1 - 68) <= 5 || abs($0.1 - 125) <= 5 })
  }

  @Test func suddenStepDown() {
    let s = qa(qaScene { $0.seconds = 70; $0.bpm = { $0 < 30 ? 120 : 75 } })
    print(s.line("step 120->75 at 30", truth: { $0 < 30 ? 120 : 75 }))
    let firstNew = s.hr.first { $0.0 > 30 && abs($0.1 - 75) <= 5 }?.0 ?? .infinity
    #expect(firstNew <= 50)
    #expect(s.hr.filter { $0.0 > 45 }.allSatisfy { abs($0.1 - 75) <= 5 })
  }

  @Test func slowRampIsFollowedNotHeld() {
    // 70 to 110 over 40 s: 1 bpm/s.
    let truth: (Double) -> Double = { min(110, max(70, 70 + ($0 - 10))) }
    let s = qa(qaScene { $0.seconds = 70; $0.bpm = truth })
    print(s.line("ramp 70->110 over 10..50", truth: truth))
    // The window is up to 10 s long, so the centre lags by up to ~5 s; allow that lag.
    let lagged = s.hr.filter { abs($0.1 - truth($0.0 - 5)) > 6 }
    #expect(lagged.isEmpty, "readings off the ramp (5 s lag allowed): \(lagged.map { "\(Int($0.0))s:\(Int($0.1))" })")
    #expect(s.hr.filter { $0.0 > 15 && $0.0 < 50 }.count >= 15, "ramp coverage \(s.hr.filter { $0.0 > 15 && $0.0 < 50 }.count)")
  }
}

@Suite struct QAMotionAndLight {
  @Test func shortMotionBurstRejectsTheWholeWindow() {
    // 0.7 s is 7% of a 10 s window, over the 5% motion share.
    let s = qa(qaScene { $0.moving = { $0 >= 30 && $0 < 30.7 } })
    print(s.line("motion 30-30.7", truth: { _ in 72 }))
    // Window up to 10 s: seconds 31..39 contain the burst.
    let inside = s.result.readings.filter { $0.elapsed >= 31 && $0.elapsed <= 39 }
    #expect(inside.allSatisfy { $0.heartRate.value == nil })
    #expect(s.hr.allSatisfy { abs($0.1 - 72) <= 3 })
  }

  @Test(arguments: [0.015, 0.03, 0.08])
  func whiteIlluminationStep(size: Double) {
    let s = qa(qaScene { $0.light = { $0 < 30 ? (1, 1, 1) : (1 + size, 1 + size, 1 + size) } })
    print(s.line("white light step \(size)", truth: { _ in 72 }))
    #expect(s.hr.allSatisfy { abs($0.1 - 72) <= 3 })
  }

  @Test(arguments: [0.005, 0.01, 0.02])
  func colouredIlluminationStep(size: Double) {
    // A warm lamp switched on: red up, blue down, below the 2% motion trigger on brightness.
    let s = qa(qaScene { $0.light = { $0 < 30 ? (1, 1, 1) : (1 + size, 1, 1 - size) } })
    print(s.line("coloured light step \(size)", truth: { _ in 72 }))
    #expect(s.hr.allSatisfy { abs($0.1 - 72) <= 3 }, "wrong values \(Set(s.hr.map { Int($0.1) }))")
  }

  @Test func repeatedColouredLightStepsDoNotMakeANumber() {
    // A screen or sign changing colour every 0.8 s (75 bpm square wave), on a wall.
    let s = qa(qaScene {
      $0.person = false
      $0.light = { t in Int(t / 0.4) % 2 == 0 ? (1.004, 1, 0.996) : (0.996, 1, 1.004) }
    })
    print(s.line("wall + coloured 1.25 Hz light", truth: { _ in 0 }))
    let share = Double(s.hr.count) / Double(s.result.readings.count)
    print("QA: coloured light square wave on wall share \(share)")
    #expect(share < 0.05)
  }
}

@Suite struct QAFrames {
  @Test(arguments: [30.0, 60.0])
  func dropsAndJitter(fps: Double) {
    let s = qa(qaScene { $0.fps = fps; $0.dropProbability = 0.1; $0.jitter = 0.3; $0.bpm = { _ in 95 } })
    print(s.line("drops 10% jitter 0.3 at \(fps)", truth: { _ in 95 }))
    #expect(s.hr.allSatisfy { abs($0.1 - 95) <= 3 })
    #expect(s.hr.count >= 35)
  }

  @Test func burstyDropsBelowGapLimit() {
    // 0.2 s holes every 2 s: each under the 0.25 s gap limit, 10% of frames.
    let frames = qaScene { $0.bpm = { _ in 80 } }.frames().filter {
      let e = $0.t - 5000
      return e < 2 || e.truncatingRemainder(dividingBy: 2) > 0.2
    }
    let r = QAStats(result: SittingReplay.run(frames))
    print(r.line("bursty 0.2 s holes", truth: { _ in 80 }))
    #expect(r.hr.allSatisfy { abs($0.1 - 80) <= 3 })
  }

  @Test func frameRateCollapseIsRejected() {
    // 60 fps for 25 s, then 12 fps.
    let all = QAScene().frames()
    var k = 0
    let frames = all.filter { f in
      if f.t - 5000 < 25 { return true }
      k += 1
      return k % 5 == 0
    }
    let r = QAStats(result: SittingReplay.run(frames))
    print(r.line("fps collapse at 25", truth: { _ in 72 }))
    #expect(r.result.readings.filter { $0.elapsed >= 36 }.allSatisfy { $0.heartRate.value == nil })
  }
}

@Suite struct QAFaceTrack {
  @Test func trackChangeMidSittingNoFaceLoss() {
    let s = qa(qaScene {
      $0.seconds = 70
      $0.bpm = { $0 < 35 ? 64 : 104 }
      $0.track = { $0 < 35 ? 3 : 4 }
    })
    print(s.line("track change at 35, 64->104", truth: { $0 < 35 ? 64 : 104 }))
    let after = s.result.readings.filter { $0.elapsed >= 35 && $0.elapsed < 42 }
    #expect(after.allSatisfy { $0.heartRate.value == nil })
    #expect(s.hr.filter { $0.0 >= 35 }.allSatisfy { abs($0.1 - 104) <= 5 })
    #expect(s.result.readings.first { $0.elapsed == 36 }?.breathingRate.value == nil)
  }

  @Test func firstReadingNeedsThreeWindows() {
    // Lock at 1 s; minimum window 6 s; three windows => no earlier than 1 + 6 + 2 = 9 s.
    let s = qa(QAScene())
    print(s.line("baseline", truth: { _ in 72 }))
    #expect((s.result.summary.timeToFirstReadingSeconds ?? 0) >= 9)
    let one = qa(QAScene()) { $0.agreeingWindows = 1 }
    #expect(
      (one.result.summary.timeToFirstReadingSeconds ?? 0) + 2 == s.result.summary.timeToFirstReadingSeconds)
  }

  @Test func alternatingHarmonicNeverAgrees() {
    // Waveform shape flips each 3 s between fundamental-dominant and harmonic-dominant.
    let a = qaScene { $0.harmonics = [1, 0.1] }.frames()
    let b = qaScene { $0.harmonics = [0.25, 1] }.frames()
    let frames = zip(a, b).map { fa, fb in Int((fa.t - 5000) / 3) % 2 == 0 ? fa : fb }
    let r = QAStats(result: SittingReplay.run(frames))
    print(r.line("alternating shape", truth: { _ in 72 }))
    #expect(r.hr.allSatisfy { abs($0.1 - 72) <= 5 })
  }
}

@Suite struct QANegativeControls {
  func share(_ change: @escaping (inout QAScene) -> Void, seeds: ClosedRange<UInt64> = 1...10) -> (Double, Double) {
    var n = 0, h = 0, b = 0
    for seed in seeds {
      let s = qa(qaScene { $0.seed = seed; change(&$0) })
      n += s.result.readings.count
      h += s.hr.count
      b += s.br.count
    }
    return (Double(h) / Double(n), Double(b) / Double(n))
  }

  @Test func staticWallExactlyConstant() {
    let r = share({ $0.person = false; $0.noise = 0 })
    print("QA: constant wall share \(r)")
    #expect(r.0 < 0.05)
  }

  @Test(arguments: [0.05, 0.5, 3.0])
  func whiteNoiseOnly(noise: Double) {
    let r = share({ $0.person = false; $0.noise = noise; $0.chestAmp = 0 })
    print("QA: white noise \(noise) share hr \(r.0) br \(r.1)")
    #expect(r.0 < 0.05)
    #expect(r.1 < 0.05)
  }

  @Test(arguments: [0.002, 0.01])
  func colouredRandomWalkLight(step: Double) {
    // Independent random-walk drift per channel (auto white balance creeping, cloud cover).
    let r = share({ s in
      s.person = false
      s.noise = 0.2
      var rng = QARandom(state: s.seed &+ 99)
      var walk = (0.0, 0.0, 0.0)
      var cache: [Int: (Double, Double, Double)] = [:]
      s.light = { t in
        let k = Int(t * 60)
        if let v = cache[k] { return (1 + v.0, 1 + v.1, 1 + v.2) }
        walk = (walk.0 + step / 60 * rng.gaussian(), walk.1 + step / 60 * rng.gaussian(), walk.2 + step / 60 * rng.gaussian())
        cache[k] = walk
        return (1 + walk.0, 1 + walk.1, 1 + walk.2)
      }
    })
    print("QA: coloured random-walk light \(step) share hr \(r.0) br \(r.1)")
    #expect(r.0 < 0.05)
  }

  @Test(arguments: [(120.0, 59.94), (120.0, 29.97), (100.0, 60.0), (100.0, 29.0)])
  func colouredFlickerAliasOnWall(hz: Double, fps: Double) {
    // Mains flicker with a colour component (sodium/fluorescent phosphors are not grey).
    let r = share({ s in
      s.person = false
      s.fps = fps
      s.light = { t in
        let f = sin(2 * .pi * hz * t)
        return (1 + 0.01 * f, 1 + 0.006 * f, 1 + 0.002 * f)
      }
    }, seeds: 1...4)
    print("QA: coloured flicker \(hz) Hz at \(fps) fps share hr \(r.0)")
    #expect(r.0 < 0.05, "coloured flicker \(hz)Hz @ \(fps)fps shows HR in \(Int(r.0 * 100))% of windows")
  }
}

@Suite struct QALowAmplitude {
  @Test(arguments: [0.02, 0.05, 0.1, 0.15])
  func faintPulseIsBlankOrRight(amp: Double) {
    var all: [(Double, Double)] = []
    var n = 0
    for seed in UInt64(1)...6 {
      let s = qa(qaScene { $0.pulseAmp = amp; $0.noise = 0.3; $0.seed = seed; $0.bpm = { _ in 78 } })
      all += s.hr
      n += s.result.readings.count
    }
    let wrong = all.filter { abs($0.1 - 78) > 5 }
    print("QA: faint amp \(amp): valid \(all.count)/\(n) wrong \(wrong.count) \(wrong.prefix(5).map { Int($0.1) })")
    #expect(wrong.count <= max(1, all.count / 20))
  }
}

@Suite struct QABreathing {
  @Test func breathingHarmonicInPulseBandWithFaintPulse() {
    // Breathing at 36/min (0.6 Hz) with a non-sinusoidal colour modulation; its 2nd harmonic
    // sits at 72 "bpm". The real pulse is 100 bpm and faint.
    let s = qa(qaScene {
      $0.bpm = { _ in 100 }
      $0.pulseAmp = 0.2
      $0.breathingPerMin = 36
      $0.breathingColour = (0.0015, 0.004, 0.001)
      $0.breathingHarmonics = [1, 0.8, 0.4]
    })
    print(s.line("breathing 36/min colour harmonics, HR 100", truth: { _ in 100 }))
    #expect(s.hr.allSatisfy { abs($0.1 - 100) <= 5 }, "wrong values \(Set(s.hr.map { Int($0.1) }))")
  }

  @Test(arguments: [8.0, 12.0])
  func asymmetricBreathingReportsFundamental(rate: Double) {
    // Quick inhale, slow exhale: strong harmonics in chest motion.
    let s = qa(qaScene { $0.breathingPerMin = rate; $0.chestHarmonics = [1, 0.7, 0.45] })
    let values = s.br.map(\.1)
    print("QA: asymmetric breathing \(rate): \(values.count) valid, values \(Set(values.map { Int($0.rounded()) }).sorted()), summary \(s.result.summary.breathingRate)")
    #expect(values.allSatisfy { abs($0 - rate) <= 2 })
  }

  @Test(arguments: [10.0, 20.0, 28.0, 34.0])
  func breathingAccuracy(rate: Double) {
    let s = qa(qaScene { $0.breathingPerMin = rate; $0.seconds = 70 })
    let values = s.br.map(\.1)
    print("QA: breathing \(rate): \(values.count) valid, values \(Set(values.map { Int($0.rounded()) }).sorted()) summary \(s.result.summary.breathingRate.value ?? -1)")
    #expect(values.allSatisfy { abs($0 - rate) <= 2 })
    #expect(values.count >= 10)
  }

  @Test func noBreathingButNoisyChest() {
    let s = qa(qaScene { $0.chestAmp = 0; $0.chestNoise = 0.0003 })
    print("QA: chest noise only: \(s.br.count) valid breathing readings, values \(Set(s.br.map { Int($0.1) }))")
    #expect(s.br.count <= 3)
  }

  @Test func breathingRestartsOnFaceChange() {
    let s = qa(qaScene { $0.seconds = 90; $0.track = { $0 < 50 ? 1 : 2 } })
    let after = s.result.readings.filter { $0.elapsed >= 50 && $0.elapsed < 89 }
    #expect(after.allSatisfy { $0.breathingRate.value == nil })
  }
}

@Suite struct QAVariability {
  // Truth from the scene's own beats over the summarised stretch.
  func truth(_ beats: [Double], from: Double, to: Double) -> (rmssd: Double, sdnn: Double) {
    let b = beats.filter { $0 >= from && $0 <= to }
    let iv = zip(b, b.dropFirst()).map { ($1 - $0) * 1000 }
    let d = zip(iv, iv.dropFirst()).map { $1 - $0 }
    let rm = (d.reduce(0) { $0 + $1 * $1 } / Double(d.count)).squareRoot()
    let mean = iv.reduce(0, +) / Double(iv.count)
    let sd = (iv.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(iv.count - 1)).squareRoot()
    return (rm, sd)
  }

  @Test(arguments: [0.05, 0.1, 0.2, 0.3])
  func reportedOnlyWhenRight(noise: Double) {
    let scene = qaScene { $0.beatJitterMs = 30; $0.noise = noise; $0.pulseAmp = 0.5 }
    let s = qa(scene)
    let t = truth(scene.beats(), from: 2, to: 60)
    let m = s.result.summary
    print("QA: HRV noise \(noise): rmssd \(m.rmssd.value ?? -1) (true \(t.rmssd)) sdnn \(m.sdnn.value ?? -1) (true \(t.sdnn)) reason \(m.rmssd.reason ?? "-") cov \(m.rmssd.coverage)")
    if let r = m.rmssd.value { #expect(abs(r - t.rmssd) <= 0.2 * t.rmssd, "RMSSD \(r) vs \(t.rmssd)") }
    if let d = m.sdnn.value { #expect(abs(d - t.sdnn) <= 0.2 * t.sdnn, "SDNN \(d) vs \(t.sdnn)") }
  }

  @Test(arguments: [0.4, 0.8])
  func commonModeInBandNoiseIsNotReportedAsVariability(level: Double) {
    // Coloured in-band disturbance shared by every region (a flickering screen nearby):
    // forehead and cheeks agree with each other, but both are wrong.
    var rng = QARandom(state: 4242)
    var cache: [Int: Double] = [:]
    var x = 0.0, y = 0.0
    let scene = qaScene {
      $0.beatJitterMs = 0
      $0.noise = 0.05
      $0.pulseAmp = 0.5
      $0.common = { t in
        let k = Int(t * 60)
        if cache[k] == nil {
          // Band-limited noise around 1-2 Hz via a resonant second-order filter.
          let w = 2 * Double.pi * 1.3 / 60
          let nx = 2 * 0.97 * cos(w) * x - 0.97 * 0.97 * y + 0.06 * rng.gaussian()
          y = x
          x = nx
          cache[k] = nx
        }
        let v = level * cache[k]!
        return (0.6 * v, -0.2 * v, 0.9 * v)
      }
    }
    let s = qa(scene)
    let t = truth(scene.beats(), from: 2, to: 60)
    let m = s.result.summary
    print("QA: common-mode \(level): hr \(m.heartRate.value ?? -1) cov \(m.heartRate.coverage) rmssd \(m.rmssd.value ?? -1) (true \(t.rmssd)) sdnn \(m.sdnn.value ?? -1) (true \(t.sdnn)) reason \(m.rmssd.reason ?? "-")")
    if let r = m.rmssd.value { #expect(abs(r - t.rmssd) <= 10, "RMSSD \(r) vs \(t.rmssd)") }
  }

  @Test func ectopicBeatsAreRejected() {
    // Steady 70 bpm with a premature beat every 12 beats (short then compensatory long).
    var beats: [Double] = [-0.5]
    var i = 0
    while beats.last! < 62 {
      i += 1
      let base = 60.0 / 70
      let interval = i % 12 == 0 ? base * 0.6 : (i % 12 == 1 ? base * 1.4 : base + 0.02 * sin(Double(i)))
      beats.append(beats.last! + interval)
    }
    let scene = qaScene { $0.beatTimes = beats; $0.noise = 0.05; $0.pulseAmp = 0.6 }
    let s = qa(scene)
    let m = s.result.summary
    // Normal-to-normal truth: drop the ectopic pair.
    print("QA: ectopic: hr \(m.heartRate.value ?? -1) rmssd \(m.rmssd.value ?? -1) sdnn \(m.sdnn.value ?? -1) reason \(m.rmssd.reason ?? "-") intervals \(m.beatIntervals.count)")
    let shortOnes = m.beatIntervals.filter { $0.ms < 600 }
    #expect(shortOnes.isEmpty, "ectopic short intervals accepted: \(shortOnes.count)")
  }

  @Test func withheldOnFaceLossHeavySitting() {
    let s = qa(qaScene { $0.beatJitterMs = 30; $0.face = { !($0 > 15 && $0 < 45) }; $0.track = { $0 < 30 ? 1 : 2 } })
    let m = s.result.summary
    print("QA: HRV with 30 s face loss: rmssd \(m.rmssd.value ?? -1) reason \(m.rmssd.reason ?? "-") cov \(m.rmssd.coverage)")
    #expect(m.rmssd.value == nil)
    #expect(m.rmssd.reason != nil)
  }
}

@Suite struct QAReadingInvariants {
  @Test func noValueWithoutValidAndReasonAlways() {
    let scenes: [QAScene] = [
      qaScene { $0.moving = { $0 > 20 && $0 < 22 }; $0.face = { !($0 > 40 && $0 < 43) }; $0.track = { $0 < 41 ? 1 : 2 } },
      qaScene { $0.person = false; $0.noise = 1 },
      qaScene { $0.locked = { !($0 < 1 || ($0 > 30 && $0 < 31)) } },
    ]
    for scene in scenes {
      for r in qa(scene).result.readings {
        for e in [r.heartRate, r.breathingRate] {
          #expect((e.state == .valid) == (e.value != nil))
          #expect((e.state == .valid) == (e.reason == nil))
        }
      }
    }
  }

  @Test func faceCoverBlanksWithin2s() {
    let frames = QAScene().frames()
    let engine = SignalEngine()
    for f in frames where f.t < 5030 { engine.ingest(f) }
    #expect(engine.reading().heartRate.value != nil)
    for f in frames where f.t >= 5030 && f.t < 5030.05 {
      var g = f
      g.facePresent = false
      g.forehead = nil; g.leftCheek = nil; g.rightCheek = nil; g.faceTrackId = nil
      engine.ingest(g)
    }
    #expect(engine.reading().heartRate.value == nil)
    #expect(engine.reading().heartRate.reason == .noFace)
  }

  @Test func faceCoveredButTrackerStillReportsFace() {
    // Hand over the face: tracker keeps a face but region colours become hand skin with no pulse
    // and a large step. The engine must not show a number from the hand for long.
    let base = qaScene { $0.seconds = 60 }.frames()
    let frames = recolour(base) { t, _, c in
      if t - 5000 >= 30 && t - 5000 < 45 {
        // Replace with a static colour plus noise: no pulse.
        c = RegionColor(r: 200 + (c.r - 180) * 0.0, g: 150, b: 130)
      }
    }
    let r = QAStats(result: SittingReplay.run(frames))
    print(r.line("hand cover 30-45 with face reported", truth: { _ in 72 }))
    let during = r.result.readings.filter { $0.elapsed >= 32 && $0.elapsed < 45 }
    #expect(during.allSatisfy { $0.heartRate.value == nil })
  }
}

@Suite struct QALongSitting {
  @Test func tenMinuteSittingFinishes() {
    let scene = qaScene { $0.seconds = 660; $0.beatJitterMs = 25; $0.noise = 0.05; $0.pulseAmp = 0.6 }
    let start = Date()
    let s = qa(scene)
    let m = s.result.summary
    print("QA: 660 s sitting: replay \(Date().timeIntervalSince(start)) s, hr \(m.heartRate.value ?? -1) cov \(m.heartRate.coverage) rmssd \(m.rmssd.value ?? -1) reason \(m.rmssd.reason ?? "-") intervals \(m.beatIntervals.count) first tMs \(m.beatIntervals.first?.tMs ?? -1)")
    #expect(m.beatIntervals.count <= 600)
    #expect(abs((m.heartRate.value ?? 0) - 72) <= 2)
    #expect(m.beatIntervals.allSatisfy { $0.tMs >= 0 && $0.tMs <= 660_000 })
  }
}

@Suite struct QADiagnostics {
  @Test func stepTimeline() {
    let s = qa(qaScene { $0.seconds = 70; $0.bpm = { $0 < 30 ? 68 : 125 } })
    let line = s.result.readings.filter { $0.elapsed >= 28 && $0.elapsed <= 50 }.map {
      "\(Int($0.elapsed)):\($0.heartRate.value.map { String(Int($0.rounded())) } ?? ($0.heartRate.reason?.rawValue ?? "?"))"
    }
    print("QA: step timeline \(line.joined(separator: " "))")
  }

  @Test(arguments: [0.3, 0.4])
  func bradycardiaHarmonicSweep(h: Double) {
    for bpm in [30.0, 32, 34, 36, 38, 39, 40, 41] {
      var n = 0, wrong = 0
      for seed in UInt64(1)...3 {
        let s = qa(qaScene { $0.seed = seed; $0.bpm = { _ in bpm }; $0.harmonics = [1, h] })
        n += s.result.readings.count
        wrong += s.hr.filter { abs($0.1 - bpm) > 5 }.count
      }
      print("QA: brady \(bpm) harmonic \(h): wrong confident readings \(wrong)/\(n)")
    }
  }

  @Test func harmonicRatioThreshold() {
    for ratio in [0.9, 1.0, 1.05, 1.1, 1.15] {
      let s = qa(qaScene { $0.bpm = { _ in 62 }; $0.harmonics = [1, ratio] })
      print("QA: harmonic amp ratio \(ratio): readings \(s.hr.count), values \(Set(s.hr.map { Int($0.1.rounded()) }).sorted())")
    }
  }

  @Test func breathingHarmonicSweep() {
    for (rate, colour) in [(36.0, 0.001), (36.0, 0.002), (30.0, 0.002), (24.0, 0.002), (20.0, 0.003)] {
      let s = qa(qaScene {
        $0.bpm = { _ in 100 }
        $0.pulseAmp = 0.4
        $0.breathingPerMin = rate
        $0.breathingColour = (colour * 0.4, colour, colour * 0.25)
        $0.breathingHarmonics = [1, 0.5, 0.3]
      })
      print("QA: breathing \(rate)/min colour \(colour) (2nd harmonic \(String(format: "%.2f", 134 * colour * 0.5)) counts vs pulse 0.4): values \(Set(s.hr.map { Int($0.1.rounded()) }).sorted()) valid \(s.hr.count)")
    }
  }

  @Test func chestNoiseSweep() {
    for noise in [0.00005, 0.0001, 0.0002, 0.0003] {
      var n = 0, valid = 0
      var values = Set<Int>()
      var realWrong = 0, realValid = 0
      for seed in UInt64(1)...5 {
        let s = qa(qaScene { $0.seed = seed; $0.chestAmp = 0; $0.chestNoise = noise })
        n += s.result.readings.count
        valid += s.br.count
        values.formUnion(s.br.map { Int($0.1.rounded()) })
        let r = qa(qaScene { $0.seed = seed; $0.chestNoise = noise; $0.breathingPerMin = 16 })
        realValid += r.br.count
        realWrong += r.br.filter { abs($0.1 - 16) > 2 }.count
      }
      print("QA: chest noise \(noise) (\(String(format: "%.2f", noise * 1080)) px/frame at 1080p): no-breath valid \(valid)/\(n) values \(values.sorted()); real 16/min valid \(realValid) wrong \(realWrong)")
    }
  }

  @Test func colouredFlickerInBandAlias() {
    for (hz, fps) in [(120.0, 59.3), (100.0, 49.4), (120.0, 59.0)] {
      var n = 0, h = 0
      var values = Set<Int>()
      for seed in UInt64(1)...4 {
        let s = qa(qaScene { sc in
          sc.seed = seed
          sc.person = false
          sc.fps = fps
          sc.light = { t in let f = sin(2 * .pi * hz * t); return (1 + 0.01 * f, 1 + 0.006 * f, 1 + 0.002 * f) }
        })
        n += s.result.readings.count
        h += s.hr.count
        values.formUnion(s.hr.map { Int($0.1.rounded()) })
      }
      print("QA: coloured flicker \(hz) Hz @ \(fps) fps on wall: \(h)/\(n) windows with HR, values \(values.sorted())")
    }
  }

  @Test func colouredSquareWaveSeeds() {
    var n = 0, h = 0
    for seed in UInt64(1)...8 {
      let s = qa(qaScene {
        $0.seed = seed
        $0.person = false
        $0.light = { t in Int(t / 0.4) % 2 == 0 ? (1.004, 1, 0.996) : (0.996, 1, 1.004) }
      })
      n += s.result.readings.count
      h += s.hr.count
    }
    print("QA: coloured 1.25 Hz square wave on wall: \(h)/\(n)")
  }

  @Test func hrvUnguarded() {
    for (noise, h) in [(0.0, [1.0]), (0.05, [1.0, 0.3]), (0.2, [1.0, 0.3])] {
      let scene = qaScene { $0.beatJitterMs = 30; $0.noise = noise; $0.pulseAmp = 0.5; $0.harmonics = h }
      let guarded = qa(scene).result.summary
      let open = qa(scene) { $0.maximumBeatDisagreementMs = 1e9 }.result.summary
      let t = QAVariability().truth(scene.beats(), from: 2, to: 60)
      print("QA: HRV noise \(noise) harm \(h): guarded \(guarded.rmssd.value ?? -1) \(guarded.rmssd.reason ?? "-"); unguarded rmssd \(open.rmssd.value ?? -1) sdnn \(open.sdnn.value ?? -1); true rmssd \(t.rmssd) sdnn \(t.sdnn)")
    }
  }

  @Test func ectopicDetail() {
    var beats: [Double] = [-0.5]
    var i = 0
    var nn: [Double] = []
    while beats.last! < 62 {
      i += 1
      let base = 60.0 / 70
      let ect = i % 12 == 0 || i % 12 == 1
      let interval = i % 12 == 0 ? base * 0.6 : (i % 12 == 1 ? base * 1.4 : base + 0.02 * sin(Double(i)))
      beats.append(beats.last! + interval)
      if !ect && beats.last! > 2 { nn.append(interval * 1000) }
    }
    let d = zip(nn, nn.dropFirst()).map { $1 - $0 }
    let rm = (d.reduce(0) { $0 + $1 * $1 } / Double(d.count)).squareRoot()
    let s = qa(qaScene { $0.beatTimes = beats; $0.noise = 0.05; $0.pulseAmp = 0.6 }).result.summary
    print("QA: ectopic NN-truth rmssd ~\(rm) (upper bound, includes pairs across ectopics); engine rmssd \(s.rmssd.value ?? -1) sdnn \(s.sdnn.value ?? -1)")
    print("QA: ectopic engine intervals \(s.beatIntervals.prefix(40).map { Int($0.ms) })")
  }
}

@Suite struct QAHRVDetail {
  @Test func perIntervalAccuracy() {
    for (noise, h, jit) in [(0.0, [1.0], 30.0), (0.0, [1.0, 0.2], 30.0), (0.0, [1.0, 0.2], 15.0), (0.05, [1.0, 0.2], 30.0), (0.0, [1.0, 0.2], 50.0)] {
      for seed in UInt64(1)...3 {
        let scene = qaScene { $0.seed = seed; $0.beatJitterMs = jit; $0.noise = noise; $0.pulseAmp = 0.5; $0.harmonics = h }
        let m = qa(scene).result.summary
        let open = qa(scene) { $0.maximumBeatDisagreementMs = 1e9 }.result.summary
        let beats = scene.beats()
        // Match each reported interval to the true interval ending nearest its tMs.
        var errs: [Double] = []
        var trueMatched: [Double] = []
        for iv in open.beatIntervals {
          let end = iv.tMs / 1000
          guard let k = beats.indices.dropFirst().min(by: { abs(beats[$0] - end) < abs(beats[$1] - end) }) else { continue }
          let tr = (beats[k] - beats[k - 1]) * 1000
          errs.append(iv.ms - tr)
          trueMatched.append(tr)
        }
        let rmsErr = (errs.reduce(0) { $0 + $1 * $1 } / Double(max(1, errs.count))).squareRoot()
        let dT = zip(trueMatched, trueMatched.dropFirst()).map { $1 - $0 }
        let trueR = (dT.reduce(0) { $0 + $1 * $1 } / Double(max(1, dT.count))).squareRoot()
        print("QA: HRV seed \(seed) noise \(noise) harm \(h) jitter \(jit): reported \(m.rmssd.value.map { String(format: "%.1f", $0) } ?? "withheld(\(m.rmssd.reason ?? ""))"), unguarded \(String(format: "%.1f", open.rmssd.value ?? -1)), true over matched \(String(format: "%.1f", trueR)); per-interval RMS error \(String(format: "%.1f", rmsErr)) ms over \(errs.count)")
      }
    }
  }

  @Test func buildGeneratorComparison() {
    for dev in [15.0, 30.0] {
      var s = SyntheticSitting()
      s.beatIntervalDeviationMs = dev
      s.noise = 0.0
      s.illuminationDrift = 0
      let m = SittingReplay.run(s.frames()).summary
      let b = s.beatTimes().filter { $0 > 2 && $0 < 60 }
      let iv = zip(b, b.dropFirst()).map { ($1 - $0) * 1000 }
      let d = zip(iv, iv.dropFirst()).map { $1 - $0 }
      let tr = (d.reduce(0) { $0 + $1 * $1 } / Double(d.count)).squareRoot()
      print("QA: build generator dev \(dev) noise 0: rmssd \(m.rmssd.value ?? -1) reason \(m.rmssd.reason ?? "-") true \(tr)")
    }
  }
}

@Suite struct QARobustness {
  @Test func nanColourDoesNotProduceAReadingOrCrash() {
    let frames = QAScene().frames().map { f -> FrameRecord in
      var f = f
      if f.t - 5000 > 30 && f.t - 5000 < 30.1 { f.forehead?.g = .nan }
      return f
    }
    let r = SittingReplay.run(frames)
    let after = r.readings.filter { $0.elapsed > 30 }
    print("QA: NaN forehead at 30 s: later values \(Set(after.compactMap { $0.heartRate.value.map { $0.isNaN ? -1 : Int($0) } })) reasons \(Set(after.compactMap { $0.heartRate.reason?.rawValue })) summary \(r.summary.heartRate.value ?? -2)")
    #expect(after.allSatisfy { $0.heartRate.value.map { !$0.isNaN } ?? true })
    #expect(r.summary.heartRate.value.map { !$0.isNaN } ?? true)
  }

  @Test func infiniteChestMotion() {
    let frames = QAScene().frames().map { f -> FrameRecord in
      var f = f
      if f.t - 5000 > 30 && f.t - 5000 < 30.02 { f.chestMotion = .infinity }
      return f
    }
    let r = SittingReplay.run(frames)
    print("QA: inf chest motion: breathing values \(Set(r.readings.compactMap { $0.breathingRate.value.map { $0.isFinite ? Int($0) : -1 } })) summary \(r.summary.breathingRate.value ?? -2)")
    #expect(r.readings.allSatisfy { $0.breathingRate.value.map(\.isFinite) ?? true })
  }

  @Test func blackFrames() {
    let frames = QAScene().frames().map { f -> FrameRecord in
      var f = f
      if f.t - 5000 > 30 { f.forehead = .init(r: 0, g: 0, b: 0); f.leftCheek = .init(r: 0, g: 0, b: 0); f.rightCheek = .init(r: 0, g: 0, b: 0) }
      return f
    }
    let r = SittingReplay.run(frames)
    let late = r.readings.filter { $0.elapsed > 41 }
    print("QA: black frames reasons \(Set(late.compactMap { $0.heartRate.reason?.rawValue }))")
    #expect(late.allSatisfy { $0.heartRate.value == nil })
  }
}
