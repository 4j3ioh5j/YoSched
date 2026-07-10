import { describe, it, expect } from "vitest";
// Next's real nonce extractor, from the installed copy. Importing it (rather than
// re-implementing the regex) is the point of these tests: if a Next upgrade changes how the
// nonce is parsed, this fails loudly here instead of silently shipping un-nonced <script> tags
// to production, where the only symptom under an enforced policy is "the app has no JS".
import { getScriptNonceFromHeader } from "next/dist/server/app-render/get-script-nonce-from-header";
import { CSP_RESPONSE_HEADER, buildCsp, generateNonce } from "../csp";

describe("buildCsp", () => {
  it("is parsed by the installed Next's own nonce extractor", () => {
    const nonce = generateNonce();
    expect(getScriptNonceFromHeader(buildCsp(nonce))).toBe(nonce);
  });

  it("puts script-src first, because Next takes the first matching directive", () => {
    // Next looks for `script-src`, then falls back to `default-src`. If default-src ever
    // preceded script-src *and* carried a nonce, the wrong one could be extracted.
    expect(buildCsp(generateNonce()).startsWith("script-src ")).toBe(true);
  });

  it("never weakens script-src with unsafe-inline or unsafe-eval", () => {
    // The whole reason for the nonce is to avoid these. A regression here would silently
    // reduce the policy to roughly no protection at all against injected script.
    const scriptSrc = buildCsp(generateNonce()).split(";")[0];
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
    expect(scriptSrc).toContain("'strict-dynamic'");
  });

  it("locks down the directives that have no legitimate use here", () => {
    const policy = buildCsp(generateNonce());
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("object-src 'none'");
  });

  it("rejects a malformed nonce rather than emitting a policy that matches no script", () => {
    // Next silently drops a nonce it cannot parse. The resulting script-src would match
    // nothing, blocking every script — and only once the policy is enforced.
    expect(() => buildCsp("not a nonce")).toThrow();
    expect(() => buildCsp("'nonce-nested'")).toThrow();
    expect(() => buildCsp("")).toThrow();
  });
});

describe("generateNonce", () => {
  it("is a fresh, valid, 128-bit base64 nonce each call", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    // 16 random bytes -> 24 base64 chars incl. one '=' pad.
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(getScriptNonceFromHeader(buildCsp(a))).toBe(a);
  });
});

describe("rollout safety", () => {
  it("still ships Report-Only — enforcing is a separate, deliberate change", () => {
    // Flipping this to the enforcing header while /_not-found and /_global-error are still
    // prerendered without a nonce would strip those pages of JS. See src/lib/csp.ts.
    expect(CSP_RESPONSE_HEADER).toBe("content-security-policy-report-only");
  });
});
