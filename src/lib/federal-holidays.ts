function nthDayOfMonth(year: number, month: number, dayOfWeek: number, n: number): Date {
  const first = new Date(year, month, 1);
  let dow = first.getDay();
  let day = 1 + ((dayOfWeek - dow + 7) % 7);
  day += (n - 1) * 7;
  return new Date(year, month, day);
}

function lastDayOfMonth(year: number, month: number, dayOfWeek: number): Date {
  const last = new Date(year, month + 1, 0);
  let dow = last.getDay();
  let day = last.getDate() - ((dow - dayOfWeek + 7) % 7);
  return new Date(year, month, day);
}

function observed(date: Date): Date {
  const dow = date.getDay();
  if (dow === 6) return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
  if (dow === 0) return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return date;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getFederalHolidays(year: number): { date: string; name: string }[] {
  const holidays: { date: Date; name: string }[] = [
    { date: new Date(year, 0, 1), name: "New Year's Day" },
    { date: nthDayOfMonth(year, 0, 1, 3), name: "Martin Luther King Jr. Day" },
    { date: nthDayOfMonth(year, 1, 1, 3), name: "Presidents' Day" },
    { date: lastDayOfMonth(year, 4, 1), name: "Memorial Day" },
    { date: new Date(year, 5, 19), name: "Juneteenth" },
    { date: new Date(year, 6, 4), name: "Independence Day" },
    { date: nthDayOfMonth(year, 8, 1, 1), name: "Labor Day" },
    { date: nthDayOfMonth(year, 9, 1, 2), name: "Columbus Day" },
    { date: new Date(year, 10, 11), name: "Veterans Day" },
    { date: nthDayOfMonth(year, 10, 4, 4), name: "Thanksgiving Day" },
    { date: new Date(year, 11, 25), name: "Christmas Day" },
  ];

  return holidays.map((h) => {
    const obs = observed(h.date);
    const suffix = obs.getTime() !== h.date.getTime() ? " (observed)" : "";
    return { date: toDateStr(obs), name: h.name + suffix };
  });
}
