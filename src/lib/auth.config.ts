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
        token.role = (user as { role: string }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        (session.user as { role: string }).role = token.role as string;
      }
      return session;
    },
  },
};
