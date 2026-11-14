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

func rmssd(_ intervals: [Double]) -> Double {
  let differences = zip(intervals, intervals.dropFirst()).map { $1 - $0 }
  return (differences.reduce(0) { $0 + $1 * $1 } / Double(differences.count)).squareRoot()
}
