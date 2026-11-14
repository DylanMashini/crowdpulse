import type { DeviceRole, User } from '@triagecam/contracts';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { RolePicker } from '@/components/RolePicker';
import { Screen } from '@/components/Screen';
import { ThemeScope, useScopedTheme } from '@/components/ThemeScope';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session/SessionProvider';
import { useAccountActions } from '@/lib/session/useAccountActions';
import { Text } from '@/components/Text';

/** Settings of the camera role, always dark like the rest of it. The nurse role has the You tab. */
export default function Settings() {
  const { state } = useSession();
  if (state.status !== 'signedIn') return null;
  return (
    <ThemeScope name="dark">
      <StatusBar style="light" />
      <SettingsContent user={state.user} role={state.device?.role ?? null} />
    </ThemeScope>
  );
}

function SettingsContent({ user, role }: { user: User; role: DeviceRole | null }) {
  const router = useRouter();
  const { busy, failure, changeRole, confirmSignOut } = useAccountActions(role);

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
