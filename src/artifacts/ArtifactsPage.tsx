// The Artifacts library (SKILL-036, VIEW-012): the pages Claude publishes and the files an agent
// creates, kept newest first and cut into one section per project, with a viewer beside the list.
// A page is served by the app's kolux-artifact scheme, which hands out only the selected entry's
// stored files; the viewer frame is sandboxed, and a clicked link that leaves the entry comes back
// here as a message and opens in the system browser. An image or a text file is shown straight from
// the same scheme; a PDF or a document the viewer cannot render is handed to its own app.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { locale } from "../language";

export type Artifact = {
  id: string;
  title: string;
  source: string;
  origin: string;
  kind: string;
  project: string | null;
  session: string | null;
  added: number;
  size: number;
  page: string;
  state: "ok" | "unavailable" | "remote";
  stored: boolean;
};

/** Titles only, ignoring case; every typed word has to appear. */
export function matches(title: string, query: string): boolean {
  const t = title.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => t.includes(w));
}

/** What a section is called: the project it came from, or how it got here. */
export function section(a: Pick<Artifact, "project" | "source">): string {
  return a.project ?? (a.source === "hand" ? "Added by hand" : "Other");
}

/** The list cut into one section per project, the section holding the newest artifact first. */
export function group(list: Artifact[]): { project: string; items: Artifact[] }[] {
  const by = new Map<string, Artifact[]>();
  for (const a of list) {
    const k = section(a);
    const items = by.get(k);
    if (items) items.push(a);
    else by.set(k, [a]);
  }
  return [...by].map(([project, items]) => ({ project, items })).sort((x, y) => y.items[0].added - x.items[0].added);
}

/** How the viewer shows an entry: in the frame, as a picture or media, or not at all. A PDF is
 * not framed: a sandboxed frame cannot run the PDF viewer, and an unsandboxed one would follow a
 * link inside the PDF in-app, so it opens in its own app like a document. */
export function view(kind: string | undefined): "frame" | "image" | "video" | "audio" | "app" {
  if (kind === "image") return "image";
  if (kind === "video") return "video";
  if (kind === "audio") return "audio";
  if (kind === undefined || kind === "page" || kind === "text") return "frame";
  return "app";
}

/** What one workspace scan did, as the Rust command reports it. */
export type Scanned = { changed: number; skipped: string[] };

/** One run at a time: a tick that finds the last run still going does nothing, so a slow import
 * never piles up calls behind it. */
export function ticker(run: () => Promise<unknown>): () => void {
  let busy = false;
  return () => {
    if (busy) return;
    busy = true;
    void run().finally(() => {
      busy = false;
    });
  };
}

/** The skipped reasons not told yet; `told` remembers them so a file over the cap is mentioned once. */
export function newlySkipped(skipped: string[], told: Set<string>): string[] {
  const fresh = skipped.filter((s) => !told.has(s));
  for (const s of fresh) told.add(s);
  return fresh;
}

/** The file's own type, for the small tag beside its title. */
export function extText(page: string): string {
  const dot = page.lastIndexOf(".");
  return dot > 0 ? page.slice(dot + 1).toUpperCase().slice(0, 5) : "";
}

/** B, KB or MB with one decimal. */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The scheme's address on this platform: Windows web views reach custom schemes over http. */
export function viewerUrl(a: Pick<Artifact, "id" | "page">, windows = navigator.userAgent.includes("Windows")): string {
  const base = windows ? "http://kolux-artifact.localhost" : "kolux-artifact://localhost";
  return `${base}/${a.id}/${a.page.split("/").map(encodeURIComponent).join("/")}`;
}

/** A link a viewer page asked for: the address and the host the user is shown. */
export type LinkAsk = { url: string; host: string };

/** Control, zero-width and bidirectional-override characters: they can reorder or hide what a person
 * reads (U+202E turns "gpj.exe" around), so none is ever shown in the question. */
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** What is shown of a page-supplied string: no control or bidi characters, at most `max` long. */
export function displayText(text: string, max = 80): string {
  const t = text.replace(INVISIBLE, "").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** The link a message from the viewer asks for, or null. Only our own frame may ask, and only for a
 * web or mail address. The page's script posts the message, so it says nothing about the user
 * (DT-C77): it is never a reason to open anything, only to ask. */
export function linkAsk(e: Pick<MessageEvent, "data" | "source">, frameWindow: Window | null | undefined): LinkAsk | null {
  if (!frameWindow || e.source !== frameWindow) return null;
  const data = e.data as { koluxOpen?: unknown } | null | undefined;
  if (typeof data?.koluxOpen !== "string") return null;
  let u: URL;
  try {
    u = new URL(data.koluxOpen);
  } catch {
    return null;
  }
  if (u.protocol === "http:" || u.protocol === "https:") return u.host ? { url: data.koluxOpen, host: u.host } : null;
  if (u.protocol === "mailto:") {
    try {
      // The whole address list is shown; the query (?body=, ?attach=) is not part of it and the opener drops it.
      const host = displayText(decodeURIComponent(u.pathname.split("?")[0]));
      return host ? { url: data.koluxOpen, host } : null;
    } catch {
      return null; // a malformed percent-escape: nothing worth asking about
    }
  }
  return null;
}

/** How long Open stays disabled after the question appears: input protection, so a click or key the user
 * meant for the page cannot land on Open (worker decision, 2f, 2026-11-01; Txais may veto). */
export const LINK_OPEN_DELAY_MS = 1000;

/** How many Cancels in a row from one entry silence its further questions. */
export const LINK_BACKOFF = 3;

/** DT-C77: a message from the viewer never opens the browser. It raises one Kolux-owned question
 * ("Open example.com?") and the browser opens only when the user clicks Open in Kolux. First ask wins:
 * while a question is pending, new asks are ignored (a page cannot swap the address under the user's
 * click); after Open or Cancel a new one may come. Open does nothing for LINK_OPEN_DELAY_MS after the
 * question appears, and it opens exactly the address that was shown, once. */
export function linkPrompt(open: (url: string) => Promise<unknown>, show: (ask: LinkAsk | null) => void, now: () => number = Date.now) {
  let pending: LinkAsk | null = null;
  let since = 0;
  let cancels = 0;
  const set = (ask: LinkAsk | null) => {
    pending = ask;
    since = now();
    show(ask);
  };
  const ready = () => pending !== null && now() - since >= LINK_OPEN_DELAY_MS;
  return {
    ask(e: Pick<MessageEvent, "data" | "source">, frameWindow: Window | null | undefined) {
      if (pending || cancels >= LINK_BACKOFF) return;
      const ask = linkAsk(e, frameWindow);
      if (ask) set(ask);
    },
    ready,
    async accept(): Promise<unknown> {
      const ask = pending;
      if (!ask || !ready()) return null;
      cancels = 0;
      set(null);
      return open(ask.url);
    },
    /** The user said no. After LINK_BACKOFF in a row from the same entry the page is not asked again
     * (a page cannot nag until a click lands) until `reset`, when the entry is chosen again. */
    cancel() {
      if (!pending) return;
      cancels += 1;
      set(null);
    },
    /** A key, a click or a focus change while Open is still disabled: the delay starts over, so input
     * meant for the page cannot add up to a click on Open. */
    touch() {
      if (pending && !ready()) since = now();
    },
    /** A different entry (or the same one chosen again) is a new conversation: the question and the
     * count of refusals are dropped. */
    reset() {
      cancels = 0;
      if (pending) set(null);
    },
  };
}

/** The question strip. It is a bar in normal layout above the viewer frame (the frame is pushed down,
 * never covered), so a page cannot draw anything under the buttons. Open has no autofocus and is
 * disabled until `ready`. */
export function LinkAskBar({ ask, ready, onOpen, onCancel }: { ask: LinkAsk; ready: boolean; onOpen: () => void; onCancel: () => void }) {
  return (
    <div className="art-ask" role="status" aria-label="Open link">
      <span className="art-ask-text" title={displayText(ask.url, 200)}>
        Open <strong>{ask.host}</strong>?
      </span>
      <button className="btn" disabled={!ready} onClick={onOpen}>
        Open
      </button>
      <button className="btn" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

type Props = {
  onToast: (text: string) => void;
  /** The workspace whose `artifacts/` folder is imported automatically; none when no folder is open. */
  workspace?: string | null;
  /** The project the workspace belongs to, so imports sit under that heading rather than the folder name. */
  project?: string | null;
};

export default function ArtifactsPage({ onToast, workspace, project }: Props) {
  const [list, setList] = useState<Artifact[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const told = useRef(new Set<string>());

  const refresh = useCallback(
    () => invoke<Artifact[]>("artifacts_list").then(setList, (e) => onToast(`Could not read the library: ${e}`)),
    [onToast],
  );
  useEffect(() => {
    void refresh();
    // A Claude session published a page (SKILL-035), or the workspace scan imported one.
    const off = listen("artifacts-changed", () => void refresh());
    return () => void off.then((f) => f());
  }, [refresh]);

  // SKILL-036: a workspace keeps its finished files in `artifacts/`. Import that folder when the
  // page opens and watch it while it is up, so an agent's new page is already in the tab without
  // Add artifact. The Rust scan remembers unchanged files and only re-imports a changed one; a file
  // it cannot keep (over the cap, unreadable) is named once. One scan at a time: a tick that finds
  // the last one still running is dropped.
  useEffect(() => {
    if (!workspace) return;
    let live = true;
    const scan = ticker(() =>
      invoke<Scanned>("artifacts_scan", { path: workspace, project })
        .then((r) => {
          if (!live) return;
          if (r.changed > 0) void refresh();
          const fresh = newlySkipped(r.skipped, told.current);
          if (fresh.length) onToast(`Not kept in Artifacts: ${fresh.join("; ")}`);
        })
        .catch(() => {}),
    );
    scan();
    const timer = window.setInterval(scan, 3000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [workspace, project, refresh, onToast]);

  // A link a viewer page asks for (DT-C77): the message only raises Kolux's own question below; the
  // browser opens when the user clicks Open there, never from the message itself.
  const [asked, setAsked] = useState<LinkAsk | null>(null);
  const [askReady, setAskReady] = useState(false);
  const [nudge, setNudge] = useState(0);
  const prompt = useRef<ReturnType<typeof linkPrompt> | null>(null);
  prompt.current ??= linkPrompt((url) => invoke("open_external", { url }), setAsked);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => prompt.current?.ask(e, frame.current?.contentWindow);
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  // Open is disabled for the first second of each question (the same clock as linkPrompt.accept), and
  // the second starts over at any click, key or focus change while it is still disabled.
  useEffect(() => {
    setAskReady(false);
    if (!asked) return;
    const t = window.setTimeout(() => setAskReady(true), LINK_OPEN_DELAY_MS + 50);
    return () => window.clearTimeout(t);
  }, [asked, nudge]);
  useEffect(() => {
    if (!asked || askReady) return;
    const again = () => {
      prompt.current?.touch();
      setNudge((n) => n + 1);
    };
    // Input inside the sandboxed frame never reaches this window; the focus leaving it for the frame does.
    const events = ["pointerdown", "keydown", "blur"] as const;
    for (const ev of events) window.addEventListener(ev, again, true);
    return () => {
      for (const ev of events) window.removeEventListener(ev, again, true);
    };
  }, [asked, askReady]);
  // Another page, or none, is a different conversation: the old question and the refusals are dropped.
  useEffect(() => {
    prompt.current?.reset();
  }, [selected]);
  // Choosing the entry again counts as choosing it: its refusals start over.
  const choose = (id: string) => {
    prompt.current?.reset();
    setSelected(id);
    setLoaded(null);
  };

  const shown = useMemo(() => group((list ?? []).filter((a) => matches(a.title, query))), [list, query]);
  const current = list?.find((a) => a.id === selected) ?? null;

  const add = async () => {
    const path = await open({
      multiple: false,
      directory: false,
      title: "Add artifact",
      filters: [
        { name: "Pages and pictures", extensions: ["html", "htm", "png", "jpg", "jpeg", "gif", "webp", "svg", "pdf"] },
        { name: "Video and audio", extensions: ["mp4", "webm", "mov", "m4v", "ogv", "mkv", "avi", "mp3", "wav", "m4a", "ogg", "oga", "flac", "aac", "opus"] },
        { name: "Documents", extensions: ["md", "txt", "csv", "json", "log", "docx", "xlsx", "pptx", "zip"] },
        { name: "All files", extensions: ["*"] },
      ],
    }).catch(() => null);
    if (typeof path !== "string") return;
    try {
      const a = await invoke<Artifact>("artifact_add", { path });
      await refresh();
      setSelected(a.id);
      setLoaded(null);
    } catch (e) {
      // SKILL-036's card fixes this wording; it covers a page or any other file added by hand.
      onToast(`Could not add that page: ${e}`);
    }
  };
  const remove = async (a: Artifact) => {
    try {
      await invoke("artifact_remove", { id: a.id });
      if (selected === a.id) setSelected(null);
      await refresh();
    } catch (e) {
      onToast(`Could not remove ${a.title}: ${e}`);
    }
  };
  // The library's own copy, never the workspace file it came from: that one may have changed since it was kept
  // (T-624 round 5, S5), and the user is looking at the stored copy's name, size and date.
  const openFile = (a: Artifact) => invoke("artifact_open", { id: a.id }).catch((e) => onToast(`Could not open ${a.title}: ${e}`));

  return (
    <div className="artifacts">
      <div className="art-side">
        <div className="art-head">
          <h2>Artifacts</h2>
          <button className="btn" onClick={() => void add()}>
            Add artifact
          </button>
        </div>
        <input className="picker-input" placeholder="Search titles" aria-label="Search artifacts" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="art-list" role="listbox" aria-label="Saved artifacts">
          {list && list.length === 0 && <div className="menu-hint">No artifacts yet. Files in this workspace's artifacts folder land here automatically, or add one yourself.</div>}
          {list && list.length > 0 && shown.length === 0 && <div className="menu-hint">No titles hold every word of “{query.trim()}”.</div>}
          {shown.map((s) => (
            <div key={s.project} className="art-group">
              <div className="art-group-head" title={s.project}>{s.project}</div>
              {s.items.map((a) => (
                <div key={a.id} role="option" aria-selected={a.id === selected} className={`art-row${a.id === selected ? " sel" : ""}`}
                  tabIndex={0}
                  onClick={() => choose(a.id)}
                  onKeyDown={(e) => e.key === "Enter" && choose(a.id)}
                >
                  <div className="art-title">
                    <span className="name">{a.title}</span>
                    {a.kind !== "page" && <span className="preview-tag">{extText(a.page)}</span>}
                    {a.state === "remote" && <span className="preview-tag">Remote</span>}
                    {a.state === "unavailable" && <span className="preview-tag">Unavailable</span>}
                  </div>
                  <div className="art-meta">
                    {[a.project ?? (a.source === "hand" ? "Added by hand" : "An agent"), a.session && "session " + a.session.slice(0, 8), new Date(a.added).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" }), sizeText(a.size)].filter(Boolean).join(" · ")}
                  </div>
                  <button
                    className="ib art-remove"
                    title="Remove from library"
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(a);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="art-view">
        {asked && <LinkAskBar ask={asked} ready={askReady} onOpen={() => void prompt.current?.accept().catch((err) => onToast(String(err)))} onCancel={() => prompt.current?.cancel()} />}
        {!current && <div className="empty"><p>Pick an artifact to view it here.</p></div>}
        {current?.state === "remote" && <div className="empty"><h2>{current.title}</h2><p>This page is on a machine this computer cannot read (WSL or SSH).</p></div>}
        {current?.state === "unavailable" && <div className="empty"><h2>{current.title}</h2><p>This page is on a network share, which Kolux never opens.</p></div>}
        {current?.state === "ok" && !current.stored && <div className="empty"><h2>{current.title}</h2><p>Could not show this file: its stored copy is missing. Add it again to restore it.</p></div>}
        {current?.state === "ok" && current.stored && view(current.kind) === "image" && <img className="art-image" src={viewerUrl(current)} alt={current.title} />}
        {current?.state === "ok" && current.stored && view(current.kind) === "video" && (
          <video className="art-media" src={viewerUrl(current)} controls preload="metadata" aria-label={current.title} />
        )}
        {current?.state === "ok" && current.stored && view(current.kind) === "audio" && (
          <div className="art-audio">
            <span>{current.title}</span>
            <audio src={viewerUrl(current)} controls preload="metadata" aria-label={current.title} />
          </div>
        )}
        {current?.state === "ok" && current.stored && view(current.kind) === "app" && (
          <div className="empty">
            <h2>{current.title}</h2>
            <p>A {extText(current.page) || "file"} file opens in its own app.</p>
            <button className="btn" onClick={() => void openFile(current)}>Open {extText(current.page) || "file"}</button>
          </div>
        )}
        {current?.state === "ok" && current.stored && view(current.kind) === "frame" && (
          <>
            {loaded !== current.id && <div className="art-loading menu-hint">Loading…</div>}
            <iframe
              // A republished page has a newer time: show the new version.
              key={`${current.id}-${current.added}`}
              ref={frame}
              name={`artifact-${current.id}`}
              title={current.title}
              className="art-frame"
              sandbox="allow-scripts allow-forms"
              src={viewerUrl(current)}
              onLoad={() => setLoaded(current.id)}
            />
          </>
        )}
      </div>
    </div>
  );
}
