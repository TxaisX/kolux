// Settings > Usage can stay open across midnight; its day bars and grid end at "today", so the panel is told
// when the local day changes instead of keeping the day it opened on.

/** Calls `onDay` with the time just after each local midnight until the returned stop is called. */
export function watchDay(onDay: (now: Date) => void): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    // A little past midnight, so the new day has begun when the timer fires (timers can run a few ms early).
    timer = setTimeout(() => {
      onDay(new Date());
      arm();
    }, next.getTime() - now.getTime() + 1000);
  };
  arm();
  return () => clearTimeout(timer);
}
