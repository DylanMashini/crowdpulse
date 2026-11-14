import { useEffect, useState } from 'react';
import { View } from 'react-native';
import TriageCapture, {
  type CameraFacing,
  CapturePreview,
  type FaceRegionsEvent,
  type ViewfinderState,
  hasCameraControls,
  hasNativePreview,
} from 'triage-capture';

import { EXPOSURE_STUCK_AFTER_SECONDS } from '@triagecam/contracts';

import { captureErrorMessage } from '@/lib/capture/captureErrors';
import { viewfinderHint } from '@/lib/capture/readingFormat';
import { sentences } from '@/lib/format';

import { Icon } from './Icon';
import { Text } from './Text';
import { useScopedTheme } from './ThemeScope';
import { Touchable } from './Touchable';
import { Viewfinder } from './Viewfinder';

type Props = {
  state: ViewfinderState;
  message?: string;
  /** True while changing camera would spoil what is being measured: a sitting is running. */
  flipDisabled?: boolean;
};

/** What the cameras are called on screen. "Rear", not "back": on a control, Back reads as the way out. */
const CAMERA_WORD: Record<CameraFacing, string> = { back: 'rear', front: 'front' };

/** How long a failed flip stays in place of the framing guidance. */
const FLIP_ERROR_MS = 6000;

/**
 * The Viewfinder over the live camera picture, fed by the capture module's outline events. It
 * keeps the ten-per-second updates to itself, so the rest of the screen renders once per second.
 * The corner control flips between the back and the front camera; the choice is remembered.
 */
export function LiveViewfinder({ state, message, flipDisabled = false }: Props) {
  const [regions, setRegions] = useState<FaceRegionsEvent | null>(null);
  const [camera, setCamera] = useState<CameraFacing>(() => (hasCameraControls ? TriageCapture.getCamera() : 'back'));
  const [flipping, setFlipping] = useState(false);
  const [flipError, setFlipError] = useState<string | null>(null);

  useEffect(() => {
    const subscription = TriageCapture.addListener('onFaceRegions', setRegions);
    return () => subscription.remove();
  }, []);

  // Exposure still locking after this long will not settle by itself (`viewfinderHint`).
  const [lockingSeconds, setLockingSeconds] = useState(0);
  useEffect(() => {
    if (state !== 'locking') return;
    const timer = setTimeout(() => setLockingSeconds(EXPOSURE_STUCK_AFTER_SECONDS), EXPOSURE_STUCK_AFTER_SECONDS * 1000);
    return () => {
      clearTimeout(timer);
      setLockingSeconds(0);
    };
  }, [state]);

  // The reason a flip failed is read once; after that the framing guidance matters more.
  useEffect(() => {
    if (!flipError) return;
    const timer = setTimeout(() => setFlipError(null), FLIP_ERROR_MS);
    return () => clearTimeout(timer);
  }, [flipError]);

  const flip = async () => {
    const next: CameraFacing = camera === 'back' ? 'front' : 'back';
    setFlipping(true);
    setFlipError(null);
    try {
      await TriageCapture.setCamera(next);
      // The outlines of the camera that was just left do not belong on the new picture.
      setRegions(null);
      setCamera(next);
    } catch (failure) {
      setFlipError(sentences(`The ${CAMERA_WORD[next]} camera did not start`, captureErrorMessage(failure)));
    } finally {
      setFlipping(false);
    }
  };

  return (
    <Viewfinder
      state={state}
      regions={regions}
      message={flipError ?? message ?? viewfinderHint(state, lockingSeconds)}
      picture={hasNativePreview ? <CapturePreview style={{ flex: 1 }} /> : undefined}
      mirrored={hasNativePreview && camera === 'front'}
      control={
        hasCameraControls ? (
          <FlipCameraButton camera={camera} disabled={flipDisabled || flipping} onPress={() => void flip()} />
        ) : undefined
      }
    />
  );
}

type FlipProps = { camera: CameraFacing; disabled: boolean; onPress: () => void };

/**
 * A round control on the picture with the camera in use named under it, so the front camera
 * is not told apart by the mirrored picture alone. It keeps to the corner: the word sits under
 * the disc, not beside it, where the outline labels are drawn.
 */
function FlipCameraButton({ camera, disabled, onPress }: FlipProps) {
  const theme = useScopedTheme();
  const { colors } = theme;
  const next = camera === 'back' ? 'front' : 'back';
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={`Switch to the ${CAMERA_WORD[next]} camera`}
      accessibilityValue={{ text: `Using the ${CAMERA_WORD[camera]} camera` }}
      accessibilityState={{ disabled }}
      style={{ alignItems: 'center', gap: theme.space.space1, opacity: disabled ? 0.45 : 1 }}
    >
      {({ pressed }) => (
        <>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: theme.radius.radiusPill,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: colors.lineStrong,
              backgroundColor: pressed ? colors.surfaceRaised : colors.scrim,
            }}
          >
            <Icon name="flip-camera" size={20} color={colors.ink} />
          </View>
          <View
            style={{
              paddingHorizontal: theme.space.space2,
              paddingVertical: 2,
              borderRadius: theme.radius.radiusPill,
              backgroundColor: colors.scrim,
            }}
          >
            <Text maxFontSizeMultiplier={1.2} style={[theme.type.label, { color: colors.ink }]}>
              {camera === 'front' ? 'Front' : 'Rear'}
            </Text>
          </View>
        </>
      )}
    </Touchable>
  );
}
