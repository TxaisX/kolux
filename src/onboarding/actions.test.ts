import { describe, expect, it } from "vitest";
import type { Place } from "./guide";
import { SOUNDS } from "../settings/notifications";
import {
  ADD_PROJECT,
  agentPanel,
  composeTarget,
  composerRequests,
  foldLabel,
  guideOpenChanged,
  permissionCard,
  plusFor,
  soundPanel,
  type Hands,
  type Proj,
} from "./actions";

const proj = (id: string): Proj => ({ id, name: id, path: `C:\\work\\${id}` });
const list = (...paths: string[]): Place[] => paths.map((path, i) => ({ path, head: "abc", isMain: i === 0 }));

describe("Multi-task picks the project for a new workspace (ONB-016)", () => {
  it("only a non-git folder added: it asks for a git project first", () => {
    expect(composeTarget([proj("notes")], [null], null)).toEqual({ kind: "ask" });
    expect(composeTarget([], [], null)).toEqual({ kind: "ask" });
  });
  it("uses the active git project, failing that the first git project, and skips folders without git", () => {
    const ps = [proj("plain"), proj("a"), proj("b")];
    const lists = [null, list("C:\\work\\a"), list("C:\\work\\b", "C:\\work\\b-ws")];
    expect(composeTarget(ps, lists, "C:\\work\\b-ws")).toEqual({ kind: "project", project: ps[2] });
    expect(composeTarget(ps, lists, "c:/work/B-WS/")).toEqual({ kind: "project", project: ps[2] });
    expect(composeTarget(ps, lists, null)).toEqual({ kind: "project", project: ps[1] });
    // the active workspace belongs to a non-git folder: it never qualifies, so the first git project is used
    expect(composeTarget(ps, lists, "C:\\work\\plain")).toEqual({ kind: "project", project: ps[1] });
  });
  it("shows the project's folder row (found by its path), then presses New session", () => {
    expect(plusFor(proj("a"))).toEqual(['.proj[title="C:\\\\work\\\\a"]', "button.sb-new"]);
  });
});

describe("the composer request (ONB-016)", () => {
  const fake = (over: Partial<Hands> = {}) => {
    const clicks: string[] = [];
    const hands: Hands = { click: (s) => (clicks.push(s), true), onScreen: () => true, wait: async () => {}, ...over };
    return { clicks, hands };
  };
  it("opens the composer on the chosen project", async () => {
    const { clicks, hands } = fake();
    const r = composerRequests(hands);
    expect(await r.open({ kind: "project", project: proj("a") })).toBe("opened");
    expect(clicks).toEqual([...plusFor(proj("a"))]);
  });
  it("with no git project it opens the Add project form instead", async () => {
    const { clicks, hands } = fake();
    expect(await composerRequests(hands).open({ kind: "ask" })).toBe("asked");
    expect(clicks).toEqual([ADD_PROJECT]);
  });
  it("a request left over from before a close and reopen is ignored", async () => {
    const { clicks, hands } = fake({ onScreen: () => false });
    const r = composerRequests({
      ...hands,
      wait: async () => {
        r.reset(); // the guide was closed and opened again while the request waited
      },
    });
    expect(await r.open({ kind: "project", project: proj("a") })).toBe("stale");
    expect(clicks).toEqual([]);
  });
  it("the Create a workspace step closing the guide does not void its own request, so a retry still opens the composer (FIX-1)", async () => {
    let looks = 0;
    const { clicks, hands } = fake({ click: (s) => (looks++ >= 1 ? (clicks.push(s), true) : false) });
    const r = composerRequests({
      ...hands,
      wait: async () => {
        guideOpenChanged(r, false); // the guide has now finished closing: its effect runs between the tries
      },
    });
    // what the step does: void the older requests, close the guide, ask for the composer
    r.reset();
    expect(await r.open({ kind: "project", project: proj("a") })).toBe("opened");
    expect(clicks).toEqual([...plusFor(proj("a"))]);
  });
  it("the guide opening does void a request left from before a close and reopen", async () => {
    const { clicks, hands } = fake({ onScreen: () => false });
    const r = composerRequests({
      ...hands,
      wait: async () => {
        guideOpenChanged(r, true);
      },
    });
    expect(await r.open({ kind: "project", project: proj("a") })).toBe("stale");
    expect(clicks).toEqual([]);
  });
  it("retries fire only on the screen they expect, and give up after a few looks", async () => {
    let looks = 0;
    const { clicks, hands } = fake({ onScreen: () => ++looks >= 3 });
    expect(await composerRequests(hands).open({ kind: "project", project: proj("a") })).toBe("opened");
    expect(looks).toBe(3);
    expect(clicks).toHaveLength(2);
    const off = fake({ onScreen: () => false });
    expect(await composerRequests(off.hands).open({ kind: "project", project: proj("a") })).toBe("gone");
    expect(off.clicks).toEqual([]);
  });
  it("keeps looking while the button is not drawn yet", async () => {
    let n = 0;
    const { hands } = fake({ click: () => ++n >= 4 });
    expect(await composerRequests(hands).open({ kind: "project", project: proj("a") })).toBe("opened");
    expect(n).toBe(5); // three misses on the folder row, then the folder row and New session
  });
});

describe("the notifications step (ONB-016)", () => {
  it("offers the system sound and Kolux's tones; non-system sounds get no volume slider", () => {
    expect(soundPanel("system").choices.map((c) => c.id)).toEqual(SOUNDS.map((o) => o.id)); // the shared list (T-309 tones + custom since MERGE 167)
    expect(soundPanel("system").slider).toBe(true);
    expect(soundPanel("chime").slider).toBe(false);
    expect(soundPanel("pulse").slider).toBe(false);
  });
  it("has no per-source notification switches", () => {
    expect(Object.keys(soundPanel("system")).sort()).toEqual(["choices", "slider"]);
  });
  it("macOS permission card: hidden until the delivery check answers, then enabled, awaiting, dialog or blocked", () => {
    const card = (p: Parameters<typeof permissionCard>[0], d: Parameters<typeof permissionCard>[1], asked = false) => permissionCard(p, d, asked);
    expect(card("mac", null)).toEqual({ show: false });
    expect(card("mac", { shown: true, blocked: false })).toMatchObject({ show: true, state: "enabled" });
    expect(card("mac", { shown: false, blocked: false })).toMatchObject({ show: true, state: "awaiting" });
    expect(card("mac", { shown: false, blocked: true })).toMatchObject({ show: true, state: "dialog" });
    // denied earlier: a later refusal reads as blocked
    expect(card("mac", { shown: false, blocked: true }, true)).toMatchObject({ show: true, state: "blocked" });
  });
  it("macOS permission card: hidden where notifications are not supported and on other systems", () => {
    expect(permissionCard("mac", "unsupported", false)).toEqual({ show: false });
    expect(permissionCard("windows", { shown: false, blocked: true }, true)).toEqual({ show: false });
    expect(permissionCard("linux", { shown: true, blocked: false }, false)).toEqual({ show: false });
  });
});

describe("the default-agent step (ONB-016)", () => {
  const a = (id: string, installed = true) => ({ id, name: id, program: id, args: [], installed, path: null });
  it("shows a picker of the lead agents and folds the rest behind a toggle", () => {
    const p = agentPanel([a("aider"), a("claude"), a("codex"), a("gemini", false)], { defaultAgent: "" });
    expect(p.picker.map((x) => x.id)).toEqual(["claude", "codex"]);
    expect(p.fallback.map((x) => x.id)).toEqual(["aider"]);
    expect(p.current).toBe("");
  });
  it("leaves out an agent switched off on the Agents page", () => {
    const p = agentPanel([a("claude"), a("codex")], { defaultAgent: "codex", disabledAgents: ["claude"] });
    expect(p.picker.map((x) => x.id)).toEqual(["codex"]);
    expect(p.current).toBe("codex");
  });
  it("the fold-out label says show while folded and hide while open", () => {
    expect(foldLabel(false)).toBe("Show fallback agents");
    expect(foldLabel(true)).toBe("Hide fallback agents");
  });
});
