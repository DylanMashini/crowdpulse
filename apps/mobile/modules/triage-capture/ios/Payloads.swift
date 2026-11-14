import CoreGraphics
import Foundation
import SignalEngine

/// The shapes that cross the bridge (docs/CONTRACTS.md section 3). Optional values are written
/// as null, never left out: the server's schemas reject a missing key.
enum Payloads {
  private static func orNull<T>(_ value: T?) -> Any {
    value.map { $0 as Any } ?? NSNull()
  }

  static func estimate(_ estimate: Estimate) -> [String: Any] {
    [
      "value": orNull(estimate.value),
      "state": estimate.state.rawValue,
      "reason": orNull(estimate.reason?.rawValue),
      "quality": estimate.quality,
      "coverage": estimate.coverage,
      "ageMs": orNull(estimate.ageMs),
    ]
  }

  /// The wire `Reading`: the engine's reading with its time moved to the phone's wall clock.
  static func reading(_ reading: Reading, in sitting: SittingSession) -> [String: Any] {
    [
      "sittingId": sitting.sittingId,
      "reading": [
        "t": Timestamps.string(from: sitting.wallClock(at: reading.t)),
        "elapsedMs": Int((reading.elapsed * 1000).rounded()),
        "heartRate": estimate(reading.heartRate),
        "breathingRate": estimate(reading.breathingRate),
      ] as [String: Any],
    ]
  }

  private static func summaryValue(_ value: SummaryValue) -> [String: Any] {
    ["value": orNull(value.value), "coverage": value.coverage, "reason": orNull(value.reason)]
  }

  static func summary(_ summary: SittingSummary) -> [String: Any] {
    [
      "durationSeconds": summary.durationSeconds,
      "frameCount": summary.frameCount,
      "droppedFrames": summary.droppedFrames,
      "heartRate": summaryValue(summary.heartRate),
      "breathingRate": summaryValue(summary.breathingRate),
      "rmssd": summaryValue(summary.rmssd),
      "sdnn": summaryValue(summary.sdnn),
      "beatIntervals": summary.beatIntervals.map { ["tMs": $0.tMs, "ms": $0.ms] },
      "timeToFirstReadingSeconds": orNull(summary.timeToFirstReadingSeconds),
      "longestDropoutSeconds": summary.longestDropoutSeconds,
      "heartRateConfidence": orNull(summary.heartRateConfidence?.rawValue),
    ]
  }

  private static func point(_ point: CGPoint) -> [String: Any] {
    ["x": Double(point.x), "y": Double(point.y)]
  }

  private static func rect(_ rect: CGRect) -> [String: Any] {
    ["x": Double(rect.minX), "y": Double(rect.minY), "width": Double(rect.width), "height": Double(rect.height)]
  }

  static func outlines(_ outlines: FaceOutlines) -> [String: Any] {
    let regions = outlines.regions
    return [
      "aspectRatio": outlines.aspectRatio,
      "face": orNull(regions.map { rect($0.face) }),
      "forehead": orNull(regions.map { $0.forehead.map(point) }),
      "leftCheek": orNull(regions.map { $0.leftCheek.map(point) }),
      "rightCheek": orNull(regions.map { $0.rightCheek.map(point) }),
      "chest": orNull(regions?.chest.map(rect)),
    ]
  }

  static func image(_ image: EncodedImage) -> [String: Any] {
    ["jpegBase64": image.jpeg.base64EncodedString(), "width": image.width, "height": image.height]
  }

  static func error(_ error: CaptureError) -> [String: Any] {
    ["code": error.code.rawValue, "message": error.message]
  }

  static func thermalState(_ state: ProcessInfo.ThermalState) -> String {
    switch state {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    @unknown default: return "critical"
    }
  }
}
