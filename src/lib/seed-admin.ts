import { randomBytes } from "node:crypto";

const MIN_ENV_PASSWORD_LEN = 8;

export type BootstrapPassword = {
  /** The password to hash for the bootstrap admin. */
  password: string;
  /** True when SEED_ADMIN_PASSWORD was accepted and used verbatim. */
  fromEnv: boolean;
  /** True when SEED_ADMIN_PASSWORD was set but rejected (too short) and a random
   *  password was generated instead — the caller MUST reveal `password`. */
  envIgnored: boolean;
};

/** Decide the bootstrap admin password. Uses SEED_ADMIN_PASSWORD only when it is
 *  present and >= 8 chars; otherwise generates a strong random one. The flags let the
 *  caller log correctly: a generated password (fromEnv=false) must always be revealed,
 *  and a too-short env value (envIgnored=true) should warn that it was ignored. Pure
 *  except for the random fallback, which is the whole point. */
export function resolveBootstrapPassword(envRaw: string | undefined): BootstrapPassword {
  const envPw = envRaw?.trim();
  if (envPw && envPw.length >= MIN_ENV_PASSWORD_LEN) {
    return { password: envPw, fromEnv: true, envIgnored: false };
  }
  return { password: randomBytes(18).toString("base64url"), fromEnv: false, envIgnored: !!envPw };
}
