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
  warn?: (message: string, failure?: unknown) => void;
};

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
  if (wanted) {
    for (let attempt = 1; attempt <= FILE_UPLOAD_ATTEMPTS && !uploaded && !refused; attempt += 1) {
      try {
        await upload();
        uploaded = true;
      } catch (failure) {
        if (permanent(failure)) {
          warn('The server will not take the sitting file', failure);
          refused = true;
        } else {
          warn(`The sitting file was not uploaded (try ${attempt} of ${FILE_UPLOAD_ATTEMPTS})`, failure);
          if (attempt < FILE_UPLOAD_ATTEMPTS) await wait(RETRY_MS * attempt);
        }
      }
    }
    if (!uploaded && !refused) {
      warn('The sitting file stays on the phone');
      return 'kept';
    }
  }
  try {
    await remove();
  } catch (failure) {
    warn('The sitting file was not deleted', failure);
  }
  return uploaded ? 'uploaded' : refused ? 'refused' : 'discarded';
}

/**
 * Hands sitting files to the server one after the other and remembers the ones that stayed on
 * the phone. When a later file gets through, the server is reachable again, so each kept file
 * is offered once more. At most `KEPT_FILES_LIMIT` files are kept; beyond that the oldest is
 * removed, so a phone that never reaches the server does not fill up.
 *
 * The list is held in memory. Files kept before the app was closed are not offered again; they
 * are in the caches folder, which iOS clears when it needs the space.
 */
export function createSittingFileShelf(limit = KEPT_FILES_LIMIT) {
  let kept: SittingFileHandOff[] = [];
  let queue: Promise<unknown> = Promise.resolve();

  async function handOff(file: SittingFileHandOff): Promise<SittingFileOutcome> {
    const outcome = await handOffSittingFile(file);
    if (outcome === 'uploaded') {
      const waiting = kept;
      kept = [];
      for (const earlier of waiting) {
        // One try each: the server answered a moment ago.
        const again = await handOffSittingFile({ ...earlier, wait: async () => {}, upload: once(earlier.upload) });
        if (again === 'kept') kept.push(earlier);
      }
    }
    if (outcome === 'kept') {
      kept.push(file);
      while (kept.length > limit) {
        const oldest = kept.shift()!;
        try {
          await oldest.remove();
        } catch (failure) {
          (file.warn ?? console.warn)('The sitting file was not deleted', failure);
        }
      }
    }
    return outcome;
  }

  return {
    /** Files are handed off in the order they were given, never two at a time. */
    handOff(file: SittingFileHandOff): Promise<SittingFileOutcome> {
      const next = queue.then(() => handOff(file));
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
