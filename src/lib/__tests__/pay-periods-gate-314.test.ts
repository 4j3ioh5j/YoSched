import { describe, it, expect, vi, beforeEach } from "vitest";

// Card #314 (Codex plan BLOCKED r2): getPayPeriods reads the settings, then may regenerate.
// A restore must not land between the two.
const h = vi.hoisted(() => ({ log: [] as string[], pause: null as null | Promise<void> }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    schedulingPreferences: { findFirst: vi.fn(async () => { h.log.push("prefs read"); if (h.pause) await h.pause; return null; }) },
    payPeriod: { findMany: vi.fn(async () => { h.log.push("periods read"); return []; }) },
  },
}));
import { getPayPeriods } from "@/lib/pay-periods-server";
import { writeGate } from "@/lib/write-gate";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("getPayPeriods holds the write gate (card #314)", () => {
  beforeEach(() => { h.log.length = 0; h.pause = null; });

  it("a restore requested after the settings read waits until getPayPeriods finishes", async () => {
    let go!: () => void;
    h.pause = new Promise((r) => { go = r; });
    const pp = getPayPeriods();
    await tick();
    const restore = writeGate.exclusive(async () => { h.log.push("restore"); });
    await tick();
    expect(h.log).toEqual(["prefs read"]);
    go();
    await pp;
    await restore;
    expect(h.log).toEqual(["prefs read", "periods read", "restore"]);
  });

  it("a getPayPeriods arriving mid-restore reads the settings only after the commit", async () => {
    let commit!: () => void;
    const restore = writeGate.exclusive(async () => { h.log.push("restore start"); await new Promise<void>((r) => { commit = r; }); h.log.push("restore commit"); });
    await tick();
    const pp = getPayPeriods();
    await tick();
    expect(h.log).toEqual(["restore start"]);
    commit();
    await restore;
    await pp;
    expect(h.log).toEqual(["restore start", "restore commit", "prefs read", "periods read"]);
  });
});
