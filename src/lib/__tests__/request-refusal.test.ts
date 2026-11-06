import { describe, it, expect } from "vitest";
import { classifyRequestRefusal, requestFailureText, requestFlaggedText } from "../request-refusal";

describe("classifyRequestRefusal", () => {
  it("names the busy retry; every other failure is other (the locked-day 409 is retired, card #67)", () => {
    // Codex #315: the grid labelled every 409 "locked", so the busy sentence was lost.
    expect(classifyRequestRefusal(409, { error: "Another edit on that day is still saving — try again", reason: "busy" })).toBe("busy");
    // An old server's locked-day body is no longer a category of its own: it shows as a plain failure.
    expect(classifyRequestRefusal(409, { error: "Can't approve — 1 covered day(s) locked (2026-11-09).", blockedDates: ["2026-11-09"] })).toBe("other");
    expect(classifyRequestRefusal(409, null)).toBe("other");
    expect(classifyRequestRefusal(500, { reason: "busy" })).toBe("other");
    expect(classifyRequestRefusal(0, null)).toBe("other");
  });
});

describe("requestFailureText", () => {
  it("names the busy count with the server's retry sentence", () => {
    expect(requestFailureText({ failed: 1, busy: 0, verb: "approved" })).toBe("1 request(s) couldn't be approved.");
    expect(requestFailureText({ failed: 1, busy: 1, busyText: "Another edit on that day is still saving — try again", verb: "approved" }))
      .toBe("1 request(s) couldn't be approved (1 waiting on another save — Another edit on that day is still saving — try again).");
    expect(requestFailureText({ failed: 3, busy: 1, verb: "denied" })).toBe("3 request(s) couldn't be denied (1 waiting on another save — try again).");
    expect(requestFailureText({ failed: 2, busy: 0, verb: "reset to pending" })).toBe("2 request(s) couldn't be reset to pending.");
  });
});

describe("requestFlaggedText", () => {
  it("says the approvals were flagged, with the server's reason when there is one", () => {
    expect(requestFlaggedText(1, "Mon 11/9 already has its 1 ORC (set by hand for AB)")).toBe("1 request(s) were flagged instead of approved: Mon 11/9 already has its 1 ORC (set by hand for AB).");
    expect(requestFlaggedText(2, undefined)).toBe("2 request(s) were flagged instead of approved.");
    expect(requestFlaggedText(1, "  ")).toBe("1 request(s) were flagged instead of approved.");
  });
});
