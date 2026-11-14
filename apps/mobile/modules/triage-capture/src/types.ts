import type { CaptureSource, EstimateReason, LiveFrame, Reading, SittingSummary, SummaryValue } from '@triagecam/contracts';

// The JavaScript API of the capture module. docs/CONTRACTS.md section 3 is the prose version.
// The Swift module (ios/TriageCaptureModule.swift) and the stub (./stub.ts) both implement it.

export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

/** ProcessInfo.ThermalState. `serious` and `critical` mean the phone is throttling. */
export type ThermalState = 'nominal' | 'fair' | 'serious' | 'critical';

/** What the viewfinder should say. Matches the design system's Viewfinder states. */
export type ViewfinderState =
  /** Looking for a face. */
  | 'searching'
  /** Face found; exposure, white balance and focus are settling. */
  | 'locking'
  /** Face tracked and exposure locked. */
  | 'measuring'
  /** A face was being measured and is gone. The reading is blank. */
  | 'lost';

/**
 * A point in the camera frame as shown upright on screen: x right, y down, both 0 to 1,
 * origin at the top-left corner. Only coordinates cross the bridge here, never pixels.
 */
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

export type CaptureOptions = {
  /** Default `back`: the phone is mounted with its rear camera facing the patient. */
  camera?: 'back' | 'front';
  /** Requested frame rate. Default 60; the module falls back to 30 if 60 cannot be held. */
  frameRate?: 30 | 60;
};

export type StartSittingOptions = {
  /** Server id from POST /api/sittings. Written into the sitting file header. */
  sittingId: string;
};

export type SittingStarted = {
  sittingId: string;
  /** Phone wall clock at the first frame of the sitting, ISO 8601 UTC. */
  startedAt: string;
};

/** Why RMSSD and SDNN are withheld: the engine's `SummaryReason`. */
export type VariabilityReason =
  /** No heart-rate reading was valid, so there was nowhere to look for beats. */
  | 'no_heart_rate'
  /** The rate was readable, but single beats could not be timed well enough. */
  | 'low_quality'
  | 'too_few_beats'
  /** Accepted beat intervals span too little of the sitting. */
  | 'low_beat_coverage';

/** A summary value with the engine's reason for withholding it. Null if and only if there is a value. */
export type ReasonedSummaryValue<Reason extends string> = SummaryValue & { reason: Reason | null };

/**
 * SignalEngine.finish() as it crosses the bridge: the wire SittingSummary plus `reason` on the
 * four values. The server's schema has no `reason` and ignores it.
 */
export type CaptureSittingSummary = Omit<SittingSummary, 'heartRate' | 'breathingRate' | 'rmssd' | 'sdnn'> & {
  heartRate: ReasonedSummaryValue<EstimateReason | 'too_few_readings'>;
  breathingRate: ReasonedSummaryValue<EstimateReason | 'too_few_readings'>;
  rmssd: ReasonedSummaryValue<VariabilityReason>;
  sdnn: ReasonedSummaryValue<VariabilityReason>;
};

export type SittingResult = {
  sittingId: string;
  /** Phone wall clock at the last frame, ISO 8601 UTC. */
  endedAt: string;
  /** SignalEngine.finish(), unchanged. Send it as the body of the finish request. */
  summary: CaptureSittingSummary;
  /** file:// URI of the sitting file (JSON Lines). Null from the stub, which records nothing. */
  fileUri: string | null;
};

export type LivePreviewOptions = {
  enabled: boolean;
  /** Frames per second, 1 to 30. Default 2. */
  fps?: number;
  /** Longest side of the JPEG in pixels, at most 640. Default 480. */
  maxLongSide?: number;
  /** JPEG quality, 0 to 1. Default 0.5. */
  quality?: number;
  /**
   * Where the module posts each frame itself (the live-view route, as an absolute URL), as a
   * raw image/jpeg body. With it set, onLiveUpload reports once per second and onPreviewFrame
   * is not sent. Without it, frames arrive as onPreviewFrame for JavaScript to post.
   */
  uploadUrl?: string;
  /** Headers for those posts: the bearer token and anything the tunnel needs. */
  uploadHeaders?: Record<string, string>;
};

export type FaceCrop = {
  /** JPEG of the face only, base64 without a data: prefix, at most 512 px on the long side. */
  jpegBase64: string;
  width: number;
  height: number;
};

/** Once per second during a sitting. */
export type ReadingEvent = {
  sittingId: string;
  /** Ready to post to the server as it is. */
  reading: Reading;
};

/** Once per second while capture runs, whether or not a sitting is running. */
export type CaptureStatusEvent = {
  source: CaptureSource;
  /** Frames delivered in the last second. */
  fps: number;
  /** Frames dropped since the sitting started, or since capture started when none is running. */
  droppedFrames: number;
  exposureLocked: boolean;
  thermalState: ThermalState;
  facePresent: boolean;
  viewfinder: ViewfinderState;
  /** The running sitting, or null. */
  sittingId: string | null;
  /** Milliseconds since the first frame of the running sitting, or null. */
  sittingElapsedMs: number | null;
};

/** About ten times per second while capture runs. Outlines for the viewfinder overlay. */
export type FaceRegionsEvent = {
  /** Width divided by height of the upright frame the coordinates refer to. */
  aspectRatio: number;
  /** All null when no face is tracked. */
  face: Rect | null;
  /** Closed polygons, 4 to 12 points each. */
  forehead: Point[] | null;
  /** The cheek on the left of the image. */
  leftCheek: Point[] | null;
  rightCheek: Point[] | null;
  /** The upper-chest region breathing is measured on. Null when it is not tracked. */
  chest: Rect | null;
};

/** One live-view frame, at the rate set by setLivePreview. Post it to the live-view route. */
export type PreviewFrameEvent = LiveFrame;

export type CaptureErrorCode =
  | 'ERR_CAMERA_PERMISSION'
  | 'ERR_CAMERA_UNAVAILABLE'
  | 'ERR_CAPTURE_INTERRUPTED'
  | 'ERR_NOT_CAPTURING'
  | 'ERR_SITTING_RUNNING'
  | 'ERR_NO_SITTING'
  | 'ERR_NO_FACE'
  | 'ERR_FILE';

/** Once per second while the module uploads live-view frames itself. */
export type LiveUploadEvent = {
  /** Frames the server accepted in the last second. */
  delivered: number;
  /** Frames that were refused or could not be sent. */
  failed: number;
  /** Dashboards watching, from the newest answer. Null when nothing was accepted. */
  viewers: number | null;
};

/** Failures that happen outside a call, such as the camera being interrupted. */
export type CaptureErrorEvent = { code: CaptureErrorCode; message: string };

export type TriageCaptureEvents = {
  onReading: (event: ReadingEvent) => void;
  onStatus: (event: CaptureStatusEvent) => void;
  onFaceRegions: (event: FaceRegionsEvent) => void;
  onPreviewFrame: (event: PreviewFrameEvent) => void;
  onLiveUpload: (event: LiveUploadEvent) => void;
  onError: (event: CaptureErrorEvent) => void;
};

export type Subscription = { remove: () => void };

/**
 * Every promise rejects with an Error whose `code` is a CaptureErrorCode.
 * Optional values cross the bridge as null, never as a missing key.
 */
export interface TriageCapture {
  /**
   * `camera` on a phone. `simulated` on the iOS simulator, where the Swift module replays a
   * synthetic sitting through the real engine. `stub` when the native module is not in the
   * build and the JavaScript stand-in is answering.
   */
  getSource(): CaptureSource;

  getCameraPermission(): Promise<PermissionStatus>;
  requestCameraPermission(): Promise<PermissionStatus>;

  /** Starts the camera and face tracking. onStatus and onFaceRegions begin. Safe to call twice. */
  startCapture(options?: CaptureOptions): Promise<void>;
  /** Stops the camera. A running sitting is abandoned and its file deleted. */
  stopCapture(): Promise<void>;

  /** Starts the engine and the sitting file on the next frame. onReading begins. */
  startSitting(options: StartSittingOptions): Promise<SittingStarted>;
  /** Ends the sitting and returns its summary. The caller decides when 60 seconds are up. */
  stopSitting(): Promise<SittingResult>;
  /** Removes a sitting file once it has been uploaded or is not wanted. */
  deleteSittingFile(fileUri: string): Promise<void>;

  /** Turns the live view on or off. Off by default; frames are never written to disk. */
  setLivePreview(options: LivePreviewOptions): Promise<void>;

  /** A crop of the tracked face from the current frame, for an opted-in patient only. */
  captureFaceCrop(): Promise<FaceCrop>;

  /**
   * Holds the interface in landscape while true: the phone sits on its mount that way during a
   * sitting. False gives the orientations in app.json back.
   */
  setLandscapeLock(locked: boolean): void;

  addListener<Name extends keyof TriageCaptureEvents>(name: Name, listener: TriageCaptureEvents[Name]): Subscription;
}
