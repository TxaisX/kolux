// Settings > General: the Classic or New look and the screen that opens first (SET-037).
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { screens } from "../chrome/TopBar";
import { useSettings } from "./useSettings";
import { useDraft } from "./useDraft";
import { FIRST_FIELD, LAST_SCREEN_FIELD, LOOK_FIELD, NEEDS_STRIP_FIELD, readLook, savedFirst, stripOn, type Look } from "./general";
import { REVIEW_FIELD, reviewOn } from "../editor/notes";
import { CONFIRM_DELETE_KEY, confirmDelete } from "../automations/model";
import { askAgainPatch, skippedOf, skippedSentence } from "./confirmations";
import { OUTBOUND } from "./outbound";
import { requestFeedback } from "../feedback/FeedbackDialog";
import { DELAY, delayFromText, prefPatch, readEditorPrefs, type DiffView } from "./editorPrefs";
import { addApp, addCustom, draftReady, moveApp, OPEN_IN_FIELD, presetsLeft, readOpenIn, removeApp, type OpenInApp } from "./openIn";
import { alreadyListed, editApp } from "../editor/openInEdit";
import { applyDraft, PROXY_FIELD, readProxyRest, type ProxyDraft } from "./proxy";
import { ResetButton } from "./SafetyRules";
import CliCard from "./CliCard";
import { LINKS_IN_KOLUX_FIELD, linksOpenInKolux } from "../chat/chatLinks";

/** A row of buttons that behaves as one radio group. */
export function Segmented<T extends string>({ label, options, value, onPick, off = [] }: { label: string; options: Array<{ id: T; label: string }>; value: T; onPick: (v: T) => void; off?: T[] }) {
  return (
    <div className="seg-row" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id} disabled={off.includes(o.id)} onClick={() => onPick(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function GeneralView({ settings, onSave }: { settings: Record<string, unknown>; onSave: (patch: Record<string, unknown>) => void }) {
  const look = readLook(settings);
  const classic = look === "classic";
  return (
    <section className="conn-card" data-section="views">
      <h2 className="conn-name">Look and first screen</h2>
      <div className="look-select">
        <span>Look</span>
        <Segmented<Look> label="Look" options={[{ id: "classic", label: "Classic" }, { id: "new", label: "New" }]} value={look} onPick={(v) => onSave({ [LOOK_FIELD]: v })} />
      </div>
      <p className="conn-detail">New shows the redesigned screens with Agents, Board and Terminals in the top bar; Classic keeps the earlier layout.</p>
      <div className="look-select">
        <span>Opens first</span>
        <Segmented label="Opens first" options={screens} value={classic ? "terminals" : savedFirst(settings)} off={classic ? ["agents", "board"] : []} onPick={(v) => onSave({ [FIRST_FIELD]: v, [LAST_SCREEN_FIELD]: v })} />
      </div>
      {classic && <p className="conn-detail">Switch the look to New to open on Agents or Board.</p>}
      <label className="conn-switch">
        <input type="checkbox" aria-label="Review notes" checked={reviewOn(settings)} onChange={(e) => onSave({ [REVIEW_FIELD]: e.target.checked })} />
        <span>Review notes: select text in a file and press Ctrl+Shift+A to add a note for an agent.</span>
      </label>
      <label className="conn-switch">
        <input type="checkbox" aria-label="Needs you strip" checked={stripOn(settings)} onChange={(e) => onSave({ [NEEDS_STRIP_FIELD]: e.target.checked })} />
        <span>Needs you strip: a row above the grid lists the sessions waiting on a permission or a question.</span>
      </label>
    </section>
  );
}

/** APP-041: the app's own log, copied or reviewed by the user; nothing leaves the computer by itself. */
export function DiagnosticsCard() {
  const [note, setNote] = useState("");
  const run = (label: string, job: () => Promise<string>) => void job().then(setNote).catch((e: unknown) => setNote(`${label} failed: ${String(e)}`));
  const copy = async () => {
    const text = await invoke<string>("diag_bundle");
    await invoke("clip_copy_text", { text }).catch(() => navigator.clipboard.writeText(text));
    return "Copied to the clipboard with keys, passwords and tokens masked.";
  };
  return (
    <section className="conn-card" data-section="diagnostics">
      <h2 className="conn-name">Diagnostics</h2>
      <p className="conn-detail">
        Kolux keeps a short log of its own starts, exits and terminal sessions in your profile folder, readable only by you. Nothing is sent anywhere: copy it yourself when you report a problem. Keys, passwords and tokens are masked before the text leaves the folder.
      </p>
      <div className="btn-row">
        <button className="btn" onClick={() => run("Copy", copy)}>
          Copy diagnostics
        </button>
        <button className="btn" onClick={() => run("Review copy", async () => `Review copy opened: ${await invoke<string>("diag_review")}`)}>
          Write a review copy and open it
        </button>
        <button className="btn" onClick={() => run("Throw away", async () => invoke("diag_review_discard").then(() => "Review copy thrown away."))}>
          Throw the review copy away
        </button>
      </div>
      {note && <p className="conn-detail">{note}</p>}
    </section>
  );
}

/** APP-070: what leaves this computer (the whole list), and the feedback link that opens in the browser instead. */
export function PrivacyCard() {
  const send = () => requestFeedback(); // APP-037: the message box opens; its own note says what happened
  return (
    <section className="conn-card" data-section="privacy">
      <h2 className="conn-name">Privacy</h2>
      <p className="conn-detail">
        Your work stays on this computer. What you type, the files you open, terminal output, projects, settings and saved keys live only in your profile folder. The app sends no usage data and has no server to send it to. The app itself connects only to:
      </p>
      <ul className="conn-detail conn-list">
        {OUTBOUND.map((o) => (
          <li key={o.to}>
            <b>{o.to}</b>: {o.when}.
          </li>
        ))}
      </ul>
      <div className="btn-row">
        <button className="btn" onClick={send}>
          Send feedback
        </button>
      </div>
    </section>
  );
}

function Confirmations({ settings, onSave }: { settings: Record<string, unknown>; onSave: (patch: Record<string, unknown>) => void }) {
  const skipped = skippedOf(settings);
  return (
    <section className="conn-card" data-section="confirmations">
      <h2 className="conn-name">Confirmations</h2>
      <label className="conn-switch">
        <input type="checkbox" role="switch" checked={confirmDelete(settings)} onChange={(e) => onSave({ [CONFIRM_DELETE_KEY]: e.target.checked })} />
        Ask before deleting an automation
      </label>
      <p className="conn-detail">{skippedSentence(settings)}</p>
      <button type="button" className="btn" disabled={skipped.length === 0} onClick={() => onSave(askAgainPatch(settings))}>
        Ask again for all
      </button>
    </section>
  );
}

/** SET-038: editor and diff preferences; the built-in editor and the diff views follow them. */
function EditorCard({ settings, onSave }: { settings: Record<string, unknown>; onSave: (patch: Record<string, unknown>) => Promise<boolean> }) {
  const p = readEditorPrefs(settings);
  const box = (key: "autoSave" | "minimap" | "wordWrap" | "spellcheck" | "diffWordWrap" | "diffWhitespace" | "diffTree", label: string) => (
    <label className="conn-switch">
      <input type="checkbox" role="switch" aria-label={label} checked={p[key]} onChange={(e) => onSave(prefPatch(key, e.target.checked))} />
      <span>{label}</span>
    </label>
  );
  return (
    <section className="conn-card" data-section="editor">
      <h2 className="conn-name">Editor and diffs</h2>
      {box("autoSave", "Save files by themselves after typing stops")}
      {p.autoSave && (
        <label className="look-select">
          <span>Wait before saving (ms)</span>
          <DelayField value={p.autoSaveDelay} onSave={(v) => onSave(prefPatch("autoSaveDelay", v))} />
        </label>
      )}
      {box("minimap", "Minimap beside the editor")}
      {box("wordWrap", "Word wrap in the editor")}
      {box("spellcheck", "Spellcheck in rich markdown")}
      <div className="look-select">
        <span>Diffs open</span>
        <Segmented<DiffView> label="Diffs open" options={[{ id: "inline", label: "Inline" }, { id: "split", label: "Side by side" }]} value={p.diffView} onPick={(v) => onSave(prefPatch("diffView", v))} />
      </div>
      {box("diffWordWrap", "Word wrap in diffs")}
      {box("diffWhitespace", "Show changes made only of whitespace")}
      {box("diffTree", "File tree beside the combined diff")}
    </section>
  );
}

/** The auto-save delay box: the typed text stays as typed (so 3000 can be entered digit by digit). A pause saves only a finished delay in range; leaving the box clamps and saves what is there (SET-036). */
function DelayField({ value, onSave }: { value: number; onSave: (v: number) => Promise<boolean> }) {
  // Resolves to the stored text, so on leaving a clamped value shows as stored (typed "5", box shows "200").
  const { props, draft } = useDraft(
    String(value),
    async (text) => {
      const v = delayFromText(text);
      if (v === null) return false;
      return v === value || (await onSave(v)) !== false ? String(v) : false;
    },
    (text) => String(delayFromText(text)) === text, // in range and in normal form: nothing for the box to rewrite
  );
  // An empty or unreadable box goes back to the saved delay when the user leaves it.
  const onBlur = async () => {
    await draft.leave();
    if (delayFromText(draft.state().text) === null) draft.discard();
  };
  return <input className="field" type="number" aria-label="Auto-save delay" min={DELAY.min} max={DELAY.max} step={100} {...props} onBlur={onBlur} />;
}

/** SET-039: the apps every Open in menu lists, from presets or by name and command. */
export function OpenInCard({ settings, onSave }: { settings: Record<string, unknown>; onSave: (patch: Record<string, unknown>) => void }) {
  const list = readOpenIn(settings);
  const [draft, setDraft] = useState({ name: "", command: "" });
  const [editing, setEditing] = useState<string | null>(null); // the row being edited in the fields below
  const put = (next: OpenInApp[]) => onSave({ [OPEN_IN_FIELD]: next });
  const left = presetsLeft(list);
  const dup = alreadyListed(list, draft, editing); // T-753: Add would drop it and clear the fields
  return (
    <section className="conn-card" data-section="open-in">
      <h2 className="conn-name">Open in</h2>
      <p className="conn-detail">These apps appear, in this order, in every Open in menu: worktrees, files and the keybindings file.</p>
      <ul className="conn-list open-in-list" aria-label="Open in apps">
        {list.map((a, i) => (
          <li key={a.id}>
            <span className="name">{a.name}</span> <code>{a.command}</code>
            <button type="button" className="btn" aria-label={`Move ${a.name} up`} disabled={i === 0} onClick={() => put(moveApp(list, a.id, -1))}>
              Up
            </button>
            <button type="button" className="btn" aria-label={`Move ${a.name} down`} disabled={i === list.length - 1} onClick={() => put(moveApp(list, a.id, 1))}>
              Down
            </button>
            <button type="button" className="btn" aria-label={`Edit ${a.name}`} onClick={() => (setEditing(a.id), setDraft({ name: a.name, command: a.command }))}>
              Edit
            </button>
            <ResetButton label="Remove" ariaLabel={`Remove ${a.name}`} yes="Yes, remove" onReset={() => put(removeApp(list, a.id))} />
          </li>
        ))}
      </ul>
      {left.length > 0 && (
        <label className="look-select">
          <span>Add an app</span>
          <select className="field" aria-label="Add an Open in app" value="" onChange={(e) => put(addApp(list, left.find((p) => p.id === e.target.value)!))}>
            <option value="">Choose an app</option>
            {left.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="btn-row">
        <input className="field" aria-label="App name" placeholder="Name" maxLength={60} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input className="field" aria-label="App command" aria-describedby={dup ? "open-in-dup" : undefined} placeholder="Command, e.g. gvim --remote" maxLength={300} value={draft.command} onChange={(e) => setDraft({ ...draft, command: e.target.value })} />
        <button
          type="button"
          className="btn"
          disabled={!draftReady(draft) || !!dup}
          onClick={() => {
            put(editing ? editApp(list, editing, draft) : addCustom(list, draft));
            setEditing(null);
            setDraft({ name: "", command: "" });
          }}
        >
          {editing ? "Save changes" : "Add custom app"}
        </button>
        {editing && (
          <button type="button" className="btn" onClick={() => (setEditing(null), setDraft({ name: "", command: "" }))}>
            Cancel
          </button>
        )}
      </div>
      {/* Always drawn so the live region announces; while empty it is out of the flow, so the card gap stays. */}
      <p className={dup ? "conn-detail warn" : "conn-detail"} role="status" id="open-in-dup" style={dup ? undefined : { position: "absolute" }}>
        {dup && `That command is already listed as ${dup.name}.`}
      </p>
    </section>
  );
}

/** SET-040: the proxy for Kolux's own traffic. The address is sealed (SAFE-026) and never shown back. */
function ProxyCard({ settings, onSave }: { settings: Record<string, unknown>; onSave: (patch: Record<string, unknown>) => void }) {
  const rest = readProxyRest(settings);
  const [set, setSet] = useState<boolean | null>(null);
  const [draft, setDraft] = useState<ProxyDraft>({ address: "", bypass: rest.bypass.join(", ") });
  const [http1, setHttp1] = useState(rest.http1);
  const [errors, setErrors] = useState<string[]>([]);
  const [note, setNote] = useState("");
  useEffect(() => {
    invoke<boolean>("secret_status", { key: PROXY_FIELD }).then(setSet, () => setSet(false));
  }, []);
  const apply = async (clear = false) => {
    setErrors([]);
    setNote("");
    const r = applyDraft(clear ? { address: "", bypass: draft.bypass } : draft, http1);
    if ("errors" in r) return setErrors(r.errors);
    // An empty address field keeps a sealed proxy unless Clear was pressed.
    const keep = !clear && !r.address && !!set;
    try {
      if (r.address) await invoke("secret_set", { key: PROXY_FIELD, value: r.address });
      else if (clear) await invoke("secret_clear", { key: PROXY_FIELD });
      onSave(r.patch);
      setSet(Boolean(r.address) || keep);
      setDraft({ ...draft, address: "" });
      setNote(r.address || keep ? "Proxy saved. Kolux's own traffic goes through it." : "No proxy: traffic goes direct.");
    } catch (e) {
      setErrors([String(e)]);
    }
  };
  if (set === null) return null;
  return (
    <section className="conn-card" data-section="proxy">
      <details open={set}>
        <summary className="conn-name">Network proxy</summary>
        <p className="conn-detail">{set ? "A proxy is set; its address is kept sealed and not shown. Type a new one to replace it, or clear it." : "Kolux's own traffic (update checks and downloads) goes direct."}</p>
        <label className="look-select">
          <span>Proxy address</span>
          <input className="field" aria-label="Proxy address" autoComplete="off" spellCheck={false} placeholder="host:port or http://host:port" maxLength={300} value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
        </label>
        <label className="look-select">
          <span>Do not use the proxy for</span>
          <textarea className="field" aria-label="Proxy bypass list" rows={2} placeholder="localhost, *.corp.example, 10.0.0.0/8" value={draft.bypass} onChange={(e) => setDraft({ ...draft, bypass: e.target.value })} />
        </label>
        <label className="conn-switch">
          <input type="checkbox" role="switch" aria-label="HTTP/1 only" checked={http1} onChange={(e) => setHttp1(e.target.checked)} />
          <span>
            HTTP/1 only
            <small>Helps on networks that break newer protocols. Off by default.</small>
          </span>
        </label>
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => void apply()}>
            Apply
          </button>
          <button type="button" className="btn" disabled={!set} onClick={() => void apply(true)}>
            Clear proxy
          </button>
        </div>
        {errors.map((e) => (
          <p key={e} className="conn-detail warn">
            {e}
          </p>
        ))}
        {note && <p className="conn-detail">{note}</p>}
      </details>
    </section>
  );
}

/** T-329-b (TERM-092, CHAT-025): links in terminals, chat replies and pull-request checks open in Kolux's own viewer when this is on. */
function LinksCard({ settings, onSave }: { settings: Record<string, unknown>; onSave: (patch: Record<string, unknown>) => void }) {
  return (
    <section className="conn-card" data-section="links">
      <h2 className="conn-name">Links</h2>
      <label className="conn-switch">
        <input type="checkbox" role="switch" checked={linksOpenInKolux(settings)} onChange={(e) => onSave({ [LINKS_IN_KOLUX_FIELD]: e.target.checked })} /> Open links in Kolux
      </label>
      <p className="conn-detail">Off: a link goes to your system browser. On: it opens in Kolux's own browser pane, and the system browser stays one Shift-click away.</p>
    </section>
  );
}

export default function GeneralPage() {
  const { settings, error, save } = useSettings();
  return (
    <>
      {error && <p className="conn-detail warn">{error}</p>}
      {settings && <GeneralView settings={settings} onSave={save} />}
      {settings && <Confirmations settings={settings} onSave={save} />}
      {settings && <EditorCard settings={settings} onSave={save} />}
      {settings && <LinksCard settings={settings} onSave={save} />}
      {settings && <OpenInCard settings={settings} onSave={save} />}
      {settings && <ProxyCard settings={settings} onSave={save} />}
      <CliCard />
      <DiagnosticsCard />
      <PrivacyCard />
    </>
  );
}
