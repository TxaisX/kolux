// Native chat, the rows of an agent's work (CHAT-012..CHAT-016; T-326): Thought buttons, plans,
// the compaction divider, provider notices, folded tool steps, diff cards, the subagent roster and
// the working, worked-for and responding lines. `fold` in steps.ts decides which rows exist.
import { useContext, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { renderMarkdown } from "../editor/PreviewPane";
import { Dots, FileCode, Globe, Plug, Search, Shell, Spark, Spinner } from "../chrome/icons";
import type { ChatItem } from "./model";
import { shortTokens } from "../usage/meter";
import { LinkContext, openLink as openChatLink, type LinkHost } from "./ChatText";
import { useCopy } from "./ux";
import { diffLineKind, diffText, duration, linkParts, looksLikeDiff, type Child, type FileDiff, type Tool, type View } from "./steps";

// CHAT-016: one clock for every elapsed timer in the chat, paused while the window is hidden.
let now = Date.now();
const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | undefined;
const tick = () => {
  now = Date.now();
  listeners.forEach((l) => l());
};
const run = () => {
  if (ticker === undefined && listeners.size > 0 && !document.hidden) ticker = setInterval(tick, 1000);
};
const halt = () => {
  clearInterval(ticker);
  ticker = undefined;
};
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => (document.hidden ? halt() : (tick(), run())));
const subscribe = (l: () => void) => {
  listeners.add(l);
  run();
  return () => {
    listeners.delete(l);
    if (listeners.size === 0) halt();
  };
};
export const useNow = () => useSyncExternalStore(subscribe, () => now);

const ICONS: Record<Tool["group"], (p: { size?: number }) => ReactNode> = { read: Search, edit: FileCode, shell: Shell, mcp: Plug, web: Globe, agent: Spark, other: Dots };
const Icon = ({ group }: { group: Tool["group"] }) => {
  const I = ICONS[group] ?? Dots;
  return <I size={12} />;
};

/** CHAT-013: a shell call shows its command; every other call its name and what it works on. */
const callLine = (t: Tool) => (t.group === "shell" && t.preview ? t.preview : [t.server ? `${t.server} · ${t.name}` : t.name, t.preview].filter(Boolean).join(" "));

/** CHAT-013: only web links are clickable. With the chat's link host (always, inside a chat) a click goes the same way as a
 * link in a reply: the "Open links in Kolux" setting, the browser choice, and a failure said under the box. */
export function openLink(e: MouseEvent, host?: LinkHost | null) {
  const a = (e.target as HTMLElement).closest("a");
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute("href") ?? "";
  if (!/^https?:\/\//i.test(href)) return;
  if (host) return openChatLink({ kind: "web", url: href }, e, host);
  invoke("open_external", { url: href }).catch(() => {});
}

/** A click handler for text with links in it, bound to the chat's link host. */
const useOpenLink = () => {
  const host = useContext(LinkContext);
  return (e: MouseEvent) => openLink(e, host);
};

function Linked({ text }: { text: string }) {
  return (
    <>
      {linkParts(text).map((p, i) =>
        p.url ? (
          <a key={i} href={p.url}>
            {p.text}
          </a>
        ) : (
          p.text
        ),
      )}
    </>
  );
}

function Output({ text }: { text: string }) {
  if (!looksLikeDiff(text)) return <pre className="chat-out"><Linked text={text} /></pre>;
  return (
    <pre className="chat-out">
      {text.split("\n").map((l, i) => (
        <span key={i} className={`dl ${diffLineKind(l)}`}>
          {l}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

function Fold({ label, children, className = "" }: { label: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`chat-fold ${className}`}>
      <button type="button" className="chat-fold-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && <div className="chat-fold-body">{children}</div>}
    </div>
  );
}

/** CHAT-012 / STAT-053: reasoning sits behind a real button, folded until opened. */
export function ThoughtRow({ item, open, onToggle }: { item: ChatItem; open: boolean; onToggle: () => void }) {
  return (
    <div className="chat-fold chat-thought">
      <button type="button" className="chat-fold-head" aria-expanded={open} onClick={onToggle}>
        Thought
      </button>
      {open && <div className="chat-fold-body chat-text">{item.text}</div>}
    </div>
  );
}

export function PlanRow({ item }: { item: ChatItem }) {
  const onLink = useOpenLink();
  return <div className="chat-plan" onClick={onLink} dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }} />;
}

/** CHAT-012: a notice's details are shown up to a limit, and the rest is one click away. */
const DETAILS_SHOWN = 4000;
export function NoticeRow({ item }: { item: ChatItem }) {
  const [all, setAll] = useState(false);
  const onLink = useOpenLink();
  const d = item.details;
  return (
    <div className="chat-notice" role="status">
      <div>{item.text}</div>
      {d && (
        <Fold label="Details">
          <pre className="chat-out" onClick={onLink}>
            <Linked text={all ? d : d.slice(0, DETAILS_SHOWN)} />
          </pre>
          {!all && d.length > DETAILS_SHOWN && (
            <button type="button" className="chat-link-btn" onClick={() => setAll(true)}>
              Show all ({d.length - DETAILS_SHOWN} more characters)
            </button>
          )}
        </Fold>
      )}
    </div>
  );
}

function StepsRow({ view }: { view: Extract<View, { row: "steps" }> }) {
  const onLink = useOpenLink();
  const latest = view.steps[view.steps.length - 1].tool!;
  const groups = [...new Set(view.steps.map((s) => s.tool!.group))];
  const label = view.live ? (
    <>
      <Spinner size={12} /> <span className="chat-call">{callLine(latest)}</span>
    </>
  ) : (
    <>
      <span className="chat-icons">{groups.map((g) => <Icon key={g} group={g} />)}</span> {view.steps.length === 1 ? callLine(latest) : `${view.steps.length} steps`}
    </>
  );
  return (
    <Fold label={label} className="chat-steps">
      {view.steps.map((s) => (
        <div key={s.id} className="chat-step" onClick={onLink}>
          <div className="chat-step-call">
            <Icon group={s.tool!.group} /> <span className="chat-call">{callLine(s.tool!)}</span>
            {!s.tool!.done && <span className="chat-faint"> · running</span>}
            {s.tool!.failed && <span className="chat-faint"> · failed</span>}
          </div>
          {s.tool!.output && <Output text={s.tool!.output} />}
        </div>
      ))}
    </Fold>
  );
}

const CHANGE: Record<FileDiff["change"], string> = { added: "Added", deleted: "Deleted", renamed: "Renamed", edited: "Edited" };

function DiffCard({ tool, diff }: { tool: Tool; diff?: FileDiff }) {
  const [copyText, copy] = useCopy("Copy diff");
  const path = diff?.path ?? tool.preview;
  const name = path.split(/[\\/]/).pop();
  return (
    <div className="chat-diff">
      <div className="chat-diff-head">
        <FileCode size={12} />
        <span className="chat-diff-name" title={diff?.from ? `${diff.from} → ${path}` : path}>
          {name}
        </span>
        {diff && !tool.failed && <span className={`chat-tag ${diff.change}`}>{CHANGE[diff.change]}</span>}
        {diff && !tool.failed && (
          <button
            type="button"
            className="chat-copy"
            onClick={() => copy(diffText(diff))}
          >
            {copyText}
          </button>
        )}
      </div>
      {tool.failed ? (
        <pre className="chat-out">{tool.output ?? "The edit was refused."}</pre>
      ) : (
        diff && (
          <div className="chat-diff-body">
            <table>
              <tbody>
                {diff.lines.map((l, i) =>
                  l.sign === "@" ? (
                    <tr key={i} className="gap">
                      <td colSpan={3}>⋯</td>
                    </tr>
                  ) : (
                    <tr key={i} className={l.sign === "+" ? "add" : l.sign === "-" ? "del" : ""}>
                      <td className="n">{l.old ?? ""}</td>
                      <td className="n">{l.new ?? ""}</td>
                      <td className="t">
                        {l.sign === " " ? " " : l.sign} {l.text}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            {diff.hidden > 0 && <div className="chat-faint chat-diff-more">{diff.hidden} more lines are not shown</div>}
          </div>
        )
      )}
    </div>
  );
}

/** CHAT-014: one card per file; a refused edit shows the agent's error instead of a diff. */
function DiffRow({ item }: { item: ChatItem }) {
  const t = item.tool!;
  const diffs = t.diffs ?? [];
  if (t.failed || diffs.length === 0) return <DiffCard tool={t} />;
  return (
    <>
      {diffs.map((d, i) => (
        <DiffCard key={i} tool={t} diff={d} />
      ))}
    </>
  );
}

const STATE_WORD: Record<Child["state"], string> = { working: "Working", idle: "Idle", completed: "Done", failed: "Failed", stopped: "Stopped", unverifiable: "Unknown (from an earlier run)" };

function RosterRow({ view }: { view: Extract<View, { row: "roster" }> }) {
  const t = useNow();
  const n = view.children.length;
  const working = view.children.filter((c) => c.state === "working").length;
  const failed = view.children.filter((c) => c.state === "failed").length;
  const word = (k: number) => `${k} subagent${k === 1 ? "" : "s"}`;
  const head = working > 0 ? `${word(working)} working` : `${word(n)} ran`;
  return (
    <Fold
      className={`chat-roster ${view.verdict}`}
      label={
        <>
          {working > 0 ? <Spinner size={12} /> : <Spark size={12} />} {head}
          {failed > 0 && <span className="chat-roster-failed"> · {failed} failed</span>}
        </>
      }
    >
      {view.children.map((c) => {
        const end = c.endedAt ?? (c.state === "working" ? t : undefined);
        return (
          <div key={c.id} className={`chat-child ${c.state}`}>
            <span className="chat-call">{c.name}</span>
            {c.label && <span> · {c.label}</span>}
            <span className="chat-faint">
              {" "}
              · {STATE_WORD[c.state]}
              {c.at !== undefined && end !== undefined ? ` · ${duration(end - c.at)}` : ""}
              {c.tokens !== undefined ? ` · ${shortTokens(c.tokens)} tokens` : ""}
            </span>
          </div>
        );
      })}
    </Fold>
  );
}

function WorkingRow({ view }: { view: Extract<View, { row: "working" }> }) {
  const t = useNow();
  return (
    <div className="chat-working" role="status">
      <Spinner size={12} /> {view.label}
      {view.since !== undefined && ` · ${duration(t - view.since)}`}
    </div>
  );
}

/** Rows `fold` adds; message rows stay with ChatView. Returns null for a message row. */
export function StepRow({ view }: { view: View }) {
  switch (view.row) {
    case "steps":
      return <StepsRow view={view} />;
    case "diff":
      return <DiffRow item={view.item} />;
    case "roster":
      return <RosterRow view={view} />;
    case "working":
      return <WorkingRow view={view} />;
    case "worked":
      return <div className="chat-worked">Worked for {duration(view.ms)}</div>;
    case "responding":
      return (
        <div className="chat-working" role="status">
          <Spinner size={12} /> Responding…
        </div>
      );
    default:
      return null;
  }
}
