import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { BASE_PATH } from "@/lib/base-path";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

// Paths a logged-out visitor (and web-filter categorization crawlers) may reach
// without being bounced to /login. "/" is public because its page renders the
// marketing landing for logged-out visitors and the schedule grid for logged-in
// users; robots.txt/sitemap.xml/privacy give crawlers real, indexable content.
// These are basePath-relative (i.e. what remains after /yosched is stripped).
const PUBLIC_PATHS = new Set(["/", "/login", "/privacy", "/robots.txt", "/sitemap.xml"]);

// Return the path with the app basePath removed, so the public-path check works
// regardless of whether Next has already stripped basePath from nextUrl.pathname.
function stripBasePath(pathname: string): string {
  if (pathname === BASE_PATH) return "/";
  if (pathname.startsWith(BASE_PATH + "/")) return pathname.slice(BASE_PATH.length);
  return pathname;
}

export default auth((req) => {
  const path = stripBasePath(req.nextUrl.pathname);
  if (!req.auth && !PUBLIC_PATHS.has(path)) {
    // Build an absolute login URL that explicitly includes the basePath, so the
    // redirect target is correct no matter how Next surfaces the incoming path.
    const loginUrl = new URL(`${BASE_PATH}/login`, req.nextUrl.origin);
    // callbackUrl is basePath-relative; the client router re-adds basePath on push.
    loginUrl.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
