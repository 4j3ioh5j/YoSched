// Card #307: one parser for every number field. Any ordinary way of writing a decimal is
// accepted (0.2, 0.20, .4, 00.45, 5, 5.), blank means "no value", and the stored value is
// shown back as it is (no rounding to a whole number).

export type DecimalOpts = {
  min?: number;
  max?: number;
  /** Round to this many decimal places before the bounds check. */
  decimals?: number;
  integer?: boolean;
  allowNegative?: boolean;
  /** Blank is an error instead of null. */
  required?: boolean;
};

export type DecimalParse = { ok: true; value: number | null } | { ok: false; error: string };

const PLAIN = /^(-)?(\d+\.?\d*|\.\d+)$/;

function roundTo(n: number, decimals: number): number {
  // Round half up on the decimal text, not the binary float (1.005 -> 1.01).
  // Shift by editing the exponent of the shortest form, so 1e-7 and 1e29 work too.
  if (Number.isInteger(n)) return n; // nothing to round (and huge values have no fraction)
  const shift = (x: number, by: number) => {
    const [mant, exp] = x.toExponential().split("e");
    return Number(`${mant}e${Number(exp) + by}`);
  };
  const r = shift(Math.round(shift(n, decimals)), -decimals);
  return Object.is(r, -0) ? 0 : r;
}

export function parseDecimalInput(raw: string, opts: DecimalOpts = {}): DecimalParse {
  const t = raw.trim();
  if (t === "") return opts.required ? { ok: false, error: "Enter a number" } : { ok: true, value: null };
  const m = PLAIN.exec(t);
  if (!m) return { ok: false, error: "Enter a number, like 0.2 or 5" };
  if (m[1] && !opts.allowNegative) return { ok: false, error: "Must not be negative" };
  let n = Number(t);
  if (!Number.isFinite(n)) return { ok: false, error: "Enter a number, like 0.2 or 5" };
  if (opts.integer) {
    if (!Number.isInteger(n)) return { ok: false, error: "Enter a whole number" };
  } else if (opts.decimals != null) {
    n = roundTo(n, opts.decimals);
  }
  if (!Number.isFinite(n)) return { ok: false, error: "Enter a number, like 0.2 or 5" };
  if (Object.is(n, -0)) n = 0;
  if (opts.min != null && n < opts.min) return { ok: false, error: `Must be at least ${formatDecimal(opts.min)}` };
  if (opts.max != null && n > opts.max) return { ok: false, error: `Must be at most ${formatDecimal(opts.max)}` };
  return { ok: true, value: n };
}

/** The stored value as text: exact, without float noise or trailing zeros. */
export function formatDecimal(v: number | null | undefined, opts: { minDecimals?: number } = {}): string {
  if (v == null || !Number.isFinite(v)) return "";
  let s = String(Number(v.toPrecision(12)));
  if (opts.minDecimals) {
    const dot = s.indexOf(".");
    const have = dot < 0 ? 0 : s.length - dot - 1;
    if (have < opts.minDecimals) s = (dot < 0 ? s + "." : s) + "0".repeat(opts.minDecimals - have);
  }
  return s;
}

/**
 * The text a field shows after its stored value moves from `prev` to `next`. The typed
 * draft stays while the value is unchanged (so "0." or a typo can be finished) and when
 * the draft is what produced the new value ("00.45" stays "00.45"); a change from
 * elsewhere (reset, reload, undo) replaces it.
 */
export function draftAfterExternal(draft: string, prev: number | null, next: number | null, opts: DecimalOpts = {}): string {
  if (prev === next) return draft;
  const p = parseDecimalInput(draft, { ...opts, min: undefined, max: undefined, required: false });
  if (p.ok && p.value === next) return draft;
  return formatDecimal(next);
}

/**
 * Card #361: how many characters a number box needs for the widest value it allows:
 * the digits of the largest bound (four with no upper bound), the decimals, a minus sign.
 */
export function decimalFieldChars(opts: DecimalOpts = {}): number {
  const digits = (n: number) => String(Math.floor(Math.abs(n))).length;
  const neg = !!opts.allowNegative && (opts.min == null || opts.min < 0);
  let whole = opts.max == null ? 4 : digits(opts.max);
  if (neg && opts.min != null) whole = Math.max(whole, digits(opts.min));
  const frac = opts.integer || !opts.decimals ? 0 : opts.decimals + 1;
  return whole + frac + (neg ? 1 : 0);
}
