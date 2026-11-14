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
export function rateLimit(key: string, limit: number, windowMs: number): void {
  const retryAfterSeconds = limiter.hit(`${key}|${limit}|${windowMs}`, limit, windowMs);
  if (retryAfterSeconds > 0) {
    throw new ApiError("rate_limited", `Too many attempts. Try again in ${retryAfterSeconds} seconds.`);
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

/** The caller's address, for rate limits. `TRUSTED_PROXY_HOPS` says how many proxies of ours are in front. */
export function clientAddress(request: Request): string {
  return forwardedClient(request.headers.get("x-forwarded-for"), env().TRUSTED_PROXY_HOPS);
}
