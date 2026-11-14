const raw = process.env.EXPO_PUBLIC_API_URL;

if (!raw || !/^https?:\/\//.test(raw)) {
  throw new Error(
    'EXPO_PUBLIC_API_URL is not set. Copy apps/mobile/.env.example to .env.local and put the ngrok URL in it.',
  );
}

/** Base URL of the web server, without a trailing slash. Prefix every route from @triagecam/contracts with it. */
export const apiUrl = raw.replace(/\/+$/, '');
