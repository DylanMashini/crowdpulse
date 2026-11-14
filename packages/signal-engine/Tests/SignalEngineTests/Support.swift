import Foundation

@testable import SignalEngine

func sitting(_ change: (inout SyntheticSitting) -> Void = { _ in }) -> SyntheticSitting {
  var sitting = SyntheticSitting()
  change(&sitting)
  return sitting
}

func replay(
  _ sitting: SyntheticSitting, _ change: (inout EngineConfiguration) -> Void = { _ in }
) -> SittingReplay.Result {
  replay(sitting.frames(), change)
}

func replay(
  _ frames: [FrameRecord], _ change: (inout EngineConfiguration) -> Void = { _ in }
) -> SittingReplay.Result {
  var configuration = EngineConfiguration()
  change(&configuration)
  return SittingReplay.run(frames, configuration: configuration)
}

extension SittingReplay.Result {
  /// Valid heart-rate readings as (seconds since the first frame, bpm).
  var heartRates: [(elapsed: Double, bpm: Double)] {
    readings.compactMap { reading in reading.heartRate.value.map { (reading.elapsed, $0) } }
  }

  var breathingRates: [(elapsed: Double, perMinute: Double)] {
    readings.compactMap { reading in reading.breathingRate.value.map { (reading.elapsed, $0) } }
  }

  /// The heart-rate estimate of the reading taken `seconds` after the first frame.
  func heartRate(at seconds: Int) -> Estimate {
    readings[seconds - 1].heartRate
  }

  func heartReasons(in seconds: ClosedRange<Int>) -> Set<EstimateReason> {
    Set(seconds.compactMap { heartRate(at: $0).reason })
  }
}

/// Applies `change` to the colour of every region of every frame that has a face.
func recolour(
  _ frames: [FrameRecord], _ change: (_ t: Double, _ region: Int, _ colour: inout RegionColor) -> Void
) -> [FrameRecord] {
  frames.map { frame in
    var frame = frame
    if var colour = frame.forehead { change(frame.t, 0, &colour); frame.forehead = colour }
    if var colour = frame.leftCheek { change(frame.t, 1, &colour); frame.leftCheek = colour }
    if var colour = frame.rightCheek { change(frame.t, 2, &colour); frame.rightCheek = colour }
    return frame
  }
}

/// The pattern of the sitting that gave no reading on a real phone: a person sitting still
/// whose skin regions settle at a new colour every few seconds, brighter or darker by up to
/// 15% and a few per cent redder or less red, and a chest that is found for a few frames at a
/// time and then reports the tracker's search limit. Synthetic: nothing here comes from a
/// recording.
func fieldFailurePattern(_ change: (inout SyntheticSitting) -> Void = { _ in }) -> [FrameRecord] {
  let still = sitting(change)
  // Seconds since the first frame, brightness factor, extra factor on red.
  let steps: [(at: Double, level: Double, red: Double)] = [
    (11.5, 0.92, 0.975), (14.0, 1.07, 1.02), (22.0, 1.04, 1.03), (25.5, 0.97, 0.98), (32.0, 1.13, 1.04),
    (35.0, 0.88, 0.96), (37.0, 1.13, 1.04), (44.0, 1.03, 1.05), (51.5, 0.95, 0.96),
  ]
  var index = 0
  return still.frames().map { frame in
    var frame = frame
    let elapsed = frame.t - still.startTime
    var level = 1.0
    var red = 1.0
    for step in steps where elapsed >= step.at {
      level *= step.level
      red *= step.red
    }
    func moved(_ colour: RegionColor?) -> RegionColor? {
      colour.map { RegionColor(r: $0.r * level * red, g: $0.g * level, b: $0.b * level) }
    }
    frame.forehead = moved(frame.forehead)
    frame.leftCheek = moved(frame.leftCheek)
    frame.rightCheek = moved(frame.rightCheek)
    // Found for 12 frames in every 40 between seconds 2 and 6, at the search limit of
    // 7 rows a frame in a 1920-row picture, and not at all otherwise.
    let found = frame.facePresent && elapsed >= 2 && elapsed < 6 && index % 40 < 12
    frame.chestMotion = found ? (index % 2 == 0 ? 1 : -1) * 7.0 / 1920 : nil
    index += 1
    return frame
  }
}

/// A negative control with no pulse in it: skin-coloured regions whose colour wanders, as
/// light and a picture do, with white sensor noise on top. The wander is first-order
/// autoregressive noise, one part shared by the three regions (the light) and one part each
/// region's own. `memory` is how much of it carries over from one frame to the next,
/// `percent` its size. With `steps` the regions also settle at a new brightness and redness
/// eight times, as in `fieldFailurePattern`.
func colouredNoiseControl(
  seed: UInt64, frameRate: Double = 60, memory: Double, percent: Double, steps: Bool
) -> [FrameRecord] {
  var generator = SplitMix64(state: seed)
  let bases = [
    RegionColor(r: 182, g: 136, b: 118), RegionColor(r: 176, g: 128, b: 112),
    RegionColor(r: 174, g: 126, b: 110),
  ]
  let count = Int(60 * frameRate)
  let drive = (1 - memory * memory).squareRoot()
  var shared = [Double](repeating: 0, count: 3)
  var own = [Double](repeating: 0, count: 9)
  var stepAt: [(at: Double, level: Double, red: Double)] = []
  if steps {
    for _ in 0..<8 {
      stepAt.append(
        (8 + 47 * generator.nextUnit(), 0.88 + 0.25 * generator.nextUnit(), 0.96 + 0.08 * generator.nextUnit()))
    }
  }
  return (0..<count).map { index in
    let elapsed = Double(index) / frameRate
    for channel in 0..<3 { shared[channel] = memory * shared[channel] + drive * generator.nextGaussian() }
    for series in 0..<9 { own[series] = memory * own[series] + drive * generator.nextGaussian() }
    var level = 1.0
    var red = 1.0
    for step in stepAt where elapsed >= step.at {
      level *= step.level
      red *= step.red
    }
    var colours: [RegionColor] = []
    for (region, base) in bases.enumerated() {
      func channel(_ value: Double, _ index: Int) -> Double {
        value * (1 + percent / 100 * (shared[index] + 0.7 * own[3 * region + index])) * level
          + 0.3 * generator.nextGaussian()
      }
      colours.append(RegionColor(r: channel(base.r, 0) * red, g: channel(base.g, 1), b: channel(base.b, 2)))
    }
    return FrameRecord(
      t: 1000 + elapsed, facePresent: true, forehead: colours[0], leftCheek: colours[1],
      rightCheek: colours[2], exposure: .locked, droppedFrames: 0, faceTrackId: 1)
  }
}

func rmssd(_ intervals: [Double]) -> Double {
  let differences = zip(intervals, intervals.dropFirst()).map { $1 - $0 }
  return (differences.reduce(0) { $0 + $1 * $1 } / Double(differences.count)).squareRoot()
}
