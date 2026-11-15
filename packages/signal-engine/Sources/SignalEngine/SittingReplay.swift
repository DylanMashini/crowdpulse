import Foundation

/// Runs a recorded sitting through the engine the way the capture module does: every frame
/// in order, one reading per second of capture time, then the summary.
public enum SittingReplay {
  public struct Result: Sendable, Equatable {
    public var readings: [Reading]
    public var summary: SittingSummary
    /// One per whole second of the sitting. Empty unless `run` was asked for diagnostics.
    public var diagnostics: [PulseDiagnostic] = []
  }

  /// - Parameter diagnostics: also collect a `PulseDiagnostic` per second. The readings and
  ///   the summary are the same either way.
  public static func run(
    _ frames: [FrameRecord], configuration: EngineConfiguration = .default, diagnostics: Bool = false
  ) -> Result {
    let engine = SignalEngine(configuration: configuration)
    engine.collectsDiagnostics = diagnostics
    var readings: [Reading] = []
    guard let first = frames.first else {
      return Result(readings: [], summary: engine.finish())
    }
    var nextReadingTime = first.t + 1
    for frame in frames {
      engine.ingest(frame)
      while frame.t >= nextReadingTime {
        readings.append(engine.reading(at: nextReadingTime))
        nextReadingTime += 1
      }
    }
    return Result(readings: readings, summary: engine.finish(), diagnostics: engine.diagnostics)
  }
}

/// One sample from a reference device (chest strap, oximeter) or a manual count.
public struct ReferenceSample: Sendable, Equatable {
  /// Seconds since the first frame of the sitting.
  public var elapsed: Double
  public var heartRate: Double

  public init(elapsed: Double, heartRate: Double) {
    self.elapsed = elapsed
    self.heartRate = heartRate
  }
}

/// A reference file: JSON Lines, one `{"t": ..., "heartRate": ...}` per line. `t` is either a
/// number, seconds since the sitting's first frame, or an ISO 8601 time, which is placed
/// against the sitting file's `startedAt`.
public enum ReferenceFile {
  public enum ReadError: Error, Equatable {
    case malformedLine(Int)
    /// A line uses a wall-clock time but the sitting's `startedAt` could not be parsed.
    case unknownSittingStart
  }

  private struct Line: Decodable {
    enum Time: Decodable {
      case elapsed(Double)
      case wallClock(String)

      init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let seconds = try? container.decode(Double.self) {
          self = .elapsed(seconds)
        } else {
          self = .wallClock(try container.decode(String.self))
        }
      }
    }

    var t: Time
    var heartRate: Double?
  }

  public static func decode(_ data: Data, sittingStartedAt: String) throws -> [ReferenceSample] {
    let decoder = JSONDecoder()
    let sittingStart = date(sittingStartedAt)
    var samples: [ReferenceSample] = []
    for (index, raw) in data.split(separator: 0x0A, omittingEmptySubsequences: true).enumerated() {
      guard let line = try? decoder.decode(Line.self, from: raw) else {
        throw ReadError.malformedLine(index + 1)
      }
      guard let heartRate = line.heartRate else { continue }
      switch line.t {
      case .elapsed(let seconds):
        samples.append(ReferenceSample(elapsed: seconds, heartRate: heartRate))
      case .wallClock(let text):
        guard let time = date(text) else { throw ReadError.malformedLine(index + 1) }
        guard let sittingStart else { throw ReadError.unknownSittingStart }
        samples.append(
          ReferenceSample(elapsed: time.timeIntervalSince(sittingStart), heartRate: heartRate))
      }
    }
    return samples.sorted { $0.elapsed < $1.elapsed }
  }

  private static func date(_ text: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: text) { return date }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: text)
  }
}

/// Agreement between a replayed sitting and its reference: the numbers plan section 9 reports.
public struct ReferenceComparison: Codable, Sendable, Equatable {
  /// Valid heart-rate readings that have a reference sample within `pairingSeconds`.
  public var pairedReadings: Int
  /// Mean of |estimate - reference| over the pairs, in bpm. Nil when nothing pairs.
  public var meanAbsoluteErrorBpm: Double?
  /// Mean of estimate - reference over the pairs, in bpm.
  public var biasBpm: Double?
  /// Share of the pairs within 5 bpm of the reference.
  public var within5BpmShare: Double?
  /// Share of the one-second readings that were valid.
  public var coverage: Double
  public var timeToFirstReadingSeconds: Double?
  public var longestDropoutSeconds: Double
  /// The sitting's summary heart rate, for the per-sitting check.
  public var summaryHeartRateBpm: Double?
  /// Mean of the reference over the whole recording, seconds without a reading included.
  public var referenceMeanBpm: Double?
  /// Mean of the reference over the paired readings only. The summary is built from the seconds
  /// that had a reading, so this is the mean to hold it against: when the rate moves during a
  /// recording, the whole-recording mean describes seconds the summary never saw.
  public var pairedReferenceMeanBpm: Double?
  /// The same for everything the screen showed during the sitting: the recorded readings
  /// above together with the provisional ones (`Estimate.provisional`). Every number above
  /// is of recorded readings only.
  public var shown: Shown?

  public struct Shown: Codable, Sendable, Equatable {
    public var pairedReadings: Int
    public var meanAbsoluteErrorBpm: Double?
    public var within5BpmShare: Double?
    /// Of the provisional readings alone.
    public var provisionalPairedReadings: Int
    public var provisionalMeanAbsoluteErrorBpm: Double?
    public var provisionalWithin5BpmShare: Double?
    /// Share of the one-second readings with a value on screen.
    public var coverage: Double
    public var timeToFirstReadingSeconds: Double?
    /// Longest run of seconds without a fresh value after the first one.
    public var longestDropoutSeconds: Double?
  }

  /// A reading pairs with the nearest reference sample no further away than this, in seconds.
  public static let pairingSeconds = 1.5

  /// The reference heart rate nearest to `elapsed`, or nil when none is within `pairingSeconds`.
  public static func reference(at elapsed: Double, in reference: [ReferenceSample]) -> Double? {
    guard
      let nearest = reference.min(by: { abs($0.elapsed - elapsed) < abs($1.elapsed - elapsed) }),
      abs(nearest.elapsed - elapsed) <= pairingSeconds
    else { return nil }
    return nearest.heartRate
  }

  public init(replay: SittingReplay.Result, reference: [ReferenceSample]) {
    var errors: [Double] = []
    var pairedReference = 0.0
    var provisionalErrors: [Double] = []
    var shownSeconds = 0
    var firstShown: Double?
    var dropout = 0
    var longestDropout = 0
    for reading in replay.readings {
      if reading.heartRate.value != nil {
        shownSeconds += 1
        firstShown = firstShown ?? reading.elapsed
        dropout = 0
      } else if firstShown != nil {
        dropout += 1
        longestDropout = max(longestDropout, dropout)
      }
      guard let estimate = reading.heartRate.value,
        let paired = ReferenceComparison.reference(at: reading.elapsed, in: reference)
      else { continue }
      if reading.heartRate.provisional {
        provisionalErrors.append(estimate - paired)
        continue
      }
      errors.append(estimate - paired)
      pairedReference += paired
    }
    func meanAbsolute(_ errors: [Double]) -> Double? {
      errors.isEmpty ? nil : errors.reduce(0) { $0 + abs($1) } / Double(errors.count)
    }
    func within5(_ errors: [Double]) -> Double? {
      errors.isEmpty ? nil : Double(errors.filter { abs($0) <= 5 }.count) / Double(errors.count)
    }
    let everything = errors + provisionalErrors
    shown = Shown(
      pairedReadings: everything.count,
      meanAbsoluteErrorBpm: meanAbsolute(everything),
      within5BpmShare: within5(everything),
      provisionalPairedReadings: provisionalErrors.count,
      provisionalMeanAbsoluteErrorBpm: meanAbsolute(provisionalErrors),
      provisionalWithin5BpmShare: within5(provisionalErrors),
      coverage: replay.readings.isEmpty ? 0 : Double(shownSeconds) / Double(replay.readings.count),
      timeToFirstReadingSeconds: firstShown,
      longestDropoutSeconds: firstShown == nil ? nil : Double(longestDropout))
    let pairs = Double(errors.count)
    pairedReadings = errors.count
    meanAbsoluteErrorBpm = errors.isEmpty ? nil : errors.reduce(0) { $0 + abs($1) } / pairs
    biasBpm = errors.isEmpty ? nil : errors.reduce(0, +) / pairs
    within5BpmShare = errors.isEmpty ? nil : Double(errors.filter { abs($0) <= 5 }.count) / pairs
    coverage = replay.summary.heartRate.coverage
    timeToFirstReadingSeconds = replay.summary.timeToFirstReadingSeconds
    longestDropoutSeconds = replay.summary.longestDropoutSeconds
    summaryHeartRateBpm = replay.summary.heartRate.value
    pairedReferenceMeanBpm = errors.isEmpty ? nil : pairedReference / pairs
    referenceMeanBpm = reference.isEmpty ? nil : reference.reduce(0) { $0 + $1.heartRate } / Double(reference.count)
  }
}
