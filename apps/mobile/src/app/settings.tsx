import { type DeviceRole, PROTOTYPE_NOTICE, type User } from '@triagecam/contracts';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { RolePicker } from '@/components/RolePicker';
import { Screen } from '@/components/Screen';
import { ThemeScope, useScopedTheme } from '@/components/ThemeScope';
import { api, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session/SessionProvider';
import { useTheme } from '@/theme';

export default function Settings() {
  const { state } = useSession();
  const device = useTheme();
  if (state.status !== 'signedIn') return null;
  const role = state.device?.role ?? null;
  // Opened from the camera role, settings stays dark like the rest of that role.
  const dark = role === 'camera';
  return (
    <ThemeScope name={dark ? 'dark' : device.name}>
      {dark ? <StatusBar style="light" /> : null}
      <SettingsContent user={state.user} role={role} />
    </ThemeScope>
  );
}

function SettingsContent({ user, role }: { user: User; role: DeviceRole | null }) {
  const theme = useScopedTheme();
  const router = useRouter();
  const { chooseRole, signOut } = useSession();
  const [roleAtOpen] = useState(role);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // A changed role means a different home screen: the anchor route picks it.
  useEffect(() => {
    if (role !== roleAtOpen) router.replace('/');
  }, [role, roleAtOpen, router]);

  const changeRole = async (next: DeviceRole) => {
    if (next === role) return;
    setBusy(true);
    setFailure(null);
    try {
      await chooseRole(next);
    } catch (error) {
      setFailure(errorMessage(error));
      setBusy(false);
    }
  };

  const confirmSignOut = () =>
    Alert.alert('Sign out of this phone?', 'The phone stops receiving flags until someone signs in again', [
      { text: 'Stay signed in', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);

  return (
    <Screen title="Settings" onBack={() => router.back()}>
      <Section heading="Role of this phone">
        <RolePicker value={role} onChange={(next) => void changeRole(next)} disabled={busy} />
        {failure ? <Notice title="The role was not changed" body={failure} /> : null}
      </Section>
      <Section heading="Account">
        <Detail label="Signed in as" value={user.email} />
        <Detail label="Server" value={api.baseUrl} />
        <Button variant="secondary" label="Sign out" onPress={confirmSignOut} />
      </Section>
      <Text style={[theme.type.caption, { color: theme.colors.inkMuted }]}>{PROTOTYPE_NOTICE}</Text>
    </Screen>
  );
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  const theme = useScopedTheme();
  return (
    <View style={{ gap: theme.space.space3 }}>
      <Text accessibilityRole="header" style={[theme.type.heading, { color: theme.colors.ink }]}>
        {heading}
      </Text>
      {children}
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  const theme = useScopedTheme();
  return (
    <View>
      <Text style={[theme.type.caption, { color: theme.colors.inkMuted }]}>{label}</Text>
      <Text selectable style={[theme.type.bodyTouch, { color: theme.colors.ink }]}>
        {value}
      </Text>
    </View>
  );
}
