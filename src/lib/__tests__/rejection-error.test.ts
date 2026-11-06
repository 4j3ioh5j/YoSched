import { describe, it, expect } from "vitest";
import { rejectionError, dayFullPopoverText } from "../rejection-error";

const resp = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("rejectionError", () => {
  it("carries the server's own cap sentence on a day-full 409", async () => {
    // Regression (Codex #292): the popover used to rebuild "Only one ORC…" from the rules
    // the page loaded, so a Max changed to 0 after page load still read "Only one".
    const err = await rejectionError(resp(409, { error: "Only 0 ORC allowed on Mondays", reason: "day-full", code: "ORC", maxPerDay: 0, date: "2026-11-02" }));
    expect(err.dayFull).toBe(true);
    expect(err.serverText).toBe("Only 0 ORC allowed on Mondays");
    expect(err.message).toBe("Only 0 ORC allowed on Mondays");
  });

  it("is not a day-full rejection for any other failure, and never invents server text", async () => {
    const stale = await rejectionError(resp(409, { error: "Please reload", code: "STALE_CLIENT" }));
    expect(stale.dayFull).toBe(false);
    expect(stale.serverText).toBeUndefined();
    expect(stale.message).toBe("Please reload");

    const noBody = await rejectionError(new Response("nope", { status: 500 }));
    expect(noBody.dayFull).toBe(false);
    expect(noBody.serverText).toBeUndefined();
    expect(noBody.message).toBe("request failed: 500");

    // A day-full body without a usable error string still flags dayFull but offers no text,
    // so the grid falls back to its own sentence rather than showing "undefined".
    const bare = await rejectionError(resp(409, { reason: "day-full" }));
    expect(bare.dayFull).toBe(true);
    expect(bare.serverText).toBeUndefined();
  });
});

describe("dayFullPopoverText", () => {
  const base = { code: "ORC", cap: 1, dayLabel: "on Mondays", day: "11/2", more: "" };

  it("shows the server's sentence verbatim when the server refused", () => {
    expect(dayFullPopoverText({ ...base, serverText: "Only 0 ORC allowed on Mondays" }))
      .toBe("Only 0 ORC allowed on Mondays — 11/2 is already full");
    // The page-load cap (1) is ignored once the server has spoken (0).
    expect(dayFullPopoverText({ ...base, serverText: "Only 0 ORC allowed on Mondays" })).not.toMatch(/one/);
  });

  it("builds the browser's own sentence for the client-side pre-check", () => {
    expect(dayFullPopoverText(base)).toBe("Only one ORC allowed on Mondays — 11/2 is already full");
    expect(dayFullPopoverText({ ...base, cap: 0 })).toBe("No ORC allowed on Mondays — 11/2 is already full");
    expect(dayFullPopoverText({ ...base, cap: 2, more: " (+3 more)" })).toBe("Only 2 ORC allowed on Mondays — 11/2 is already full (+3 more)");
  });
});
