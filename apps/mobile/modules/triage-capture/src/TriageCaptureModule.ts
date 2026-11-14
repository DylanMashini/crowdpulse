import { requireOptionalNativeModule } from 'expo';

import { TriageCaptureStub } from './stub';
import type { TriageCapture } from './types';

const native = requireOptionalNativeModule<TriageCapture>('TriageCapture');

// A build made before the Swift side existed has the module but none of its functions.
const implemented = typeof native?.startCapture === 'function';

const TriageCaptureModule: TriageCapture = implemented && native ? native : new TriageCaptureStub();

export default TriageCaptureModule;
