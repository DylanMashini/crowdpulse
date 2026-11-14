import { useEffect, useState } from 'react';
import TriageCapture, {
  type CameraFacing,
  CapturePreview,
  type FaceRegionsEvent,
  type ViewfinderState,
  hasCameraControls,
  hasNativePreview,
} from 'triage-capture';

import { captureErrorMessage } from '@/lib/capture/captureErrors';
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
      setFlipError(sentences(`The ${next} camera did not start`, captureErrorMessage(failure)));
    } finally {
      setFlipping(false);
    }
  };

  return (
    <Viewfinder
      state={state}
      regions={regions}
      message={flipError ?? message}
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
 * A pill on the picture that names the camera in use and flips to the other one. The touch
 * target is the full 48 points high; the pill is smaller.
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
      accessibilityLabel={`Switch to the ${next} camera`}
      accessibilityValue={{ text: `Using the ${camera} camera` }}
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        height: 40,
        minWidth: 40,
        paddingHorizontal: theme.space.space3,
        gap: theme.space.space2,
        borderRadius: theme.radius.radiusPill,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: colors.lineStrong,
        backgroundColor: pressed ? colors.surfaceRaised : colors.scrim,
        opacity: disabled ? 0.45 : 1,
      })}
    >
      <Icon name="flip-camera" size={20} color={colors.ink} />
      {/* The pill keeps its height, so its word grows less than the text around it. */}
      <Text maxFontSizeMultiplier={1.2} style={[theme.type.label, { color: colors.ink }]}>
        {camera === 'front' ? 'Front' : 'Back'}
      </Text>
    </Touchable>
  );
}
