// The simulator rig (scripts/sim-qa.sh) sets EXPO_PUBLIC_SIM_API_URL in Metro's environment to
// point the app at a server on the Mac. It has its own name because in a development bundle
// Expo lets a variable in .env.local win over the same variable in the shell, so
// EXPO_PUBLIC_API_URL cannot be overridden for one run. It is never put in an .env file.
const raw = process.env.EXPO_PUBLIC_SIM_API_URL || process.env.EXPO_PUBLIC_API_URL;

if (!raw || !/^https?:\/\//.test(raw)) {
  throw new Error(
    'EXPO_PUBLIC_API_URL is not set. Copy apps/mobile/.env.example to .env.local and put the ngrok URL in it.',
  );
}

/** Base URL of the web server, without a trailing slash. Prefix every route from @triagecam/contracts with it. */
export const apiUrl = raw.replace(/\/+$/, '');
