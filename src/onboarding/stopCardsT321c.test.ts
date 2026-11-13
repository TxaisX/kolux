// ONB-024 (T-321-c): the usage stop's connected accounts and the orchestration skill card, as pure rules.
import { describe, expect, it } from "vitest";
import { claudeVia, codexVia, ONBOARDING_TERMINAL_HEIGHT, skillCard, stopCard, STOP_SKILLS, usageCard } from "./stopCards";

const none = { claude: { accounts: [], keyMode: false }, codex: { accounts: [], systemDefault: "signed-out" }, claudeLimits: [] as unknown[] };

describe("the usage stop counts agents as connected (ONB-024)", () => {
  it("Claude: a managed account, the 1-year key, or rate-limit data from Claude Code's own sign-in", () => {
    expect(claudeVia({ accounts: [{}], keyMode: false }, [])).toEqual({ connected: true, via: "accounts" });
    expect(claudeVia({ accounts: [], keyMode: true }, [])).toEqual({ connected: true, via: "key" });
    expect(claudeVia({ accounts: [], keyMode: false }, [{ usedPercent: 3 }])).toEqual({ connected: true, via: "default" });
    expect(claudeVia({ accounts: [], keyMode: false }, [])).toEqual({ connected: false, via: "none" });
  });
  it("Claude: unknown until the account list has answered, and while its limits are still being read", () => {
    expect(claudeVia(null, [])).toMatchObject({ connected: null });
    expect(claudeVia({ accounts: [], keyMode: false }, null)).toMatchObject({ connected: null });
    // an account is enough even if the limits never arrive
    expect(claudeVia({ accounts: [{}], keyMode: false }, null)).toMatchObject({ connected: true });
  });
  it("Codex signed in outside Kolux counts as connected; a key, a custom provider or signed out does not", () => {
    expect(codexVia({ accounts: [], systemDefault: "chatgpt" })).toEqual({ connected: true, via: "default" });
    expect(codexVia({ accounts: [{}], systemDefault: "signed-out" })).toEqual({ connected: true, via: "accounts" });
    for (const d of ["api-key", "custom-provider", "signed-out"]) expect(codexVia({ accounts: [], systemDefault: d })).toEqual({ connected: false, via: "none" });
    expect(codexVia(null)).toMatchObject({ connected: null });
  });
  it("the card lists Claude then Codex and sums them up: any connected, none, or still reading", () => {
    expect(stopCard("usage", { taskSource: null, settings: null, usage: { ...none, codex: { accounts: [], systemDefault: "chatgpt" } } })).toMatchObject({
      kind: "usage",
      anyConnected: true,
      rows: [
        { agent: "claude", connected: false },
        { agent: "codex", connected: true, via: "default" },
      ],
    });
    expect(usageCard(none)).toMatchObject({ anyConnected: false });
    expect(usageCard(null)).toMatchObject({ anyConnected: null, rows: [{ connected: null }, { connected: null }] });
    expect(usageCard({ ...none, codex: null })).toMatchObject({ anyConnected: null });
  });
  it("the usage card needs no saved settings", () => {
    expect(stopCard("usage", { taskSource: null, settings: null, usage: none })).not.toBeNull();
  });
});

describe("the orchestration stop shows a skill setup card (ONB-024)", () => {
  it("the orchestration stop names its own skill", () => {
    expect(STOP_SKILLS.orchestration.skill).toBe("orchestration");
    expect(skillCard("orchestration", [])).toMatchObject({ kind: "skill", skill: { skill: "orchestration", ready: false } });
    expect(skillCard("orchestration", ["kolux-cli", "orchestration"])).toMatchObject({ skill: { skill: "orchestration", ready: true } });
  });
  it("a skill found in an agent's own folder is ready; another skill does not make it ready; unknown while scanning", () => {
    expect(skillCard("orchestration", ["kolux-cli"])).toMatchObject({ skill: { ready: false } });
    expect(skillCard("orchestration", null)).toMatchObject({ skill: { ready: null } });
    expect(skillCard("orchestration", undefined)).toMatchObject({ skill: { ready: null } });
  });
  it("stopCard returns the skill card without saved settings, and null for stops with no card", () => {
    expect(stopCard("orchestration", { taskSource: null, settings: null, homeSkills: [] })).toMatchObject({ kind: "skill" });
    expect(stopCard("orchestration", { taskSource: null, settings: null })).toMatchObject({ kind: "skill", skill: { ready: null } });
    expect(stopCard("workspaces", { taskSource: null, settings: {} })).toBeNull();
    expect(skillCard("statuses", [])).toBeNull();
  });
  it("the setup terminal is shorter inside onboarding than the tour's default", () => {
    expect(ONBOARDING_TERMINAL_HEIGHT).toBeLessThan(220);
  });
});
