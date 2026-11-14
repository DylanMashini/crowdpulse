import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

export type PushRegistration =
  | { available: true; token: string }
  /** `reason` is one sentence for the worklist, saying why and what still works. */
  | { available: false; reason: string };

/** While the app is open the flag is shown by the in-app PushBanner, not by a system banner. */
export function showFlagsInApp(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/** Asks for permission and an Expo push token. Never throws: an unavailable push has a reason. */
export async function registerForPush(): Promise<PushRegistration> {
  if (!Device.isDevice) {
    return { available: false, reason: 'Push notifications do not reach a simulator' };
  }
  try {
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
      permission = await Notifications.requestPermissionsAsync();
    }
    if (!permission.granted) {
      return { available: false, reason: 'Notifications are turned off for Triage Cam in the Settings app' };
    }
    const projectId: unknown = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (typeof projectId !== 'string') {
      return { available: false, reason: 'This build has no Expo project id, so it cannot receive push notifications' };
    }
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return { available: true, token: data };
  } catch (error) {
    console.warn('Push registration failed', error);
    return { available: false, reason: 'This phone could not register for push notifications' };
  }
}

/** The patient a notification is about, from the `data` the server attaches to every flag push. */
export function patientOfNotification(notification: Notifications.Notification): {
  flagId: string | null;
  patientNumber: number;
} | null {
  const data = notification.request.content.data as { flagId?: unknown; patientNumber?: unknown } | undefined;
  const patientNumber = Number(data?.patientNumber);
  if (!Number.isSafeInteger(patientNumber) || patientNumber < 1) return null;
  return { flagId: typeof data?.flagId === 'string' ? data.flagId : null, patientNumber };
}
