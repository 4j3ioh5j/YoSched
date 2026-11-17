// Card #326: when the Backup tab's re-read after a zone change fails (503, offline), the next time
// the tab comes back into view tries again, and the failure is shown, not swallowed.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { makeZoneReloader, readAutoView } from "../auto-backup-section";

type V = { storedZone: string | null };
const tzLA = { loaded: true, storedZone: "America/Los_Angeles" };

function harness(results: Array<{ ok: true; view: V } | { ok: false; error: string } | "hang">) {
  const views: V[] = [];
  const errors: (string | undefined)[] = [];
  let calls = 0;
  const pending: Array<() => void> = [];
  const r = makeZoneReloader<V>({
    fetchView: () => {
      const out = results[calls++] ?? { ok: false, error: "no more" };
      if (out === "hang") return new Promise((res) => pending.push(() => res({ ok: true, view: { storedZone: tzLA.storedZone } })));
      return Promise.resolve(out);
    },
    onView: (v) => views.push(v),
    onError: (e) => errors.push(e),
  });
  return { r, views, errors, calls: () => calls, release: () => pending.splice(0).forEach((f) => f()) };
}

describe("makeZoneReloader", () => {
  it("a failed re-read is shown and retried on the next return to the tab", async () => {
    const h = harness([{ ok: false, error: "The server answered 503" }, { ok: true, view: { storedZone: "America/Los_Angeles" } }]);
    await h.r.onZone({ storedZone: null }, tzLA);
    expect(h.calls()).toBe(1);
    expect(h.errors).toEqual(["The server answered 503"]);
    expect(h.views).toEqual([]);
    await h.r.onVisible();
    expect(h.calls()).toBe(2);
    expect(h.views).toEqual([{ storedZone: "America/Los_Angeles" }]);
    expect(h.errors).toEqual(["The server answered 503", undefined]); // cleared on success
  });

  it("no retry on return when nothing failed", async () => {
    const h = harness([{ ok: true, view: { storedZone: "America/Los_Angeles" } }]);
    await h.r.onZone({ storedZone: null }, tzLA);
    await h.r.onVisible();
    expect(h.calls()).toBe(1);
    expect(h.errors).toEqual([]);
  });

  it("keeps retrying on each return while it keeps failing, and stops after a success", async () => {
    const h = harness([{ ok: false, error: "a" }, { ok: false, error: "b" }, { ok: true, view: { storedZone: "UTC" } }]);
    await h.r.onZone({ storedZone: null }, tzLA);
    await h.r.onVisible();
    await h.r.onVisible();
    await h.r.onVisible();
    expect(h.calls()).toBe(3);
    expect(h.views).toEqual([{ storedZone: "UTC" }]);
  });

  it("one read at a time: a return to the tab during a read does not start another", async () => {
    const h = harness(["hang"]);
    const first = h.r.onZone({ storedZone: null }, tzLA);
    await h.r.onVisible();
    await h.r.onZone({ storedZone: null }, tzLA);
    expect(h.calls()).toBe(1);
    h.release();
    await first;
    expect(h.views.length).toBe(1);
  });

  it("does nothing when the zone has not moved", async () => {
    const h = harness([]);
    await h.r.onZone({ storedZone: "UTC" }, { loaded: true, storedZone: "UTC" });
    await h.r.onVisible();
    expect(h.calls()).toBe(0);
  });

  it("after unmount nothing lands", async () => {
    const h = harness([{ ok: false, error: "x" }]);
    h.r.dispose();
    await h.r.onZone({ storedZone: null }, tzLA);
    await h.r.onVisible();
    expect(h.errors).toEqual([]);
    expect(h.views).toEqual([]);
  });
});

describe("readAutoView", () => {
  it("a non-OK answer gives its error text", async () => {
    const f = async () => new Response(JSON.stringify({ error: "Busy" }), { status: 503 });
    expect(await readAutoView(f)).toEqual({ ok: false, error: "Busy" });
    const g = async () => new Response("x", { status: 503 });
    expect(await readAutoView(g)).toEqual({ ok: false, error: "The server answered 503" });
  });
  it("a network failure is an error, not a throw", async () => {
    const f = async (): Promise<Response> => { throw new TypeError("fetch failed"); };
    expect(await readAutoView(f)).toEqual({ ok: false, error: "Could not reach the server" });
  });
  it("an OK answer gives the view", async () => {
    const f = async () => new Response(JSON.stringify({ storedZone: "UTC" }), { status: 200 });
    expect(await readAutoView(f)).toEqual({ ok: true, view: { storedZone: "UTC" } });
  });
});

describe("the section uses the reloader", () => {
  it("wires zone changes and returns to the tab", () => {
    const src = readFileSync(path.join(__dirname, "../auto-backup-section.tsx"), "utf8");
    expect(src).toMatch(/makeZoneReloader(<\w+>)?\(\{/);
    expect(src).toMatch(/visibilitychange/);
    expect(src).toMatch(/\.onVisible\(\)/);
    expect(src).toMatch(/\.onZone\(view, tz\)/);
  });
});
