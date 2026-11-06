import { describe, it, expect } from "vitest";
import { classifyRequestRefusal, requestFailureText } from "../request-refusal";

describe("classifyRequestRefusal", () => {
  it("tells the busy retry apart from the locked-day refusal; anything else is other", () => {
    // Codex #315: the grid labelled every 409 "locked", so the busy sentence was lost.
    expect(classifyRequestRefusal(409, { error: "Another edit on that day is still saving — try again", reason: "busy" })).toBe("busy");
    expect(classifyRequestRefusal(409, { error: "Can't approve — 1 covered day(s) locked (2026-11-09).", blockedDates: ["2026-11-09"] })).toBe("locked");
    expect(classifyRequestRefusal(409, null)).toBe("locked"); // the locked body never carried a reason
    expect(classifyRequestRefusal(500, { reason: "busy" })).toBe("other");
    expect(classifyRequestRefusal(0, null)).toBe("other");
  });
});

describe("requestFailureText", () => {
  it("names the locked and the busy counts separately, with the server's retry sentence", () => {
    expect(requestFailureText({ failed: 1, locked: 1, busy: 0, verb: "approved" })).toBe("1 request(s) couldn't be approved (1 locked).");
    expect(requestFailureText({ failed: 1, locked: 0, busy: 1, busyText: "Another edit on that day is still saving — try again", verb: "approved" }))
      .toBe("1 request(s) couldn't be approved (1 waiting on another save — Another edit on that day is still saving — try again).");
    expect(requestFailureText({ failed: 3, locked: 1, busy: 1, verb: "denied" })).toBe("3 request(s) couldn't be denied (1 locked; 1 waiting on another save — try again).");
    expect(requestFailureText({ failed: 2, locked: 0, busy: 0, verb: "reset to pending" })).toBe("2 request(s) couldn't be reset to pending.");
  });
});
