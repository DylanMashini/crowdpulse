import { ApiError } from "./http.ts";

/** Cursors are opaque to clients: base64url of a small JSON value. */
export const encodeCursor = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");

export function decodeCursor(cursor: string): unknown {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new ApiError("invalid_request", "The cursor is not valid");
  }
}

/** Splits `limit + 1` fetched rows into the page and whether another page follows. */
export function takePage<Row>(rows: Row[], limit: number): { items: Row[]; last: Row | null } {
  const items = rows.slice(0, limit);
  return { items, last: rows.length > limit ? (items.at(-1) ?? null) : null };
}
