import { describe, expect, it } from "vitest";
import { PAGES } from "./pages";
import { hideRule, INDEX, MAX_SEARCH, searchRepos, searchSettings } from "./search";

// Where each page draws its sections (SettingsPage wraps the pages that have no sections of their own).
const SOURCES: Record<string, string[]> = {
  general: ["GeneralPage.tsx", "CliCard.tsx"],
  appearance: ["AppearancePage.tsx", "CustomThemeEditor.tsx"],
  accounts: ["SettingsPage.tsx", "ConnectGrid.tsx", "AgentCredentials.tsx"],
  agents: ["AgentsPage.tsx"],
  terminal: ["TerminalPage.tsx", "InputCards.tsx", "TerminalImport.tsx"],
  git: ["GitPage.tsx", "AiRecipesSection.tsx", "SetupPolicyRow.tsx", "autoPr.tsx"],
  safety: ["SafetyPage.tsx", "SafetyRules.tsx"],
  notifications: ["NotificationsPage.tsx", "SettingsPage.tsx"],
  shortcuts: ["ShortcutsPage.tsx"],
  usage: ["SettingsPage.tsx"],
  claude: ["ClaudeSetupPage.tsx"],
};
const FILES = import.meta.glob("./*.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
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
  it("every Appearance entry names the Fold its section is drawn in, or a search hit shows nothing (UX-audit)", () => {
    const page = read("AppearancePage.tsx");
    const folds = [...page.matchAll(/<Fold id="([\w-]+)"[\s\S]*?<\/Fold>/g)].map((m) => ({ id: m[1], from: m.index!, to: m.index! + m[0].length }));
    const foldAt = (pos: number) => folds.find((f) => pos >= f.from && pos < f.to)?.id;
    // AppearanceView takes these two as props and puts them inside the Interface and Window folds
    const slot: Record<string, string> = { LanguageView: "interface", WindowSwitches: "window" };
    const foldOf = (section: string): string | undefined => {
      for (const file of ["AppearancePage.tsx", "CustomThemeEditor.tsx"]) {
        const src = read(file);
        const at = src.indexOf(`data-section="${section}"`);
        if (at < 0) continue;
        const direct = file === "AppearancePage.tsx" ? foldAt(at) : undefined;
        if (direct) return direct;
        // drawn by a component of its own: the fold is where that component is used
        const fn = [...src.slice(0, at).matchAll(/^(?:export )?(?:default )?function (\w+)/gm)].pop()?.[1];
        if (!fn) return undefined;
        return slot[fn] ?? foldAt(page.indexOf(`<${fn} `));
      }
      return undefined;
    };
    const appearance = INDEX.filter((e) => e.page === "appearance");
    expect(appearance.length).toBeGreaterThan(10);
    for (const e of appearance) expect(e.fold, `appearance/${e.section}`).toBe(foldOf(e.section));
  });
  it("finds font in Appearance, inside the fold that holds it, and the terminal font (SET 022)", () => {
    const h = searchSettings("font")!;
    expect(h.pages).toEqual([
      { page: "appearance", sections: ["fonts", "terminal-font"] },
      { page: "terminal", sections: ["text"] },
    ]);
    expect([...h.folds]).toEqual(["interface", "terminal"]);
  });
  it("finds Ask before closing running terminals by confirm, close or agent (SET 043)", () => {
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
    expect(hideRule(searchSettings("sound")!)).toBe('.settings-found[data-page="notifications"] [data-section]:not([data-section="beneath-master"]):not([data-section="sound"]) { display: none !important; }');
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
    expect(searchSettings("advanced")!.pages.find((p) => p.page === "accounts")?.sections).toEqual(["accounts-advanced", "accounts-claude", "accounts-codex", "agent-folders", "provider-usage", "minimax", "gemini"]);
    expect(searchSettings("")).toBeNull();
    expect(searchSettings("accounts keys")!.pages[0]).toEqual({ page: "accounts", sections: "all" });
    expect(hideRule(searchSettings("accounts keys")!)).toBe("");
  });
  it("finds the Protected actions section on the Safety page by its everyday words (SAFE-015)", () => {
    for (const q of ["protected", "force push", "stripe", "terraform", "rule"]) expect(searchSettings(q)!.pages.find((p) => p.page === "safety")?.sections, q).toContain("protected");
    expect(searchSettings("safety")!.pages[0]).toEqual({ page: "safety", sections: "all" });
  });
  it("every section a page draws is indexed, so a search can find it and never hides it (UX-audit)", () => {
    // The Claude page also draws cards from a list (data-section={id}); its fixed ones are checked here. Repo pages are not searched pages.
    const drawn: Record<string, string[]> = {
      general: ["GeneralPage.tsx", "CliCard.tsx"],
      appearance: ["AppearancePage.tsx", "CustomThemeEditor.tsx"],
      accounts: ["SettingsPage.tsx", "AgentCredentials.tsx"],
      agents: ["AgentsPage.tsx"],
      terminal: ["TerminalPage.tsx", "InputCards.tsx", "TerminalImport.tsx"],
      git: ["GitPage.tsx", "AiRecipesSection.tsx", "SetupPolicyRow.tsx", "autoPr.tsx"],
      safety: ["SafetyPage.tsx", "SafetyRules.tsx"],
      notifications: ["NotificationsPage.tsx"],
      shortcuts: ["ShortcutsPage.tsx"],
      claude: ["ClaudeSetupPage.tsx"],
    };
    // T-755: a page left out of this list fails (Usage is drawn by SettingsPage, checked below), and so does a
    // settings file that draws a section no list here reads (RepoPage and RepoSetup draw the repo pages, which are not searched).
    const read = new Set(Object.values(drawn).flat());
    const unread = Object.keys(FILES).map((f) => f.slice(2)).filter((f) => !f.startsWith("Repo") && !read.has(f) && /data-section="/.test(FILES[`./${f}`]));
    expect(unread, "these draw sections no page list reads").toEqual([]);
    expect(Object.keys(PAGES).filter((p) => p !== "usage" && !(p in drawn))).toEqual([]);
    const src = (f: string) => FILES[`./${f}`] ?? "";
    for (const [page, files] of Object.entries(drawn)) {
      const text = files.map(src).join("\n");
      expect(text.length, page).toBeGreaterThan(0);
      const sections = [...text.matchAll(/data-section="([a-z-]+)"/g)].map((m) => m[1]);
      expect(sections.length, page).toBeGreaterThan(0);
      const indexed = new Set(INDEX.filter((e) => e.page === page).map((e) => e.section));
      // SettingsPage also draws the usage and notifications sections, checked below.
      for (const s of sections.filter((x) => page !== "accounts" || !["activity", "tokens", "alerts"].includes(x))) expect(indexed.has(s), `${page}/${s} is drawn but not in the search index`).toBe(true);
    }
    // SettingsPage also draws the Activity/Tokens (usage) and Finished-and-stopped (notifications) sections.
    const settingsPage = src("SettingsPage.tsx");
    for (const [page, s] of [["usage", "activity"], ["usage", "tokens"], ["notifications", "alerts"]] as const) {
      expect(settingsPage).toContain(`data-section="${s}"`);
      expect(INDEX.some((e) => e.page === page && e.section === s), `${page}/${s}`).toBe(true);
    }
  });
});
