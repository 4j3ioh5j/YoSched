"use client";

type Bucket = "payPeriod" | "month";

const OPTS: { value: Bucket; label: string }[] = [
  { value: "payPeriod", label: "Pay periods" },
  { value: "month", label: "Months" },
];

/** Time axis granularity for the line chart (spec.timeBucket). */
export function TimeBucketPicker({
  value,
  onChange,
}: {
  value: Bucket;
  onChange: (b: Bucket) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 w-16">Time axis</span>
      <div className="flex rounded overflow-hidden border border-slate-700">
        {OPTS.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`px-2.5 py-1 text-[11px] transition-colors ${value === o.value ? "bg-blue-600/30 text-blue-300" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
