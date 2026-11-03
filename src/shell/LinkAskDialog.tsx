// TERM-135: the dialog behind askLink. Mounted once near the app's root. role="dialog" so the guided
// tours (which wait while any dialog is open) hold off. The Kolux browser choice has the focus;
// Escape or a click outside opens the link in the system browser this once and leaves the question open.
import { trapTab } from "../chrome/dialogFocus";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { answerLinks, dialogWords, dismissLinks, linkState, subscribeLinks, waitingLink } from "./linkAsk";

const isMac = () => typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

export default function LinkAskHost() {
  const url = useSyncExternalStore(subscribeLinks, waitingLink, waitingLink);
  return url ? <Dialog url={url} /> : null;
}

function Dialog({ url }: { url: string }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  const w = dialogWords(linkState(), url, isMac());
  return (
    <div className="ask-backdrop" onMouseDown={() => dismissLinks()}>
      <div
        className="ask"
        role="dialog"
        aria-modal="true"
        aria-label={w.title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          trapTab(e);
          if (e.key === "Escape") (e.preventDefault(), dismissLinks());
        }}
      >
        <h2 className="ask-title">{w.title}</h2>
        <div className="ask-body">
          <p>{w.lead}</p>
          <p className="conn-detail">{w.tip}</p>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={() => answerLinks("system")}>
            {w.other}
          </button>
          <button ref={first} className="btn primary" onClick={() => answerLinks("kolux")}>
            {w.keep}
          </button>
        </div>
      </div>
    </div>
  );
}
