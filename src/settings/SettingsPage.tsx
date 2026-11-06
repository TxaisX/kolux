// Settings, laid over the window body (the panes underneath stay mounted and untouched). Its first
// page is AI connections (ACCT-004): the Claude card connects on the 1-year key by default. The
// Connect grid with install steps is ConnectGrid (ACCT-001, ACCT-003); the Claude account route and
// the Codex sign-ins came with T-043-b / T-043-c.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { saveChanged } from "./saveChanged";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import VendorMark from "../chrome/VendorMark";
import { actionLabel, keyCard, ownSignInLine, RESUME_FIELD, resumeOn, type KeyAction, type KeyStatus, type OwnSignIn } from "./claudeKey";
import ClaudeAccounts, { addClaudeAccount } from "./ClaudeAccounts";
import AgentCredentials from "./AgentCredentials";
import ProviderUsage from "./ProviderUsage";
import CodexAccounts from "./CodexAccounts";
import CodexCard from "./CodexCard";
import { ConnectGrid, liveCheck, OtherWays, taglineOf } from "./ConnectGrid";
import { settleWithin } from "./pending";
import Ask from "../chrome/Ask";
import { trapTab } from "../chrome/dialogFocus";
import GrokCard from "./GrokCard";
import { AttentionNote, fixDoes, openInstallPage, type Fix } from "./Attention";
import type { Project } from "../projects/model";
import RepoPage from "./RepoPage";
import { PAGE_GROUPS, PAGES, pageOf, rememberPage, lastPage, type Page, type PageId, type SettingsTarget } from "./pages";
import { Bell, FolderPlus, Gear, Keyboard, List, Merge, Plug, Pulse, Shell, Sliders, Spark, Target } from "../chrome/icons";
import { markGuide } from "../onboarding/guide";
import { clearReadFailure, connectFailed, firstAiConnected, readFailed } from "../onboarding/firstRun";
import { useKeymap } from "../keys/KeymapContext";
import { matchEvent } from "../keys/keymap";
import { hideRule, MAX_REPOS_DRAWN, MAX_SEARCH, SearchFolds, searchRepos } from "./search";
import { useSettled } from "../editor/settledQuery";
import { useSearchHits } from "./useSearchHits";

// SET-006: a page loads the first time it is opened, so Settings itself opens quickly.
const AppearancePage = lazy(() => import("./AppearancePage"));
const GeneralPage = lazy(() => import("./GeneralPage"));
const NotificationsPage = lazy(() => import("./NotificationsPage"));
// STAT-041 / STAT-045: the finish, stopped and quiet-alert switches (T-026-a, T-039-a).
const Notifications = lazy(() => import("./NotificationSwitches"));
const ShortcutsPage = lazy(() => import("./ShortcutsPage"));
const TerminalPage = lazy(() => import("./TerminalPage"));
const GitPage = lazy(() => import("./GitPage"));
const AgentsPage = lazy(() => import("./AgentsPage"));
const ClaudeSetupPage = lazy(() => import("./ClaudeSetupPage"));
// SAFE-015: the Protected actions section (T-059-b).
const SafetyPage = lazy(() => import("./SafetyPage"));
const TokenAnalytics = lazy(() => import("../usage/TokenAnalytics"));
const Activity = lazy(() => import("../usage/Activity"));

/** One small line glyph per page, the way Claude's settings rail does it. Repositories share FolderPlus. */
const PAGE_ICON: Record<PageId, ComponentType<{ size?: number }>> = {
  general: Gear,
  appearance: Sliders,
  accounts: Plug,
  agents: List,
  terminal: Shell,
  git: Merge,
  safety: Target,
  notifications: Bell,
  shortcuts: Keyboard,
  usage: Pulse,
  claude: Spark,
};

export function ClaudeCardView({ status, busy, error, onAction, onUseAccount, own = null, resume = false, onResume }: { status: KeyStatus | null; busy: boolean; error?: string | null; onAction: (a: KeyAction) => void; onUseAccount?: () => void; own?: OwnSignIn | null; resume?: boolean; onResume?: (on: boolean) => void }) {
  const card = keyCard(status);
  const ownLine = card.state === "disconnected" || card.state === "attention" ? ownSignInLine(own) : null;
  const fix = (f: Fix) => (fixDoes(f) === "install-page" ? void openInstallPage("claude").catch(() => {}) : onAction(fixDoes(f) === "check" ? "cancel" : "connect"));
  const chip = card.state === "connected" || card.state === "warning" ? "Connected" : card.state === "expired" ? "Ran out" : card.state === "connecting" ? "Connecting" : card.state === "attention" ? "Needs attention" : card.state === "reading" ? "" : "Not connected";
  return (
    <section className="conn-card" data-state={card.state} aria-label="Claude">
      <header className="conn-head">
        <VendorMark agent="claude" size={18} />
        <span className="conn-name">Claude</span>
        {chip && <span className={`conn-chip ${card.state}`}>{chip}</span>}
      </header>
      <p className="conn-detail conn-tagline">{taglineOf("claude")}</p>
      <div className="conn-headline">{card.headline}</div>
      {card.detail && <p className={card.state === "warning" || card.state === "expired" || card.state === "attention" ? "conn-detail warn" : "conn-detail"}>{card.detail}</p>}
      {ownLine && <p className={ownLine.warn ? "conn-detail warn own-sign-in" : "conn-detail own-sign-in"}>{ownLine.text}</p>}
      <AttentionNote attention={card.attention} route="claude-key" busy={busy} offer={card.state === "attention"} onFix={fix} />
      {error && (
        <p className="conn-detail warn" role="alert">
          {error}
        </p>
      )}
      <div className="btn-row">
        {card.actions.map((a) => (
          <button key={a} className={a === "connect" || a === "renew" ? "btn primary" : a === "disconnect" ? "btn danger" : "btn"} disabled={busy && a !== "cancel"} onClick={() => onAction(a)}>
            {actionLabel[a]}
          </button>
        ))}
        {onUseAccount && (card.state === "disconnected" || card.state === "attention") && <OtherWays ways={[{ label: "Use my Claude account instead", onPick: onUseAccount, disabled: busy }]} />}
      </div>
      {onResume && (
        <label className="conn-switch">
          <input type="checkbox" role="switch" checked={resume} onChange={(e) => onResume(e.target.checked)} />
          <span>
            Carry on by itself once a usage limit resets
            <small>Off unless you turn it on. A Claude pane stopped by a usage limit gets "The usage limit has reset. Please continue where you left off." typed in about a minute after the limit resets, as long as Claude is still the program in front and nothing else was typed there since.</small>
          </span>
        </label>
      )}
    </section>
  );
}

/** ACCT-015: the one question before the 1-year key is erased. */
export const claudeDisconnect = {
  title: "Disconnect Claude?",
  body: "Kolux erases the 1-year key it saved for Claude. A Claude sign-in you made yourself, and any managed Claude accounts, stay as they are.",
  confirm: "Disconnect",
};

/** `onConnected`: told whether Claude counts as connected each time that changes (ONB-003). */
export function ClaudeCard({ onConnected = () => {} }: { onConnected?: (on: boolean) => void } = {}) {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const on = ["connected", "warning"].includes(keyCard(status).state);
  useEffect(() => onConnected(on), [onConnected, on]);
  const [own, setOwn] = useState<OwnSignIn | null>(null);
  const [resume, setResume] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const read = useCallback(() => {
    invoke<KeyStatus>("claude_key_status")
      .then((v) => {
        setStatus(v);
        setError(clearReadFailure);
      })
      .catch(() => setError(readFailed));
    invoke<OwnSignIn | null>("claude_own_sign_in")
      .then(setOwn)
      .catch(() => setOwn(null));
  }, []);
  useEffect(() => {
    read();
    invoke<Record<string, unknown>>("get_settings")
      .then((s) => setResume(resumeOn(s)))
      .catch(() => {});
    const offs = [listen("claude-key", read), listen("claude-accounts", read)];
    const stop = liveCheck(read, window, document, 0);
    return () => (stop(), offs.forEach((o) => void o.then((u) => u()).catch(() => {})));
  }, [read]);
  const saveResume = (on: boolean) => {
    setResume(on);
    invoke<Record<string, unknown>>("get_settings")
      .then((s) => saveChanged(s, { ...s, [RESUME_FIELD]: on }))
      .catch((e) => {
        setResume(!on);
        setError(String(e));
      });
  };
  // While a setup runs the days-left figure cannot change, but its browser step can: read again.
  useEffect(() => {
    if (!status?.settingUp) return;
    const t = window.setInterval(read, 1000);
    return () => window.clearInterval(t);
  }, [status?.settingUp, read]);
  const act = (a: KeyAction, sure = false) => {
    setError(null);
    if (a === "disconnect" && !sure) return setAsking(true);
    const command = a === "cancel" ? "claude_key_cancel" : a === "disconnect" ? "claude_key_disconnect" : "claude_key_connect";
    setBusy(a !== "cancel");
    const call = invoke(command);
    call.catch((e) => setError(command === "claude_key_connect" ? connectFailed("Claude", e) : String(e)));
    // ACCT-002: the buttons come back after 30 seconds even if no answer arrives.
    void settleWithin(call).then(() => {
      setBusy(false);
      read();
    });
  };
  const useAccount = () => {
    setError(null);
    addClaudeAccount().catch((e) => setError(String(e)));
  };
  return (
    <>
      <ClaudeCardView status={status} busy={busy} error={error} onAction={act} onUseAccount={useAccount} own={own} resume={resume} onResume={saveResume} />
      {asking && (
        <Ask
          {...claudeDisconnect}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            act("disconnect", true);
          }}
        />
      )}
    </>
  );
}


/** One page's settings; Settings draws one, a search draws each page that holds a match. */
function PageBody({ page, repo, onSaved, active }: { page: Page; repo?: Project; onSaved: (p: Project) => void; active?: string }) {
  return (
    <>
      {page === "general" && <GeneralPage />}
      {page === "appearance" && (
        <>
          <p className="settings-sub">How Kolux looks. Changes show straight away.</p>
          <AppearancePage />
        </>
      )}
      {page === "accounts" && (
        <>
          <p className="settings-sub">Link Kolux to the AI services you already pay for. Kolux charges nothing and ships no models or keys of its own: each agent runs on your plan or key and talks straight to its provider, and Kolux neither relays nor records that traffic. Keys and sign-ins are sealed on this PC for your Windows account only.</p>
          <div data-section="connections">
            <ConnectGrid cards={{ claude: <ClaudeCard onConnected={firstAiConnected} />, codex: <CodexCard onConnected={firstAiConnected} />, grok: <GrokCard onConnected={firstAiConnected} /> }} />
          </div>
          <div className="conn-advanced" data-section="accounts-advanced">
            <h3 className="conn-advanced-head">Manage accounts (advanced)</h3>
            <div data-section="accounts-claude">
              <ClaudeAccounts />
            </div>
            <div data-section="accounts-codex">
              <CodexAccounts />
            </div>
            <div data-section="agent-folders">
              <AgentCredentials />
            </div>
            <div data-section="provider-usage">
              <ProviderUsage />
            </div>
          </div>
        </>
      )}
      {page === "shortcuts" && <ShortcutsPage />}
      {page === "terminal" && <TerminalPage />}
      {page === "git" && <GitPage />}
      {page === "agents" && <AgentsPage />}
      {page === "notifications" && (
        <>
          <NotificationsPage />
          <div data-section="alerts">
            <Notifications />
          </div>
        </>
      )}
      {page === "usage" && (
        <>
          <div data-section="activity">
            <Activity />
          </div>
          <div data-section="tokens">
            <p className="settings-sub">What your agents used, read from the logs they keep on this computer.</p>
            <TokenAnalytics />
          </div>
        </>
      )}
      {page === "safety" && <SafetyPage />}
      {page === "claude" && <ClaudeSetupPage active={active} />}
      {repo && <RepoPage project={repo} onSaved={onSaved} />}
    </>
  );
}

/** Scrolls a section of the open page into view once it is drawn (pages load lazily). */
function useScrollTo(section: string | undefined, page: Page, n: number) {
  useEffect(() => {
    if (!section) return;
    let frames = 0;
    let raf = 0;
    const look = () => {
      const el = document.querySelector<HTMLElement>(`.settings-main [data-section="${CSS.escape(section)}"]`);
      if (el) {
        // SET-016: a link into a folded section unfolds it (and only it) first.
        for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
        el.scrollIntoView({ block: "start" });
        el.classList.add("settings-section-flash");
        window.setTimeout(() => el.classList.remove("settings-section-flash"), 1200);
      } else if (++frames < 180) raf = requestAnimationFrame(look);
    };
    raf = requestAnimationFrame(look);
    return () => cancelAnimationFrame(raf);
  }, [section, page, n]);
}

/** `target` comes from a link elsewhere in the app; `n` changes on every open so a repeat link scrolls again. */
export default function SettingsPage({ onClose, target, n = 0, active = "" }: { onClose: () => void; target?: SettingsTarget | null; n?: number; active?: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const saved = (u: Project) => setProjects((ps) => ps.map((x) => (x.id === u.id ? u : x)));
  const [page, setPage] = useState<Page>(() => pageOf(target?.page ?? lastPage(), []));
  // T-752 (DT-C188): a list that could not be read keeps the Repositories group, says why and offers Try again.
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    setProjectsError(null);
    invoke<Project[]>("project_list")
      .then((list) => {
        setProjects(list);
        // A remembered repository page waits for the list before it can be shown.
        if (!target) setPage(pageOf(lastPage(), list.map((p) => p.id)));
      })
      .catch((e: unknown) => setProjectsError(String(e)));
  }, [target, tries]);
  useEffect(() => {
    if (target) {
      setPage(target.page);
      rememberPage(target.page);
    }
  }, [target, n]);
  // SET-007: a search across every page; a link into Settings or a page picked on the left ends it.
  const [query, setQuery] = useState("");
  const box = useRef<HTMLInputElement>(null);
  const keymap = useKeymap();
  useEffect(() => setQuery(""), [target, n]);
  // EDIT-049: the filter runs after a short pause in typing; emptying the box shows every setting at once.
  const settled = useSettled(query);
  const { hits, folds } = useSearchHits(settled); // SET-007: launch commands and advanced controls count too
  const repoHits = useMemo(() => searchRepos(settled, projects), [settled, projects]);
  const go = (p: Page) => {
    setQuery("");
    setPage(p);
    rememberPage(p); // only a page picked here is stored, never the mount-time placeholder
  };
  useEffect(() => {
    // Mod+F (settings.search) wins over a terminal's or the window's own use of the chord.
    const find = (e: KeyboardEvent) => {
      if (matchEvent(keymap, e, ["settings"])?.id !== "settings.search") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      box.current?.focus();
      box.current?.select();
    };
    window.addEventListener("keydown", find, true);
    return () => window.removeEventListener("keydown", find, true);
  }, [keymap]);
  // USAGE 012: opening the Usage page counts as having tried the usage feature (Explore Kolux).
  useEffect(() => void (page === "usage" && markGuide("tried", "usage").catch(() => {})), [page]);
  useScrollTo(target?.section, page, n);
  // T-565 (VIEW-009): Settings takes the keyboard when it opens and gives it back on close. Left in the
  // terminal it covers, Escape went to the program and xterm stopped it before this listener.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => back?.focus();
  }, []);
  // An Escape that belongs to another dialog is that dialog's even when it lets the Escape go on (the
  // Usage Share card, the Send feedback box): a shown modal inside Settings, or a dialog around the key.
  // Not every modal on the page: the panes under Settings stay mounted with their own alertdialogs.
  // Registered once. The Share card no longer has a window listener of its own: its dialog focus catches
  // Escape on the window in the capture phase, so it sees the key before this handler does.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const modal = [...(root.current?.querySelectorAll('[aria-modal="true"]') ?? [])].some((d) => !d.closest("[hidden]"));
      const owner = (e.target as Element | null)?.closest?.('[role="dialog"],[role="alertdialog"]');
      if (modal || (owner && owner !== root.current)) return;
      close.current();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const repo = page.startsWith("repo:") ? projects.find((p) => `repo:${p.id}` === page) : undefined;
  const title = repo ? repo.name : page in PAGES ? PAGES[page as keyof typeof PAGES] : "";
  const matching = hits ? new Set(hits.pages.map((h) => h.page)) : null;
  const rail = PAGE_GROUPS.map((g) => ({ ...g, pages: g.pages.filter((p) => !matching || matching.has(p)) })).filter((g) => g.pages.length > 0);
  const repos = hits ? repoHits : projects;
  return (
    <div
      ref={root}
      className="settings"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      tabIndex={-1}
      onKeyDown={trapTab}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{ outline: "none" }}
    >
      <div className="settings-panel">
        <nav className="settings-nav" aria-label="Settings pages">
          <div className="settings-nav-head">
            <div className="settings-title">Settings</div>
            <input
              ref={box}
              className="field settings-search"
              type="search"
              aria-label="Search settings"
              placeholder="Search settings"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) {
                  e.stopPropagation();
                  setQuery("");
                }
              }}
            />
          </div>
          <div className="settings-rail">
            {rail.map((g) => (
              <div key={g.title} className="settings-block">
                <div className="settings-group">{g.title}</div>
                {g.pages.map((p) => {
                  const Glyph = PAGE_ICON[p];
                  return (
                    <button key={p} className="settings-link" aria-current={!hits && page === p ? "page" : undefined} onClick={() => go(p)}>
                      <Glyph size={14} />
                      <span>{PAGES[p]}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            {(repos.length > 0 || (!hits && projectsError)) && <div className="settings-group">Repositories</div>}
            {repos.map((p) => (
              <button key={p.id} className="settings-link repo" aria-current={!hits && page === `repo:${p.id}` ? "page" : undefined} onClick={() => go(`repo:${p.id}`)}>
                <FolderPlus size={14} />
                <span>{p.name}</span>
              </button>
            ))}
            {!hits && projectsError && (
              <p className="conn-detail warn" role="alert" style={{ padding: "0 9px" }}>
                The repositories could not be listed: {projectsError}{" "}
                <button className="btn" onClick={() => setTries((n) => n + 1)}>
                  Try again
                </button>
              </p>
            )}
          </div>
          <div className="settings-rail-foot">Settings save as you change them.</div>
        </nav>
        <main className="settings-main">
          <div className="settings-main-inner">
            <header className="settings-head">
              <h1>{hits ? "Search" : title}</h1>
              <button className="ib" title="Close Settings (Esc)" aria-label="Close Settings" onClick={onClose}>
                ×
              </button>
            </header>
            {hits ? (
              <SearchFolds.Provider value={folds}>
                <style>{hideRule(hits)}</style>
                {hits.refused && <p className="conn-detail warn">That search is too long: {MAX_SEARCH} characters at most.</p>}
                {!hits.refused && hits.pages.length === 0 && repoHits.length === 0 && <p className="conn-detail">No setting matches.</p>}
                {hits.pages.map((h) => (
                  <div key={h.page} className="settings-found" data-page={h.page}>
                    <h2 className="settings-found-title">{PAGES[h.page]}</h2>
                    <Suspense fallback={null}>
                      <PageBody page={h.page} onSaved={saved} active={active} />
                    </Suspense>
                  </div>
                ))}
                {repoHits.length <= MAX_REPOS_DRAWN ? repoHits.map((p) => <RepoPage key={p.id} project={p} onSaved={saved} />) : <p className="conn-detail">{repoHits.length} repositories match; pick one on the left.</p>}
              </SearchFolds.Provider>
            ) : (
              <Suspense fallback={null}>
                <PageBody page={page} repo={repo} onSaved={saved} active={active} />
              </Suspense>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
