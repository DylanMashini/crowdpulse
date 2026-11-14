import Foundation
import SignalEngine

let usage = """
  usage:
    engine-cli run <sitting.jsonl>
        One Reading per second as JSON Lines, then the SittingSummary.
    engine-cli compare <sitting.jsonl> <reference.jsonl>
        Agreement with a reference as one JSON object. Reference lines are
        {"t": seconds since the first frame or an ISO 8601 time, "heartRate": bpm}.
    engine-cli diagnose <sitting.jsonl> [reference.jsonl] [--config <overrides.json>]
        One PulseDiagnostic per second as JSON Lines, then the SittingSummary: the check
        that refused each heart-rate reading ("gate"), the numbers it compared, and what
        the window would have reported unrefused ("candidateBpm"). With a reference, each
        line also carries the nearest "referenceBpm". Same readings as run. --config is a
        JSON object of EngineConfiguration fields to change, such as
        {"maximumMotionShare": 1}: what the sitting reads with a check moved or off.
    engine-cli synth <out.jsonl> [options]
        --hr 72  --br 16  --seconds 60  --fps 60  --seed 1  --noise 0.25  --amplitude 0.35
        --subject person|wall|noise      --hr-change <at seconds> <to bpm>
        --flicker <hz> <depth>           --face-loss <from> <to>
        --motion <from> <to>             --gap <from> <to>
        --drop <probability>             --beat-deviation <ms>
        --harmonic <second harmonic of the pulse, relative to the fundamental; 0.2>
  """

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}

func printJSON<T: Encodable>(_ value: T) throws {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  print(String(decoding: try encoder.encode(value), as: UTF8.self))
}

func run(path: String) throws {
  let contents = try SittingFile.read(from: URL(fileURLWithPath: path))
  let result = SittingReplay.run(contents.frames)
  for reading in result.readings { try printJSON(reading) }
  try printJSON(result.summary)
}

func compare(sittingPath: String, referencePath: String) throws {
  let contents = try SittingFile.read(from: URL(fileURLWithPath: sittingPath))
  let reference = try ReferenceFile.decode(
    Data(contentsOf: URL(fileURLWithPath: referencePath)),
    sittingStartedAt: contents.header.startedAt)
  try printJSON(ReferenceComparison(replay: SittingReplay.run(contents.frames), reference: reference))
}

/// One line of `diagnose`: the diagnostic's own fields, with the reference beside them.
struct DiagnosedSecond: Encodable {
  var diagnostic: PulseDiagnostic
  var referenceBpm: Double?

  enum CodingKeys: String, CodingKey { case referenceBpm }

  func encode(to encoder: Encoder) throws {
    try diagnostic.encode(to: encoder)
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encodeIfPresent(referenceBpm, forKey: .referenceBpm)
  }
}

/// The default configuration with the fields named in a JSON object file changed. For
/// asking what a sitting would have read with a check moved or switched off.
func configuration(overridesPath: String?) throws -> EngineConfiguration {
  guard let overridesPath else { return .default }
  let data = try Data(contentsOf: URL(fileURLWithPath: overridesPath))
  guard let overrides = try JSONSerialization.jsonObject(with: data) as? [String: Any],
    var fields = try JSONSerialization.jsonObject(with: JSONEncoder().encode(EngineConfiguration.default))
      as? [String: Any]
  else { fail("--config needs a JSON object of EngineConfiguration fields") }
  for (name, value) in overrides {
    guard fields[name] != nil else { fail("EngineConfiguration has no field \(name)") }
    fields[name] = value
  }
  return try JSONDecoder().decode(EngineConfiguration.self, from: JSONSerialization.data(withJSONObject: fields))
}

func diagnose(sittingPath: String, referencePath: String?, configuration: EngineConfiguration) throws {
  let contents = try SittingFile.read(from: URL(fileURLWithPath: sittingPath))
  let reference = try referencePath.map {
    try ReferenceFile.decode(
      Data(contentsOf: URL(fileURLWithPath: $0)), sittingStartedAt: contents.header.startedAt)
  }
  let result = SittingReplay.run(contents.frames, configuration: configuration, diagnostics: true)
  for diagnostic in result.diagnostics {
    try printJSON(
      DiagnosedSecond(
        diagnostic: diagnostic,
        referenceBpm: reference.flatMap { ReferenceComparison.reference(at: diagnostic.elapsed, in: $0) }))
  }
  try printJSON(result.summary)
}

func synth(arguments: [String]) throws {
  guard let output = arguments.first else { fail("synth needs an output path") }
  var sitting = SyntheticSitting()
  var options = arguments.dropFirst().makeIterator()

  func number(_ flag: String) -> Double {
    guard let raw = options.next(), let value = Double(raw) else { fail("\(flag) needs a number") }
    return value
  }
  func interval(_ flag: String) -> SyntheticSitting.Interval {
    SyntheticSitting.Interval(start: number(flag), end: number(flag))
  }

  while let flag = options.next() {
    switch flag {
    case "--hr": sitting.heartRateBpm = number(flag)
    case "--br": sitting.breathingRatePerMin = number(flag)
    case "--seconds": sitting.durationSeconds = number(flag)
    case "--fps": sitting.frameRate = number(flag)
    case "--seed": sitting.seed = UInt64(number(flag))
    case "--noise": sitting.noise = number(flag)
    case "--amplitude": sitting.pulseAmplitude = number(flag)
    case "--harmonic": sitting.pulseHarmonic = number(flag)
    case "--subject":
      guard let subject = options.next().flatMap(SyntheticSitting.Subject.init(rawValue:)) else {
        fail("--subject is person, wall or noise")
      }
      sitting.subject = subject
    case "--hr-change":
      sitting.heartRateChange = SyntheticSitting.RateChange(atSeconds: number(flag), toBpm: number(flag))
    case "--flicker": sitting.flicker = SyntheticSitting.Flicker(hz: number(flag), depth: number(flag))
    case "--face-loss": sitting.faceLoss = interval(flag)
    case "--motion": sitting.motionBursts.append(interval(flag))
    case "--gap": sitting.frameGap = interval(flag)
    case "--drop": sitting.droppedFrameProbability = number(flag)
    case "--beat-deviation": sitting.beatIntervalDeviationMs = number(flag)
    default: fail("unknown option \(flag)\n\(usage)")
    }
  }
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  let startedAt = formatter.string(from: Date())
  try SittingFile.write(sitting.contents(startedAt: startedAt), to: URL(fileURLWithPath: output))
}

let arguments = Array(CommandLine.arguments.dropFirst())
do {
  switch (arguments.first, arguments.count) {
  case ("run", 2):
    try run(path: arguments[1])
  case ("compare", 3):
    try compare(sittingPath: arguments[1], referencePath: arguments[2])
  case ("diagnose", 2...):
    var paths = Array(arguments.dropFirst())
    var overridesPath: String?
    if let flag = paths.firstIndex(of: "--config") {
      guard flag + 1 < paths.count else { fail("--config needs a file") }
      overridesPath = paths[flag + 1]
      paths.removeSubrange(flag...(flag + 1))
    }
    guard (1...2).contains(paths.count) else { fail(usage) }
    try diagnose(
      sittingPath: paths[0], referencePath: paths.count == 2 ? paths[1] : nil,
      configuration: configuration(overridesPath: overridesPath))
  case ("synth", 2...):
    try synth(arguments: Array(arguments.dropFirst()))
  default:
    fail(usage)
  }
} catch {
  fail("engine-cli: \(error)")
}
