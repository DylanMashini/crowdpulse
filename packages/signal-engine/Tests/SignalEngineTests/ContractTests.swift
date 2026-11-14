import Foundation
import Testing

@testable import SignalEngine

// These tests pin the interface the capture module and the server rely on. Accuracy tests for
// the estimator belong beside them, added by whoever implements the maths.

@Test func frameRecordUsesTheWireKeys() throws {
  let frame = FrameRecord(
    t: 12.5, facePresent: true,
    forehead: RegionColor(r: 1, g: 2, b: 3),
    leftCheek: RegionColor(r: 4, g: 5, b: 6),
    rightCheek: RegionColor(r: 7, g: 8, b: 9),
    chestMotion: -0.001, exposure: .locked, droppedFrames: 2, faceTrackId: 7
  )
  let line = String(decoding: try SittingFile.encodeLine(frame), as: UTF8.self)
  #expect(
    line == """
      {"chestMotion":-0.001,"droppedFrames":2,"exposure":"locked","facePresent":true,"faceTrackId":7,\
      "forehead":{"b":3,"g":2,"r":1},"leftCheek":{"b":6,"g":5,"r":4},"rightCheek":{"b":9,"g":8,"r":7},"t":12.5}

      """)
}

@Test func frameRecordAcceptsMissingAndNullOptionals() throws {
  let json = #"{"t":1,"facePresent":false,"forehead":null,"exposure":"adjusting","droppedFrames":0}"#
  let frame = try JSONDecoder().decode(FrameRecord.self, from: Data(json.utf8))
  #expect(frame == FrameRecord(t: 1, facePresent: false, exposure: .adjusting, droppedFrames: 0))
}

@Test func sittingFileRoundTrips() throws {
  var sitting = SyntheticSitting()
  sitting.durationSeconds = 3
  let contents = sitting.contents(sittingId: "s-1", startedAt: "2026-11-14T03:00:00.000Z")
  let decoded = try SittingFile.decode(try SittingFile.encode(contents))
  #expect(decoded.header == contents.header)
  #expect(decoded.frames.count == 180)
  #expect(decoded.frames == contents.frames)
}

@Test func sittingFileRejectsAnotherFormat() {
  let data = Data(#"{"format":"other","version":1}"#.utf8)
  #expect(throws: SittingFile.ReadError.malformedLine(1)) { try SittingFile.decode(data) }
  #expect(throws: SittingFile.ReadError.empty) { try SittingFile.decode(Data()) }
}

@Test func syntheticSittingIsDeterministicAndSettles() {
  let sitting = SyntheticSitting()
  let frames = sitting.frames()
  #expect(frames == sitting.frames())
  #expect(frames.count == 3600)
  #expect(frames.first?.facePresent == false)
  #expect(frames.first?.exposure == .adjusting)
  #expect(frames.last?.facePresent == true)
  #expect(frames.last?.exposure == .locked)
  #expect(zip(frames, frames.dropFirst()).allSatisfy { $0.t < $1.t })
}

@Test func estimateNeverCarriesAValueUnlessValid() {
  let engine = SignalEngine()
  for frame in SyntheticSitting().frames().prefix(120) { engine.ingest(frame) }
  let reading = engine.reading()
  for estimate in [reading.heartRate, reading.breathingRate] {
    #expect((estimate.state == .valid) == (estimate.value != nil))
    #expect((estimate.state == .valid) == (estimate.reason == nil))
    #expect((0...1).contains(estimate.quality))
    #expect((0...1).contains(estimate.coverage))
  }
}

@Test func readingGoesStaleWhenFramesStop() {
  let engine = SignalEngine()
  let frames = SyntheticSitting().frames().prefix(300)
  for frame in frames { engine.ingest(frame) }
  let lastTime = frames.last!.t
  let silent = engine.reading(at: lastTime + engine.configuration.staleAfterSeconds + 0.5)
  #expect(silent.heartRate.state == .stale)
  #expect(silent.heartRate.reason == .noFrames)
  #expect(silent.heartRate.value == nil)
  #expect(silent.breathingRate.state == .stale)
}

@Test func readingWireStringsAreStable() throws {
  let estimate = Estimate.unavailable(.none, .lowQuality)
  let json = String(decoding: try JSONEncoder().encode(estimate), as: UTF8.self)
  #expect(json.contains(#""state":"none""#))
  #expect(json.contains(#""reason":"low_quality""#))
  #expect(EstimateReason.awaitingAgreement.rawValue == "awaiting_agreement")
  #expect(EstimateReason.noFrames.rawValue == "no_frames")
}

@Test func finishReportsTheSittingShape() {
  let engine = SignalEngine()
  let frames = SyntheticSitting().frames()
  for frame in frames { engine.ingest(frame) }
  let summary = engine.finish()
  #expect(summary.frameCount == frames.count)
  #expect(abs(summary.durationSeconds - 59.983) < 0.01)
  for value in [summary.heartRate, summary.breathingRate, summary.rmssd, summary.sdnn] {
    #expect((0...1).contains(value.coverage))
  }
  engine.reset()
  #expect(engine.finish().frameCount == 0)
}
