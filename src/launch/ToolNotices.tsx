// APP-023: the landing screen's notices for missing or signed-out tools, each dismissable, with a
// manual Check again that probes once more (results are otherwise kept from the first probe).
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentInfo } from "./PlusMenu";
import { openSettings } from "../settings/pages";
import { CHECK_FAILED, dismissKey, toolNotices, type Notice, type Tools } from "./toolChecks";

/** The notice id for a dismissal that could not be saved; it has no Check again button, only Dismiss. */
export const DISMISS_FAILED = "dismiss-failed";
export const dismissFailedNotice = (err: unknown): Notice => ({ id: DISMISS_FAILED, text: `Kolux could not save that dismissal: ${String(err)}` });

type ViewProps = { notices: Notice[]; busy: boolean; onDismiss: (id: string) => void; onRefresh: () => void };

export function ToolNoticesView({ notices, busy, onDismiss, onRefresh }: ViewProps) {
  if (notices.length === 0) return null;
  return (
    <div className="tool-notices">
      {notices.map((n) => (
        <div key={n.id} className="notice signin-notice" role="status" data-notice={n.id}>
          <span>{n.text}</span>
          {n.action === "settings" && (
            <button className="btn" onClick={() => openSettings("accounts")}>
              Open Settings
            </button>
          )}
          {n.id !== DISMISS_FAILED && (
            <button className="btn" disabled={busy} onClick={onRefresh} aria-label={`${n.id === CHECK_FAILED.id ? "Try again" : "Check again"}: ${n.text.split(". ")[0]}`}>
              {busy ? "Checking…" : n.id === CHECK_FAILED.id ? "Try again" : "Check again"}
            </button>
          )}
          <button className="btn dismiss" onClick={() => onDismiss(n.id)} aria-label={`Dismiss: ${n.text.split(". ")[0]}`}>
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}

/** `projects` is the registered project ids; a change reads the hosted projects again (probes stay cached). */
export default function ToolNotices({ projects }: { projects: string }) {
  const [tools, setTools] = useState<Tools | null>(null);
  const [agents, setAgents] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false); // the probe itself could not run
  const [saveError, setSaveError] = useState<Notice | null>(null); // a dismissal could not be saved
  const check = useCallback((refresh: boolean) => {
    setBusy(true);
    setFailed(false);
    setSaveError(null);
    Promise.all([
      invoke<Tools>("tools_check", { refresh }).then(setTools),
      invoke<AgentInfo[]>("agent_list").then((list) => setAgents(list.some((a) => a.installed))),
    ])
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => check(false), [check, projects]);
  if (!tools && !failed) return null;
  const dismiss = (id: string) => {
    if (id === DISMISS_FAILED) return setSaveError(null);
    if (!tools || id === CHECK_FAILED.id) return setFailed(false);
    const under = dismissKey(tools);
    const before = tools.dismissed[id];
    setTools((t) => t && { ...t, dismissed: { ...t.dismissed, [id]: under } });
    // A dismissal that could not be saved comes back (only that notice, whatever else changed meanwhile), with the reason, instead of vanishing until the next launch.
    invoke("tools_dismiss", { id, under }).catch((err) => {
      setTools((t) => {
        if (!t) return t;
        const { [id]: _gone, ...rest } = t.dismissed;
        return { ...t, dismissed: before === undefined ? rest : { ...rest, [id]: before } };
      });
      setSaveError(dismissFailedNotice(err));
    });
  };
  const notices = tools ? toolNotices(tools, agents) : [];
  const shown = [...(failed ? [CHECK_FAILED] : []), ...(saveError ? [saveError] : []), ...notices];
  return <ToolNoticesView notices={shown} busy={busy} onDismiss={dismiss} onRefresh={() => check(true)} />;
}
