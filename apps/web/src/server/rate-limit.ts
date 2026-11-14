import { isIP } from "node:net";

import { env } from "./env.ts";
import { ApiError } from "./http.ts";

type Window = { startedAt: number; count: number };

/**
 * Fixed-window counters held in memory. One server process, so this is the whole picture,
 * except for the minute or so of a deploy when two overlap and a caller can get both allowances.
 */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Counts one attempt for `key`. Returns 0 when allowed, else the seconds until the window ends. */
  hit(key: string, limit: number, windowMs: number): number {
    const now = this.now();
    const current = this.windows.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      this.sweep(now, windowMs);
      this.windows.set(key, { startedAt: now, count: 1 });
      return 0;
    }
    current.count += 1;
    return current.count <= limit ? 0 : Math.max(1, Math.ceil((current.startedAt + windowMs - now) / 1000));
  }

  private sweep(now: number, windowMs: number): void {
    if (this.windows.size < 5000) return;
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= windowMs) this.windows.delete(key);
    }
  }
}

const globalForLimiter = globalThis as typeof globalThis & { triagecamLimiter?: RateLimiter };
const limiter = (globalForLimiter.triagecamLimiter ??= new RateLimiter());

export const MINUTE_MS = 60_000;

/** Throws rate_limited once `key` has been used more than `limit` times inside the window. */
export function rateLimit(key: string, limit: number, windowMs: number, counters: RateLimiter = limiter): void {
  const retryAfterSeconds = counters.hit(`${key}|${limit}|${windowMs}`, limit, windowMs);
  if (retryAfterSeconds > 0) {
    throw new ApiError(
      "rate_limited",
      `Too many attempts. Try again in ${retryAfterSeconds} seconds.`,
      undefined,
      retryAfterSeconds,
    );
  }
}

/**
 * The caller's address out of an `X-Forwarded-For` header.
 *
 * Every proxy appends the address it received the request from, so the right-hand end of the
 * list is written by our own proxies and the left-hand end by whoever sent the request. With
 * `trustedProxies` proxies of ours in front of the server (production: Cloudflare, then the
 * load balancer, so 2) the caller is that many entries from the right, and nothing a caller
 * puts in the header can move it. A shorter list means the request skipped a proxy; its first
 * entry was still written by one of ours.
 *
 * With `trustedProxies` undefined (development, where the only proxy is a tunnel) the first
 * entry is used, as the tunnel reports it. Requests with no header share the bucket "direct".
 */
export function forwardedClient(header: string | null, trustedProxies: number | undefined): string {
  const entries = (header ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) return "direct";
  if (!trustedProxies) return entries[0] as string;
  return entries[Math.max(0, entries.length - trustedProxies)] as string;
}

/**
 * What a rate limit counts an address as. An IPv4 address is itself. An IPv6 address is its
 * /64: a single host or home network is handed a whole /64 and can use any of its 2^64
 * addresses, so counting each one separately would be no limit at all. An IPv4 address written
 * as IPv6 (`::ffff:192.0.2.1`) counts as the IPv4 address. Anything else is returned as it came.
 */
export function addressBucket(address: string): string {
  const bare = address.replace(/^\[|\]$/g, "").split("%")[0] as string;
  if (isIP(bare) !== 6) return address;

  // A dotted IPv4 tail is two groups.
  let text = bare.toLowerCase();
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", tail] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups =
    tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  const words = groups.map((group) => parseInt(group, 16));

  const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if (mapped) {
    const [high, low] = [words[6] as number, words[7] as number];
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  }
  return `${words.slice(0, 4).map((word) => word.toString(16)).join(":")}::/64`;
}

/**
 * The caller, for rate limits: their address, or their /64 on IPv6 (`addressBucket`).
 * `TRUSTED_PROXY_HOPS` says how many proxies of ours are in front.
 */
export function clientAddress(request: Request): string {
  return addressBucket(forwardedClient(request.headers.get("x-forwarded-for"), env().TRUSTED_PROXY_HOPS));
}

/** Sign-in attempts allowed inside `SIGN_IN_WINDOW_MS`, by what is counted. */
export const SIGN_IN_LIMITS = {
  /** From one address, whatever the account: a waiting room or a venue can share one address. */
  perAddress: 60,
  /** For one account from one address: a person mistyping their own password. */
  perAddressAndAccount: 10,
  /** For one account from everywhere: guessing spread over many addresses. */
  perAccount: 30,
} as const;
export const SIGN_IN_WINDOW_MS = 5 * MINUTE_MS;

/** Counts one sign-in attempt from `address`, before the request body is known. */
export function limitSignInAddress(address: string, counters?: RateLimiter): void {
  rateLimit(`sign-in:${address}`, SIGN_IN_LIMITS.perAddress, SIGN_IN_WINDOW_MS, counters);
}

/**
 * Counts one sign-in attempt on the account `email` from `address`.
 *
 * The limit across all addresses is what stops guessing from many addresses at once; it is
 * three times the limit for one address, so one caller hammering an account from one place
 * is stopped by their own limit first and does not lock its owner out from elsewhere. It
 * counts every attempt, for an account that exists or not, so it gives nothing away.
 */
export function limitSignInAccount(address: string, email: string, counters?: RateLimiter): void {
  rateLimit(`sign-in:${address}:${email}`, SIGN_IN_LIMITS.perAddressAndAccount, SIGN_IN_WINDOW_MS, counters);
  rateLimit(`sign-in-account:${email}`, SIGN_IN_LIMITS.perAccount, SIGN_IN_WINDOW_MS, counters);
}
