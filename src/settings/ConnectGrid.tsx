// ACCT-001 / ACCT-003: the AI connections page shows Claude, Codex and Grok in a grid, each with a
// one-line tagline. Until detection answers, a card is a loading placeholder and never claims an
// agent is missing. A missing agent gets Install (WinGet, with progress and Cancel) or, where Kolux
// cannot install it, "Open install page"; once it is in, the card moves on to its own sign-in with
// no restart. Each card's sign-in then walks one state at a time (ACCT-002); OtherWays is the
// "Other ways to connect" menu every card shares.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { clearReadFailure, readFailed } from "../onboarding/firstRun";
import { emit, listen } from "@tauri-apps/api/event";
import VendorMark from "../chrome/VendorMark";
import { AttentionNote, CHECK_AGAIN, openInstallPage, type Attention } from "./Attention";
import type { AgentInfo } from "../launch/PlusMenu";
import { watchEscape } from "../switcher/accounts";

export type ConnectId = "claude" | "codex" | "grok";
export const CONNECT: { id: ConnectId; name: string; tagline: string }[] = [
  { id: "claude", name: "Claude", tagline: "Anthropic's coding agent, on your Claude Pro or Max plan." },
  { id: "codex", name: "Codex", tagline: "OpenAI's coding agent, on your ChatGPT plan." },
  { id: "grok", name: "Grok", tagline: "xAI's coding agent, on your Grok sign-in or an xAI key." },
];
export const taglineOf = (id: ConnectId): string => CONNECT.find((c) => c.id === id)!.tagline;
export type Way = { label: string; onPick: () => void; disabled?: boolean };

/** ACCT-002: an agent's other sign-in methods, behind one small menu next to Connect. */
/** A small menu of choices; a connected card's Manage uses the same menu (ACCT-015).
 *  T-712 (DT-C148): it closes on a pick, on Escape (focus back on the summary) and on a click outside it, like HandOff. */
export function OtherWays({ ways, label = "Other ways to connect" }: { ways: Way[]; label?: string }) {
  const box = useRef<HTMLDetailsElement>(null);
  const head = useRef<HTMLElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const shown = isOpen && ways.length > 0; // an emptied menu unmounts without a toggle
  useEffect(() => {
    if (!shown) return;
    const shut = () => box.current?.removeAttribute("open");
    const onDown = (e: Event) => box.current?.contains(e.target as Node) || shut();
    // Capture phase and stopped, so the Escape that closes the menu does not also close Settings.
    const offEsc = watchEscape(document, () => {
      shut();
      head.current?.focus();
    });
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      offEsc();
    };
  }, [shown]);
  if (ways.length === 0) return null;
  return (
    <details className="conn-more" ref={box} onToggle={(e) => setIsOpen(e.currentTarget.hasAttribute("open"))}>
      <summary className="btn link" ref={head}>
        {label}
      </summary>
      <div className="conn-more-list" role="menu">
        {ways.map((w) => (
          <button
            key={w.label}
            role="menuitem"
            className="btn"
            disabled={w.disabled}
            onClick={() => {
              box.current?.removeAttribute("open");
              head.current?.focus(); // before the pick, so a flow that takes focus still gets it
              w.onPick();
            }}
          >
            {w.label}
          </button>
        ))}
      </div>
    </details>
  );
}
export type InstallView = { running: boolean; progress: number | null; attention: Attention | null };
export type Stage = "loading" | "not-installed" | "installing" | "installed";

/** Where a card is before its own sign-in takes over. `agents` is null until detection answers. */
export function stageOf(id: ConnectId, agents: AgentInfo[] | null, install?: InstallView): Stage {
  if (install?.running) return "installing";
  if (!agents) return "loading";
  return agents.find((a) => a.id === id)?.installed ? "installed" : "not-installed";
}

type SlotProps = {
  id: ConnectId;
  stage: Stage;
  install?: InstallView;
  /** Kolux can install it here (WinGet is on the PC); otherwise the card offers the install page. */
  canInstall: boolean;
  onInstall: () => void;
  onCancel: () => void;
  onPage: () => void;
};

/** The card for an agent that is still loading, missing or installing. */
export function InstallCardView({ id, stage, install, canInstall, onInstall, onCancel, onPage }: SlotProps) {
  const info = CONNECT.find((c) => c.id === id)!;
  if (stage === "loading") {
    return (
      <section className="conn-card conn-loading" aria-label={info.name} aria-busy="true" data-state="loading">
        <header className="conn-head">
          {id !== "grok" && <VendorMark agent={id} size={18} />}
          <span className="conn-name">{info.name}</span>
        </header>
        <p className="conn-detail">{info.tagline}</p>
        <div className="conn-skeleton" />
        <p className="conn-detail">Checking this PC…</p>
      </section>
    );
  }
  const busy = stage === "installing";
  return (
    <section className="conn-card" aria-label={info.name} data-state={busy ? "installing" : "not-installed"}>
      <header className="conn-head">
        {id !== "grok" && <VendorMark agent={id} size={18} />}
        <span className="conn-name">{info.name}</span>
        <span className={`conn-chip ${busy ? "connecting" : "disconnected"}`}>{busy ? "Installing" : "Not installed"}</span>
      </header>
      <p className="conn-detail">{info.tagline}</p>
      <div className="conn-headline">{busy ? `Installing ${info.name}…` : `${info.name} is not on this PC yet`}</div>
      {busy && (
        <div className="conn-progress" role="progressbar" aria-label={`Installing ${info.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={install?.progress ?? undefined}>
          <div className="conn-progress-bar" data-known={install?.progress != null} style={{ width: install?.progress != null ? `${install.progress}%` : undefined }} />
        </div>
      )}
      {busy && <p className="conn-detail">{install?.progress != null ? `${install.progress}% · through the Windows package manager` : "Starting the Windows package manager…"}</p>}
      {!busy && <AttentionNote attention={install?.attention ?? null} route="install" onFix={(f) => (f === "Open install page" ? onPage() : onInstall())} />}
      <div className="btn-row">
        {busy ? (
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          !install?.attention &&
          (canInstall ? (
            <button className="btn primary" onClick={onInstall}>
              Install
            </button>
          ) : (
            <button className="btn primary" onClick={onPage}>
              Open install page
            </button>
          ))
        )}
      </div>
    </section>
  );
}

type Win = { addEventListener: (k: string, f: () => void) => void; removeEventListener: (k: string, f: () => void) => void; setInterval: (f: () => void, ms: number) => number; clearInterval: (id: number) => void };

/** True the first time `id` is claimed and false until it is released: the guard against a double press. */
export const claimInstall = (held: Set<string>, id: string): boolean => (held.has(id) ? false : (held.add(id), true));

/** ACCT-014: runs `check` when the window gets focus back, when a card's Check again is pressed,
 *  and every `every` ms while the window is visible (0: no timer, as for the account cards, whose
 *  own check would start a program per account); the returned function stops all of them. */
export function liveCheck(check: () => void, win: Win = window, doc: { visibilityState: string } = document, every = 5000): () => void {
  win.addEventListener("focus", check);
  win.addEventListener(CHECK_AGAIN, check);
  const t = every > 0 ? win.setInterval(() => doc.visibilityState === "visible" && check(), every) : null;
  return () => {
    win.removeEventListener("focus", check);
    win.removeEventListener(CHECK_AGAIN, check);
    if (t !== null) win.clearInterval(t);
  };
}

/** Reads detection and install state for the grid; `cards` holds each agent's own card, shown once it is in. */
export function ConnectGrid({ cards }: { cards: Record<ConnectId, ReactNode> }) {
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [installs, setInstalls] = useState<Record<string, InstallView>>({});
  const [can, setCan] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  // ACCT-014: a changed result goes to every open window, so the whole app sees an agent that
  // was installed or removed outside Kolux.
  const last = useRef("");
  const readAgents = useCallback(
    () =>
      void invoke<AgentInfo[]>("agent_list")
        .then((list) => {
          setAgents(list);
          setError(clearReadFailure);
          const seen = JSON.stringify(list);
          if (last.current && seen !== last.current) void emit("agents-changed", list).catch(() => {});
          last.current = seen;
        })
        .catch(() => setError(readFailed)),
    [],
  );
  const readInstalls = useCallback(() => void invoke<Record<string, InstallView>>("agent_installs").then(setInstalls).catch(() => {}), []);
  useEffect(() => {
    readAgents();
    readInstalls();
    for (const c of CONNECT) void invoke<boolean>("agent_can_install", { agent: c.id }).then((v) => setCan((m) => ({ ...m, [c.id]: v }))).catch(() => {});
    // SESS-002: the window searches once and sends the list; this takes it rather than searching again.
    const offs = [listen<AgentInfo[] | null>("agents-changed", (e) => Array.isArray(e.payload) && (setAgents(e.payload), (last.current = JSON.stringify(e.payload)))), listen("agent-install", readInstalls)];
    const stop = liveCheck(() => (readAgents(), readInstalls()));
    return () => (stop(), offs.forEach((o) => void o.then((u) => u()).catch(() => {})));
  }, [readAgents, readInstalls]);
  // A second press of Install while the first is still starting would start two installs.
  const starting = useRef(new Set<string>());
  const run = (p: Promise<unknown>, once?: string) => {
    setError(null);
    p.catch((e) => setError(String(e))).finally(() => (once && starting.current.delete(once), readInstalls()));
  };
  const install = (id: string) => {
    if (!claimInstall(starting.current, id)) return;
    run(invoke("agent_install", { agent: id }), id);
  };
  return (
    <>
      <div className="conn-grid">
        {CONNECT.map((c) => {
          const stage = stageOf(c.id, agents, installs[c.id]);
          return stage === "installed" ? (
            <div key={c.id} className="conn-slot" data-section={`connect-${c.id}`}>
              {cards[c.id]}
            </div>
          ) : (
            <div key={c.id} className="conn-slot" data-section={`connect-${c.id}`}>
              <InstallCardView
                id={c.id}
                stage={stage}
                install={installs[c.id]}
                canInstall={can[c.id] ?? false}
                onInstall={() => install(c.id)}
                onCancel={() => run(invoke("agent_install_cancel", { agent: c.id }))}
                onPage={() => run(openInstallPage(c.id))}
              />
            </div>
          );
        })}
      </div>
      {error && (
        <p className="conn-detail warn" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
