import { ApiError } from "./http.ts";

type Window = { startedAt: number; count: number };

/** Fixed-window counters held in memory. One server process, so this is the whole picture. */
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

/** The caller's address as the tunnel or proxy reports it; requests made directly share one bucket. */
export function clientAddress(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "direct";
}
