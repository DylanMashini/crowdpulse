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

func rmssd(_ intervals: [Double]) -> Double {
  let differences = zip(intervals, intervals.dropFirst()).map { $1 - $0 }
  return (differences.reduce(0) { $0 + $1 * $1 } / Double(differences.count)).squareRoot()
}
