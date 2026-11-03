// Native chat, the message box at the foot of the chat (CHAT-017; T-327): grows to about eight
// lines, Enter sends and Shift+Enter starts a new line, the arrows step through earlier messages,
// and the unsent draft is kept per pane. The rules live in composer.ts. T-334 adds the autocomplete
// menu (CHAT-019, complete.ts), the model and effort controls (CHAT-024, controls.ts) and the
// attachment chips (CHAT-021, attach.ts).
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { Scan } from "../skills/skills";
import { decide } from "../terminal/screenshotPaste";
import { addHistory, draftOf, historyOf, keepDraft, keyAction, linesFor, stepHistory } from "./composer";
import { applyPick, isDismissed, menuFor, needs, pathsOf, runsOnEnter, stepIndex, triggerAt, wordOf, type Dismissed, type Entry, type Load } from "./complete";
import { MAX_ATTACHMENTS, dropHere, isImageName, nameOf, pastedName, refusal, sendable, update, withPaths, without, type Attachment } from "./attach";
import { TERMINAL_NOTE, confirmModel, controlsOff, hasControls, loadSaved, modelCommand, opensPicker, routeOf, saveChoice, sentChange, type Change, type Choice } from "./controls";
import { ModelControls } from "./ModelControls";
import { buttonMode, stopArmed } from "./stop";
import { useDismiss } from "./ux";

export type ComposerHandle = { focus: () => void };

type Props = {
  paneKey: number;
  /** The session has a live terminal to type into. */
  live: boolean;
  /** CHAT-022: why sending is held back for now (the agent is asking in its terminal); the draft can still be written. */
  blocked?: string;
  /** A note that does not hold the box (the last message was too long). */
  note?: string;
  /** False when nothing was sent: the box keeps the text. */
  onSend: (text: string) => boolean;
  /** CHAT-018: a turn is under way, so the button beside the box reads Stop and `onStop` interrupts the agent. */
  working?: boolean;
  onStop?: () => void;
  /** CHAT-019, CHAT-021, CHAT-024: the agent in the pane, its folder, the model it shows, and the switch to its terminal (for Codex's own picker). */
  agent?: string;
  cwd?: string | null;
  shownModel?: string | null;
  onTerminal?: () => void;
  /** CHAT-019: the session's own command list, when it reports one; it replaces the built-in list. */
  commands?: readonly string[] | null;
};

let attachCounter = 0;

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ paneKey, live, blocked, note, onSend, working = false, onStop, agent, cwd = null, shownModel = null, onTerminal, commands = null }, ref) {
  const [text, setText] = useState(() => draftOf(paneKey));
  // The history index shown; history.length means the draft itself.
  const [at, setAt] = useState(() => historyOf(paneKey).length);
  const draft = useRef(text);
  const box = useRef<HTMLTextAreaElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  // CHAT-018: when this box last sent, so a quick second click on Send is never taken as Stop.
  const sentAt = useRef<number | null>(null);
  useImperativeHandle(ref, () => ({ focus: () => box.current?.focus() }), []);

  // --- CHAT-019: the autocomplete menu ---
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState<Dismissed>(null);
  const [active, setActive] = useState(0);
  const [skills, setSkills] = useState<Load<Scan>>({ state: "idle" });
  const [files, setFiles] = useState<Load<string[]>>({ state: "idle" });
  const filesAt = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  const trigger = triggerAt(text, caret, agent);
  const menu = trigger && !isDismissed(dismissed, text, trigger) ? menuFor(trigger, { agent, reported: commands, skills, files }) : null;
  const menuOpen = menu !== null && (menu.entries.length > 0 || menu.notes.length > 0);
  const loadSkills = useCallback(
    (refresh: boolean) => {
      setSkills({ state: "loading" });
      invoke<Scan>("skills_scan", { workspace: cwd, refresh }).then(
        (value) => alive.current && setSkills({ state: "ready", value }),
        (e) => alive.current && setSkills({ state: "error", error: String(e) }),
      );
    },
    [cwd],
  );
  const loadFiles = useCallback(() => {
    if (!cwd) return setFiles({ state: "error", error: "this session has no folder" });
    filesAt.current = Date.now();
    setFiles((f) => (f.state === "ready" ? f : { state: "loading" }));
    invoke<{ files: string[] }>("file_list", { root: cwd }).then(
      (l) => alive.current && setFiles({ state: "ready", value: pathsOf(l) }),
      (e) => alive.current && setFiles({ state: "error", error: String(e) }),
    );
  }, [cwd]);
  const sign = trigger?.sign;
  useEffect(() => {
    if (!sign) return;
    const want = needs({ sign, start: 0, end: 0, query: "" }, agent);
    if (want.skills && skills.state === "idle") loadSkills(false);
    // Files are listed again when the menu opens and the list is older than 15 seconds.
    if (want.files && (files.state === "idle" || files.state === "error" || Date.now() - filesAt.current > 15000)) loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sign, agent, cwd]);
  useEffect(() => {
    setSkills({ state: "idle" });
    setFiles({ state: "idle" });
  }, [cwd, agent]);
  const entries = menu?.entries ?? [];
  const cur = Math.min(active, Math.max(0, entries.length - 1));
  const word = trigger ? wordOf(text, trigger) : "";
  useEffect(() => setActive(0), [trigger?.start, trigger?.sign, word]);
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingCaret.current === null || !box.current) return;
    box.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
    setCaret(pendingCaret.current);
    pendingCaret.current = null;
  });

  // --- CHAT-021: attachments ---
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [preview, setPreview] = useState<Attachment | null>(null);
  useDismiss(!!preview?.thumb, () => setPreview(null));
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const [local, setLocal] = useState<string | null>(null);
  const thumbs = useRef<Set<string>>(new Set());
  const pasted = useRef(0);
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const listRef = useRef(attachments);
  listRef.current = attachments;
  const forget = (a: Attachment | undefined) => {
    if (a?.thumb && thumbs.current.delete(a.thumb)) URL.revokeObjectURL(a.thumb);
  };
  useEffect(() => {
    const set = thumbs.current;
    return () => set.forEach((u) => URL.revokeObjectURL(u));
  }, []);
  // The attachments belong to the pane they were made in.
  useEffect(() => {
    listRef.current.forEach(forget);
    setAttachments([]);
    setPreview(null);
    setLocal(null);
    pasted.current = 0;
  }, [paneKey]);
  const addImage = (file: File) => {
    const why = refusal(listRef.current, agentRef.current, true);
    if (why) return setLocal(why);
    setLocal(null);
    const id = `att-${++attachCounter}`;
    const thumb = URL.createObjectURL(file);
    thumbs.current.add(thumb);
    pasted.current += 1;
    const att: Attachment = { id, name: pastedName(file.type, pasted.current), image: true, state: "saving", thumb };
    listRef.current = [...listRef.current, att];
    setAttachments(listRef.current);
    file
      .arrayBuffer()
      .then((buf) => invoke<string>("paste_image_save", new Uint8Array(buf), { headers: { "x-image-kind": file.type } }))
      .then(
        (path) => setAttachments((l) => update(l, id, { state: "ready", path })),
        (e) => setAttachments((l) => update(l, id, { state: "failed", error: typeof e === "string" ? e : "The image could not be saved." })),
      );
  };
  const addPaths = (paths: string[]) => {
    for (const path of paths) {
      const why = refusal(listRef.current, agentRef.current, false);
      if (why) return setLocal(why);
      const name = nameOf(path);
      const att: Attachment = { id: `att-${++attachCounter}`, name, path, image: isImageName(name), state: "ready" };
      listRef.current = [...listRef.current, att];
      setAttachments(listRef.current);
    }
    setLocal(null);
  };
  const attachFile = () => {
    invoke<string | null>("file_pick", { defaultPath: cwd }).then(
      (p) => typeof p === "string" && addPaths([p]),
      (e) => setLocal(String(e)),
    );
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pick = decide(e.clipboardData);
    if (pick.take !== "image") return;
    e.preventDefault();
    addImage(pick.file);
  };
  // A file dropped on this chat is attached; a drop on another pane or anywhere else is not.
  useEffect(() => {
    let open = true;
    let stop: (() => void) | undefined;
    try {
      getCurrentWebview()
        .onDragDropEvent(({ payload: p }) => {
          const root = wrap.current?.closest(".chat");
          if (!root || p.type !== "drop") return;
          const scale = window.devicePixelRatio || 1;
          const x = p.position.x / scale;
          const y = p.position.y / scale;
          const under = document.elementFromPoint(x, y);
          if (dropHere({ x, y }, root.getBoundingClientRect(), under !== null && root.contains(under))) addPaths(p.paths);
        })
        .then(
          (un) => (open ? (stop = un) : un()),
          () => {},
        );
    } catch {
      // outside the app window there is no drop to hear
    }
    return () => {
      open = false;
      stop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- CHAT-024: model and effort ---
  const [changes, setChanges] = useState<Change[]>([]);
  const [saved, setSaved] = useState<Record<string, Choice>>(() => loadSaved());
  const [pickerAsk, setPickerAsk] = useState(0);
  useEffect(() => setChanges((c) => confirmModel(c, shownModel)), [shownModel]);
  useEffect(() => setChanges([]), [paneKey]);
  const controls = hasControls(agent) ? (agent as string) : null;
  const pickModel = (id: string) => {
    if (!controls) return;
    setSaved(saveChoice(controls, { model: id }));
    if (routeOf(controls, "model") === "terminal") {
      setLocal(TERMINAL_NOTE);
      onTerminal?.();
      return;
    }
    if (id === "default") return setChanges((c) => c.filter((x) => x.what !== "model"));
    if (onSend(modelCommand(id))) {
      setLocal(null);
      setChanges((c) => sentChange(c, "model", id));
    } else setLocal("The model change was not sent.");
  };
  const pickEffort = (level: string) => {
    if (!controls) return;
    setSaved(saveChoice(controls, { effort: level }));
    if (routeOf(controls, "effort") === "terminal") {
      setLocal(TERMINAL_NOTE);
      onTerminal?.();
    }
  };
  const pickFast = (on: boolean) => {
    if (controls) setSaved(saveChoice(controls, { fast: on }));
  };

  useEffect(() => {
    const t = draftOf(paneKey);
    setText(t);
    draft.current = t;
    setAt(historyOf(paneKey).length);
  }, [paneKey]);

  const change = (t: string, c: number) => {
    setText(t);
    setCaret(c);
    draft.current = t;
    keepDraft(paneKey, t);
    setAt(historyOf(paneKey).length);
  };

  const submit = (override?: string) => {
    const typed = override ?? text;
    if (!live || blocked || !sendable(typed, attachments)) return;
    // CHAT-024: a bare /model opens the model list instead of going to the agent as text.
    if (attachments.length === 0 && opensPicker(agent, typed)) {
      setPickerAsk((n) => n + 1);
      change("", 0);
      return;
    }
    sentAt.current = Date.now();
    if (!onSend(withPaths(typed, attachments))) return;
    addHistory(paneKey, typed);
    attachments.forEach(forget);
    listRef.current = [];
    setAttachments([]);
    pasted.current = 0;
    setLocal(null);
    setText("");
    setCaret(0);
    draft.current = "";
    keepDraft(paneKey, "");
    setAt(historyOf(paneKey).length);
    box.current?.focus();
  };
  const mode = buttonMode(working, !!blocked);
  const click = () => {
    if (mode === "send") return submit();
    if (stopArmed(sentAt.current, Date.now())) onStop?.();
  };

  /** CHAT-019: picks a menu line. `run`: a command or skill is sent now (Enter); otherwise it only goes into the text (Tab, a click). */
  const pick = (entry: Entry, run: boolean) => {
    if (!trigger) return;
    const r = applyPick(text, trigger, entry);
    if (run && runsOnEnter(entry)) return submit(r.text.trimEnd());
    pendingCaret.current = r.caret;
    change(r.text, r.caret);
    box.current?.focus();
  };

  const plain = (e: KeyboardEvent) => !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey;
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (menuOpen && trigger && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      if (entries.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp") && plain(e)) {
        e.preventDefault();
        return setActive(stepIndex(cur, entries.length, e.key === "ArrowDown" ? 1 : -1));
      }
      if (entries.length > 0 && e.key === "Tab" && plain(e)) {
        e.preventDefault();
        return pick(entries[cur], false);
      }
      if (entries.length > 0 && e.key === "Enter" && plain(e)) {
        e.preventDefault();
        return pick(entries[cur], true);
      }
      if (e.key === "Escape") {
        // Closed for this word until the word changes; Escape never reaches the agent from the box.
        e.preventDefault();
        e.stopPropagation();
        return setDismissed({ start: trigger.start, word });
      }
    }
    const before = el.value.slice(0, el.selectionStart);
    const after = el.value.slice(el.selectionEnd);
    const act = keyAction({ key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode }, !before.includes("\n"), !after.includes("\n"));
    if (act === "send") {
      e.preventDefault();
      submit();
    } else if (act === "older" || act === "newer") {
      const history = historyOf(paneKey);
      if (history.length === 0) return;
      e.preventDefault();
      const next = stepHistory(history, at, act);
      setAt(next);
      setText(next === history.length ? draft.current : history[next]);
    } else if (act === "escape") {
      // CHAT-017: Escape never reaches the agent from the box (it would interrupt it).
      e.stopPropagation();
    }
  };

  const shown = blocked ?? note ?? local ?? undefined;
  const listId = `chat-complete-${paneKey}`;
  return (
    <div className="chat-composer" ref={wrap}>
      {shown && (
        <div className="chat-asking" role="status">
          {shown}
        </div>
      )}
      {menuOpen && menu && (
        <div className="chat-complete">
          <ul id={listId} role="listbox" aria-label="Suggestions">
            {entries.map((en, i) => (
              <li key={`${en.kind}-${en.name}`} role="presentation">
                {en.group && en.group !== entries[i - 1]?.group && <div className="chat-complete-group">{en.group}</div>}
                <div id={`${listId}-${i}`} role="option" aria-selected={i === cur} className={`chat-complete-item${i === cur ? " on" : ""}`} onMouseDown={(e) => (e.preventDefault(), pick(en, false))} onMouseMove={() => i !== cur && setActive(i)}>
                  <span className="chat-complete-name">{en.kind === "file" ? en.name : en.insert}</span>
                  {en.both && <span className="chat-complete-tag">agent decides</span>}
                  {en.description && <span className="chat-complete-desc">{en.description}</span>}
                </div>
              </li>
            ))}
          </ul>
          {menu.notes.map((n) => (
            <div key={n.text} className="chat-complete-note" role="status">
              {n.text}
              {n.retry && (
                <button type="button" className="chat-complete-retry" onMouseDown={(e) => (e.preventDefault(), n.retry === "skills" ? loadSkills(true) : loadFiles())}>
                  Retry
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {attachments.length > 0 && (
        <ul className="chat-chips" aria-label="Attachments">
          {attachments.map((a) => (
            <li key={a.id} className={`chat-chip ${a.state}`}>
              {a.thumb && !broken.has(a.id) ? (
                <button type="button" className="chat-chip-thumb" aria-label={`Preview ${a.name}`} onClick={() => setPreview(a)}>
                  <img src={a.thumb} alt="" onError={() => setBroken((s) => new Set(s).add(a.id))} />
                </button>
              ) : a.thumb ? (
                <span className="chat-chip-broken">Preview unavailable</span>
              ) : null}
              <span className="chat-chip-name" title={a.path ?? a.name}>
                {a.name}
              </span>
              {a.state === "saving" && (
                <span className="chat-chip-state" role="status">
                  Saving…
                </span>
              )}
              {a.state === "failed" && (
                <span className="chat-chip-state error" role="alert">
                  {a.error ?? "Not saved"}
                </span>
              )}
              <button
                type="button"
                className="chat-chip-x"
                aria-label={`Remove ${a.name}`}
                onClick={() => {
                  forget(a);
                  listRef.current = without(listRef.current, a.id);
                  setAttachments(listRef.current);
                  if (preview?.id === a.id) setPreview(null);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={box}
        className="chat-box"
        aria-label="Message"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? listId : undefined}
        aria-activedescendant={menuOpen && entries.length > 0 ? `${listId}-${cur}` : undefined}
        rows={linesFor(text)}
        value={text}
        placeholder={live ? "Message the agent. Enter sends, Shift+Enter starts a new line." : "This session has no live terminal. Switch back to the terminal to reconnect."}
        onChange={(e) => change(e.target.value, e.target.selectionStart)}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
      />
      <button type="button" className="chat-attach" aria-label="Attach file" title={attachments.length >= MAX_ATTACHMENTS ? "Too many attachments" : "Attach a file"} disabled={!live} onClick={attachFile}>
        +
      </button>
      {controls && <ModelControls agent={controls} shown={shownModel} saved={saved[controls] ?? {}} changes={changes} disabled={controlsOff(working, live)} openPicker={pickerAsk} onModel={pickModel} onEffort={pickEffort} onFast={pickFast} />}
      <button type="button" className={`chat-send${mode === "stop" ? " stop" : ""}`} aria-label={mode === "stop" ? "Stop" : "Send"} disabled={mode === "send" ? !live || !!blocked || !sendable(text, attachments) : !onStop} onClick={click}>
        {mode === "stop" ? "Stop" : "Send"}
      </button>
      {preview?.thumb && (
        <button type="button" className="chat-full" aria-label="Close preview" autoFocus onClick={() => setPreview(null)}>
          <img src={preview.thumb} alt={preview.name} />
        </button>
      )}
    </div>
  );
});
