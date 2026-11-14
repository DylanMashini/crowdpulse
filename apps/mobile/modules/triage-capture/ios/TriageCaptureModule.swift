import ExpoModulesCore

// The JavaScript contract for this module is ../src/types.ts (docs/CONTRACTS.md section 3).
// This file only translates between that contract and CaptureController.

struct CaptureOptionsRecord: Record {
  init() {}

  @Field var camera: String?
  @Field var frameRate: Double?
}

struct StartSittingRecord: Record {
  init() {}

  @Field var sittingId: String = ""
}

struct LivePreviewRecord: Record {
  init() {}

  @Field var enabled: Bool = false
  @Field var fps: Double?
  @Field var maxLongSide: Double?
  @Field var quality: Double?
  /// Where to post the frames. Set: the module uploads them itself. Nil: onPreviewFrame.
  @Field var uploadUrl: String?
  @Field var uploadHeaders: [String: String]?
}

public class TriageCaptureModule: Module {
  private lazy var controller = CaptureController { [weak self] event, body in
    self?.sendEvent(event, body)
  }

  public func definition() -> ModuleDefinition {
    Name("TriageCapture")

    Events("onReading", "onStatus", "onFaceRegions", "onPreviewFrame", "onLiveUpload", "onError")

    Function("getSource") { () -> String in
      self.controller.sourceName
    }

    AsyncFunction("getCameraPermission") { () -> String in
      self.controller.permission().rawValue
    }

    AsyncFunction("requestCameraPermission") { (promise: Promise) in
      self.controller.requestPermission { promise.resolve($0.rawValue) }
    }

    AsyncFunction("startCapture") { (options: CaptureOptionsRecord?, promise: Promise) in
      var settings = CaptureSettings()
      if let camera = options?.camera.flatMap(CameraPosition.init(rawValue:)) { settings.camera = camera }
      if options?.frameRate == 30 { settings.frameRate = 30 }
      self.controller.startCapture(settings) { result in
        switch result {
        case .success: promise.resolve(nil)
        case .failure(let error): promise.reject(error)
        }
      }
    }

    AsyncFunction("stopCapture") { (promise: Promise) in
      self.controller.stopCapture { promise.resolve(nil) }
    }

    AsyncFunction("startSitting") { (options: StartSittingRecord, promise: Promise) in
      self.controller.startSitting(options.sittingId) { result in
        switch result {
        case .success(let started):
          promise.resolve(["sittingId": started.sittingId, "startedAt": Timestamps.string(from: started.startedAt)])
        case .failure(let error):
          promise.reject(error)
        }
      }
    }

    AsyncFunction("stopSitting") { (promise: Promise) in
      self.controller.stopSitting { result in
        switch result {
        case .success(let outcome):
          promise.resolve([
            "sittingId": outcome.sittingId,
            "endedAt": Timestamps.string(from: outcome.endedAt),
            "summary": Payloads.summary(outcome.summary),
            "fileUri": outcome.fileURL.map { $0.absoluteString as Any } ?? NSNull(),
          ] as [String: Any])
        case .failure(let error):
          promise.reject(error)
        }
      }
    }

    AsyncFunction("deleteSittingFile") { (fileUri: String, promise: Promise) in
      do {
        try self.controller.deleteSittingFile(fileUri)
        promise.resolve(nil)
      } catch {
        promise.reject(error as? CaptureError ?? CaptureError(.file, error.localizedDescription))
      }
    }

    AsyncFunction("setLivePreview") { (options: LivePreviewRecord) in
      var upload: LiveUploadTarget?
      if let address = options.uploadUrl {
        guard let url = URL(string: address), url.scheme == "http" || url.scheme == "https" else {
          throw CaptureError(.file, "The live-view address is not a valid URL")
        }
        upload = LiveUploadTarget(url: url, headers: options.uploadHeaders ?? [:])
      }
      self.controller.setLivePreview(
        framesPerSecond: options.fps, maxLongSide: options.maxLongSide, quality: options.quality,
        enabled: options.enabled, upload: upload
      )
    }

    AsyncFunction("captureFaceCrop") { (promise: Promise) in
      self.controller.captureFaceCrop { result in
        switch result {
        case .success(let image): promise.resolve(Payloads.image(image))
        case .failure(let error): promise.reject(error)
        }
      }
    }

    Function("setLandscapeLock") { (locked: Bool) in
      DispatchQueue.main.async { OrientationLock.set(landscapeOnly: locked) }
    }

    OnDestroy {
      self.controller.shutdown()
    }
  }
}

private extension Promise {
  /// Rejects with an `Error` whose `code` is the contract's error code.
  func reject(_ error: CaptureError) {
    reject(error.code.rawValue, error.message)
  }
}
