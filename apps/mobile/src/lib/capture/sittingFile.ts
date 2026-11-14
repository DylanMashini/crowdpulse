/** How many times a sitting file is offered to the server before the phone gives up. */
export const FILE_UPLOAD_ATTEMPTS = 3;
const RETRY_MS = 1500;

export type SittingFileHandOff = {
  /** Whether the server wants the file at all: development builds only. */
  wanted: boolean;
  upload: () => Promise<void>;
  remove: () => Promise<void>;
  wait?: (ms: number) => Promise<void>;
  warn?: (message: string, failure?: unknown) => void;
};

export type SittingFileOutcome = 'uploaded' | 'kept' | 'discarded';

/**
 * Hands a finished sitting's file to the server and removes it from the phone.
 *
 * The file is the only record of what the camera saw, and a sitting that ended with no reading
 * cannot be examined without it. So in development it is removed only once the server has it:
 * the upload is tried `FILE_UPLOAD_ATTEMPTS` times, and when every try fails the file stays on
 * the phone, where it can be copied off with the app's container. Outside development the file
 * is not wanted and is removed at once.
 */
export async function handOffSittingFile({
  wanted,
  upload,
  remove,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  warn = (message, failure) => console.warn(message, failure),
}: SittingFileHandOff): Promise<SittingFileOutcome> {
  let uploaded = false;
  if (wanted) {
    for (let attempt = 1; attempt <= FILE_UPLOAD_ATTEMPTS && !uploaded; attempt += 1) {
      try {
        await upload();
        uploaded = true;
      } catch (failure) {
        warn(`The sitting file was not uploaded (try ${attempt} of ${FILE_UPLOAD_ATTEMPTS})`, failure);
        if (attempt < FILE_UPLOAD_ATTEMPTS) await wait(RETRY_MS * attempt);
      }
    }
    if (!uploaded) {
      warn('The sitting file stays on the phone');
      return 'kept';
    }
  }
  try {
    await remove();
  } catch (failure) {
    warn('The sitting file was not deleted', failure);
  }
  return uploaded ? 'uploaded' : 'discarded';
}
