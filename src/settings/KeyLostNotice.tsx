// ACCT-010: a key the system's key store can no longer open (a new Windows profile, a restored
// backup) was cleared at startup; this note in the main window says which one and where to
// reconnect it. It stays until dismissed or until that key is stored again.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openSettings } from "./pages";
import { onlyWindowState } from "./settingsSync";

// One name for every field in SECRET_KEYS (settingsSync.ts), so the note never says only "a stored key".
const LABELS: Record<string, string> = {
  claudeOauthToken: "Claude 1-year key",
  xaiApiKey: "xAI key",
  httpProxy: "proxy address",
  minimaxCookie: "MiniMax cookie",
  minimaxApiKey: "MiniMax key",
  moonshotApiKey: "Moonshot key",
};

/** The note's sentence for the cleared settings fields; null when there are none. */
export function lostText(names: string[]): string | null {
  if (names.length === 0) return null;
  const known = names.map((n) => LABELS[n]).filter(Boolean);
  const many = names.length > 1;
  const subject = known.length > 0 ? `Your ${known.join(" and ")}` : many ? "Some stored keys" : "A stored key";
  return `${subject} could not be opened on this computer, so ${many ? "they were" : "it was"} cleared. Reconnect ${many ? "them" : "it"} in Settings › Accounts & keys.`;
}

/** Row 892: asks the app to forget the note; the reason when it refuses, else null (the note may go). */
export async function dismissFailure(dismiss: () => Promise<unknown>): Promise<string | null> {
  try {
    await dismiss();
    return null;
  } catch (e) {
    return `The note could not be dismissed (${e instanceof Error ? e.message : String(e)}), so it will show again.`;
  }
}

/** What the note shows after a dismiss: the names stay and the reason shows when the app refuses; they go only when it agrees. */
export async function dismissNote(names: string[], dismiss: () => Promise<unknown>): Promise<{ names: string[]; error: string | null }> {
  const error = await dismissFailure(dismiss);
  return { names: error ? names : [], error };
}

export function KeyLostView({ names, onOpen, onDismiss, error }: { names: string[]; onOpen: () => void; onDismiss: () => void; error?: string | null }) {
  const text = lostText(names);
  if (!text) return null;
  return (
    <div className="notice signin-notice key-lost">
      <span role="status">{text}</span>
      {error && (
        <span className="warn" role="alert">
          {error}
        </span>
      )}
      <button className="btn" onClick={onOpen}>
        Open Accounts &amp; keys
      </button>
      <button className="btn" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

export default function KeyLostNotice() {
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const read = () =>
      void invoke<string[]>("secrets_dropped")
        .then((n) => {
          setNames(n);
          setError(null);
        })
        .catch(() => {});
    read();
    // Connecting a key again clears its name; the Claude key card and settings saves say so.
    const offs = [listen("claude-key", read), listen("settings-saved", (e) => onlyWindowState(e?.payload) || read())];
    return () => offs.forEach((o) => void o.then((u) => u()).catch(() => {}));
  }, []);
  const dismiss = () => {
    void dismissNote(names, () => invoke("secrets_dropped_dismiss")).then((r) => {
      setNames((prev) => (r.error ? prev : []));
      setError(r.error);
    });
  };
  return <KeyLostView names={names} onOpen={() => openSettings("accounts")} onDismiss={dismiss} error={error} />;
}
