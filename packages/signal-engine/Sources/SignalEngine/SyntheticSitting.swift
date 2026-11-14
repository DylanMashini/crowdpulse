import Foundation

/// Generates frame records for a sitting with a known heart and breathing rate. Used by the
/// engine's tests, by `engine-cli synth`, and by the capture module's simulated source on the
/// iOS simulator, which has no camera.
///
/// The defaults describe a still person in steady light. Everything else is off until set.
public struct SyntheticSitting: Sendable, Equatable {
  /// What the camera is pointed at.
  public enum Subject: String, Sendable, Codable {
    /// Skin with a pulse and a breathing chest.
    case person
    /// A still, grey surface that the face tracker wrongly reports as a face. No pulse, no breathing.
    case wall
    /// Skin-coloured regions with no pulse and no breathing: only `noise`.
    case noise
  }

  /// A stretch of the sitting, in seconds since its first frame.
  public struct Interval: Sendable, Equatable {
    public var start: Double
    public var end: Double

    public init(start: Double, end: Double) {
      self.start = start
      self.end = end
    }

    func contains(_ elapsed: Double) -> Bool {
      elapsed >= start && elapsed < end
    }
  }

  /// A change of heart rate during the sitting.
  public struct RateChange: Sendable, Equatable {
    /// Seconds since the first frame at which the rate starts to move.
    public var atSeconds: Double
    public var toBpm: Double
    /// Length of the linear ramp to the new rate; 0 is a step.
    public var overSeconds: Double

    public init(atSeconds: Double, toBpm: Double, overSeconds: Double = 0) {
      self.atSeconds = atSeconds
      self.toBpm = toBpm
      self.overSeconds = overSeconds
    }
  }

  /// Lighting that flickers, as lamps on mains power do at twice the mains frequency. The
  /// frames sample it at their own times, so it aliases as it would in a camera.
  public struct Flicker: Sendable, Equatable {
    public var hz: Double
    /// Peak brightness change as a fraction, the same in all three channels.
    public var depth: Double

    public init(hz: Double, depth: Double) {
      self.hz = hz
      self.depth = depth
    }
  }

  public var heartRateBpm: Double = 72
  public var breathingRatePerMin: Double = 16
  public var durationSeconds: Double = 60
  public var frameRate: Double = 60
  /// Peak pulse amplitude in the green channel, in 8-bit counts.
  public var pulseAmplitude: Double = 0.35
  /// Standard deviation of per-frame sensor noise in each channel, in 8-bit counts.
  public var noise: Double = 0.25
  /// Peak chest travel as a fraction of frame height.
  public var chestAmplitude: Double = 0.004
  /// Seconds before the face is found and exposure locks.
  public var settleSeconds: Double = 2
  /// Capture-clock time of the first frame.
  public var startTime: Double = 1000
  public var seed: UInt64 = 1

  public var subject: Subject = .person
  /// Second harmonic of the pulse wave, relative to the fundamental.
  public var pulseHarmonic: Double = 0.2
  /// Standard deviation of the random beat-to-beat change in interval length, in ms.
  /// With independent intervals SDNN equals this and RMSSD is about 1.41 times it.
  public var beatIntervalDeviationMs: Double = 0
  public var heartRateChange: RateChange?
  /// Standard deviation of the per-frame chest displacement error, as a fraction of frame height.
  public var chestNoise: Double = 0.00002
  /// Peak slow brightness change over the sitting, as a fraction.
  public var illuminationDrift: Double = 0.02
  public var flicker: Flicker?
  /// Stretches in which the person moves: colour means and chest position are thrown about.
  public var motionBursts: [Interval] = []
  /// The face is lost for this stretch and comes back under the next track id.
  public var faceLoss: Interval?
  /// Chance that the camera drops any one frame.
  public var droppedFrameProbability: Double = 0
  /// A stretch in which the camera delivers no frames at all.
  public var frameGap: Interval?
  /// Standard deviation of the frame timestamp error, as a fraction of the frame interval.
  public var timestampJitter: Double = 0
  /// Track id of the face when it is first found.
  public var faceTrackId: Int = 1

  public init() {}

  /// Times of the generated heart beats, in seconds since the first frame. Empty unless the
  /// subject is a person.
  public func beatTimes() -> [Double] {
    guard subject == .person else { return [] }
    var generator = SplitMix64(state: seed ^ 0x5DEE_CE66_D1CE_4E5B)
    var beats = [-0.4]
    while let last = beats.last, last < durationSeconds + 2 {
      let interval = 60 / heartRate(at: last) + beatIntervalDeviationMs / 1000 * generator.nextGaussian()
      beats.append(last + max(0.25, interval))
    }
    return beats
  }

  private func heartRate(at elapsed: Double) -> Double {
    guard let change = heartRateChange, elapsed > change.atSeconds else { return heartRateBpm }
    guard change.overSeconds > 0 else { return change.toBpm }
    let progress = min(1, (elapsed - change.atSeconds) / change.overSeconds)
    return heartRateBpm + progress * (change.toBpm - heartRateBpm)
  }

  public func frames() -> [FrameRecord] {
    var generator = SplitMix64(state: seed)
    let beats = beatTimes()
    var beatIndex = 0
    let count = Int((durationSeconds * frameRate).rounded())
    let breathHz = breathingRatePerMin / 60
    var previousChest: Double?
    var previousTime = -Double.infinity
    var dropped = 0
    var wander = 0.0
    var frames: [FrameRecord] = []
    frames.reserveCapacity(count)

    let skin = [
      RegionColor(r: 182, g: 136, b: 118), RegionColor(r: 176, g: 128, b: 112),
      RegionColor(r: 174, g: 126, b: 110),
    ]
    let surface = [
      RegionColor(r: 151, g: 150, b: 146), RegionColor(r: 149, g: 148, b: 144),
      RegionColor(r: 153, g: 152, b: 148),
    ]
    let bases = subject == .wall ? surface : skin
    let gains = [1.0, 0.8, 0.8]

    for index in 0..<count {
      let nominal = Double(index) / frameRate
      let jittered = nominal + timestampJitter * generator.nextGaussian() / frameRate
      let elapsed = max(jittered, previousTime + 0.1 / frameRate)
      let settled = nominal >= settleSeconds

      let lost = frameGap?.contains(nominal) == true
        || (settled && droppedFrameProbability > 0 && generator.nextUnit() < droppedFrameProbability)
      if lost {
        dropped += 1
        continue
      }
      previousTime = elapsed

      var pulse = 0.0
      if subject == .person {
        while beatIndex + 2 < beats.count, beats[beatIndex + 1] <= elapsed { beatIndex += 1 }
        let phase = 2 * .pi * (elapsed - beats[beatIndex]) / (beats[beatIndex + 1] - beats[beatIndex])
        pulse = cos(phase) + pulseHarmonic * cos(2 * phase)
      }

      let moving = motionBursts.contains { $0.contains(nominal) }
      if moving { wander += 0.01 * generator.nextGaussian() } else { wander *= 0.9 }
      let shift = moving ? 0.06 * sin(2 * .pi * 1.7 * elapsed) + wander : wander

      var brightness = 1 + illuminationDrift * (0.6 * sin(2 * .pi * 0.03 * elapsed) + 0.4 * (elapsed / durationSeconds - 0.5))
      if let flicker { brightness *= 1 + flicker.depth * sin(2 * .pi * flicker.hz * elapsed) }

      var chest = subject == .person ? chestAmplitude * sin(2 * .pi * breathHz * elapsed) : 0
      chest += chestNoise * generator.nextGaussian()
      if moving { chest += 0.006 * generator.nextGaussian() }
      let motion = previousChest.map { chest - $0 }
      previousChest = chest

      func region(_ base: RegionColor, gain: Double) -> RegionColor {
        // Blood volume changes absorb green most, blue less, red least. Movement changes
        // which skin the region covers, so its colour shift is not the same in each channel.
        let amplitude = gain * pulseAmplitude * pulse
        return RegionColor(
          r: base.r * (brightness + shift) + 0.33 * amplitude + noise * generator.nextGaussian(),
          g: base.g * (brightness + 0.8 * shift) + amplitude + noise * generator.nextGaussian(),
          b: base.b * (brightness + 0.6 * shift) + 0.55 * amplitude + noise * generator.nextGaussian()
        )
      }

      let faceLost = faceLoss?.contains(nominal) == true
      let visible = settled && !faceLost
      let reacquired = faceLoss.map { nominal >= $0.end } ?? false
      frames.append(
        FrameRecord(
          t: startTime + elapsed,
          facePresent: visible,
          forehead: visible ? region(bases[0], gain: gains[0]) : nil,
          leftCheek: visible ? region(bases[1], gain: gains[1]) : nil,
          rightCheek: visible ? region(bases[2], gain: gains[2]) : nil,
          chestMotion: visible ? motion : nil,
          exposure: settled ? .locked : .adjusting,
          droppedFrames: dropped,
          faceTrackId: visible ? faceTrackId + (reacquired ? 1 : 0) : nil
        ))
    }
    return frames
  }

  public func contents(sittingId: String? = nil, startedAt: String) -> SittingFile.Contents {
    SittingFile.Contents(
      header: SittingFile.Header(
        sittingId: sittingId, source: .simulated, nominalFrameRate: frameRate,
        startedAt: startedAt, captureStart: startTime,
        note: "synthetic \(subject.rawValue): \(heartRateBpm) bpm, \(breathingRatePerMin) breaths per min"
      ),
      frames: frames()
    )
  }
}

/// Small deterministic generator so synthetic sittings are reproducible from their seed.
struct SplitMix64 {
  var state: UInt64

  mutating func next() -> UInt64 {
    state &+= 0x9E37_79B9_7F4A_7C15
    var z = state
    z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
    z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
    return z ^ (z >> 31)
  }

  mutating func nextUnit() -> Double {
    Double(next() >> 11) / Double(1 << 53)
  }

  /// Standard normal sample (Box-Muller).
  mutating func nextGaussian() -> Double {
    let u = max(nextUnit(), .leastNonzeroMagnitude)
    let v = nextUnit()
    return (-2 * log(u)).squareRoot() * cos(2 * .pi * v)
  }
}
