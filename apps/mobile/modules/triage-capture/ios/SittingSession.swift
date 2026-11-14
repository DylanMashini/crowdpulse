import Foundation
import SignalEngine

/// One sitting: the engine, the sitting file and the two clocks. Created on the sitting's
/// first frame. Not thread-safe: it lives on the controller's queue, which is the one queue
/// the engine is ever called from.
final class SittingSession {
  let sittingId: String
  let fileURL: URL
  /// Phone wall clock at the first frame.
  let startedAt: Date
  /// Capture-clock time of the first frame.
  let captureStart: Double

  private let engine: SignalEngine
  private let writer: SittingFileWriter
  private let droppedBefore: Int
  private var lastFrameTime: Double
  private var framesWritten = 0
  private var readingsEmitted = 0
  private var writeError: Error?

  /// `wallClockOffset` is wall-clock seconds since 1970 minus capture-clock seconds.
  init(
    sittingId: String, firstFrame: FrameRecord, source: SittingFile.Source,
    frameRate: Double, wallClockOffset: Double, directory: URL
  ) throws {
    self.sittingId = sittingId
    captureStart = firstFrame.t
    lastFrameTime = firstFrame.t
    startedAt = Date(timeIntervalSince1970: firstFrame.t + wallClockOffset)
    droppedBefore = firstFrame.droppedFrames

    var configuration = EngineConfiguration.default
    configuration.nominalFrameRate = frameRate
    engine = SignalEngine(configuration: configuration)

    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    fileURL = directory.appendingPathComponent("\(sittingId).jsonl")
    writer = try SittingFileWriter(
      url: fileURL,
      header: SittingFile.Header(
        sittingId: sittingId, source: source, nominalFrameRate: frameRate,
        startedAt: Timestamps.string(from: startedAt), captureStart: firstFrame.t
      )
    )
    ingest(firstFrame)
  }

  /// Frames dropped since the sitting's first frame.
  private(set) var droppedFrames = 0

  var elapsedSeconds: Double { lastFrameTime - captureStart }

  func wallClock(at captureTime: Double) -> Date {
    startedAt.addingTimeInterval(captureTime - captureStart)
  }

  func ingest(_ frame: FrameRecord) {
    var record = frame
    // The source counts drops from the start of capture; a sitting counts from its own start.
    record.droppedFrames = max(0, frame.droppedFrames - droppedBefore)
    // There is no frame before the sitting's first to measure movement against.
    if framesWritten == 0 { record.chestMotion = nil }
    droppedFrames = record.droppedFrames
    lastFrameTime = record.t
    engine.ingest(record)
    guard writeError == nil else { return }
    do {
      try writer.append(record)
      framesWritten += 1
    } catch {
      writeError = error
    }
  }

  /// The next one-second reading if its time has come. `now` is the capture clock, not the
  /// newest frame's time, so a camera that goes quiet still produces readings, and they turn stale.
  func readingIfDue(now: Double) -> Reading? {
    let due = Int(now - captureStart)
    guard due > readingsEmitted else { return nil }
    readingsEmitted = due
    return engine.reading(at: now)
  }

  /// Ends the sitting. `fileError` is set when the sitting file is incomplete; the file has
  /// then been removed, and the summary is still good.
  func finish() -> (summary: SittingSummary, endedAt: Date, fileError: Error?) {
    let summary = engine.finish()
    let endedAt = wallClock(at: lastFrameTime)
    do {
      try writer.close()
    } catch {
      writeError = writeError ?? error
    }
    if writeError != nil {
      try? FileManager.default.removeItem(at: fileURL)
    }
    return (summary, endedAt, writeError)
  }

  /// Gives the sitting up and removes its file.
  func abandon() {
    try? writer.close()
    try? FileManager.default.removeItem(at: fileURL)
  }
}

enum Timestamps {
  private static let formatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()

  /// ISO 8601 in UTC with milliseconds and a trailing Z, the only form the wire accepts.
  static func string(from date: Date) -> String {
    formatter.string(from: date)
  }
}
