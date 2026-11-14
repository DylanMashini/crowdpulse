import type { DeviceRole, User } from '@triagecam/contracts';
import * as Device from 'expo-device';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, errorMessage, isApiError, onUnauthenticated, setAuthToken } from '@/lib/api';

import { type StoredDevice, clearToken, loadDevice, loadToken, saveDevice, saveToken } from './storage';

export type SessionState =
  | { status: 'loading' }
  /** A token is stored but the server could not be asked about it. */
  | { status: 'unreachable'; message: string }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: User; device: { id: string; role: DeviceRole } | null };

type Session = {
  state: SessionState;
  /** Asks the server about the stored token again. */
  retry: () => void;
  /** Rejects with an ApiError; the form shows it. */
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Registers this phone in a role, or changes the role of the phone already registered. */
  chooseRole: (role: DeviceRole) => Promise<void>;
  /** Tells the server where to send flags for this phone. Null clears it. */
  setPushToken: (expoPushToken: string | null) => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

function deviceLabel(role: DeviceRole): string {
  const base = role === 'camera' ? 'Camera phone' : 'Nurse phone';
  return (Device.modelName ? `${base}, ${Device.modelName}` : base).slice(0, 60);
}

/** Asks the server who the stored token belongs to. */
async function restoreSession(): Promise<SessionState> {
  const token = await loadToken();
  if (!token) return { status: 'signedOut' };
  setAuthToken(token);
  try {
    const [{ user }, stored] = await Promise.all([api.me(), loadDevice()]);
    const device = stored && stored.userId === user.id ? { id: stored.id, role: stored.role } : null;
    return { status: 'signedIn', user, device };
  } catch (error) {
    // An expired or revoked token: the API client has already cleared it.
    if (isApiError(error) && error.code === 'unauthenticated') return { status: 'signedOut' };
    return { status: 'unreachable', message: errorMessage(error) };
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const dropSession = useCallback(() => {
    setAuthToken(null);
    void clearToken();
    setState({ status: 'signedOut' });
  }, []);

  useEffect(() => {
    onUnauthenticated(dropSession);
    void restoreSession().then(setState);
  }, [dropSession]);

  const register = useCallback(
    async (user: User, existing: { id: string } | null, role: DeviceRole, expoPushToken?: string | null) => {
      const request = { role, label: deviceLabel(role), expoPushToken };
      let device;
      try {
        ({ device } = await api.registerDevice(existing ? { id: existing.id, ...request } : request));
      } catch (error) {
        // The stored id belongs to a device the server no longer has: register as a new one.
        if (!existing || !isApiError(error) || error.code !== 'not_found') throw error;
        ({ device } = await api.registerDevice(request));
      }
      const stored: StoredDevice = { userId: user.id, id: device.id, role: device.role };
      await saveDevice(stored);
      setState({ status: 'signedIn', user, device: { id: stored.id, role: stored.role } });
    },
    [],
  );

  const session = useMemo<Session>(
    () => ({
      state,
      retry() {
        setState({ status: 'loading' });
        void restoreSession().then(setState);
      },
      async signIn(email, password) {
        const response = await api.signIn(email, password);
        if (!response.token) {
          throw new Error(`The server at ${api.baseUrl} signed in without a token for this phone`);
        }
        setAuthToken(response.token);
        await saveToken(response.token);
        const stored = await loadDevice();
        const device = stored && stored.userId === response.user.id ? { id: stored.id, role: stored.role } : null;
        setState({ status: 'signedIn', user: response.user, device });
      },
      async signOut() {
        if (state.status === 'signedIn') {
          // Best effort: a phone that is signed out should stop receiving flags, and the
          // session should end on the server. Neither may keep the person signed in here.
          try {
            if (state.device?.role === 'nurse') {
              await api.registerDevice({
                id: state.device.id,
                role: 'nurse',
                label: deviceLabel('nurse'),
                expoPushToken: null,
              });
            }
            await api.signOut();
          } catch (error) {
            console.warn('Sign-out did not reach the server', error);
          }
        }
        dropSession();
      },
      async chooseRole(role) {
        if (state.status !== 'signedIn') return;
        await register(state.user, state.device, role);
      },
      async setPushToken(expoPushToken) {
        if (state.status !== 'signedIn' || !state.device) return;
        await register(state.user, state.device, state.device.role, expoPushToken);
      },
    }),
    [state, dropSession, register],
  );

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession needs a SessionProvider above it');
  return session;
}

/** The registered device of this phone, or null while signed out or before a role is chosen. */
export function useDevice(): { id: string; role: DeviceRole } | null {
  const { state } = useSession();
  return state.status === 'signedIn' ? state.device : null;
}
