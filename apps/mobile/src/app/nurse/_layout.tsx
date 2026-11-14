import { Stack } from 'expo-router';

import { NurseProvider } from '@/lib/nurse/NurseProvider';
import { useTheme } from '@/theme';

/**
 * The nurse role follows the device's light or dark setting. The four tabs sit under one
 * provider, so they share the worklist and the flags and a new flag is announced over all of
 * them. A patient opens over the tabs and goes back to the tab it was opened from.
 */
export default function NurseLayout() {
  const theme = useTheme();
  return (
    <NurseProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.surface } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="patient/[number]" />
      </Stack>
    </NurseProvider>
  );
}
