import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Card #312: Print and Export save a version first when a month changed or has none.
// Source pins on the wiring; the decisions themselves are tested in lib/auto-version and
// the /api/versions/ensure route.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const grid = read("src/app/schedule-grid.tsx");
const dialog = read("src/app/export-year-dialog.tsx");
const page = read("src/app/page.tsx");
const settingsPage = read("src/app/settings/page.tsx");
const settingsUi = read("src/app/settings/settings-page.tsx");

const fnBody = (src: string, start: string) => {
  const i = src.indexOf(start);
  expect(i, `missing ${start}`).toBeGreaterThan(-1);
  return src.slice(i, src.indexOf("\n  }, [", i));
};

describe("the setting reaches the grid and Settings (card #312)", () => {
  it("page passes the parsed mode to the grid", () => {
    expect(page).toMatch(/autoVersionMode=\{parseAutoVersionMode\(schedPrefs\?\.autoVersionMode\)\}/);
  });
  it("Settings loads it and shows the three choices", () => {
    expect(settingsPage).toMatch(/autoVersionMode: parseAutoVersionMode\(schedulingPrefsRow\?\.autoVersionMode\)/);
    expect(settingsUi).toMatch(/<AutoVersionSection initial=\{schedulingPrefs\.autoVersionMode\} \/>/);
    expect(settingsUi).toMatch(/save\(\{ autoVersionMode: /);
    for (const label of ["Automatic", "Ask first", "Off"]) expect(settingsUi).toContain(`"${label}"`);
  });
});

describe("Print saves a version first (card #312)", () => {
  const i = grid.indexOf("const printMonth = useCallback(() => printGate(async () => {");
  const print = grid.slice(i, grid.indexOf("}), [", i));

  it("one Print at a time", () => {
    expect(i).toBeGreaterThan(-1);
    expect(grid).toContain("const [printGate] = useState(() => exclusive((run: () => Promise<void>) => run()));");
  });

  it("Live sandbox, view-only users and Off keep the old behaviour", () => {
    expect(grid).toMatch(/const autoVersionOn = !liveMode && canEdit && autoVersionMode !== "off";/);
    expect(print).toMatch(/if \(!autoVersionOn\) \{[\s\S]*unsavedPrintWarning\(/);
  });

  it("the month and cells are frozen at the click and re-checked against the screen after the wait", () => {
    expect(print).toMatch(/frozen: \{ year: viewYear, month: viewMonth, hash: liveMonthHash \}/);
    expect(print).toMatch(/const frozen = scheduleInputRef\.current\(false\);[\s\S]*await runPrintFlow\(/);
    expect(print).toMatch(/stamp: \(n\) => \{ printVersionRef\.current = n; stampPrint\(n\); printedVersion = n; \}/);
  });

  it("after the wait, an unmounted grid or a Live sandbox never prints (Codex r1)", () => {
    expect(grid).toMatch(/const printMountedRef = useRef\(false\);/);
    expect(grid).toMatch(/useEffect\(\(\) => \{ printMountedRef\.current = true; return \(\) => \{ printMountedRef\.current = false; \}; \}, \[\]\);/);
    expect(grid).toMatch(/const showingNow = useCallback\(\(\) => \(printMountedRef\.current \? \{ \.\.\.showingRef\.current, live: liveModeRef\.current \} : null\), \[\]\);/);
    expect(print).toMatch(/showing: showingNow,/);
  });

  it("the beforeprint stamp reads the version from the ref", () => {
    expect(grid).toMatch(/const stamp = \(\) => stampPrint\(printVersionRef\.current\);/);
  });

  it("Ctrl/Cmd+P and the Print button go through it", () => {
    expect(grid).toContain("void printMonth();");
    expect(grid).toContain("onClick={() => void printMonth()}");
  });
});

describe("Export saves versions for the whole year first (card #312)", () => {
  it("the dialog awaits prepare(year) before building, and builds from its frozen input", () => {
    const run = dialog.slice(dialog.indexOf("const onExport = "));
    const prep = run.indexOf("await prepare(year)");
    const build = run.indexOf("runYearExport(");
    expect(prep).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(prep);
    expect(run).toMatch(/const input = ensured\.input;/);
    expect(run).toMatch(/if \(!ensured\.ok\)/);
  });

  it("the grid freezes the input and the twelve months' hashes before the wait", () => {
    const p = grid.slice(grid.indexOf("prepare={(year: number) => {"));
    const input = p.indexOf("const input = scheduleInputRef.current(false);");
    const hashes = p.indexOf("yearMonths(year).map(");
    const wait = p.indexOf("prepareYearExport(");
    expect(input).toBeGreaterThan(-1);
    // Card #476: the shared builder deep-copies, so later edits cannot reach the frozen input.
    expect(grid).toMatch(/const scheduleInput = \(live: boolean\): ExportScheduleInput => \{[\s\S]{0,600}return structuredClone\(\{/);
    expect(hashes).toBeGreaterThan(input);
    expect(wait).toBeGreaterThan(hashes);
  });

  it("version numbers come from the live map, not the page-load prop", () => {
    expect(grid).not.toMatch(/versions: currentVersions\.map/);
    expect(grid).toMatch(/versions: \[\.\.\.currentVersionMapRef\.current\.values\(\)\]/);
  });
});
