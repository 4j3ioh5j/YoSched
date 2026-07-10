import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { BASE_PATH } from "@/lib/base-path";
import { CSP_RESPONSE_HEADER, buildCsp, generateNonce } from "@/lib/csp";
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

// Per-request CSP, or null if we could not build one.
//
// 🔴 THIS FAILS OPEN, DELIBERATELY. This middleware runs on `/`, `/privacy`, `/robots.txt` and
// `/sitemap.xml` — all crawled, all indexed. A throw here is a 500 on every one of them, and
// sustained 5xx is how a site actually loses its index entries. A missing CSP header is a
// return to the status quo we shipped for months; a 500 is not. Serving the page always wins
// over serving the policy.
function cspForRequest(): { nonce: string; policy: string } | null {
  try {
    const nonce = generateNonce();
    return { nonce, policy: buildCsp(nonce) };
  } catch {
    return null;
  }
}

export default auth((req) => {
  const csp = cspForRequest();

  const path = stripBasePath(req.nextUrl.pathname);
  if (!req.auth && !PUBLIC_PATHS.has(path)) {
    // Build an absolute login URL that explicitly includes the basePath, so the
    // redirect target is correct no matter how Next surfaces the incoming path.
    const loginUrl = new URL(`${BASE_PATH}/login`, req.nextUrl.origin);
    // callbackUrl is basePath-relative; the client router re-adds basePath on push.
    loginUrl.searchParams.set("callbackUrl", path);
    const redirect = NextResponse.redirect(loginUrl);
    if (csp) redirect.headers.set(CSP_RESPONSE_HEADER, csp.policy);
    return redirect;
  }

  if (!csp) return NextResponse.next();

  // Next reads the nonce back off the *request's* CSP header when it renders, and stamps it
  // onto its own <script> tags. Forwarding the header on the request is what makes that work —
  // setting it only on the response would leave every script un-nonced. See src/lib/csp.ts.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(CSP_RESPONSE_HEADER, csp.policy);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set(CSP_RESPONSE_HEADER, csp.policy);
  return res;
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
