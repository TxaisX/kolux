// T-066-d: a program's own resume hint names its session; it wins over a listed guess (T-066-e), a hook's id is
// never replaced. Moved out of the command line's window bridge when the command line went; called where that sat,
// so the window's hook order is unchanged.
import { useEffect } from "react";
import { withHintedSession } from "./layout";
import { onTerminalExit } from "./outputBus";
import type { WindowState } from "../shell/windowStore";

export function useResumeHint({ ptys, setPanes }: Pick<WindowState, "ptys" | "setPanes">) {
  useEffect(() => {
    const off = onTerminalExit<{ id: number; code?: number | null; session?: string }>((e) => {
      const hit = Object.entries(ptys.current).find(([, t]) => t === e.payload.id);
      const printed = e.payload.session;
      if (hit && printed) setPanes((ps) => withHintedSession(ps, Number(hit[0]), printed));
    });
    return () => void off.then((f) => f()).catch(() => undefined);
  }, []);
}
