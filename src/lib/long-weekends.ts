// Card #467: the long-weekend score, shared by STEP 3's day-off choice and the "Long weekends
// off" priority factor so the two can never disagree. Pure: the caller says which days are off.
//
// A run of 2+ consecutive off days scores (len − 1) × the sequential weight; a run of 3+ (4+)
// that touches one of the person's non-working weekdays scores the 3-day (4-day) weekend weight.
// The toggles and weights are the Scheduling Preferences settings.

export type OffRunPrefs = {
  preferSequentialOff: boolean;
  sequentialOffWeight: number;
  prefer3DayWeekends: boolean;
  threeDayWeekendWeight: number;
  prefer4DayWeekends: boolean;
  fourDayWeekendWeight: number;
};

export type OffDay = { date: string; isOff: boolean; isNonWorkDay: boolean };

/** Score of the off-day runs in a calendar (ordered by date, consecutive days). */
export function scoreOffRuns(calendar: readonly OffDay[], prefs: OffRunPrefs): number {
  let score = 0;
  let runLen = 0;
  let runTouchesNonWorkDay = false;
  for (let i = 0; i <= calendar.length; i++) {
    const entry = calendar[i];
    if (entry && entry.isOff) {
      runLen++;
      if (entry.isNonWorkDay) runTouchesNonWorkDay = true;
    } else {
      if (runLen >= 2 && prefs.preferSequentialOff) score += (runLen - 1) * prefs.sequentialOffWeight;
      if (runLen >= 3 && runTouchesNonWorkDay && prefs.prefer3DayWeekends) score += prefs.threeDayWeekendWeight;
      if (runLen >= 4 && runTouchesNonWorkDay && prefs.prefer4DayWeekends) score += prefs.fourDayWeekendWeight;
      runLen = 0;
      runTouchesNonWorkDay = false;
    }
  }
  return score;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * The calendar from 3 days before `firstDate` to 3 days after `lastDate` (the padding lets a
 * run that crosses the window's edge into a weekend count), with `isOff(date)` per day and
 * non-working days from the person's working weekdays (0 = Sunday).
 */
export function paddedOffCalendar(
  firstDate: string,
  lastDate: string,
  workingDows: readonly number[],
  isOff: (date: string, isNonWorkDay: boolean) => boolean,
): OffDay[] {
  const working = new Set(workingDows);
  const cur = new Date(firstDate + "T12:00:00");
  cur.setDate(cur.getDate() - 3);
  const end = new Date(lastDate + "T12:00:00");
  end.setDate(end.getDate() + 3);
  const out: OffDay[] = [];
  while (cur <= end) {
    const date = ymd(cur);
    const isNonWorkDay = !working.has(cur.getDay());
    out.push({ date, isOff: isOff(date, isNonWorkDay), isNonWorkDay });
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/**
 * The "Long weekends off" factor's view of one day, from the FINISHED grid (card #467): a day
 * with a cell is off only when that cell is an away (off or leave) shift, so a worked weekend
 * or holiday is not off. A blank day inside the run becomes an X later, so it is off. A blank
 * day outside the run falls back to the person's non-working weekdays and holidays.
 */
export function gradedIsOff(
  cellIsAway: boolean | undefined,
  inRun: boolean,
  isNonWorkDay: boolean,
  isHoliday: boolean,
): boolean {
  if (cellIsAway !== undefined) return cellIsAway;
  if (inRun) return true;
  return isNonWorkDay || isHoliday;
}
