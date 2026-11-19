// Card #359: the widths the user-defined columns print at, as the schedule page last measured
// them (the browser measures text in the print font, so Settings cannot work them out itself).
// Kept in this browser's storage: a convenience for choosing a width, never a saved setting.
import { UD_WIDTH_MAX_ENTRIES } from "./print-layout";

export const UD_WIDTH_SNAPSHOT_KEY = "yosched:udWidthSnapshot";
export type UdWidthSnapshot = { month: string; cols: Record<string, { printIn: number; bestFitIn: number }> };
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };

const okIn = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100;
const round = (v: number) => Math.round(v * 10000) / 10000;

export function buildUdWidthSnapshot(month: string, printIn: ReadonlyMap<string, number>, bestFitIn: ReadonlyMap<string, number>): UdWidthSnapshot {
  const cols: UdWidthSnapshot["cols"] = {};
  for (const [k, p] of printIn) {
    const b = bestFitIn.get(k);
    if (okIn(p) && okIn(b)) cols[k] = { printIn: round(p), bestFitIn: round(b) };
  }
  return { month, cols };
}

export function parseUdWidthSnapshot(raw: string | null): UdWidthSnapshot | null {
  if (!raw) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const { month, cols } = v as { month?: unknown; cols?: unknown };
  if (typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) return null;
  if (!cols || typeof cols !== "object" || Array.isArray(cols)) return null;
  const out: UdWidthSnapshot["cols"] = {};
  let n = 0;
  for (const [k, c] of Object.entries(cols as Record<string, unknown>)) {
    if (n >= UD_WIDTH_MAX_ENTRIES) break;
    if (!c || typeof c !== "object") continue;
    const { printIn, bestFitIn } = c as { printIn?: unknown; bestFitIn?: unknown };
    if (okIn(printIn) && okIn(bestFitIn)) { out[k] = { printIn, bestFitIn }; n++; }
  }
  return { month, cols: out };
}

const browserStore = (): Store | null => (typeof window !== "undefined" ? window.localStorage : null);

// The store is looked up inside the try: some browsers throw on the localStorage getter itself.
export function saveUdWidthSnapshot(s: UdWidthSnapshot, store?: Store | null): void {
  try { (store === undefined ? browserStore() : store)?.setItem(UD_WIDTH_SNAPSHOT_KEY, JSON.stringify(s)); } catch { /* private mode / quota: Settings just shows no widths */ }
}

export function loadUdWidthSnapshot(store?: Store | null): UdWidthSnapshot | null {
  try { return parseUdWidthSnapshot((store === undefined ? browserStore() : store)?.getItem(UD_WIDTH_SNAPSHOT_KEY) ?? null); } catch { return null; }
}
