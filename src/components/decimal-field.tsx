"use client";

// Card #307: a number field that takes any ordinary decimal (0.2, 0.20, .4, 00.45, 5)
// and keeps what is being typed until it is a whole number. A plain text box with the
// decimal keypad: type="number" drops "." and ".4" mid-typing and varies by browser.

import { useState, type InputHTMLAttributes } from "react";
import { decimalFieldChars, draftAfterExternal, formatDecimal, parseDecimalInput, type DecimalOpts } from "@/lib/decimal-input";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "max" | "step"> &
  DecimalOpts & {
    value: number | null;
    /** Called with each valid value as it is typed (null = blank). */
    onValueChange: (v: number | null) => void;
    minDecimals?: number;
  };

export function DecimalField({ value, onValueChange, min, max, decimals, integer, allowNegative, required, minDecimals, onBlur, className, style, ...rest }: Props) {
  const opts: DecimalOpts = { min, max, decimals, integer, allowNegative, required };
  const [draft, setDraft] = useState(() => formatDecimal(value, { minDecimals }));
  const [shown, setShown] = useState(value);
  // The text we last committed from: the parent may store our value in its own form
  // (0 for blank, null for 0), so its echo of our commit must not replace the draft.
  const [committed, setCommitted] = useState<string | null>(null);
  // A new value from outside (reset, reload, undo) replaces the draft; our own commit does not.
  if (shown !== value) {
    setShown(value);
    setCommitted(null);
    if (draft !== committed) setDraft(draftAfterExternal(draft, shown, value, opts));
  }
  const parsed = parseDecimalInput(draft, opts);
  const error = parsed.ok ? null : parsed.error;

  return (
    <input
      {...rest}
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      autoComplete="off"
      value={draft}
      aria-invalid={error ? true : undefined}
      title={error ?? rest.title}
      className={`${className ?? ""}${error ? " !border-red-500" : ""}`}
      // Card #361: never narrower than the widest allowed value (plus the box's padding).
      style={{ minWidth: `calc(${decimalFieldChars(opts)}ch + 1.25rem)`, ...style }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const p = parseDecimalInput(raw, opts);
        if (p.ok && p.value !== value) {
          setCommitted(raw);
          onValueChange(p.value);
        }
      }}
      onBlur={(e) => {
        // Leaving the field shows what is stored: "00.45" becomes "0.45", a typo goes back.
        setDraft(formatDecimal(value, { minDecimals }));
        setCommitted(null);
        onBlur?.(e);
      }}
    />
  );
}
