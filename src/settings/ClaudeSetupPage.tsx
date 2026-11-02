// T-651 / DT-C88: Settings > Claude. A read-only breakdown of how Claude Code is set up on this
// machine and for one workspace: model, merged settings, permissions, hooks, MCP servers, skills,
// subagents, plugins and the CLAUDE.md files that apply. Every row carries the scope it came from.
// The backend (claude_setup.rs) does the reading and masks secrets; this page only shows it.
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Project } from "../projects/model";

export type FileRef = { scope: string; label: string; path: string };
export type SettingRow = { key: string; value: string; scope: string; path: string; also: string[] };
export type Rule = { rule: string; scope: string };
export type Masked = { key: string; value: string };
export type ClaudeSetup = {
  configDir: string;
  managedDir: string;
  workspace: string | null;
  sources: { scope: string; label: string; path: string; state: string }[];
  model: SettingRow | null;
  settings: SettingRow[];
  permissions: { allow: Rule[]; ask: Rule[]; deny: Rule[]; directories: Rule[]; defaultMode: SettingRow | null };
  hooks: { event: string; matcher: string | null; kind: string; command: string; scope: string }[];
  mcp: { name: string; kind: string; target: string; env: Masked[]; headers: Masked[]; scope: string; from: string; off: boolean }[];
  mcpFlags: { list: string; name: string; scope: string }[];
  skills: { name: string; description: string; scope: string; path: string }[];
  agents: { name: string; description: string; scope: string; path: string }[];
  plugins: { id: string; enabled: boolean | null; version: string | null; scope: string; from: string }[];
  memory: { path: string; kind: string; scope: string; bytes: number }[];
  files: { settings: FileRef[]; mcp: FileRef[]; plugins: FileRef[] };
  reads: string[];
  notes: string[];
};

/** Highest first: what wins when two layers set the same key. */
export const PRECEDENCE = ["managed", "cli", "local", "project", "user"] as const;
const SCOPE_NAME: Record<string, string> = { managed: "Managed", cli: "CLI", local: "Local", project: "Project", user: "User" };
const WORKSPACE_KEY = "kolux.claudeTabWorkspace";

const cut: CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const row: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 12rem) minmax(0, 1fr) auto", gap: 8, alignItems: "baseline", padding: "3px 0", borderTop: "1px solid var(--line)" };
const badgeStyle: CSSProperties = { fontSize: 11, padding: "0 6px", border: "1px solid var(--line-strong)", borderRadius: 8, color: "var(--fg-muted)", whiteSpace: "nowrap" };

export function Badge({ scope }: { scope: string }) {
  return (
    <span style={badgeStyle} data-scope={scope}>
      {scope.split(" + ").map((s) => SCOPE_NAME[s] ?? s).join(" + ")}
    </span>
  );
}

/** One line that never widens the page: cut with an ellipsis, the full text in the tooltip. */
export function Cut({ text, mono }: { text: string; mono?: boolean }) {
  return (
    <span style={{ ...cut, display: "block", fontFamily: mono ? "var(--font-mono, monospace)" : undefined }} title={text}>
      {text}
    </span>
  );
}

export function sizeOf(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export function Precedence({ sources }: { sources: ClaudeSetup["sources"] }) {
  return (
    <div className="conn-card" style={{ maxWidth: "none" }} data-section="precedence">
      <div className="conn-head">
        <strong>Which file wins</strong>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }} aria-label="precedence, highest first">
        {PRECEDENCE.map((s, i) => {
          const found = sources.filter((x) => x.scope === s && x.state === "found").length;
          return (
            <span key={s} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              {i > 0 && <span aria-hidden="true">{">"}</span>}
              <span style={badgeStyle} data-scope={s} title={s === "cli" ? "Command-line flags live only in a running session; they are not read here." : `${found} file${found === 1 ? "" : "s"} found`}>
                {SCOPE_NAME[s]}
                {s === "cli" ? " (per session)" : ` ${found}`}
              </span>
            </span>
          );
        })}
      </div>
      <div className="settings-sub" style={{ margin: 0 }}>
        A higher scope overrides a lower one for the same setting. Lists such as permission rules are joined across scopes instead.
      </div>
    </div>
  );
}

/** "Open file" for one file, "Open: <name>" for several. */
export function OpenButtons({ files, open }: { files: FileRef[]; open: (p: string) => void }) {
  if (files.length === 0) return null;
  return (
    <span className="btn-row" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {files.map((f) => (
        <button key={f.path} className="btn" title={f.path} onClick={() => open(f.path)}>
          {files.length === 1 ? "Open file" : `Open: ${f.label}`}
        </button>
      ))}
    </span>
  );
}

export function Section({ id, title, count, files, open, children }: { id: string; title: string; count?: number; files?: FileRef[]; open: (p: string) => void; children: ReactNode }) {
  return (
    <section className="conn-card" style={{ maxWidth: "none", minWidth: 0 }} data-section={id}>
      <div className="conn-head" style={{ flexWrap: "wrap" }}>
        <strong>{title}</strong>
        {count !== undefined && <span className="settings-sub" style={{ margin: 0 }}>{count}</span>}
        <span style={{ flex: 1 }} />
        <OpenButtons files={files ?? []} open={open} />
      </div>
      {children}
    </section>
  );
}

const Empty = ({ what }: { what: string }) => <div className="settings-sub" style={{ margin: 0 }}>{what}</div>;

function Setting({ r }: { r: SettingRow }) {
  return (
    <div style={row}>
      <Cut text={r.key} mono />
      <Cut text={r.also.length ? `${r.value}   (also set in ${r.also.map((s) => SCOPE_NAME[s] ?? s).join(", ")})` : r.value} mono />
      <Badge scope={r.scope} />
    </div>
  );
}

function Rules({ label, rules }: { label: string; rules: Rule[] }) {
  if (rules.length === 0) return null;
  return (
    <>
      <div className="settings-found-title" style={{ marginTop: 6 }}>{label} ({rules.length})</div>
      {rules.map((r) => (
        <div key={`${r.scope}:${r.rule}`} style={{ ...row, gridTemplateColumns: "minmax(0, 1fr) auto" }}>
          <Cut text={r.rule} mono />
          <Badge scope={r.scope} />
        </div>
      ))}
    </>
  );
}

export function ClaudeSetupView({ data, error, open, notice }: { data: ClaudeSetup | null; error: string; open: (p: string) => void; notice?: string }) {
  if (error) return <div role="alert" className="settings-sub">Could not read the Claude setup: {error}</div>;
  if (!data) return <div className="settings-sub">Reading the Claude setup…</div>;
  const p = data.permissions;
  const none = p.allow.length + p.ask.length + p.deny.length + p.directories.length === 0 && !p.defaultMode;
  const perRow = (path: string) => (
    <button className="btn" title={path} onClick={() => open(path)}>Open</button>
  );
  const entries = (list: { name: string; description: string; scope: string; path: string }[], what: string) =>
    list.length === 0 ? <Empty what={`No ${what} found.`} /> : list.map((e) => (
      <div key={e.path} style={{ ...row, gridTemplateColumns: "minmax(0, 12rem) minmax(0, 1fr) auto auto" }}>
        <Cut text={e.name} mono />
        <Cut text={e.description || "(no description)"} />
        <Badge scope={e.scope} />
        {perRow(e.path)}
      </div>
    ));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      {notice && <div role="status" className="settings-sub" style={{ margin: 0 }}>{notice}</div>}
      <Precedence sources={data.sources} />
      <Section id="model" title="Model" files={data.files.settings} open={open}>
        {data.model ? <Setting r={data.model} /> : <Empty what="No model is set in any settings file, so Claude Code uses its own default." />}
      </Section>
      <Section id="settings" title="Settings" count={data.settings.length} files={data.files.settings} open={open}>
        {data.settings.length === 0 ? <Empty what="No other settings are set." /> : data.settings.map((r) => <Setting key={r.key} r={r} />)}
        <details>
          <summary className="settings-sub" style={{ margin: 0, cursor: "pointer" }}>Files checked ({data.sources.length})</summary>
          {data.sources.map((s) => (
            <div key={`${s.scope}:${s.path}`} style={{ ...row, gridTemplateColumns: "minmax(0, 1fr) auto auto" }}>
              <Cut text={s.path} mono />
              <span style={badgeStyle}>{s.state}</span>
              <Badge scope={s.scope} />
            </div>
          ))}
        </details>
      </Section>
      <Section id="permissions" title="Permissions" count={p.allow.length + p.ask.length + p.deny.length} files={data.files.settings} open={open}>
        {none && <Empty what="No permission rules are set." />}
        {p.defaultMode && <Setting r={p.defaultMode} />}
        <Rules label="Allow" rules={p.allow} />
        <Rules label="Ask" rules={p.ask} />
        <Rules label="Deny" rules={p.deny} />
        <Rules label="Extra folders" rules={p.directories} />
      </Section>
      <Section id="hooks" title="Hooks" count={data.hooks.length} files={data.files.settings} open={open}>
        <div className="settings-sub" style={{ margin: 0 }}>Shown as text. Kolux never runs a hook from this page.</div>
        {data.hooks.length === 0 ? <Empty what="No hooks are set." /> : data.hooks.map((h, i) => (
          <div key={i} style={{ ...row, gridTemplateColumns: "minmax(0, 12rem) minmax(0, 1fr) auto" }}>
            <Cut text={h.matcher ? `${h.event} · ${h.matcher}` : h.event} mono />
            <Cut text={h.kind === "command" ? h.command : `${h.kind}: ${h.command}`} mono />
            <Badge scope={h.scope} />
          </div>
        ))}
      </Section>
      <Section id="mcp" title="MCP servers" count={data.mcp.length} files={data.files.mcp} open={open}>
        <div className="settings-sub" style={{ margin: 0 }}>Secret values are hidden; only the names of environment variables and headers are shown. Nothing is started.</div>
        {data.mcp.length === 0 ? <Empty what="No MCP servers are configured." /> : data.mcp.map((m, i) => (
          <div key={`${m.scope}:${m.name}:${i}`} style={{ ...row, gridTemplateColumns: "minmax(0, 12rem) minmax(0, 1fr) auto" }}>
            <Cut text={m.off ? `${m.name} (off)` : m.name} mono />
            <div style={{ minWidth: 0 }}>
              <Cut text={`${m.kind} · ${m.target}`} mono />
              {[...m.env.map((e) => `env ${e.key}=${e.value}`), ...m.headers.map((h) => `header ${h.key}: ${h.value}`)].map((t) => <Cut key={t} text={t} mono />)}
              <Cut text={`from ${m.from}`} />
            </div>
            <Badge scope={m.scope} />
          </div>
        ))}
        {data.mcpFlags.length > 0 && (
          <details>
            <summary className="settings-sub" style={{ margin: 0, cursor: "pointer" }}>Approval lists for this workspace ({data.mcpFlags.length})</summary>
            {data.mcpFlags.map((f) => (
              <div key={`${f.list}:${f.name}`} style={{ ...row, gridTemplateColumns: "minmax(0, 14rem) minmax(0, 1fr) auto" }}>
                <Cut text={f.list} mono />
                <Cut text={f.name} mono />
                <Badge scope={f.scope} />
              </div>
            ))}
          </details>
        )}
      </Section>
      <Section id="skills" title="Skills" count={data.skills.length} open={open}>{entries(data.skills, "skills")}</Section>
      <Section id="agents" title="Subagents" count={data.agents.length} open={open}>{entries(data.agents, "subagents")}</Section>
      <Section id="plugins" title="Plugins" count={data.plugins.length} files={data.files.plugins} open={open}>
        {data.plugins.length === 0 ? <Empty what="No plugins are enabled or installed." /> : data.plugins.map((pl, i) => (
          <div key={`${pl.from}:${pl.id}:${i}`} style={{ ...row, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 10rem) auto" }}>
            <Cut text={pl.id} mono />
            <Cut text={pl.from === "settings" ? (pl.enabled === false ? "turned off in settings" : "turned on in settings") : `installed${pl.version ? ` · ${pl.version}` : ""}`} />
            <Badge scope={pl.scope} />
          </div>
        ))}
      </Section>
      <Section id="memory" title="CLAUDE.md files" count={data.memory.length} open={open}>
        <div className="settings-sub" style={{ margin: 0 }}>Only the size is read, never the text.</div>
        {data.memory.length === 0 ? <Empty what="No CLAUDE.md files apply." /> : data.memory.map((m) => (
          <div key={m.path} style={{ ...row, gridTemplateColumns: "minmax(0, 1fr) auto auto auto" }}>
            <Cut text={m.path} mono />
            <span className="settings-sub" style={{ margin: 0 }}>{sizeOf(m.bytes)}</span>
            <Badge scope={m.scope} />
            {perRow(m.path)}
          </div>
        ))}
      </Section>
      {data.notes.length > 0 && (
        <details>
          <summary className="settings-sub" style={{ margin: 0, cursor: "pointer" }}>Skipped ({data.notes.length})</summary>
          {data.notes.map((n, i) => <Cut key={i} text={n} />)}
        </details>
      )}
      <details>
        <summary className="settings-sub" style={{ margin: 0, cursor: "pointer" }}>Everything this page opened ({data.reads.length})</summary>
        {data.reads.map((r, i) => <Cut key={i} text={r} mono />)}
      </details>
    </div>
  );
}

function remembered(): string {
  try {
    return localStorage.getItem(WORKSPACE_KEY) ?? "";
  } catch {
    return "";
  }
}

export default function ClaudeSetupPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspace, setWorkspace] = useState(remembered);
  const [data, setData] = useState<ClaudeSetup | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    invoke<Project[]>("project_list").then(setProjects).catch(() => setProjects([]));
  }, []);
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    invoke<ClaudeSetup>("claude_setup", { workspace: workspace || null })
      .then((d) => live && setData(d))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [workspace]);
  const pick = (path: string) => {
    setWorkspace(path);
    try {
      localStorage.setItem(WORKSPACE_KEY, path);
    } catch {
      /* no storage: the choice lasts until Settings closes */
    }
  };
  const open = useCallback((path: string) => {
    setNotice("");
    invoke("open_path", { path }).catch((e) => setNotice(`Could not open ${path}: ${e}`));
  }, []);
  return (
    <div style={{ minWidth: 0 }}>
      <div className="settings-sub">How Claude Code is set up here. Read-only: open a file to change it.</div>
      <label className="field" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <span>Workspace</span>
        <select aria-label="workspace" value={workspace} onChange={(e) => pick(e.target.value)} style={{ minWidth: 0, maxWidth: "100%" }}>
          <option value="">None (user and managed files only)</option>
          {projects.map((pr) => (
            <option key={pr.id} value={pr.path}>{pr.displayName || pr.name}</option>
          ))}
          {workspace && !projects.some((pr) => pr.path === workspace) && <option value={workspace}>{workspace}</option>}
        </select>
      </label>
      <ClaudeSetupView data={data} error={error} open={open} notice={notice} />
    </div>
  );
}
