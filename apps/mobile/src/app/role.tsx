import type { DeviceRole } from '@triagecam/contracts';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { RolePicker } from '@/components/RolePicker';
import { Screen } from '@/components/Screen';
import { errorMessage } from '@/lib/api';
import { useDevice, useSession } from '@/lib/session/SessionProvider';

/** Shown once after sign-in. Nothing is selected until the person chooses. */
export default function ChooseRole() {
  const router = useRouter();
  const { chooseRole } = useSession();
  const device = useDevice();
  const [role, setRole] = useState<DeviceRole | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Once the phone is registered, the anchor route sends it to its role.
  useEffect(() => {
    if (device) router.replace('/');
  }, [device, router]);

  const confirm = async (chosen: DeviceRole) => {
    setBusy(true);
    setFailure(null);
    try {
      await chooseRole(chosen);
    } catch (error) {
      setFailure(errorMessage(error));
      setBusy(false);
    }
  };

  return (
    <Screen title="What is this phone for?" subtitle="You can change the role later in settings">
      <RolePicker value={role} onChange={setRole} disabled={busy} />
      {failure ? <Notice title="The role was not saved" body={failure} /> : null}
      <Button
        variant="primary"
        block
        label={busy ? 'Saving role' : role ? `Continue as ${role}` : 'Choose a role to continue'}
        disabled={busy || role === null}
        onPress={() => role && void confirm(role)}
      />
    </Screen>
  );
}
