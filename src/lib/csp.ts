// Content-Security-Policy for the app, built per-request around a fresh nonce.
//
// WHY THIS LIVES HERE AND NOT IN next.config.ts `headers()`: a nonce has to change on every
// request, and `headers()` is evaluated once at build time. The policy is therefore emitted
// from src/middleware.ts, which runs per-request.
//
// HOW NEXT PICKS UP THE NONCE: Next does not read `x-nonce`. It parses the *request's* CSP
// header and extracts the first `'nonce-…'` out of `script-src` (falling back to `default-src`)
// — see `getScriptNonceFromHeader` in next/dist/server/app-render. It accepts either
// `content-security-policy` or `content-security-policy-report-only`
// (app-render.js: `headers['content-security-policy'] || headers['content-security-policy-report-only']`),
// which is what lets us stamp nonces while still only *reporting* violations. csp.test.ts
// asserts this against the installed Next, so a version bump that changes it fails loudly here
// rather than silently shipping un-nonced scripts.
//
// 🔴 A NONCE CANNOT REACH STATICALLY PRERENDERED HTML. There is no per-request render, so the
// inline `self.__next_f.push(...)` bootstrap scripts are baked in without a nonce attribute.
// Under an *enforced* policy those pages lose all JS. `/privacy` and `/login` are therefore
// pinned to dynamic rendering (`export const dynamic = "force-dynamic"`). Next's own
// `/_not-found` and `/_global-error` are still prerendered and still un-nonced — that is the
// known gap that must be closed BEFORE this policy is switched from Report-Only to enforcing.

// Directives that do not depend on the nonce. `style-src` needs 'unsafe-inline' because React
// and Next emit inline style attributes; there is no nonce path for those. Fonts are self-hosted
// by next/font at build time, so 'self' is enough — no data: or third-party font origins.
const STATIC_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  // Nothing in the app frames itself or is meant to be framed. Stricter than the
  // X-Frame-Options: SAMEORIGIN we also send; where both apply, frame-ancestors wins.
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
] as const;

// Build the policy for one request.
//
// `'strict-dynamic'` means a script the browser trusts (ours, via the nonce) may load further
// scripts — which is exactly how Next loads its chunks. It also makes `'self'` *ignored* for
// script-src in browsers that understand it; `'self'` is retained only as a fallback for
// CSP-Level-2 browsers that ignore 'strict-dynamic' instead.
//
// script-src is emitted FIRST because Next's nonce parser takes the first matching directive.
export function buildCsp(nonce: string): string {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(nonce)) {
    // A malformed nonce is silently dropped by Next's parser, which would ship a policy whose
    // script-src matches nothing — every script blocked, and only under enforcement. Fail here.
    throw new Error(`buildCsp: nonce is not a valid CSP nonce-source (got ${JSON.stringify(nonce)})`);
  }
  return [`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`, ...STATIC_DIRECTIVES].join("; ");
}

// A fresh 128-bit nonce, base64-encoded. `crypto` and `btoa` are both available in the
// Edge runtime middleware executes in; `Buffer` is not.
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

// We send Report-Only for now: violations are reported to the browser console and nothing is
// blocked. Flipping this constant to "content-security-policy" enforces the same policy — do
// not flip it until the prerendered-page gap above is closed and the app has been driven in a
// real browser with zero violations. A CSP's failure mode is silent breakage.
export const CSP_RESPONSE_HEADER = "content-security-policy-report-only";
