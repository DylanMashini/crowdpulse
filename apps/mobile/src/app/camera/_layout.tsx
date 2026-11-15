import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import TriageCapture from 'triage-capture';

import { ThemeScope } from '@/components/ThemeScope';
import { createLandscapeLock } from '@/lib/capture/landscapeLock';
import { useStation } from '@/lib/capture/station';
import { useDevice } from '@/lib/session/SessionProvider';
import { useTheme } from '@/theme';

/** The camera role: check-in, face match, the sitting and its summary. */
export default function CameraLayout() {
  const theme = useTheme();
  // The check-in page on the dashboard can run a check-in on this phone while the camera role is open.
  useStation(useDevice()?.id ?? null);
  // The phone sits on its mount in landscape while it captures. The interface is turned when a
  // screen has finished arriving, never while the stack is moving (lib/capture/landscapeLock.ts).
  const [landscape] = useState(() => createLandscapeLock((locked) => TriageCapture.setLandscapeLock(locked)));
  useEffect(() => () => landscape.release(), [landscape]);
  return (
    <ThemeScope name="dark">
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.surface0 } }}
        screenListeners={({ route }) => ({
          transitionEnd: (event) => landscape.transitionEnded({ screen: route.name, closing: event.data.closing }),
        })}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="match" />
        <Stack.Screen name="sitting" options={{ gestureEnabled: false }} />
        <Stack.Screen name="summary" options={{ gestureEnabled: false }} />
      </Stack>
    </ThemeScope>
  );
}
