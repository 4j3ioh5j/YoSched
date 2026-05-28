const MONTH_NAMES_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

export type DateFormatKey =
  | "MMMM D, YYYY"
  | "MMM D, YYYY"
  | "MM/DD/YYYY"
  | "DD/MM/YYYY"
  | "YYYY-MM-DD"
  | "M/D/YYYY"
  | "D/M/YYYY"
  | "D MMMM YYYY"
  | "DD.MM.YYYY";

export const DATE_FORMAT_OPTIONS: { key: DateFormatKey; label: string }[] = [
  { key: "MMMM D, YYYY", label: "January 5, 2026" },
  { key: "MMM D, YYYY", label: "Jan 5, 2026" },
  { key: "MM/DD/YYYY", label: "01/05/2026" },
  { key: "M/D/YYYY", label: "1/5/2026" },
  { key: "DD/MM/YYYY", label: "05/01/2026" },
  { key: "D/M/YYYY", label: "5/1/2026" },
  { key: "D MMMM YYYY", label: "5 January 2026" },
  { key: "DD.MM.YYYY", label: "05.01.2026" },
  { key: "YYYY-MM-DD", label: "2026-01-05" },
];

export const DEFAULT_DATE_FORMAT: DateFormatKey = "MMMM D, YYYY";

export function formatDate(date: Date, format: DateFormatKey): string {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();

  switch (format) {
    case "MMMM D, YYYY":
      return `${MONTH_NAMES_FULL[m]} ${d}, ${y}`;
    case "MMM D, YYYY":
      return `${MONTH_NAMES_SHORT[m]} ${d}, ${y}`;
    case "MM/DD/YYYY":
      return `${pad2(m + 1)}/${pad2(d)}/${y}`;
    case "DD/MM/YYYY":
      return `${pad2(d)}/${pad2(m + 1)}/${y}`;
    case "YYYY-MM-DD":
      return `${y}-${pad2(m + 1)}-${pad2(d)}`;
    case "M/D/YYYY":
      return `${m + 1}/${d}/${y}`;
    case "D/M/YYYY":
      return `${d}/${m + 1}/${y}`;
    case "D MMMM YYYY":
      return `${d} ${MONTH_NAMES_FULL[m]} ${y}`;
    case "DD.MM.YYYY":
      return `${pad2(d)}.${pad2(m + 1)}.${y}`;
    default:
      return `${MONTH_NAMES_FULL[m]} ${d}, ${y}`;
  }
}

export function formatDateCompact(date: Date, format: DateFormatKey): string {
  const m = date.getMonth() + 1;
  const d = date.getDate();

  switch (format) {
    case "MMMM D, YYYY":
    case "MMM D, YYYY":
    case "MM/DD/YYYY":
    case "M/D/YYYY":
      return `${m}/${d}`;
    case "DD/MM/YYYY":
    case "D/M/YYYY":
    case "D MMMM YYYY":
      return `${d}/${m}`;
    case "DD.MM.YYYY":
      return `${pad2(d)}.${pad2(m)}`;
    case "YYYY-MM-DD":
      return `${pad2(m)}-${pad2(d)}`;
    default:
      return `${m}/${d}`;
  }
}

export function isValidDateFormat(value: string): value is DateFormatKey {
  return DATE_FORMAT_OPTIONS.some((o) => o.key === value);
}
