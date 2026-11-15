import { WEBCAM, WEBCAM_FRAME_PREFIX_BYTES } from '@triagecam/contracts';

// This computer's webcam as a source of frames for a sitting: getUserMedia, one JPEG per camera
// frame with the time the camera took it. Nothing is measured here. The frames go to the
// server, where the same code that reads a phone's camera reads them (lib/webcam-station.ts).

export type WebcamFailure = 'permission_denied' | 'no_camera' | 'unavailable';

export class WebcamError extends Error {
  readonly kind: WebcamFailure;

  constructor(kind: WebcamFailure, message: string) {
    super(message);
    this.name = 'WebcamError';
    this.kind = kind;
  }
}

export interface WebcamFrame {
  jpeg: Blob;
  /** When the camera took the frame, on this browser's clock: ms since the epoch, fractions kept. */
  capturedAtMs: number;
}

export interface WebcamHandlers {
  /** False while the consumer has no room: the frame is then not encoded, and counted as dropped. */
  accepts: () => boolean;
  onFrame: (frame: WebcamFrame) => void;
  /** The camera stopped delivering frames: unplugged, taken by another program, or switched off. */
  onLost: () => void;
}

/** The body of the frames route: before each JPEG, its capture time and its length. */
export function frameBatch(frames: WebcamFrame[]): Blob {
  const parts: BlobPart[] = [];
  for (const frame of frames) {
    const prefix = new DataView(new ArrayBuffer(WEBCAM_FRAME_PREFIX_BYTES));
    prefix.setFloat64(0, frame.capturedAtMs, true);
    prefix.setUint32(8, frame.jpeg.size, true);
    parts.push(prefix.buffer, frame.jpeg);
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}

/** The size frames are sent at: the camera's own, or scaled so the long side is at most the limit. Even numbers. */
export function sendSize(width: number, height: number, maxLongSide: number = WEBCAM.maxLongSidePx): { width: number; height: number } {
  const scale = Math.min(1, maxLongSide / Math.max(width, height, 1));
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

function failure(error: unknown): WebcamError {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return new WebcamError('permission_denied', 'The browser has not been allowed to use the camera.');
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new WebcamError('no_camera', 'No camera was found on this computer.');
  return new WebcamError('unavailable', 'The webcam could not be started. Another program may be using it.');
}

// Chrome's reader of a camera track's frames. It runs when the tab is not in front, which a
// <video> element's frame callback does not.
interface TrackFrame {
  /** Microseconds, on the camera's own clock. */
  timestamp: number;
  displayWidth: number;
  displayHeight: number;
  close(): void;
}
type TrackProcessor = new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<TrackFrame> };

export class WebcamCapture {
  /** Frames the camera delivered that were not sent on. Cumulative. */
  dropped = 0;

  private readonly stream: MediaStream;
  private readonly handlers: WebcamHandlers;
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private video: HTMLVideoElement | null = null;
  private reader: ReadableStreamDefaultReader<TrackFrame> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private encoding = false;
  private drawn = false;
  /** Camera clock to this browser's wall clock, fixed at the first frame so the spacing of frames is the camera's own. */
  private clockOffsetMs: number | null = null;
  private lastFrameAt = performance.now();

  private constructor(stream: MediaStream, handlers: WebcamHandlers) {
    this.stream = stream;
    this.handlers = handlers;
    const context = this.canvas.getContext('2d', { alpha: false });
    if (!context) throw new WebcamError('unavailable', 'This browser cannot read frames from the camera.');
    this.context = context;
  }

  /** Asks for the camera and starts delivering frames. Rejects with a `WebcamError`. */
  static async open(handlers: WebcamHandlers): Promise<WebcamCapture> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new WebcamError('unavailable', 'This page cannot use a camera. Open the dashboard over https or on localhost.');
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: { ideal: WEBCAM.maxLongSidePx }, height: { ideal: 480 }, frameRate: { ideal: WEBCAM.fps } },
      });
    } catch (error) {
      throw failure(error);
    }
    let capture: WebcamCapture;
    try {
      capture = new WebcamCapture(stream, handlers);
      await capture.begin();
    } catch (error) {
      for (const track of stream.getTracks()) track.stop();
      throw error instanceof WebcamError ? error : failure(error);
    }
    return capture;
  }

  private async begin(): Promise<void> {
    const track = this.stream.getVideoTracks()[0];
    if (!track) throw new WebcamError('no_camera', 'No camera was found on this computer.');
    track.addEventListener('ended', () => this.lose());
    this.watchdog = setInterval(() => {
      if (performance.now() - this.lastFrameAt > WEBCAM.lostAfterMs) this.lose();
    }, 1000);

    const Processor = (globalThis as { MediaStreamTrackProcessor?: TrackProcessor }).MediaStreamTrackProcessor;
    if (Processor) {
      this.reader = new Processor({ track }).readable.getReader();
      void this.readTrack(this.reader);
      return;
    }
    // Other browsers: the frames of a playing <video>, which stop when the tab is hidden.
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;
    video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.append(video);
    this.video = video;
    await video.play();
    const onFrame: VideoFrameRequestCallback = (now, metadata) => {
      if (this.closed) return;
      // captureTime is on the page's own clock; without it, the time the frame was shown stands in.
      const pageMs = metadata.captureTime ?? metadata.presentationTime ?? now;
      this.take(video, video.videoWidth, video.videoHeight, performance.timeOrigin + pageMs);
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  }

  private async readTrack(reader: ReadableStreamDefaultReader<TrackFrame>): Promise<void> {
    try {
      for (;;) {
        const { value: frame, done } = await reader.read();
        if (done || !frame) break;
        try {
          const cameraMs = frame.timestamp / 1000;
          this.clockOffsetMs ??= performance.timeOrigin + performance.now() - cameraMs;
          this.take(frame as unknown as CanvasImageSource, frame.displayWidth, frame.displayHeight, cameraMs + this.clockOffsetMs);
        } finally {
          frame.close();
        }
      }
    } catch {
      // The track failed: the same as its end.
    }
    this.lose();
  }

  /** One camera frame: drawn at the size it is sent at and encoded, unless the last one is still being encoded. */
  private take(source: CanvasImageSource, width: number, height: number, capturedAtMs: number): void {
    if (this.closed || width === 0 || height === 0) return;
    this.lastFrameAt = performance.now();
    if (this.encoding || !this.handlers.accepts()) {
      this.dropped += 1;
      return;
    }
    const size = sendSize(width, height);
    if (this.canvas.width !== size.width || this.canvas.height !== size.height) {
      this.canvas.width = size.width;
      this.canvas.height = size.height;
    }
    this.context.drawImage(source, 0, 0, size.width, size.height);
    this.drawn = true;
    this.encoding = true;
    this.canvas.toBlob(
      (jpeg) => {
        this.encoding = false;
        if (this.closed) return;
        if (jpeg && jpeg.size <= WEBCAM.maxFrameBytes) this.handlers.onFrame({ jpeg, capturedAtMs });
        else this.dropped += 1;
      },
      'image/jpeg',
      WEBCAM.jpegQuality,
    );
  }

  /**
   * The newest frame as a JPEG in base64 with no `data:` prefix, for the face routes, which find
   * the face in it themselves. Null before the first frame.
   */
  snapshot(): string | null {
    if (this.closed || !this.drawn) return null;
    const url = this.canvas.toDataURL('image/jpeg', 0.85);
    const comma = url.indexOf(',');
    return comma === -1 ? null : url.slice(comma + 1);
  }

  private lose(): void {
    if (this.closed) return;
    this.close();
    this.handlers.onLost();
  }

  /** Turns the camera off. Its light goes out. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.watchdog) clearInterval(this.watchdog);
    void this.reader?.cancel().catch(() => {});
    for (const track of this.stream.getTracks()) track.stop();
    if (this.video) {
      this.video.srcObject = null;
      this.video.remove();
    }
  }
}
