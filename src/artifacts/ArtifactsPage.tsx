// The Artifacts library (SKILL-036, VIEW-012): the pages Claude publishes and the files an agent
// creates, kept newest first and cut into one section per project, with a viewer beside the list.
// A page is served by the app's kolux-artifact scheme, which hands out only the selected entry's
// stored files; the viewer frame is sandboxed, and a clicked link that leaves the entry comes back
// here as a message and opens in the system browser. An image or a text file is shown straight from
// the same scheme; a PDF or a document the viewer cannot render is handed to its own app.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import Ask from "../chrome/Ask";
import { locale } from "../language";
import "./artifacts.css";

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

/** How the viewer shows an entry: in the frame, as a picture, or not at all. */
export function view(kind: string | undefined): "frame" | "image" | "app" {
  if (kind === "image") return "image";
  if (kind === undefined || kind === "page" || kind === "text") return "frame";
  return "app";
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

/** Which row an arrow key lands on in a list of `count` rows: Up and Down step (and stop at the ends), Home and End jump. */
export function stepRow(count: number, from: number, key: string): number | null {
  if (count === 0) return null;
  if (key === "ArrowDown") return Math.min(count - 1, from + 1);
  if (key === "ArrowUp") return Math.max(0, from - 1);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** How long a page may take to load before the viewer says so. */
export const SLOW_MS = 10_000;

type Props = { onToast: (text: string) => void };

export default function ArtifactsPage({ onToast }: Props) {
  const [list, setList] = useState<Artifact[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [slow, setSlow] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Artifact | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  const refresh = () => invoke<Artifact[]>("artifacts_list").then(setList, (e) => onToast(`Could not read the library: ${e}`));
  useEffect(() => {
    void refresh();
    // A Claude session published a page (SKILL-035).
    const off = listen("artifacts-changed", () => void refresh());
    return () => void off.then((f) => f());
  }, []);

  // A link clicked inside the viewer: only messages from our own frame count.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || typeof e.data?.koluxOpen !== "string") return;
      invoke("open_external", { url: e.data.koluxOpen }).catch((err) => onToast(String(err)));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // A page that never reports it loaded is called out instead of leaving "Loading…" up for good.
  useEffect(() => {
    if (!selected || loaded === selected) return;
    setSlow(null);
    const t = setTimeout(() => setSlow(selected), SLOW_MS);
    return () => clearTimeout(t);
  }, [selected, loaded]);

  const shown = useMemo(() => group((list ?? []).filter((a) => matches(a.title, query))), [list, query]);
  const current = list?.find((a) => a.id === selected) ?? null;

  const add = async () => {
    const path = await open({
      multiple: false,
      directory: false,
      title: "Add artifact",
      filters: [
        { name: "Pages and pictures", extensions: ["html", "htm", "png", "jpg", "jpeg", "gif", "webp", "svg", "pdf"] },
        { name: "Documents", extensions: ["md", "txt", "csv", "docx", "xlsx", "pptx"] },
        { name: "All files", extensions: ["*"] },
      ],
    }).catch((e) => {
      onToast(`Could not open the file picker: ${e}`);
      return null;
    });
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
  const pick = (id: string) => (setSelected(id), setLoaded(null));
  const arrows = (e: KeyboardEvent<HTMLDivElement>) => {
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("button.art-row")];
    const to = stepRow(rows.length, rows.indexOf(e.target as HTMLElement), e.key);
    if (to === null || !rows.includes(e.target as HTMLElement)) return;
    e.preventDefault();
    rows[to].focus();
  };
  const openFile = (a: Artifact) => invoke("open_path", { path: a.origin }).catch((e) => onToast(`Could not open ${a.title}: ${e}`));

  return (
    <div className="artifacts">
      {removing && (
        <Ask
          title={`Remove ${removing.title}?`}
          body={`“${removing.title}” and its stored copy are deleted from the library. The original file it came from is not touched.`}
          confirm="Remove"
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const a = removing;
            setRemoving(null);
            void remove(a);
          }}
        />
      )}
      <div className="art-side">
        <div className="art-head">
          <h2>Artifacts</h2>
          <button className="btn" onClick={() => void add()}>
            Add artifact
          </button>
        </div>
        <input className="picker-input" placeholder="Search titles" aria-label="Search artifacts" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="art-list" role="group" aria-label="Saved artifacts" onKeyDown={arrows}>
          {list && list.length === 0 && <div className="menu-hint">No artifacts yet. Pages and files your agents make land here, or add one yourself.</div>}
          {list && list.length > 0 && shown.length === 0 && <div className="menu-hint">No titles hold every word of “{query.trim()}”.</div>}
          {shown.map((s) => (
            <div key={s.project} className="art-group">
              <div className="art-group-head" title={s.project}>{s.project}</div>
              <div role="list" aria-label={s.project} className="art-items">
                {s.items.map((a) => (
                  <div key={a.id} role="listitem" className="art-item">
                    <button type="button" aria-current={a.id === selected ? "true" : undefined} className={`art-row${a.id === selected ? " sel" : ""}`} onClick={() => pick(a.id)}>
                      <span className="art-title">
                        <span className="name">{a.title}</span>
                        {a.kind !== "page" && <span className="preview-tag">{extText(a.page)}</span>}
                        {a.state === "remote" && <span className="preview-tag">Remote</span>}
                        {a.state === "unavailable" && <span className="preview-tag">Unavailable</span>}
                      </span>
                      <span className="art-meta">
                        {[a.project ?? (a.source === "hand" ? "Added by hand" : "An agent"), a.session && "session " + a.session.slice(0, 8), new Date(a.added).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" }), sizeText(a.size)].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                    <button type="button" className="ib art-remove" title="Remove from library" aria-label={`Remove ${a.title}`} onClick={() => setRemoving(a)}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="art-view">
        {!current && <div className="empty"><p>Pick an artifact to view it here.</p></div>}
        {current?.state === "remote" && <div className="empty"><h2>{current.title}</h2><p>This page is on a machine this computer cannot read (WSL or SSH).</p></div>}
        {current?.state === "unavailable" && <div className="empty"><h2>{current.title}</h2><p>This page is on a network share, which Kolux never opens.</p></div>}
        {current?.state === "ok" && !current.stored && <div className="empty"><h2>{current.title}</h2><p>Could not show this file: its stored copy is missing. Add it again to restore it.</p></div>}
        {current?.state === "ok" && current.stored && view(current.kind) === "image" && <img className="art-image" src={viewerUrl(current)} alt={current.title} />}
        {current?.state === "ok" && current.stored && view(current.kind) === "app" && (
          <div className="empty">
            <h2>{current.title}</h2>
            <p>A {extText(current.page) || "file"} file opens in its own app.</p>
            <button className="btn" onClick={() => void openFile(current)}>Open {extText(current.page) || "file"}</button>
          </div>
        )}
        {current?.state === "ok" && current.stored && view(current.kind) === "frame" && (
          <>
            {loaded !== current.id && slow !== current.id && <div className="art-loading menu-hint" role="status">Loading…</div>}
            {loaded !== current.id && slow === current.id && <div className="art-loading art-slow menu-hint" role="status">This page is taking a long time to load. It may be empty or broken.</div>}
            <iframe
              // A republished page has a newer time: show the new version.
              key={`${current.id}-${current.added}`}
              ref={frame}
              name={`artifact-${current.id}`}
              title={current.title}
              className="art-frame"
              // Hidden until it loads (or is called slow), so the viewer never flashes the frame's white ground in a dark theme.
              style={loaded === current.id || slow === current.id ? undefined : { visibility: "hidden" }}
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
