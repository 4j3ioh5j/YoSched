import type { NextAuthConfig } from "next-auth";
import { BASE_PATH } from "./base-path";

// Cookies are scoped to the app's sub-path (`Path=/yosched`) so they don't leak onto
// the rest of the shared apex domain (yologiq.com) or collide with anything else
// hosted there. The `__Host-` prefix Auth.js uses for the CSRF cookie by default
// REQUIRES `Path=/`, so it is incompatible with a sub-path — we use `__Secure-`
// (on HTTPS) instead, keeping the same host-only, secure protection minus the
// root-path constraint. On plain-HTTP local dev we drop the prefix and `secure` so
// the browser still accepts the cookies. (The old `isProduction` gate here was
// effectively dead in production — AUTH_TRUST_HOST is always set behind the proxy —
// so the __Secure-/__Host- prefixes came from Auth.js defaults, not this block.)
const useSecureCookies = process.env.NODE_ENV === "production";
const cookiePrefix = useSecureCookies ? "__Secure-" : "";
const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: BASE_PATH,
  secure: useSecureCookies,
};

export const authConfig: NextAuthConfig = {
  providers: [],
  // Auth.js's server-side basePath stays the DEFAULT "/api/auth": Next.js strips the
  // app basePath (/yosched) from the request BEFORE the route handler/middleware run,
  // so Auth.js sees "/api/auth/*", not "/yosched/api/auth/*". The browser-facing full
  // path (/yosched/api/auth) is configured separately on <SessionProvider>. trustHost
  // makes Auth.js trust the X-Forwarded-Host/Proto the apex proxy injects, so any URLs
  // it builds use yologiq.com (https), not the internal origin hostname.
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
  },
  pages: { signIn: `${BASE_PATH}/login` },
  cookies: {
    sessionToken: { name: `${cookiePrefix}authjs.session-token`, options: cookieOptions },
    callbackUrl: { name: `${cookiePrefix}authjs.callback-url`, options: cookieOptions },
    csrfToken: { name: `${cookiePrefix}authjs.csrf-token`, options: cookieOptions },
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        if ((user as { totpVerifiedAt?: number }).totpVerifiedAt) {
          token.totpVerifiedAt = (user as { totpVerifiedAt: number }).totpVerifiedAt;
        }
        const u = user as { groupId?: string; groupName?: string; groupLevel?: number; permissions?: string[] };
        token.groupId = u.groupId;
        token.groupName = u.groupName;
        token.groupLevel = u.groupLevel;
        token.permissions = u.permissions;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        (session.user as { totpVerifiedAt?: number }).totpVerifiedAt = token.totpVerifiedAt as number | undefined;
        (session.user as { groupId?: string }).groupId = token.groupId as string | undefined;
        (session.user as { groupName?: string }).groupName = token.groupName as string | undefined;
        (session.user as { groupLevel?: number }).groupLevel = token.groupLevel as number | undefined;
        (session.user as { permissions?: string[] }).permissions = token.permissions as string[] | undefined;
      }
      return session;
    },
  },
};
