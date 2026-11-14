import * as SecureStore from 'expo-secure-store';

import { KEPT_FILES_LIMIT, type KeptFile, type KeptFileStore } from './sittingFile';

const KEY = 'triagecam.keptSittingFiles';

/**
 * The list of sitting files still on the phone, kept between runs of the app. It is a handful
 * of ids and paths (never the files), stored beside the device registration.
 */
export const keptFileStore: KeptFileStore = {
  async load() {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is KeptFile =>
        typeof entry === 'object' && entry !== null && typeof entry.sittingId === 'string' && typeof entry.fileUri === 'string',
    );
  },
  async save(files) {
    if (files.length === 0) {
      await SecureStore.deleteItemAsync(KEY);
      return;
    }
    // One more than the limit: the kept files and the one being uploaded.
    await SecureStore.setItemAsync(KEY, JSON.stringify(files.slice(-(KEPT_FILES_LIMIT + 1))));
  },
};
