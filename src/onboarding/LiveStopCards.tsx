// ONB-024 (T-321-c): the two Explore Kolux stop cards that read live facts. Usage lists which agents are
// connected (managed accounts, the Claude key, or an agent's own default sign-in); the orchestration and
// browser stops show the skill they need, and its installer command, which a small inline terminal types
// without running. The rules are in stopCards.ts; nothing here runs an installer.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import InlineTerminal from "./InlineTerminal";
import { openSettings } from "../settings/pages";
import { ONBOARDING_TERMINAL_HEIGHT, stopCard, type ClaudeFacts, type CodexFacts, type UsageFacts, type Via } from "./stopCards";

const VIA_WORDS: Record<Via, string> = {
  accounts: "through an account added in Kolux",
  key: "through the Claude key",
  default: "through its own sign-in",
  none: "",
};

export function UsageStop() {
  const [facts, setFacts] = useState<UsageFacts>({ claude: null, codex: null, claudeLimits: null });
  useEffect(() => {
    let live = true;
    const read = () => {
      invoke<ClaudeFacts>("claude_accounts").then((v) => live && setFacts((f) => ({ ...f, claude: v })), () => {});
      invoke<CodexFacts>("codex_accounts").then((v) => live && setFacts((f) => ({ ...f, codex: v })), () => {});
      // A failed read of the stored limits counts as none reported, not as "still reading".
      invoke<unknown[]>("claude_usage").then((v) => live && setFacts((f) => ({ ...f, claudeLimits: v })), () => live && setFacts((f) => ({ ...f, claudeLimits: [] })));
    };
    read();
    const offs = [listen("claude-accounts", read), listen("codex-accounts", read)];
    return () => {
      live = false;
      offs.forEach((o) => void o.then((u) => u()).catch(() => {}));
    };
  }, []);
  const card = stopCard("usage", { taskSource: null, settings: null, usage: facts });
  if (card?.kind !== "usage") return null;
  return (
    <div data-card="usage">
      <ul className="guide-caps">
        {card.rows.map((r) => (
          <li key={r.agent} data-agent={r.agent} data-connected={r.connected}>
            <span className="name">{r.label}</span>{" "}
            <span className={`state${r.connected ? " ok" : ""}`}>{r.connected === null ? "Checking..." : r.connected ? "Connected" : "Not connected"}</span>
            {r.connected && r.via !== "none" && <span className="about"> {VIA_WORDS[r.via]}</span>}
          </li>
        ))}
      </ul>
      {card.anyConnected === false && <p className="guide-note">
          Add an account, and its usage shows here.{" "}
          <button className="btn" onClick={() => openSettings("accounts")}>
            Open Settings &gt; Accounts
          </button>
        </p>}
    </div>
  );
}

type Scan = { skills: { name: string; source: string }[] };

export function SkillStop({ stop }: { stop: string }) {
  const [home, setHome] = useState<string[] | null>(null);
  const [n, setN] = useState(0);
  const [line, setLine] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    invoke<Scan>("skills_scan", { workspace: null, refresh: n > 0 }).then(
      (s) => live && setHome(s.skills.filter((k) => k.source === "home").map((k) => k.name)),
      () => live && setHome([]),
    );
    return () => void (live = false);
  }, [n]);
  const card = stopCard(stop, { taskSource: null, settings: null, homeSkills: home });
  if (card?.kind !== "skill") return null;
  const s = card.skill;
  const show = () =>
    invoke<string>("skills_install_command", { names: [s.skill] }).then(
      (l) => (setNote(null), setLine(l)),
      (e) => setNote(String(e)),
    );
  const copy = () => navigator.clipboard.writeText(line ?? "").then(() => setNote("Command copied"), () => setNote("Could not copy; select the command above and copy it yourself"));
  return (
    <div data-card="skill" data-skill={s.skill} data-ready={s.ready}>
      <p className="guide-note">
        <span className="name">{s.label}</span>{" "}
        <span className={`state${s.ready ? " ok" : ""}`}>{s.ready === null ? "Checking..." : s.ready ? "Ready" : "Not set up"}</span>
        <span className="about"> {s.about}</span>
      </p>
      {s.ready === false && (
        <>
          {line && <code className="skills-cmd">{line}</code>}
          {line && typing && <InlineTerminal command={line} height={ONBOARDING_TERMINAL_HEIGHT} onExit={() => setN((x) => x + 1)} />}
          <div className="btn-row">
            {!line && (
              <button className="btn" onClick={() => void show()}>
                Show setup command
              </button>
            )}
            {line && !typing && (
              <button className="btn" onClick={() => setTyping(true)}>
                Type in terminal
              </button>
            )}
            {line && (
              <button className="btn" onClick={() => void copy()}>
                Copy command
              </button>
            )}
            <button className="btn" onClick={() => setN((x) => x + 1)}>
              Re-check
            </button>
          </div>
        </>
      )}
      {note && (
        <p className="guide-note dim" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
