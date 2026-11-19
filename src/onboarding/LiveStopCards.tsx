// ONB-024 (T-321-c): the Explore Kolux stop card that reads live facts. Usage lists which agents are
// connected (managed accounts, the Claude key, or an agent's own default sign-in). The rules are in
// stopCards.ts. (The orchestration stop's skill card and its installer command went with the skills
// installer, slim-down wave B.)
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openSettings } from "../settings/pages";
import { stopCard, type ClaudeFacts, type CodexFacts, type UsageFacts, type Via } from "./stopCards";

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
