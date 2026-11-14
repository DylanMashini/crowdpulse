import type { DeviceRole, User } from '@triagecam/contracts';
import { useRouter } from 'expo-router';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Detail } from '@/components/Detail';
import { Notice } from '@/components/Notice';
import { RolePicker } from '@/components/RolePicker';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/TabScreen';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session/SessionProvider';
import { useAccountActions } from '@/lib/session/useAccountActions';

/** Settings of the camera role. The nurse role has the You tab. */
export default function Settings() {
  const { state } = useSession();
  if (state.status !== 'signedIn') return null;
  return <SettingsContent user={state.user} role={state.device?.role ?? null} />;
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
        <Card>
          <Detail label="Signed in as" value={user.email} />
          <Detail label="Server" value={api.baseUrl} />
        </Card>
        <Button variant="secondary" block label="Sign out" onPress={confirmSignOut} />
      </Section>
    </Screen>
  );
}
