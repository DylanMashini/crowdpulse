import AVFoundation
import CoreGraphics
import Foundation
import SignalEngine

/// The error codes of docs/CONTRACTS.md section 3. Raw values are what JavaScript sees in `error.code`.
enum CaptureErrorCode: String {
  case cameraPermission = "ERR_CAMERA_PERMISSION"
  case cameraUnavailable = "ERR_CAMERA_UNAVAILABLE"
  case captureInterrupted = "ERR_CAPTURE_INTERRUPTED"
  case notCapturing = "ERR_NOT_CAPTURING"
  case sittingRunning = "ERR_SITTING_RUNNING"
  case noSitting = "ERR_NO_SITTING"
  case noFace = "ERR_NO_FACE"
  case file = "ERR_FILE"
}

struct CaptureError: Error {
  let code: CaptureErrorCode
  let message: String

  init(_ code: CaptureErrorCode, _ message: String) {
    self.code = code
    self.message = message
  }
}

enum PermissionStatus: String {
  case granted, denied, undetermined
}

enum CameraPosition: String {
  case back, front
}

struct CaptureSettings {
  var camera: CameraPosition = .back
  var frameRate: Double = 60
}

struct PreviewSettings {
  var framesPerSecond: Double
  var maxLongSide: Double
  var quality: Double
}

struct EncodedImage {
  let jpeg: Data
  let width: Int
  let height: Int
}

/// Outlines of the tracked face in the upright frame: x right, y down, both 0 to 1, origin top-left.
struct FaceRegions {
  var face: CGRect
  var forehead: [CGPoint]
  /// The cheek on the left of the image.
  var leftCheek: [CGPoint]
  var rightCheek: [CGPoint]
  var chest: CGRect?
}

struct FaceOutlines {
  /// Width divided by height of the upright frame.
  var aspectRatio: Double
  var regions: FaceRegions?
}

/// Where frame records come from: the camera on a phone, the synthetic generator on the simulator.
/// Both feed the same engine, sitting file and event path.
protocol FrameSource: AnyObject {
  var kind: SittingFile.Source { get }
  var delegate: FrameSourceDelegate? { get set }
  /// The rate frames are requested at right now. 60, or 30 after a fallback.
  var frameRate: Double { get }
  /// While true the source does not change its frame rate.
  var holdsFrameRate: Bool { get set }

  func permission() -> PermissionStatus
  func requestPermission(_ completion: @escaping (PermissionStatus) -> Void)

  /// Blocks until frames are flowing or the source has failed.
  func start(_ settings: CaptureSettings) throws
  func stop()

  /// The camera frames come from. The simulated source keeps the choice and measures nothing with it.
  var camera: CameraPosition { get }
  /// Changes camera while capture runs. Frames, exposure and face tracking carry on from the
  /// new camera; a tracked face is picked up again under a new track id.
  func switchCamera(to position: CameraPosition) throws

  /// What a `CapturePreviewView` draws: the capture session, or nil where there is no camera
  /// and the view shows the test pattern instead.
  var previewSession: AVCaptureSession? { get }
  /// The device behind `previewSession`, so the view can keep its picture upright.
  var previewDevice: AVCaptureDevice? { get }

  func outlines() -> FaceOutlines
  /// Nil turns the preview off.
  func setPreview(_ settings: PreviewSettings?)
  func captureFaceCrop(_ completion: @escaping (Result<EncodedImage, CaptureError>) -> Void)
}

/// Called on the source's own queues.
protocol FrameSourceDelegate: AnyObject {
  /// `record.droppedFrames` counts from the start of capture; the sitting rebases it.
  func frameSource(_ source: FrameSource, didProduce record: FrameRecord)
  func frameSource(_ source: FrameSource, didEncodePreview image: EncodedImage)
  func frameSource(_ source: FrameSource, didFail error: CaptureError)
}

/// Where preview views find the frame source. There is one capture module, so one source.
enum CapturePreviewHub {
  /// Posted on the main queue when the camera behind the preview started or changed.
  static let didChange = Notification.Name("TriageCapturePreviewDidChange")

  private static let lock = NSLock()
  private static weak var current: FrameSource?

  static var source: FrameSource? {
    get { lock.withLock { current } }
    set { lock.withLock { current = newValue } }
  }

  static func changed() {
    DispatchQueue.main.async { NotificationCenter.default.post(name: didChange, object: nil) }
  }
}

enum FrameSources {
  static func make() -> FrameSource {
    #if targetEnvironment(simulator)
    return SimulatedSource()
    #else
    return CameraSource()
    #endif
  }
}
