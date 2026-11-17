// Card #334: "today" / "N days ago" next to Last backup counts calendar days in the Settings
// time zone, not 24-hour periods (Nov 16 19:21 PST seen on Nov 17 PST said "today").
import { describe, it, expect } from "vitest";
import { lastBackupLabel } from "../backup-panel";

const LA = "America/Los_Angeles";
const at = (iso: string) => new Date(iso);

describe("lastBackupLabel", () => {
  it("a backup from yesterday evening reads 1 day ago, even under 24 hours later", () => {
    // Nov 16 19:21 PST = Nov 17 03:21 UTC; now Nov 17 14:30 PST = Nov 17 22:30 UTC.
    expect(lastBackupLabel("2026-11-17T03:21:00Z", LA, at("2026-11-17T22:30:00Z"))).toMatch(/\(1 day ago\)$/);
  });
  it("a backup earlier the same local day reads today, even across the UTC midnight", () => {
    // Nov 17 08:00 PST = 16:00 UTC; now Nov 17 23:30 PST = Nov 18 07:30 UTC.
    expect(lastBackupLabel("2026-11-17T16:00:00Z", LA, at("2026-11-18T07:30:00Z"))).toMatch(/\(today\)$/);
  });
  it("just after local midnight, last night's backup is 1 day ago", () => {
    // Nov 16 23:59 PST; now Nov 17 00:01 PST.
    expect(lastBackupLabel("2026-11-17T07:59:00Z", LA, at("2026-11-17T08:01:00Z"))).toMatch(/\(1 day ago\)$/);
  });
  it("counts calendar days across a clock change", () => {
    // Nov 1 2026 is the fall-back day in Los Angeles. Oct 31 12:00 PDT → Nov 2 12:00 PST.
    expect(lastBackupLabel("2026-10-31T19:00:00Z", LA, at("2026-11-02T20:00:00Z"))).toMatch(/\(2 days ago\)$/);
  });
  it("uses the given zone: the same instants in UTC", () => {
    expect(lastBackupLabel("2026-11-17T03:21:00Z", "UTC", at("2026-11-17T22:30:00Z"))).toMatch(/\(today\)$/);
  });
  it("shows the stamp in the zone, and never for no backup", () => {
    expect(lastBackupLabel("2026-11-17T03:21:00Z", LA, at("2026-11-17T22:30:00Z"))).toContain("19:21 PST");
    expect(lastBackupLabel(null, LA, at("2026-11-17T22:30:00Z"))).toBe("never");
  });
  it("a backup stamped slightly in the future (clock skew) reads today, not a negative count", () => {
    expect(lastBackupLabel("2026-11-17T22:31:00Z", LA, at("2026-11-17T22:30:00Z"))).toMatch(/\(today\)$/);
  });
});
