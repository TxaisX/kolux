import { describe, expect, it } from "vitest";
import type { Scan, Skill } from "../skills/skills";
import { applyPick, commandsFor, fileEntries, isDismissed, kindsFor, mergeNames, menuFor, rank, runsOnEnter, skillEntries, stepIndex, tierOf, triggerAt, wordOf, type Sources } from "./complete";

const skill = (name: string, source: Skill["source"], agents: Skill["agents"] = ["claude"], description: string | null = null): Skill => ({ name, description, updated: null, path: `/s/${name}`, source, agents, plugin: null });
const scan = (skills: Skill[]): Scan => ({ skills, roots: [] });
const src = (over: Partial<Sources> = {}): Sources => ({ agent: "claude", skills: { state: "ready", value: scan([]) }, files: { state: "idle" }, ...over });

describe("CHAT-019 triggers", () => {
  it("/ opens at the start of a line only", () => {
    expect(triggerAt("/comp", 5, "claude")).toEqual({ sign: "/", start: 0, end: 5, query: "comp" });
    expect(triggerAt("hello\n/co", 9, "claude")?.query).toBe("co");
    expect(triggerAt("say /comp", 9, "claude")).toBeNull();
    expect(triggerAt("/usr/bin", 8, "claude")).toBeNull();
  });
  it("@ opens after a space or at the start, with folders in the query", () => {
    expect(triggerAt("look at @src/ch", 15, "claude")).toEqual({ sign: "@", start: 8, end: 15, query: "src/ch" });
    expect(triggerAt("@a", 2, "codex")?.query).toBe("a");
    expect(triggerAt("mail me@host", 12, "claude")).toBeNull();
  });
  it("$ is a Codex-only skill sign", () => {
    expect(triggerAt("use $re", 7, "codex")?.query).toBe("re");
    expect(triggerAt("use $re", 7, "claude")).toBeNull();
  });
  it("nothing opens on a blank word or a caret outside the text", () => {
    expect(triggerAt("", 0, "claude")).toBeNull();
    expect(triggerAt("abc ", 4, "claude")).toBeNull();
    expect(triggerAt("/a", 9, "claude")).toBeNull();
  });
  it("the caret in the middle of a word uses the text before it", () => {
    expect(triggerAt("/compact now", 5, "claude")?.query).toBe("comp");
  });
  it("dismissing keeps the menu closed for that word only", () => {
    const text = "/com";
    const t = triggerAt(text, 4, "claude")!;
    const d = { start: t.start, word: wordOf(text, t) };
    expect(isDismissed(d, text, t)).toBe(true);
    const t2 = triggerAt("/comp", 5, "claude")!;
    expect(isDismissed(d, "/comp", t2)).toBe(false);
    expect(isDismissed(d, "x\n/com", triggerAt("x\n/com", 6, "claude")!)).toBe(false);
  });
  it("Claude lists skills under /, Codex under $", () => {
    expect(kindsFor({ sign: "/", start: 0, end: 1, query: "" }, "claude")).toEqual(["command", "skill"]);
    expect(kindsFor({ sign: "/", start: 0, end: 1, query: "" }, "codex")).toEqual(["command"]);
    expect(kindsFor({ sign: "$", start: 0, end: 1, query: "" }, "codex")).toEqual(["skill"]);
    expect(kindsFor({ sign: "@", start: 0, end: 1, query: "" }, "claude")).toEqual(["file"]);
  });
});

describe("CHAT-019 ranking", () => {
  const e = (name: string, description?: string) => ({ kind: "command" as const, name, insert: `/${name}`, description });
  it("exact first, then starts-with, then fuzzy, then description", () => {
    const list = [e("recompile", "x"), e("cost", "shows compact use"), e("co"), e("compact"), e("cmpt")];
    expect(rank(list, "co").map((x) => x.name)).toEqual(["co", "cost", "compact", "recompile"]);
    expect(rank([e("zzz", "uses co here"), e("xyz")], "co").map((x) => x.name)).toEqual(["zzz"]);
  });
  it("/comp lists the compact command first", () => {
    const names = rank(commandsFor("claude"), "comp").map((x) => x.name);
    expect(names[0]).toBe("compact");
  });
  it("tiers are 0 exact, 1 prefix, 2 fuzzy, 3 description, -1 none", () => {
    expect(tierOf(e("compact"), "compact")).toBe(0);
    expect(tierOf(e("compact"), "com")).toBe(1);
    expect(tierOf(e("compact"), "cpt")).toBe(2);
    expect(tierOf(e("other", "shrinks the context"), "context")).toBe(3);
    expect(tierOf(e("other"), "zzz")).toBe(-1);
  });
  it("a file matches by its own name before the folder path", () => {
    const files = fileEntries(["src/chat/MessageBox.tsx", "docs/messagebox-notes.md"]);
    expect(rank(files, "MessageBox.tsx")[0].name).toBe("src/chat/MessageBox.tsx");
    expect(rank(files, "src/ch").map((f) => f.name)).toEqual(["src/chat/MessageBox.tsx"]);
  });
  it("an empty query keeps the given order", () => {
    expect(rank(commandsFor("codex"), "").map((x) => x.name)[0]).toBe("agent");
  });
});

describe("CHAT-019 commands, skills and mentions", () => {
  it("each agent's built-in command list, and none for an agent with none", () => {
    expect(commandsFor("claude").length).toBeGreaterThan(10);
    expect(commandsFor("omp")).toEqual([]);
  });
  it("skills are grouped project, personal, built-in, plugin and use $ in Codex", () => {
    const skills = [skill("a", "workspace"), skill("b", "home"), skill("c", "bundled"), skill("d", "plugin"), skill("e", "home", ["codex"]), skill("f", "home", ["shared"])];
    expect(skillEntries(skills, "claude").map((s) => s.group)).toEqual(["Project", "Personal", "Built-in", "Plugin", "Personal"]);
    expect(skillEntries(skills, "codex").map((s) => s.insert)).toEqual(["$e", "$f"]);
    expect(skillEntries(skills, "omp")).toEqual([]);
  });
  it("a name that is a command and a skill is listed once and marked", () => {
    const all = [...commandsFor("claude"), ...skillEntries([skill("review", "home"), skill("mine", "home")], "claude")];
    const merged = mergeNames(all);
    expect(merged.filter((m) => m.name === "review")).toHaveLength(1);
    expect(merged.find((m) => m.name === "review")?.both).toBe(true);
    expect(merged.find((m) => m.name === "mine")?.both).toBeUndefined();
  });
  it("a file with a space in its name is quoted in the mention", () => {
    expect(fileEntries(["a b.txt", "c.txt"]).map((f) => f.insert)).toEqual(['@"a b.txt"', "@c.txt"]);
  });
});

describe("CHAT-019 menu states", () => {
  const t = (text: string, agent = "claude") => triggerAt(text, text.length, agent)!;
  it("commands stay pickable while skills load", () => {
    const m = menuFor(t("/comp"), src({ skills: { state: "loading" } }));
    expect(m.entries[0].name).toBe("compact");
    expect(m.notes).toEqual([{ text: "Loading skills…" }]);
  });
  it("a failed skill scan shows the error with Retry", () => {
    const m = menuFor(t("/"), src({ skills: { state: "error", error: "no access" } }));
    expect(m.notes[0].retry).toBe("skills");
    expect(m.entries.length).toBeGreaterThan(0);
  });
  it("a finished empty skill search says so, apart from loading", () => {
    const m = menuFor(t("$x", "codex"), src({ agent: "codex", skills: { state: "ready", value: scan([]) } }));
    expect(m.notes).toEqual([{ text: "No skills found." }]);
    expect(m.entries).toEqual([]);
  });
  it("@ lists matching files once they are loaded", () => {
    const m = menuFor(t("see @src/ch"), src({ files: { state: "ready", value: ["src/chat/MessageBox.tsx", "README.md"] } }));
    expect(m.entries.map((x) => x.name)).toEqual(["src/chat/MessageBox.tsx"]);
    expect(menuFor(t("see @"), src({ files: { state: "loading" } })).notes[0].text).toBe("Loading files…");
    expect(menuFor(t("see @"), src({ files: { state: "error", error: "x" } })).notes[0].retry).toBe("files");
  });
  it("the menu shows at most eight lines", () => {
    expect(menuFor(t("/"), src()).entries).toHaveLength(8);
  });
});

describe("CHAT-019 picking", () => {
  it("Tab puts the entry in place of the typed word", () => {
    const text = "see @src/ch and more";
    const trig = triggerAt(text, 11, "claude")!;
    const r = applyPick(text, trig, fileEntries(["src/chat/MessageBox.tsx"])[0]);
    expect(r.text).toBe("see @src/chat/MessageBox.tsx and more");
    expect(r.text.slice(0, r.caret)).toBe("see @src/chat/MessageBox.tsx ");
  });
  it("a space is added at the end of the text", () => {
    const trig = triggerAt("/comp", 5, "claude")!;
    expect(applyPick("/comp", trig, commandsFor("claude").find((c) => c.name === "compact")!).text).toBe("/compact ");
  });
  it("Enter runs commands and skills, not files", () => {
    expect(runsOnEnter(commandsFor("claude")[0])).toBe(true);
    expect(runsOnEnter(fileEntries(["a"])[0])).toBe(false);
  });
  it("the arrows wrap", () => {
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 0, 1)).toBe(0);
  });
});
