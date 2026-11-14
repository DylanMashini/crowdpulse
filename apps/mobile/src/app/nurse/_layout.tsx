import { Stack } from 'expo-router';

import { FlagFeedProvider } from '@/lib/nurse/FlagFeed';
import { useTheme } from '@/theme';

/** The nurse role follows the device's light or dark setting. Flags arrive over every screen in it. */
export default function NurseLayout() {
  const theme = useTheme();
  return (
    <FlagFeedProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.surface } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="ticket/[number]" />
      </Stack>
    </FlagFeedProvider>
  );
}
