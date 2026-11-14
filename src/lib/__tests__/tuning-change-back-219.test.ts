import { describe, it, expect } from "vitest";
import { tuningNeedsSave } from "../scheduler-tuning";
import { createLatestWriter } from "../latest-writer";

// Card #219 (review follow-up of #215): change a tuning number 14 → 20 and back to 14 before the
// first save lands. The change-back must still be sent, so the server ends on 14.

describe("tuning change-back while a save is pending (card #219)", () => {
  it("an unchanged value is skipped only when nothing is pending", () => {
    expect(tuningNeedsSave("14", 14, false)).toBe(false);
    expect(tuningNeedsSave("14", 14, true)).toBe(true);
    expect(tuningNeedsSave("20", 14, false)).toBe(true);
  });

  it("14 → 20 → 14: the server ends on 14 and the page reports the last choice", async () => {
    let server = 14;
    const saved = 14; // the page's last SAVED value, unchanged until the first save lands
    const releases: (() => void)[] = [];
    const settled: number[] = [];
    const w = createLatestWriter<"spreadRadiusDays", number>(
      (_k, v) => new Promise<void>((res) => releases.push(() => { server = v; res(); })),
      (_k, v, err) => { if (err === null) settled.push(v); },
    );
    const blur = (text: string) => { if (tuningNeedsSave(text, saved, w.busy("spreadRadiusDays"))) w.write("spreadRadiusDays", Number(text)); };
    blur("20");
    blur("14"); // before the first save lands
    releases.shift()!();
    await Promise.resolve(); await Promise.resolve();
    releases.shift()!();
    await Promise.resolve(); await Promise.resolve();
    expect(server).toBe(14);
    expect(settled).toEqual([14]);
  });
});
