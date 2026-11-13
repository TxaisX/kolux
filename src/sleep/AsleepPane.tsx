// TERM-123 (T-817): the placeholder a sleeping agent pane shows in place of its terminal. Wake, a click
// anywhere in the pane, focusing it or typing in it starts the same agent again on its resume line
// (useAgentSleep.wakePane). The shown idle count keeps moving while the pane sleeps.
import { useEffect, useState } from "react";
import type { Asleep } from "./agentSleep";
import { idleShown } from "./agentSleep";
import { t } from "../i18n/lookup";
import { usePackLoaded } from "../shell/usePackLoaded";

export default function AsleepPane({ asleep, hidden, onWake }: { asleep: Asleep; hidden: boolean; onWake: () => void }) {
  usePackLoaded();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (hidden) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [hidden]);
  const wake = () => onWake();
  return (
    <div className="pane pane-asleep" hidden={hidden} tabIndex={0} onMouseDown={wake} onFocus={wake} onKeyDown={wake} data-testid="asleep-pane">
      <div className="empty" role="status">
        <h2>{t("sleep.asleep", { count: idleShown(asleep, now) })}</h2>
        <p>{t("sleep.asleep.hint")}</p>
        <button className="btn" onClick={wake}>
          {t("sleep.wake")}
        </button>
      </div>
    </div>
  );
}
