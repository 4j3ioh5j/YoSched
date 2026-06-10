import type { NextAuthConfig } from "next-auth";

const isProduction = process.env.NODE_ENV === "production" && !process.env.AUTH_TRUST_HOST;

export const authConfig: NextAuthConfig = {
  providers: [],
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
  },
  pages: { signIn: "/login" },
  ...(isProduction && {
    cookies: {
      sessionToken: {
        name: "__Secure-authjs.session-token",
        options: {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          secure: true,
        },
      },
    },
  }),
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
