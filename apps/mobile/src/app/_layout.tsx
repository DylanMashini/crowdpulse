import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Appearance, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { Text } from '@/components/Text';
import { Wordmark } from '@/components/Wordmark';
import { SessionProvider, useSession } from '@/lib/session/SessionProvider';
import { useTheme } from '@/theme';

// Night Shift is dark only. This makes what iOS draws (the tab bar's material, alerts, the
// keyboard, the refresh spinner) dark in both device appearances, to match what the app draws.
Appearance.setColorScheme('dark');

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="light" />
        <RootNavigator />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const theme = useTheme();
  const { state, retry, signOut } = useSession();

  if (state.status === 'loading' || state.status === 'unreachable') {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          padding: theme.space.space4,
          gap: theme.space.space6,
          backgroundColor: theme.colors.surface0,
        }}
      >
        <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center', gap: theme.space.space6 }}>
          <Wordmark />
          {state.status === 'loading' ? (
            <Text accessibilityLiveRegion="polite" style={[theme.type.body, { color: theme.colors.inkMuted }]}>
              Checking your sign-in
            </Text>
          ) : (
            <Notice title="Your sign-in could not be checked" body={state.message}>
              <Button variant="primary" block label="Try again" onPress={retry} />
              <Button variant="quiet" block label="Sign out" onPress={() => void signOut()} />
            </Notice>
          )}
        </View>
      </View>
    );
  }

  const signedIn = state.status === 'signedIn';
  const role = signedIn ? (state.device?.role ?? null) : null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.surface0 } }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
        <Stack.Screen name="check-email" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="role" />
        <Stack.Screen name="settings" />
      </Stack.Protected>
      <Stack.Protected guard={role === 'camera'}>
        <Stack.Screen name="camera" />
      </Stack.Protected>
      <Stack.Protected guard={role === 'nurse'}>
        <Stack.Screen name="nurse" />
      </Stack.Protected>
    </Stack>
  );
}
