import bcrypt from "bcryptjs";

/** bcrypt hash with 10 rounds. */
export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

/** Constant-time-ish compare; never throws, never logs. */
export function verifyPassword(password: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(password, hash);
  } catch {
    return false;
  }
}
