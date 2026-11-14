import { requireNativeView } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

import { hasNativePreview } from './TriageCaptureModule';

const NativePreview: ComponentType<ViewProps> | null = hasNativePreview
  ? requireNativeView<ViewProps>('TriageCapture')
  : null;

/**
 * The live camera picture, drawn natively from the capture session (ios/CapturePreviewView.swift):
 * no frame crosses the bridge. It fills its box and crops the overflow, and shows the front
 * camera mirrored. On the simulator it shows the test pattern. It renders nothing in a build
 * without the native view (the JavaScript stub, or a development build made before it existed).
 */
export function CapturePreview(props: ViewProps) {
  return NativePreview ? <NativePreview {...props} /> : null;
}
