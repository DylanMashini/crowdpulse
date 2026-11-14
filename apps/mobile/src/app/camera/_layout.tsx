import { Stack } from 'expo-router';

import { ThemeScope } from '@/components/ThemeScope';
import { useTheme } from '@/theme';

/** The camera role: check-in, face match, the sitting and its summary. */
export default function CameraLayout() {
  const theme = useTheme();
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
