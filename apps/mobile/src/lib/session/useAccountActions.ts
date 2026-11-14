import type { DeviceRole } from '@triagecam/contracts';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { errorMessage } from '@/lib/api';

import { useSession } from './SessionProvider';

/**
 * Changing the role of this phone and signing out, for the settings screen of the camera role
 * and the You tab of the nurse role. A changed role means a different home, which the anchor
 * route picks.
 */
export function useAccountActions(role: DeviceRole | null) {
  const router = useRouter();
  const { chooseRole, signOut } = useSession();
  const [roleAtOpen] = useState(role);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

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

  return { busy, failure, changeRole, confirmSignOut };
}
