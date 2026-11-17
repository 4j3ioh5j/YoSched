// Card #324: an open Backup tab reloads its backup time when the zone was changed in another tab
// (the zone reader refetches when the tab comes back into view).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { zoneMovedUnder } from "../auto-backup-section";

describe("zoneMovedUnder", () => {
  const view = { storedZone: null as string | null };
  it("reloads only when a loaded zone differs from the one the view was read under", () => {
    expect(zoneMovedUnder(view, { loaded: true, storedZone: "America/Los_Angeles" })).toBe(true);
    expect(zoneMovedUnder({ storedZone: "America/Los_Angeles" }, { loaded: true, storedZone: "UTC" })).toBe(true);
    expect(zoneMovedUnder({ storedZone: "America/Los_Angeles" }, { loaded: true, storedZone: null })).toBe(true);
    expect(zoneMovedUnder(view, { loaded: true, storedZone: null })).toBe(false);
    expect(zoneMovedUnder({ storedZone: "UTC" }, { loaded: true, storedZone: "UTC" })).toBe(false);
  });
  it("not before the zone has been read, nor without a view", () => {
    expect(zoneMovedUnder(view, { loaded: false, storedZone: "UTC" })).toBe(false);
    expect(zoneMovedUnder(null, { loaded: true, storedZone: "UTC" })).toBe(false);
  });
  it("the section watches the shared zone reader", () => {
    const src = readFileSync(path.join(__dirname, "../auto-backup-section.tsx"), "utf8");
    expect(src).toMatch(/useTimeZone\(\)/);
    expect(src).toMatch(/zoneMovedUnder\(view, tz\)/);
  });
});
