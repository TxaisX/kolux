// APP-037 / PROJ-089 on screen: the Send Feedback message box. It opens already holding the version
// and system under a rule, the user writes above it, ticks Submit anonymously if they like, and
// Open on GitHub hands the finished new-issue address to the browser. The app sends nothing.
// Mounted once (App.tsx); anything that wants it calls requestFeedback().
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppInfo } from "../app-info";
import type { FeedbackFacts } from "../settings/privacy";
import { copyCrashBundle, CRASH_BUNDLE_HINT } from "./crashBundle";
import { addImages, clipboardNote, MAX_IMAGES, MIME, type Shot } from "./images";
import { Close } from "../chrome/icons";
import { closed, issue, NOTE_POS, reduce, restoreFocus, tabTarget, typedText } from "./model";

const EVENT = "kolux-feedback";
const NOTE_MS = 8000;

/** Opens the message box, optionally with some text already above the block; `crash` marks a crash report. */
export function requestFeedback(text = "", crash = false) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { text, crash } }));
}

/** The version from the app, the system from the back end; what cannot be read says so. */
async function readFacts(): Promise<FeedbackFacts> {
  const info = await invoke<AppInfo>("app_info").catch(() => null);
  const sys = await invoke<{ release: string; arch: string; login: string | null }>("feedback_facts").catch(() => null);
  return { version: info?.version ?? "unknown", platform: navigator.platform || "unknown", release: sys?.release ?? "unknown", arch: sys?.arch ?? "unknown", login: sys?.login ?? null };
}

/** The first screenshot onto the clipboard as a PNG (the only image type a page may put there). */
async function copyFirst(shot: Shot): Promise<boolean> {
  try {
    let blob = new Blob([shot.bytes as BlobPart], { type: MIME[shot.kind] });
    if (shot.kind !== "png") {
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      canvas.getContext("2d")?.drawImage(bmp, 0, 0);
      blob = await new Promise<Blob>((ok, no) => canvas.toBlob((b) => (b ? ok(b) : no(new Error("no png"))), "image/png"));
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}

export default function FeedbackDialog() {
  const [s, dispatch] = useReducer(reduce, closed);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const sending = useRef(false);
  const [shots, setShots] = useState<Shot[]>([]);
  const [refused, setRefused] = useState<string[]>([]);
  const [crash, setCrash] = useState(false);
  const previews = useMemo(() => shots.map((x) => URL.createObjectURL(new Blob([x.bytes as BlobPart], { type: MIME[x.kind] }))), [shots]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  // APP-038: a box that closes unsent keeps its text, so it keeps its pictures; a send clears them
  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    const read = await Promise.all([...files].map(async (f) => ({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })));
    const r = addImages(shots, read, crash);
    setShots(r.shots);
    setRefused(r.refused);
  };

  useEffect(() => {
    const on = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string; crash?: boolean }>).detail?.text ?? "";
      setCrash((e as CustomEvent<{ crash?: boolean }>).detail?.crash === true);
      void readFacts().then((facts) => dispatch({ t: "open", facts, text }));
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  // The cursor starts above the block, where the user types.
  useEffect(() => {
    if (!s.open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = box.current;
    if (el) {
      el.focus();
      const end = typedText(el.value).length;
      el.setSelectionRange(end, end);
    }
    // Closing (or sending) hands the keyboard back to whatever opened the box.
    return () => void restoreFocus(prev);
  }, [s.open]);

  // The note after a send fades on its own.
  useEffect(() => {
    if (s.open || !s.note) return;
    const t = window.setTimeout(() => dispatch({ t: "close" }), NOTE_MS);
    return () => window.clearTimeout(t);
  }, [s.open, s.note]);

  const send = () => {
    if (!s.facts || sending.current) return; // one send at a time: a second click opens no second tab
    // FIX-1: whatever goes wrong while the address is built shows in the box; the button never does nothing
    try {
      const r = issue(s.draft, s.facts, s.anonymous);
      if (!r.ok) return dispatch({ t: "fail", error: r.error });
      sending.current = true;
      dispatch({ t: "send" });
      // the copy starts inside the click, while the page may still write to the clipboard
      const bundle = crash ? copyCrashBundle(() => invoke<string>("diag_bundle"), (t) => navigator.clipboard.writeText(t)) : null;
      const copied = !crash && shots.length ? copyFirst(shots[0]) : Promise.resolve(false);
      invoke("open_external", { url: r.url }).then(
        async () => {
          sending.current = false;
          const extra = bundle ? await bundle : clipboardNote(shots.length, await copied);
          setShots([]);
          setRefused([]);
          dispatch({ t: "sent", trimmed: r.trimmed, extra });
        },
        (e: unknown) => ((sending.current = false), dispatch({ t: "fail", error: `Could not open the browser: ${String(e)}` })),
      );
    } catch (e) {
      sending.current = false;
      dispatch({ t: "fail", error: `Could not build the report: ${String(e)}` });
    }
  };

  if (!s.open) {
    return s.note ? (
      <div role="status" className="conn-detail" style={{ position: "fixed", right: NOTE_POS.right, bottom: NOTE_POS.bottom, maxWidth: 360, padding: "10px 12px", zIndex: 50, background: "var(--pane-bg)", border: "1px solid var(--line-subtle)", borderRadius: 8, color: "var(--fg-row)" }}>
        {s.note}
      </div>
    ) : null;
  }
  return (
    <div className="scrim" onMouseDown={() => dispatch({ t: "close" })}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Send feedback"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") dispatch({ t: "close" });
          else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
          else if (e.key === "Tab") {
            // APP-037: the box is modal; Tab never leaves it.
            const items = [...e.currentTarget.querySelectorAll<HTMLElement>("textarea, input:not([hidden]), button:not([disabled])")];
            const to = tabTarget(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
            if (to >= 0) {
              e.preventDefault();
              items[to].focus();
            }
          }
        }}
        style={{ width: "min(640px, calc(100vw - 48px))", display: "flex", flexDirection: "column", gap: 10, padding: "16px 18px", background: "var(--pane-bg)", border: "1px solid var(--line-focus)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0, 0, 0, 0.5)", color: "var(--fg)" }}
      >
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Send feedback</h2>
        <p className="conn-detail" style={{ margin: 0 }}>
          Write what happened or what you would like. Paths and secrets are removed before anything is filled in. Your browser opens GitHub's new-issue page; you read it there and submit it yourself, the app sends nothing.
        </p>
        <textarea
          ref={box}
          className="field auto-prompt"
          aria-label="Your feedback"
          style={{ minHeight: 220 }}
          value={s.draft}
          onChange={(e) => dispatch({ t: "type", draft: e.target.value })}
        />
        <label className="auto-radio">
          <input type="checkbox" checked={s.anonymous} onChange={(e) => dispatch({ t: "anon", on: e.target.checked })} /> Submit anonymously (leave my GitHub name out)
        </label>
        {crash ? (
          <span className="muted">{CRASH_BUNDLE_HINT}</span>
        ) : (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
            Add screenshot
          </button>
          <input ref={fileInput} type="file" multiple accept={Object.values(MIME).join(",")} hidden aria-label="Add screenshots" onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
          {shots.map((x, i) => (
            <span key={`${x.name}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <img src={previews[i]} alt={x.name} title={x.name} style={{ height: 36, borderRadius: 4 }} />
              <button className="btn" aria-label={`Remove ${x.name}`} title={`Remove ${x.name}`} onClick={() => setShots(shots.filter((_, j) => j !== i))}>
                <Close size={11} />
              </button>
            </span>
          ))}
          <span className="muted">Up to {MAX_IMAGES} images; the first is put on the clipboard for you to paste.</span>
        </div>
        )}
        {refused.map((m) => (
          <p key={m} role="alert" className="conn-detail" style={{ margin: 0, color: "var(--danger)" }}>
            {m}
          </p>
        ))}
        {s.error && (
          <p role="alert" className="conn-detail" style={{ margin: 0, color: "var(--danger)" }}>
            {s.error}
          </p>
        )}
        <div className="auto-dialog-foot">
          <span className="muted">Everything under the line is added for you.</span>
          <button className="btn" onClick={() => dispatch({ t: "close" })}>
            Cancel
          </button>
          <button className="btn primary" disabled={s.sending} onClick={send}>
            {s.sending ? "Opening…" : "Open on GitHub"}
          </button>
        </div>
      </div>
    </div>
  );
}
