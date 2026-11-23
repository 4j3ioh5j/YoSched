import { describe, it, expect } from "vitest";
import { LIVE_SCOPES, DEFAULT_LIVE_SCOPE, isLiveScope, parseLiveScope, LIVE_SCOPE_LABELS } from "../live-scope";

describe("live-scope", () => {
  it("default is 'day' and every scope has a label", () => {
    expect(DEFAULT_LIVE_SCOPE).toBe("day");
    for (const s of LIVE_SCOPES) expect(LIVE_SCOPE_LABELS[s]).toBeTruthy();
  });

  it("isLiveScope accepts the four scopes and rejects anything else", () => {
    for (const s of LIVE_SCOPES) expect(isLiveScope(s)).toBe(true);
    for (const bad of ["", "DAY", "week", null, undefined, 1, {}]) expect(isLiveScope(bad)).toBe(false);
  });

  it("parseLiveScope passes valid values through and falls back for the rest", () => {
    expect(parseLiveScope("pp")).toBe("pp");
    expect(parseLiveScope("limited")).toBe("limited");
    expect(parseLiveScope(undefined)).toBe(DEFAULT_LIVE_SCOPE);
    expect(parseLiveScope("bogus")).toBe(DEFAULT_LIVE_SCOPE);
  });
});

// Card #461: each scope button in the Auto-generate banner explains itself in one short sentence.
import { LIVE_SCOPE_HINTS } from "../live-scope";
import { readFileSync } from "node:fs";
import { join } from "node:path";
describe("live-scope hints (card #461)", () => {
  it("every scope has one concise, distinct sentence", () => {
    const seen = new Set<string>();
    for (const s of LIVE_SCOPES) {
      const h = LIVE_SCOPE_HINTS[s];
      expect(h, s).toBeTruthy();
      expect(h.length, s).toBeLessThanOrEqual(80);
      expect(seen.has(h), s).toBe(false);
      seen.add(h);
    }
  });
  it("the banner buttons and the Settings picker both use the shared hints", () => {
    const grid = readFileSync(join(__dirname, "../../app/schedule-grid.tsx"), "utf8");
    expect(grid).toMatch(/title=\{LIVE_SCOPE_HINTS\[val\]\}/);
    const settings = readFileSync(join(__dirname, "../../app/settings/settings-page.tsx"), "utf8");
    expect(settings).not.toMatch(/const LIVE_SCOPE_HINTS/);
    expect(settings).toMatch(/LIVE_SCOPE_HINTS\[scope\]/);
  });
});
