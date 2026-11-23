// Card #482: Settings shows "Saved" only when the server kept the fields that matter. An older
// server (a rollback) ignores a field it does not know and still answers 200.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unsavedKeys } from "../save-echo";

describe("unsavedKeys (card #482)", () => {
  const body = { printPdfFont: "barlow-semi-condensed", printFontSize: 9 };
  it("none when the server returns what was sent", () => {
    expect(unsavedKeys(body, { id: "default", ...body }, ["printPdfFont"])).toEqual([]);
  });
  it("a key the server left out", () => {
    expect(unsavedKeys(body, { id: "default", printFontSize: 9 }, ["printPdfFont"])).toEqual(["printPdfFont"]);
  });
  it("a key the server kept at another value", () => {
    expect(unsavedKeys(body, { printPdfFont: "archivo-narrow" }, ["printPdfFont"])).toEqual(["printPdfFont"]);
  });
  it("every key when the answer is not an object", () => {
    for (const bad of [null, undefined, "ok", 3, ["printPdfFont"]]) expect(unsavedKeys(body, bad, ["printPdfFont", "printFontSize"]), String(bad)).toEqual(["printPdfFont", "printFontSize"]);
  });
  it("only the listed keys are checked", () => {
    expect(unsavedKeys(body, { printPdfFont: "barlow-semi-condensed" }, ["printPdfFont"])).toEqual([]);
    expect(unsavedKeys(body, {}, [])).toEqual([]);
  });
});

describe("the Settings save checks the answer (card #482)", () => {
  const ui = readFileSync(join(__dirname, "../../app/settings/settings-page.tsx"), "utf8");
  const slice = (name: string) => { const i = ui.search(new RegExp(`function ${name}[(<]`)); return ui.slice(i, ui.indexOf("\nfunction ", i + 10)); };
  it("the hook rejects an answer missing a required field before adopting the draft", () => {
    const hook = slice("useSavedDraft");
    const check = hook.indexOf("unsavedKeys(");
    expect(check).toBeGreaterThan(hook.indexOf("if (!res.ok)"));
    expect(check).toBeLessThan(hook.indexOf("setSaved(next)"));
    expect(hook).toMatch(/opts\?\.mustEcho/);
  });
  it("Table Font requires the PDF font on Save and on Reset", () => {
    const body = slice("PrintFontSection");
    expect(body.match(/mustEcho: \["printPdfFont"\]/g)?.length).toBe(2);
  });
});
