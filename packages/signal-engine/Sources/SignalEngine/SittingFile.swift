import Foundation

/// The sitting file: JSON Lines, UTF-8, one object per line. Line 1 is a `Header`; every
/// following line is a `FrameRecord`. See docs/CONTRACTS.md section 1.
public enum SittingFile {
  public static let format = "triagecam.sitting"
  public static let version = 1

  public enum Source: String, Codable, Sendable {
    case camera
    /// Synthetic frames from `SyntheticSitting`, used on the iOS simulator.
    case simulated
  }

  public struct Header: Codable, Sendable, Equatable {
    public var format: String
    public var version: Int
    /// Server id of the sitting (UUID), or nil for a recording made without the server.
    public var sittingId: String?
    public var source: Source
    public var nominalFrameRate: Double
    /// Wall-clock time of the first frame on the phone, ISO 8601 UTC.
    public var startedAt: String
    /// Capture-clock time of the first frame, so `t - captureStart` is seconds into the sitting.
    public var captureStart: Double
    /// Free text: phone model, what was recorded ("wall", "resting", "after stairs").
    public var note: String?

    public init(
      sittingId: String?, source: Source, nominalFrameRate: Double,
      startedAt: String, captureStart: Double, note: String? = nil
    ) {
      self.format = SittingFile.format
      self.version = SittingFile.version
      self.sittingId = sittingId
      self.source = source
      self.nominalFrameRate = nominalFrameRate
      self.startedAt = startedAt
      self.captureStart = captureStart
      self.note = note
    }
  }

  public struct Contents: Sendable, Equatable {
    public var header: Header
    public var frames: [FrameRecord]

    public init(header: Header, frames: [FrameRecord]) {
      self.header = header
      self.frames = frames
    }
  }

  public enum ReadError: Error, Equatable {
    case empty
    case unsupportedFormat(String, Int)
    case malformedLine(Int)
  }

  public static func encodeLine<T: Encodable>(_ value: T) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    var data = try encoder.encode(value)
    data.append(0x0A)
    return data
  }

  public static func encode(_ contents: Contents) throws -> Data {
    var data = try encodeLine(contents.header)
    for frame in contents.frames {
      data.append(try encodeLine(frame))
    }
    return data
  }

  public static func decode(_ data: Data) throws -> Contents {
    let decoder = JSONDecoder()
    var header: Header?
    var frames: [FrameRecord] = []
    var lineNumber = 0
    for line in data.split(separator: 0x0A, omittingEmptySubsequences: true) {
      lineNumber += 1
      do {
        if header == nil {
          let parsed = try decoder.decode(Header.self, from: line)
          guard parsed.format == format, parsed.version == version else {
            throw ReadError.unsupportedFormat(parsed.format, parsed.version)
          }
          header = parsed
        } else {
          frames.append(try decoder.decode(FrameRecord.self, from: line))
        }
      } catch let error as ReadError {
        throw error
      } catch {
        throw ReadError.malformedLine(lineNumber)
      }
    }
    guard let header else { throw ReadError.empty }
    return Contents(header: header, frames: frames)
  }

  public static func read(from url: URL) throws -> Contents {
    try decode(Data(contentsOf: url))
  }

  public static func write(_ contents: Contents, to url: URL) throws {
    try encode(contents).write(to: url, options: .atomic)
  }
}

/// Appends a sitting file line by line while a sitting runs, so a crash loses at most the
/// unflushed tail. Not thread-safe.
public final class SittingFileWriter {
  private let handle: FileHandle

  public init(url: URL, header: SittingFile.Header) throws {
    FileManager.default.createFile(atPath: url.path, contents: nil)
    handle = try FileHandle(forWritingTo: url)
    try handle.write(contentsOf: SittingFile.encodeLine(header))
  }

  public func append(_ frame: FrameRecord) throws {
    try handle.write(contentsOf: SittingFile.encodeLine(frame))
  }

  public func close() throws {
    try handle.close()
  }
}
