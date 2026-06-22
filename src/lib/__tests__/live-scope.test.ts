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
