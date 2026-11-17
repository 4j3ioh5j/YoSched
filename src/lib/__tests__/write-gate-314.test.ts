import { describe, it, expect, beforeEach } from "vitest";
import { createWriteGate, GateBusyError, GateDrainTimeoutError, GateMissingError } from "@/lib/write-gate";

// Card #314 (Codex plan BLOCKED r1/r2): a backup or restore must never see, or be
// followed by, half of an application save. The gate drains whole handlers first.

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("write gate (card #314)", () => {
  let gate: ReturnType<typeof createWriteGate>;
  beforeEach(() => { gate = createWriteGate({ sharedWaitMs: 200, drainMs: 200 }); });

  it("save/export: an export started mid-save reads only after the whole save, and sees its rows", async () => {
    const rows: string[] = ["old"];
    const pause = deferred();
    const log: string[] = [];
    const save = gate.shared(async () => {
      rows.length = 0; log.push("deleted");          // tx 1
      await pause.promise;                            // between transactions
      rows.push("new"); log.push("created");          // tx 2
    });
    await tick();
    const exp = gate.exclusive(async () => { log.push("export-read"); return [...rows]; });
    await tick();
    expect(log).toEqual(["deleted"]);                 // export has not read the empty gap
    pause.resolve();
    await save;
    expect(await exp).toEqual(["new"]);
    expect(log).toEqual(["deleted", "created", "export-read"]);
  });

  it("save/restore: an in-flight save finishes before restore; a save arriving mid-restore runs after it", async () => {
    const log: string[] = [];
    const inFlight = deferred();
    const restoreBody = deferred();
    const a = gate.shared(async () => { log.push("A start"); await inFlight.promise; log.push("A end"); });
    await tick();
    const restore = gate.exclusive(async () => { log.push("restore start"); await restoreBody.promise; log.push("restore commit"); });
    await tick();
    const b = gate.shared(async () => { log.push("B first read"); });
    await tick();
    expect(log).toEqual(["A start"]);
    inFlight.resolve();
    await a;
    await tick();
    expect(log).toEqual(["A start", "A end", "restore start"]);
    restoreBody.resolve();
    await restore;
    await b;
    expect(log).toEqual(["A start", "A end", "restore start", "restore commit", "B first read"]);
  });

  it("a request waiting too long behind a backup gets GateBusy", async () => {
    const hold = deferred();
    const ex = gate.exclusive(() => hold.promise);
    await tick();
    await expect(gate.shared(async () => "x")).rejects.toBeInstanceOf(GateBusyError);
    hold.resolve();
    await ex;
  });

  it("a drain that times out runs nothing and lets requests through again", async () => {
    const hold = deferred();
    const long = gate.shared(() => hold.promise);
    await tick();
    let ran = false;
    await expect(gate.exclusive(async () => { ran = true; })).rejects.toBeInstanceOf(GateDrainTimeoutError);
    expect(ran).toBe(false);
    expect(await gate.shared(async () => "ok")).toBe("ok");
    hold.resolve();
    await long;
  });

  it("nested shared inside shared, and shared inside exclusive, pass straight through", async () => {
    expect(await gate.shared(() => gate.shared(async () => 1))).toBe(1);
    expect(await gate.exclusive(() => gate.shared(async () => 2))).toBe(2);
  });

  it("exclusive is released when its body throws", async () => {
    await expect(gate.exclusive(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await gate.shared(async () => "after")).toBe("after");
  });

  it("two exclusives run one after the other", async () => {
    const log: string[] = [];
    const h = deferred();
    const one = gate.exclusive(async () => { log.push("1 start"); await h.promise; log.push("1 end"); });
    await tick();
    const two = gate.exclusive(async () => { log.push("2"); });
    await tick();
    expect(log).toEqual(["1 start"]);
    h.resolve();
    await Promise.all([one, two]);
    expect(log).toEqual(["1 start", "1 end", "2"]);
  });

  it("an exclusive requested inside a shared holder is refused (it could never drain)", async () => {
    await expect(gate.shared(() => gate.exclusive(async () => 1))).rejects.toBeInstanceOf(GateMissingError);
  });

  it("requireToken: refuses outside any holder, passes inside shared and exclusive", async () => {
    expect(() => gate.requireToken("payPeriod.deleteMany")).toThrow(GateMissingError);
    await gate.shared(async () => gate.requireToken("x"));
    await gate.exclusive(async () => gate.requireToken("x"));
    await tick();
    expect(() => gate.requireToken("after")).toThrow(GateMissingError);
  });

  it("gated(): maps GateBusy to a 503 and passes handler arguments through", async () => {
    const h = gate.gated(async (req: Request, ctx: { params: Promise<{ id: string }> }) => new Response((await ctx.params).id + req.method));
    const ok = await h(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id: "7" }) });
    expect(await ok.text()).toBe("7POST");
    const hold = deferred();
    const ex = gate.exclusive(() => hold.promise);
    await tick();
    const busy = await h(new Request("http://x"), { params: Promise.resolve({ id: "1" }) });
    expect(busy.status).toBe(503);
    expect((await busy.json()).error).toMatch(/backup or restore/);
    hold.resolve();
    await ex;
  });
});
