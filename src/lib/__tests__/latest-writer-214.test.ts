import { describe, it, expect } from "vitest";
import { createLatestWriter } from "../latest-writer";

// Card #214: colour saves must reach the server in order, and an older save's late result
// must never change what the page shows.

function harness() {
  const sent: [string, string | null][] = [];
  const pending: { resolve: () => void; reject: (e: unknown) => void }[] = [];
  const settled: [string, string | null, boolean][] = [];
  const w = createLatestWriter<string, string | null>(
    (k, v) => { sent.push([k, v]); return new Promise<void>((resolve, reject) => pending.push({ resolve, reject })); },
    (k, v, e) => settled.push([k, v, e === null]),
  );
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { w, sent, pending, settled, flush };
}

describe("createLatestWriter", () => {
  it("colour save in flight, then switched off: the off is sent after it, and the server ends on off", async () => {
    const h = harness();
    h.w.write("printHolidayColor", "#C0C0C0");
    h.w.write("printHolidayColor", null);
    expect(h.sent).toEqual([["printHolidayColor", "#C0C0C0"]]); // second waits
    h.pending[0].resolve(); await h.flush();
    expect(h.sent).toEqual([["printHolidayColor", "#C0C0C0"], ["printHolidayColor", null]]);
    expect(h.settled).toEqual([]); // the older save's success is not reported
    h.pending[1].resolve(); await h.flush();
    expect(h.settled).toEqual([["printHolidayColor", null, true]]);
  });

  it("only the newest queued value is sent", async () => {
    const h = harness();
    h.w.write("k", "#111111");
    h.w.write("k", "#222222");
    h.w.write("k", "#333333");
    h.pending[0].resolve(); await h.flush();
    expect(h.sent.map((s) => s[1])).toEqual(["#111111", "#333333"]);
  });

  it("an older save that fails late is ignored when a newer one follows", async () => {
    const h = harness();
    h.w.write("k", "#111111");
    h.w.write("k", null);
    h.pending[0].reject(new Error("500")); await h.flush();
    expect(h.settled).toEqual([]);
    h.pending[1].resolve(); await h.flush();
    expect(h.settled).toEqual([["k", null, true]]);
  });

  it("the newest save failing is reported (so the page can roll back)", async () => {
    const h = harness();
    h.w.write("k", "#111111");
    h.pending[0].reject(new Error("500")); await h.flush();
    expect(h.settled).toEqual([["k", "#111111", false]]);
    expect(h.w.busy("k")).toBe(false);
  });

  it("different fields do not wait for each other", () => {
    const h = harness();
    h.w.write("a", "#111111");
    h.w.write("b", null);
    expect(h.sent).toEqual([["a", "#111111"], ["b", null]]);
  });
});
