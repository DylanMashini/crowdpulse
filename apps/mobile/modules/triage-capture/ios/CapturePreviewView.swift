import AVFoundation
import ExpoModulesCore
import UIKit

/// The live camera picture, drawn by the system's own preview layer straight from the capture
/// session: no frame crosses the bridge. It fills its bounds and crops the overflow, and the
/// viewfinder lays its outlines over it with the same arithmetic. The front camera is shown
/// mirrored, as people expect of a front camera; the frames that are measured are not.
///
/// Where there is no camera (the simulator) it shows the test pattern instead, mirrored when
/// the front camera is chosen so the flip can be seen.
final class CapturePreviewView: ExpoView {
  private let videoLayer = AVCaptureVideoPreviewLayer()
  private let patternLayer = CALayer()
  private var changeObserver: NSObjectProtocol?
  private var rotationObservation: NSKeyValueObservation?
  private var rotationCoordinator: AnyObject?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
    isAccessibilityElement = false
    videoLayer.videoGravity = .resizeAspectFill
    patternLayer.contentsGravity = .resizeAspectFill
    patternLayer.masksToBounds = true
    patternLayer.isHidden = true
    layer.addSublayer(videoLayer)
    layer.addSublayer(patternLayer)
  }

  deinit {
    if let changeObserver { NotificationCenter.default.removeObserver(changeObserver) }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    withoutAnimation {
      videoLayer.frame = bounds
      patternLayer.frame = bounds
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if let changeObserver { NotificationCenter.default.removeObserver(changeObserver) }
    changeObserver = nil
    guard window != nil else {
      rotationObservation = nil
      rotationCoordinator = nil
      videoLayer.session = nil
      return
    }
    changeObserver = NotificationCenter.default.addObserver(
      forName: CapturePreviewHub.didChange, object: nil, queue: .main
    ) { [weak self] _ in self?.refresh() }
    refresh()
  }

  /// Main thread.
  private func refresh() {
    let source = CapturePreviewHub.source
    withoutAnimation {
      if let session = source?.previewSession {
        patternLayer.isHidden = true
        videoLayer.isHidden = false
        if videoLayer.session !== session { videoLayer.session = session }
      } else {
        videoLayer.isHidden = true
        videoLayer.session = nil
        patternLayer.isHidden = source == nil
        if patternLayer.contents == nil {
          patternLayer.contents = TestPattern.image(size: CGSize(width: 1280, height: 720), elapsed: nil).cgImage
        }
        patternLayer.setAffineTransform(source?.camera == .front ? CGAffineTransform(scaleX: -1, y: 1) : .identity)
      }
    }
    followRotation(of: source?.previewDevice)
  }

  /// Keeps the picture upright in the interface, whichever way the phone is turned.
  private func followRotation(of device: AVCaptureDevice?) {
    rotationObservation = nil
    rotationCoordinator = nil
    guard let device else { return }
    if #available(iOS 17.0, *) {
      let coordinator = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: videoLayer)
      rotationCoordinator = coordinator
      rotationObservation = coordinator.observe(\.videoRotationAngleForHorizonLevelPreview, options: [.initial, .new]) {
        [weak self] coordinator, _ in
        let angle = coordinator.videoRotationAngleForHorizonLevelPreview
        DispatchQueue.main.async {
          guard let connection = self?.videoLayer.connection, connection.isVideoRotationAngleSupported(angle) else { return }
          connection.videoRotationAngle = angle
        }
      }
    } else if let connection = videoLayer.connection, connection.isVideoOrientationSupported {
      // Before iOS 17 the phone is assumed to sit in its mount, as the capture path assumes.
      connection.videoOrientation = .landscapeRight
    }
  }

  private func withoutAnimation(_ change: () -> Void) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    change()
    CATransaction.commit()
  }
}
