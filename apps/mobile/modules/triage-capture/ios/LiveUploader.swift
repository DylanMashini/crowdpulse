import Foundation

/// Where live-view frames go, and the headers that authorise them.
struct LiveUploadTarget {
  let url: URL
  let headers: [String: String]
}

/// What the uploader achieved in the last second, for the screen and for the rate decision.
struct LiveUploadReport {
  /// Frames the server accepted.
  let delivered: Int
  /// Frames that were refused, timed out or could not be sent.
  let failed: Int
  /// Dashboards watching, from the newest answer. Nil when nothing was accepted this second.
  let viewers: Int?
}

/// Posts live-view JPEGs straight from the encoder to the server, without a trip through
/// JavaScript: at 15 frames a second a base64 string across the bridge for every frame would
/// cost more than the picture is worth. The live view is a preview, so a frame that cannot go
/// out now is dropped, never queued, and nothing is written to disk.
final class LiveUploader {
  /// One request on the wire and one behind it. More than that and frames would arrive late.
  private static let maxInFlight = 2

  private let session: URLSession
  private let lock = NSLock()
  private var target: LiveUploadTarget?
  private var inFlight = 0
  private var delivered = 0
  private var failed = 0
  private var viewers: Int?

  init() {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpMaximumConnectionsPerHost = Self.maxInFlight
    configuration.timeoutIntervalForRequest = 4
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.urlCache = nil
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.waitsForConnectivity = false
    session = URLSession(configuration: configuration)
  }

  var hasTarget: Bool { lock.withLock { target != nil } }

  /// Nil stops uploading. Frames already on the wire finish and are not counted.
  func setTarget(_ next: LiveUploadTarget?) {
    lock.withLock {
      target = next
      delivered = 0
      failed = 0
      viewers = nil
    }
  }

  /// Sends one frame unless two are already on their way, in which case it is dropped.
  func upload(_ image: EncodedImage, capturedAt: Date) {
    let destination: LiveUploadTarget? = lock.withLock {
      guard let target, inFlight < Self.maxInFlight else { return nil }
      inFlight += 1
      return target
    }
    guard let destination else { return }

    var request = URLRequest(url: destination.url)
    request.httpMethod = "POST"
    for (name, value) in destination.headers { request.setValue(value, forHTTPHeaderField: name) }
    request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
    request.setValue(String(Int64((capturedAt.timeIntervalSince1970 * 1000).rounded())), forHTTPHeaderField: "x-frame-captured-at")

    session.uploadTask(with: request, from: image.jpeg) { [weak self] data, response, _ in
      guard let self else { return }
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      var watching: Int?
      if status == 200, let data, let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        watching = (body["viewers"] as? NSNumber)?.intValue
      }
      self.lock.withLock {
        self.inFlight -= 1
        guard self.target?.url == destination.url else { return }
        if status == 200 {
          self.delivered += 1
          self.viewers = watching ?? self.viewers
        } else if status != 429 {
          // 429 is the server's own rate limit: the frame was early, not lost to a fault.
          self.failed += 1
        }
      }
    }.resume()
  }

  /// The counts since the last call. Nil when there is no target, or nothing was attempted.
  func takeReport() -> LiveUploadReport? {
    lock.withLock {
      guard target != nil, delivered + failed > 0 else { return nil }
      let report = LiveUploadReport(delivered: delivered, failed: failed, viewers: delivered > 0 ? viewers : nil)
      delivered = 0
      failed = 0
      return report
    }
  }
}
