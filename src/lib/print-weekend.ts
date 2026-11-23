// Card #462: a printed month that ends on the weekend's FIRST day also prints the weekend's
// second day, so a paired weekend shift (e.g. CALL) prints whole. The weekend comes from Settings.
import { weekendSecondDow } from "./scheduler-tuning";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The day after the month's last day when that last day starts the weekend, else null. */
export function printExtraDate(lastOfMonthIso: string, weekendStartDow: number): string | null {
  const m = ISO.exec(lastOfMonthIso);
  if (!m || !Number.isInteger(weekendStartDow) || weekendStartDow < 0 || weekendStartDow > 6) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getDay() !== weekendStartDow) return null;
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  if (next.getDay() !== weekendSecondDow(weekendStartDow)) return null;
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
}
