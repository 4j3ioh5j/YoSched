// Card #319: required two-factor login. Pure rules; the database reads live in auth-guard.ts
// and auth-epoch.ts.
//
// A session is judged by what it proved AT SIGN-IN (`secondFactor` in the token) and by its
// generation: the login's session version (bumped on enrol, disable, reset, password change)
// and the install's auth epoch (rotated by every restore, never carried in a backup).

/** /account?setup2fa=1: the page a setup-only session is sent to. */
export const SETUP_2FA_QUERY = "setup2fa";

export type SecondFactor = "totp" | "trusted" | "none";
export type SessionClaims = { sv?: number; ep?: string; secondFactor?: SecondFactor };
export type Access = "ok" | "setup" | "signin";

export function sessionAccess(
  claims: SessionClaims,
  user: { sessionVersion: number; totpEnabled: boolean },
  epoch: string,
  requireTotp: boolean,
): Access {
  if ((claims.sv ?? 0) !== user.sessionVersion || claims.ep !== epoch) return "signin";
  if (!requireTotp) return "ok";
  const proved = claims.secondFactor === "totp" || claims.secondFactor === "trusted";
  if (proved) return "ok";
  return user.totpEnabled ? "signin" : "setup";
}
