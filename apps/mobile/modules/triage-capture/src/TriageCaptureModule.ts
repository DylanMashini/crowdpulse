import { requireOptionalNativeModule } from 'expo';

import { TriageCaptureStub } from './stub';
import type { TriageCapture } from './types';

const native = requireOptionalNativeModule<TriageCapture>('TriageCapture');

// A build made before the Swift side existed has the module but none of its functions.
const implemented = typeof native?.startCapture === 'function';

const TriageCaptureModule: TriageCapture = implemented && native ? native : new TriageCaptureStub();

/**
 * True when the build has the camera flip and the native preview view. A development build
 * made before they existed still measures; it shows outlines on a dark field and no flip control.
 */
export const hasCameraControls = !implemented || typeof native?.setCamera === 'function';

/** True when `CapturePreview` draws a picture: the camera on a phone, the test pattern on the simulator. */
export const hasNativePreview = implemented && typeof native?.setCamera === 'function';

export default TriageCaptureModule;
