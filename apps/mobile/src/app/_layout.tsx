import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { SessionProvider, useSession } from '@/lib/session/SessionProvider';
import { fonts, useTheme } from '@/theme';
import { Text } from '@/components/Text';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="auto" />
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
          gap: theme.space.space5,
          backgroundColor: theme.colors.surface,
        }}
      >
        <View style={{ gap: theme.space.space1 }}>
          <Text style={[theme.type.title, { fontFamily: fonts.sans[600], color: theme.colors.ink }]}>Triage Cam</Text>
          <Text style={[theme.type.bodyTouch, { color: theme.colors.inkMuted }]}>Vitals station</Text>
        </View>
        {state.status === 'loading' ? (
          <Text accessibilityLiveRegion="polite" style={[theme.type.bodyTouch, { color: theme.colors.inkMuted }]}>
            Checking your sign-in
          </Text>
        ) : (
          <Notice title="Your sign-in could not be checked" body={state.message}>
            <Button variant="primary" block label="Try again" onPress={retry} />
            <Button variant="quiet" block label="Sign out" onPress={() => void signOut()} />
          </Notice>
        )}
      </View>
    );
  }

  const signedIn = state.status === 'signedIn';
  const role = signedIn ? (state.device?.role ?? null) : null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.surface } }}>
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
