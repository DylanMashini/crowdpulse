import { isApiError } from '../api/errors.ts';

/** How many times a sitting file is offered to the server before the phone gives up. */
export const FILE_UPLOAD_ATTEMPTS = 3;
const RETRY_MS = 1500;

/** How many files that failed to upload are kept for a later try. About 1.2 MB a minute each. */
export const KEPT_FILES_LIMIT = 5;

export type SittingFileHandOff = {
  /** Whether the server wants the file at all: development builds only. */
  wanted: boolean;
  upload: () => Promise<void>;
  remove: () => Promise<void>;
  /**
   * True for a failure that sending the file again cannot get past: the server does not know
   * the sitting, the file is too large, or the server takes no files at all. Such a file is
   * removed, because nothing will ever take it.
   */
  permanent?: (failure: unknown) => boolean;
  wait?: (ms: number) => Promise<void>;
  /** Called once at most for one hand-off, with the last failure: a file is one line in the log, not four. */
  warn?: (message: string, failure?: unknown) => void;
};

/** The file is no longer on the phone (iOS clears the caches folder when it needs the space). */
export class SittingFileGone extends Error {
  constructor() {
    super('The sitting file is no longer on the phone');
    this.name = 'SittingFileGone';
  }
}

/**
 * Whether sending the file again later cannot succeed. A 401 is not one of those: the device's
 * session ran out, and the same file goes through once someone signs in again.
 */
export function isPermanentRefusal(failure: unknown): boolean {
  if (failure instanceof SittingFileGone) return true;
  return isApiError(failure) && !failure.retryable && failure.status !== 401;
}

export type SittingFileOutcome = 'uploaded' | 'kept' | 'discarded' | 'refused';

/**
 * Hands a finished sitting's file to the server and removes it from the phone.
 *
 * The file is the only record of what the camera saw, and a sitting that ended with no reading
 * cannot be examined without it. So in development it is removed only once the server has it:
 * the upload is tried `FILE_UPLOAD_ATTEMPTS` times, and when every try fails the file stays on
 * the phone (`createSittingFileShelf` offers it again later). A file the server refuses for
 * good is removed. Outside development the file is not wanted and is removed at once.
 */
export async function handOffSittingFile({
  wanted,
  upload,
  remove,
  permanent = () => false,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  warn = (message, failure) => console.warn(message, failure),
}: SittingFileHandOff): Promise<SittingFileOutcome> {
  let uploaded = false;
  let refused = false;
  let lastFailure: unknown;
  if (wanted) {
    for (let attempt = 1; attempt <= FILE_UPLOAD_ATTEMPTS && !uploaded && !refused; attempt += 1) {
      try {
        await upload();
        uploaded = true;
      } catch (failure) {
        lastFailure = failure;
        if (permanent(failure)) {
          warn('The server will not take the sitting file', failure);
          refused = true;
        } else if (attempt < FILE_UPLOAD_ATTEMPTS) {
          await wait(RETRY_MS * attempt);
        }
      }
    }
    if (!uploaded && !refused) {
      warn('The sitting file stays on the phone', lastFailure);
      return 'kept';
    }
  }
  try {
    await remove();
  } catch (failure) {
    // A file that was refused has had its one line already.
    if (!refused) warn('The sitting file was not deleted', failure);
  }
  return uploaded ? 'uploaded' : refused ? 'refused' : 'discarded';
}

/** What is written down about a file that is still on the phone, so the next run of the app finds it. */
export type KeptFile = { sittingId: string; fileUri: string };

/** Where that list lives between runs. Both calls may fail; the shelf then carries on in memory. */
export type KeptFileStore = {
  load: () => Promise<KeptFile[]>;
  save: (files: KeptFile[]) => Promise<void>;
};

export type SittingFileShelfOptions = {
  limit?: number;
  store?: KeptFileStore;
  /** Makes the hand-off for a file found in the store. Needed with `store`. */
  open?: (file: KeptFile) => SittingFileHandOff;
  warn?: (message: string, failure?: unknown) => void;
};

type Shelved = { file: SittingFileHandOff; record?: KeptFile };

/**
 * Hands sitting files to the server one after the other and remembers the ones that stayed on
 * the phone. When a later file gets through, the server is reachable again, so each kept file
 * is offered once more. At most `limit` (`KEPT_FILES_LIMIT`) files are kept in total, across
 * runs of the app; beyond that the oldest is removed, so a phone that never reaches the server
 * does not fill up.
 *
 * With a `store`, every file that has not left the phone is written down (`KeptFile`), the one
 * being uploaded included, so a file is not lost track of when the app is closed. `resume()`
 * reads the list at the start of the next run, removes the oldest beyond the limit and offers
 * the rest again. A file from a sitting that never reached `stopSitting` is in no list: only
 * the capture module knows its name, and iOS clears it with the caches folder.
 */
export function createSittingFileShelf(options: number | SittingFileShelfOptions = {}) {
  const { limit = KEPT_FILES_LIMIT, store, open, warn = (message, failure) => console.warn(message, failure) }: SittingFileShelfOptions =
    typeof options === 'number' ? { limit: options } : options;
  let kept: Shelved[] = [];
  let inFlight: KeptFile | null = null;
  let resumed = false;
  let queue: Promise<unknown> = Promise.resolve();

  async function persist(): Promise<void> {
    if (!store) return;
    const records = kept.flatMap((entry) => (entry.record ? [entry.record] : []));
    try {
      await store.save(inFlight ? [...records, inFlight] : records);
    } catch (failure) {
      warn('The list of kept sitting files was not saved', failure);
    }
  }

  /** Removes the oldest files until no more than `limit` are kept. */
  async function prune(): Promise<void> {
    while (kept.length > limit) {
      const oldest = kept.shift()!;
      try {
        await oldest.file.remove();
      } catch (failure) {
        (oldest.file.warn ?? warn)('The sitting file was not deleted', failure);
      }
    }
  }

  /** One try each, oldest first, stopping at the first that still does not get through. */
  async function offerKept(): Promise<void> {
    const waiting = kept;
    kept = [];
    let reachable = true;
    for (const earlier of waiting) {
      // Quiet: each of these has had its line in the log already.
      const again = reachable
        ? await handOffSittingFile({ ...earlier.file, wait: async () => {}, warn: () => {}, upload: once(earlier.file.upload) })
        : 'kept';
      if (again === 'kept') {
        reachable = false;
        kept.push(earlier);
      }
    }
  }

  async function handOff(file: SittingFileHandOff, record?: KeptFile): Promise<SittingFileOutcome> {
    if (record && file.wanted) {
      inFlight = record;
      await persist();
    }
    const outcome = await handOffSittingFile(file);
    inFlight = null;
    // The server answered a moment ago: the files kept from before may get through now.
    if (outcome === 'uploaded') await offerKept();
    if (outcome === 'kept') {
      kept.push({ file, record });
      await prune();
    }
    await persist();
    return outcome;
  }

  async function resume(): Promise<number> {
    if (resumed || !store || !open) return kept.length;
    resumed = true;
    let found: KeptFile[] = [];
    try {
      found = await store.load();
    } catch (failure) {
      warn('The list of kept sitting files was not read', failure);
    }
    const known = new Set(kept.flatMap((entry) => (entry.record ? [entry.record.fileUri] : [])));
    const earlier = found.filter((record) => !known.has(record.fileUri)).map((record) => ({ file: open(record), record }));
    if (earlier.length === 0) return kept.length;
    // Files from earlier runs are older than anything kept in this one.
    kept = [...earlier, ...kept];
    await prune();
    await offerKept();
    await persist();
    if (kept.length > 0) warn(`${kept.length} sitting ${kept.length === 1 ? 'file' : 'files'} from earlier stay on the phone`);
    return kept.length;
  }

  return {
    /**
     * Files are handed off in the order they were given, never two at a time. With `record`
     * (and a store) the file is found again by the next run of the app if it does not get through.
     */
    handOff(file: SittingFileHandOff, record?: KeptFile): Promise<SittingFileOutcome> {
      const next = queue.then(() => handOff(file, record));
      queue = next.catch(() => {});
      return next;
    },
    /**
     * Once per run, at the start: finds the files written down by earlier runs, removes the
     * oldest beyond the limit and offers the rest to the server again. Returns how many are
     * still kept.
     */
    resume(): Promise<number> {
      const next = queue.then(resume);
      queue = next.catch(() => {});
      return next;
    },
    get keptCount() {
      return kept.length;
    },
  };
}

/** `upload`, but every call after the first fails without sending anything. */
function once(upload: () => Promise<void>): () => Promise<void> {
  let sent = false;
  return async () => {
    if (sent) throw new Error('already tried');
    sent = true;
    await upload();
  };
}
