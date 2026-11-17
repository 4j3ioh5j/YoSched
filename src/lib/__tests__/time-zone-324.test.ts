// Card #324: changing the zone keeps the NEXT backup at the same moment, even when a clock
// change falls between the last backup moment and the next one.
import { describe, it, expect } from "vitest";
import { convertWallTime, nextZonedSlot, wallClock, zonedSlot } from "../time-zone";

const LA = "America/Los_Angeles";
const sameOffset = (a: Date, b: Date) => {
  const off = (d: Date) => { const w = wallClock(d, LA); return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - Math.floor(d.getTime() / 60_000) * 60_000; };
  return off(a) === off(b);
};
const nextDue = (at: Date, hhmm: string, zone: string) => nextZonedSlot(at, hhmm, zone).toISOString();

describe("convertWallTime uses the next backup moment", () => {
  it("spring forward: 10:30 UTC on 2026-03-08 (09:30Z) becomes 03:30 in LA, not 02:30", () => {
    const at = new Date("2026-03-08T09:30:00Z");
    const lt = convertWallTime("10:30", "UTC", LA, at);
    expect(lt).toBe("03:30");
    expect(nextDue(at, lt, LA)).toBe(nextDue(at, "10:30", "UTC"));
  });
  it("fall back: 09:30 UTC on 2026-11-01 (08:00Z) is 01:30 LA, which happens twice that night: the backup runs at the first 01:30 (one hour early, once), then lines up", () => {
    const at = new Date("2026-11-01T08:00:00Z");
    const lt = convertWallTime("09:30", "UTC", LA, at);
    expect(lt).toBe("01:30");
    expect(nextDue(at, lt, LA)).toBe("2026-11-01T08:30:00.000Z");
    const after = new Date("2026-11-01T09:30:00Z"); // the old next moment
    expect(nextDue(after, lt, LA)).toBe(nextDue(after, "09:30", "UTC"));
  });
  it("LA → UTC across the spring change keeps the next moment", () => {
    const at = new Date("2026-03-08T09:00:00Z"); // 01:00 PST, change at 10:00Z
    const utc = convertWallTime("17:00", LA, "UTC", at);
    expect(nextDue(at, utc, "UTC")).toBe(nextDue(at, "17:00", LA));
  });
  it("every hour over both 2026 changes, both directions: never later, never skipped, then the same every day", () => {
    const H = 3600_000;
    for (const day of ["2026-03-07", "2026-03-08", "2026-10-31", "2026-11-01"]) {
      for (let h = 0; h < 24; h++) {
        const at = new Date(`${day}T${String(h).padStart(2, "0")}:15:00Z`);
        for (const t of ["00:30", "02:30", "09:30", "10:30", "17:00", "23:45"]) {
          for (const [from, to] of [["UTC", LA], [LA, "UTC"]]) {
            const lt = convertWallTime(t, from, to, at);
            const was = nextZonedSlot(at, t, from).getTime();
            // The scheduler's rule (autoDue): due once the latest slot at or before now is after the
            // last success. Say the last backup ran on time at the old previous slot.
            const last = zonedSlot(at, t, from).getTime();
            const now = zonedSlot(at, lt, to).getTime() > last ? at.getTime() + 1 : nextZonedSlot(at, lt, to).getTime();
            const tag = `${at.toISOString()} ${t} ${from}→${to}`;
            expect(now, tag).toBeGreaterThan(at.getTime());
            expect(now, tag).toBeLessThanOrEqual(was); // never later than the old schedule
            expect(was - now, tag).toBeLessThan(25 * H); // and never a day skipped
            // From the old next moment on, the two agree (until the next clock change, after
            // which the time follows the new zone's clock, which is the point of the setting).
            const after = new Date(was);
            // (Skipped when the old next moment was itself moved by a spring-forward gap.)
            const w = wallClock(after, from);
            const exact = `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}` === t;
            if (exact && sameOffset(after, new Date(was + 25 * H))) {
              expect(nextZonedSlot(after, lt, to).toISOString(), tag).toBe(nextZonedSlot(after, t, from).toISOString());
            }
          }
        }
      }
    }
  });
});

describe("nextZonedSlot", () => {
  it("is strictly after now, and the slot after zonedSlot", () => {
    const now = new Date("2026-11-17T01:00:00Z"); // exactly 17:00 PST
    expect(nextZonedSlot(now, "17:00", LA).toISOString()).toBe("2026-11-18T01:00:00.000Z");
    expect(zonedSlot(now, "17:00", LA).toISOString()).toBe("2026-11-17T01:00:00.000Z");
    expect(nextZonedSlot(new Date("2026-11-17T00:59:00Z"), "17:00", LA).toISOString()).toBe("2026-11-17T01:00:00.000Z");
  });
});
