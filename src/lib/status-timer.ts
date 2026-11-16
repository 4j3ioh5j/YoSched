// Card #303: the "Saved" → idle status timer of a settings section. One timer per section;
// a new save cancels it, so an earlier save's timer can never unlock the inputs while a
// later save is still in flight.

export type StatusTimer = { arm: () => void; cancel: () => void };

export function createStatusTimer(onIdle: () => void, ms = 2000): StatusTimer {
  let t: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (t !== null) {
      clearTimeout(t);
      t = null;
    }
  };
  return {
    cancel,
    arm: () => {
      cancel();
      t = setTimeout(() => {
        t = null;
        onIdle();
      }, ms);
    },
  };
}
