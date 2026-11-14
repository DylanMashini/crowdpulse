import bcrypt from "bcrypt";

import { newToken } from "./tokens.ts";

const COST = 12;

export const hashPassword = (password: string): Promise<string> => bcrypt.hash(password, COST);

let decoy: Promise<string> | undefined;

/**
 * Checks a password against a stored hash. With no hash (unknown email) it still does one
 * bcrypt comparison, so the response time does not tell the two cases apart.
 */
export async function verifyPassword(password: string, passwordHash: string | null): Promise<boolean> {
  if (passwordHash === null) {
    decoy ??= hashPassword(newToken());
    await bcrypt.compare(password, await decoy);
    return false;
  }
  return bcrypt.compare(password, passwordHash);
}
