import { describe, expect, it } from "vitest";
import { hideRule, INDEX, MAX_SEARCH, searchRepos, searchSettings } from "./search";

// Where each page draws its sections (SettingsPage wraps the pages that have no sections of their own).
const SOURCES: Record<string, string[]> = {
  general: ["GeneralPage.tsx"],
  appearance: ["AppearancePage.tsx"],
  accounts: ["SettingsPage.tsx", "ConnectGrid.tsx", "AgentCredentials.tsx"],
  agents: ["AgentsPage.tsx"],
  terminal: ["TerminalPage.tsx", "InputCards.tsx"],
  git: ["GitPage.tsx", "AiRecipesSection.tsx"],
  safety: ["SafetyPage.tsx"],
  notifications: ["NotificationsPage.tsx", "SettingsPage.tsx"],
  shortcuts: ["ShortcutsPage.tsx"],
  usage: ["SettingsPage.tsx"],
};
const FILES = import.meta.glob(["./*Page.tsx", "./AiRecipesSection.tsx", "./InputCards.tsx", "./ConnectGrid.tsx", "./AgentCredentials.tsx"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const read = (f: string) => FILES[`./${f}`] ?? "";

describe("search all settings (SET-007)", () => {
  it("indexes only sections that are still drawn on their page", () => {
    for (const e of INDEX) {
      const src = SOURCES[e.page].map(read).join("\n");
      // the three connection slots are drawn from one template (ConnectGrid)
      const drawn = e.section.startsWith("connect-") ? "data-section={`connect-${c.id}`}" : `data-section="${e.section}"`;
      expect(src, `${e.page}/${e.section}`).toContain(drawn);
    }
  });
  it("finds font in Appearance, inside the fold that holds it, and the terminal font (SET 022)", () => {
    const h = searchSettings("font")!;
    expect(h.pages).toEqual([
      { page: "appearance", sections: ["fonts"] },
      { page: "terminal", sections: ["text"] },
    ]);
    expect([...h.folds]).toEqual(["interface"]);
  });
  it("finds Ask Before Closing Running Terminals by confirm, close or agent (SET 043)", () => {
    for (const q of ["confirm", "close", "agent"]) expect(searchSettings(q)!.pages.find((p) => p.page === "terminal")?.sections, q).toContain("closing");
  });
  it("ranks the page whose title matches first, then the rest in page order", () => {
    const h = searchSettings("shortcuts")!;
    expect(h.pages[0]).toEqual({ page: "shortcuts", sections: "all" });
    expect(searchSettings("terminal")!.pages.map((p) => p.page)).toEqual(["terminal", "appearance", "shortcuts"]);
  });
  it("finds agents by name or id, and languages by their own names", () => {
    expect(searchSettings("devin")!.pages).toEqual([{ page: "agents", sections: ["agents"] }]);
    expect(searchSettings("日本語")!.pages).toEqual([{ page: "appearance", sections: ["language"] }]);
  });
  it("refuses an over-long search before trimming, even a run of spaces", () => {
    expect(searchSettings(" ".repeat(MAX_SEARCH + 1))!.refused).toBe(true);
    expect(searchSettings("   ")).toBeNull();
    expect(searchSettings("zzzz")!.pages).toEqual([]);
  });
  it("finds repositories by name or folder and hides the sections without a match", () => {
    const ps = [{ name: "kolux", path: "G:/Dev/kolux" }, { name: "site", path: "G:/Web/site" }];
    expect(searchRepos("web", ps).map((p) => p.name)).toEqual(["site"]);
    expect(hideRule(searchSettings("sound")!)).toBe('.settings-found[data-page="notifications"] [data-section]:not([data-section="sound"]) { display: none !important; }');
  });
  it("ACCT-030: a provider word leaves only that provider's card and accounts on the accounts page", () => {
    const sections = (q: string) => searchSettings(q)!.pages.find((p) => p.page === "accounts")?.sections;
    expect(sections("codex")).toEqual(["connections", "connect-codex", "accounts-advanced", "accounts-codex"]);
    expect(sections("anthropic")).toEqual(["connections", "connect-claude", "accounts-advanced", "accounts-claude"]);
    expect(sections("grok")).toEqual(["connections", "connect-grok"]);
    expect(sections("minimax")).toEqual(["accounts-advanced", "agent-folders", "minimax"]);
    expect(sections("gemini")).toEqual(["accounts-advanced", "agent-folders", "gemini"]);
    expect(hideRule(searchSettings("grok")!)).toContain('[data-section]:not([data-section="connections"]):not([data-section="connect-grok"]) { display: none !important; }');
  });
  it("ACCT-030: a word of the wrapper keeps everything inside it; clearing the search or naming the page shows it all", () => {
    expect(searchSettings("connections")!.pages.find((p) => p.page === "accounts")?.sections).toEqual(["connections", "connect-claude", "connect-codex", "connect-grok"]);
    expect(searchSettings("advanced")!.pages.find((p) => p.page === "accounts")?.sections).toEqual(["accounts-advanced", "accounts-claude", "accounts-codex", "agent-folders", "minimax", "gemini"]);
    expect(searchSettings("")).toBeNull();
    expect(searchSettings("accounts keys")!.pages[0]).toEqual({ page: "accounts", sections: "all" });
    expect(hideRule(searchSettings("accounts keys")!)).toBe("");
  });
  it("finds the Protected actions section on the Safety page by its everyday words (SAFE-015)", () => {
    for (const q of ["protected", "force push", "stripe", "terraform", "rule"]) expect(searchSettings(q)!.pages.find((p) => p.page === "safety")?.sections, q).toEqual(["protected"]);
    expect(searchSettings("safety")!.pages[0]).toEqual({ page: "safety", sections: "all" });
  });
});
