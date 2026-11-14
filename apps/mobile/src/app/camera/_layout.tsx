import { Stack } from 'expo-router';

import { ThemeScope } from '@/components/ThemeScope';
import { useStation } from '@/lib/capture/station';
import { useDevice } from '@/lib/session/SessionProvider';
import { useTheme } from '@/theme';

/** The camera role: check-in, face match, the sitting and its summary. */
export default function CameraLayout() {
  const theme = useTheme();
  // The check-in page on the dashboard can run a check-in on this phone while the camera role is open.
  useStation(useDevice()?.id ?? null);
  return (
    <ThemeScope name="dark">
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.surface0 } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="match" />
        <Stack.Screen name="sitting" options={{ gestureEnabled: false }} />
        <Stack.Screen name="summary" options={{ gestureEnabled: false }} />
      </Stack>
    </ThemeScope>
  );
}
