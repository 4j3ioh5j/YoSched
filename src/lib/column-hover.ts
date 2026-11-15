// Card #221: the text shown when hovering a person's column header on the schedule grid. Its
// shift lines are the shifts the Equity Factors settings track (the keys of the averages, in
// Settings order) — never a fixed list of shift codes in code.

type HoverEquity = {
  displayDeviation: { overall: number; desirability: number };
  metrics: { holidayWorkCount: number; shiftCounts: Record<string, number> };
};
type HoverAverages = { holidayWorkCount: number; perShift: Record<string, number> };

export function columnHoverText(o: { name: string; empLabel: string; fte: number; fe: HoverEquity | undefined; averages: HoverAverages | undefined }): string {
  const head = `${o.name} (${o.empLabel})`;
  if (!o.fe) return head;
  const z = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}σ`;
  const avg = (v: number | undefined) => ((v ?? 0) * o.fte).toFixed(1);
  const lines = [
    head,
    `Equity: ${z(o.fe.displayDeviation.overall)}`,
    `Desirability: ${z(-o.fe.displayDeviation.desirability)}`,
    `Holiday: ${o.fe.metrics.holidayWorkCount} (avg ${avg(o.averages?.holidayWorkCount)})`,
  ];
  for (const [code, a] of Object.entries(o.averages?.perShift ?? {})) {
    lines.push(`${code}: ${o.fe.metrics.shiftCounts[code] ?? 0} (avg ${avg(a)})`);
  }
  return lines.join("\n");
}
