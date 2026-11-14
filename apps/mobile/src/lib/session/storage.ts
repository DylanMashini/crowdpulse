import type { DeviceRole } from '@triagecam/contracts';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'triagecam.token';
const DEVICE_KEY = 'triagecam.device';

/** The device this phone registered, and whose account it belongs to. */
export type StoredDevice = { userId: string; id: string; role: DeviceRole };

export const loadToken = () => SecureStore.getItemAsync(TOKEN_KEY);
export const saveToken = (token: string) => SecureStore.setItemAsync(TOKEN_KEY, token);
export const clearToken = () => SecureStore.deleteItemAsync(TOKEN_KEY);

export async function loadDevice(): Promise<StoredDevice | null> {
  const raw = await SecureStore.getItemAsync(DEVICE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredDevice>;
    if (typeof value.userId !== 'string' || typeof value.id !== 'string') return null;
    if (value.role !== 'camera' && value.role !== 'nurse') return null;
    return { userId: value.userId, id: value.id, role: value.role };
  } catch {
    // Unreadable means not registered: the role picker runs again.
    return null;
  }
}

export const saveDevice = (device: StoredDevice) => SecureStore.setItemAsync(DEVICE_KEY, JSON.stringify(device));
