// Generated one-time passwords (admin "Generate" on /users). The person must replace it at
// first sign-in (User.mustChangePassword). Pure: the random source is injected so the same
// code runs on the server (crypto.randomInt) and in the browser (crypto.getRandomValues),
// and tests can drive it deterministically.

// No look-alikes: 0/O/o, 1/l/I are left out so a password read off a screen types back right.
export const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const LOWER = "abcdefghijkmnpqrstuvwxyz";
export const DIGITS = "23456789";
const ALL = UPPER + LOWER + DIGITS;

export const GENERATED_PASSWORD_LENGTH = 16;

/** randomInt(n) must return a uniform integer in [0, n). */
export type RandomInt = (n: number) => number;

export function generatePassword(randomInt: RandomInt, length = GENERATED_PASSWORD_LENGTH): string {
  if (!Number.isInteger(length) || length < 8 || length > 128) throw new Error("password length out of range");
  const pick = (set: string) => {
    const i = randomInt(set.length);
    if (!Number.isInteger(i) || i < 0 || i >= set.length) throw new Error("random source out of range");
    return set[i];
  };
  // One of each required class, the rest from the full alphabet, then a Fisher–Yates shuffle
  // so the guaranteed characters don't sit in fixed positions.
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS)];
  while (chars.length < length) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw new Error("random source out of range");
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Browser random source: rejection sampling over getRandomValues (no modulo bias). */
export function browserRandomInt(n: number): number {
  if (!Number.isInteger(n) || n <= 0 || n > 2 ** 32) throw new Error("bad range");
  const limit = Math.floor(2 ** 32 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}
