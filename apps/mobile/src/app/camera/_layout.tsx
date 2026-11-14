import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { ThemeScope } from '@/components/ThemeScope';
import { useTheme } from '@/theme';

/** The camera role is always dark, whatever the device setting. */
export default function CameraLayout() {
  const theme = useTheme('dark');
  return (
    <ThemeScope name="dark">
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.surface } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="match" />
        <Stack.Screen name="sitting" options={{ gestureEnabled: false }} />
        <Stack.Screen name="summary" options={{ gestureEnabled: false }} />
      </Stack>
    </ThemeScope>
  );
}
