import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

// Paths a logged-out visitor (and web-filter categorization crawlers) may reach
// without being bounced to /login. "/" is public because its page renders the
// marketing landing for logged-out visitors and the schedule grid for logged-in
// users; robots.txt/sitemap.xml/privacy give crawlers real, indexable content.
const PUBLIC_PATHS = new Set(["/", "/login", "/privacy", "/robots.txt", "/sitemap.xml"]);

export default auth((req) => {
  if (!req.auth && !PUBLIC_PATHS.has(req.nextUrl.pathname)) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
