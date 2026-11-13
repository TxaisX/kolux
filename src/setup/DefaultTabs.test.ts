import { describe, expect, it } from "vitest";
import { defaultTabs, nearestTabColor, openDefaultTabs, tabPanes, tabTitle, type SharedTab } from "./DefaultTabs";
import type { Pane } from "../App";
import type { TabColors } from "../terminal/tabColor";
import type { TrustAnswer, TrustAsk } from "./TrustPrompt";

const tab = (title: string | null, command: string | null, color: string | null = null): SharedTab => ({ title, color, command });

/** A fake Rust: `need` is what script_trust_needed says; a grant makes the next read carry commands. */
function fakeRust(tabs: SharedTab[], need: TrustAsk | null, refused: string | null = null) {
  const calls: [string, Record<string, unknown>][] = [];
  let granted = need === null;
  const invoke = async <T,>(cmd: string, args: Record<string, unknown>): Promise<T> => {
    calls.push([cmd, args]);
    if (cmd === "script_trust_needed") return (granted ? null : need) as T;
    if (cmd === "script_trust_grant") {
      granted = true;
      return null as T;
    }
    return { tabs: granted ? tabs : tabs.map((t) => ({ ...t, command: null })), ask: granted ? null : need, refused } as T;
  };
  return { calls, invoke };
}

const ask: TrustAsk = { kind: "tabs", script: "pnpm dev", changed: false, project: "app" };

describe("PROJ-034 the default tabs of a new workspace", () => {
  it("asks once for the commands, then opens the tabs with them", async () => {
    const r = fakeRust([tab("Dev", "pnpm dev", "#0af"), tab("Notes", null)], ask);
    const asked: TrustAsk[] = [];
    const out = await defaultTabs("C:/r", "C:/w", r.invoke, async (a) => (asked.push(a), "once" as TrustAnswer));
    expect(asked).toEqual([ask]);
    expect(out.tabs).toEqual([tab("Dev", "pnpm dev", "#0af"), tab("Notes", null)]);
    expect(r.calls.map((c) => c[0])).toEqual(["script_trust_needed", "script_trust_grant", "workspace_default_tabs"]);
    expect(r.calls[1][1]).toEqual({ path: "C:/w", kind: "tabs", script: "pnpm dev", always: false, root: "C:/r" });
  });

  it("opens the tabs without their commands when the user says Don't run", async () => {
    const r = fakeRust([tab("Dev", "pnpm dev")], ask);
    const out = await defaultTabs("C:/r", "C:/w", r.invoke, async () => "skip");
    expect(out.tabs).toEqual([tab("Dev", null)]);
    expect(r.calls.map((c) => c[0])).toEqual(["script_trust_needed", "workspace_default_tabs"]);
  });

  it("never asks when the file has no commands or the repository is trusted", async () => {
    const r = fakeRust([tab("Notes", null)], null);
    const out = await defaultTabs("C:/r", "C:/w", r.invoke, async () => {
      throw new Error("no question expected");
    });
    expect(out).toEqual({ tabs: [tab("Notes", null)], refused: null });
  });

  it("reports a refused file and opens nothing", async () => {
    const r = fakeRust([], null, "kolux.yaml is larger than 64 KB, so its shared settings are ignored");
    expect(await defaultTabs("C:/r", "C:/w", r.invoke)).toEqual({ tabs: [], refused: "kolux.yaml is larger than 64 KB, so its shared settings are ignored" });
  });

  it("titles a tab by its title, else its command's first word, else Terminal", () => {
    expect(tabTitle(tab("Dev", "pnpm dev"))).toBe("Dev");
    expect(tabTitle(tab(null, "  pnpm dev"))).toBe("pnpm");
    expect(tabTitle(tab(null, null, "#fff"))).toBe("Terminal");
  });
});

/** The window's panes and tab colours as plain variables, with the setters the App gives. */
function windowState(start: Pane[]) {
  const w = { panes: start, colors: {} as TabColors, said: [] as string[], next: { current: 100 } };
  return {
    w,
    deps: {
      nextKey: w.next,
      setPanes: (f: Pane[] | ((p: Pane[]) => Pane[])) => void (w.panes = typeof f === "function" ? f(w.panes) : f),
      setTabColors: (f: TabColors | ((m: TabColors) => TabColors)) => void (w.colors = typeof f === "function" ? f(w.colors) : f),
      say: (m: string) => void w.said.push(m),
    },
  };
}
const shell = (key: number, cwd: string): Pane => ({ key, cwd, branch: "b", agent: "shell", program: null, args: [] });

describe("PROJ-034 opening the default tabs in a new workspace", () => {
  it("picks the palette colour nearest a file colour, and none for a bad one", () => {
    expect(nearestTabColor("#0af")).toBe("blue");
    expect(nearestTabColor("#E00")).toBe("red");
    expect(nearestTabColor("#46a758")).toBe("green");
    expect(nearestTabColor("red")).toBeNull();
    expect(nearestTabColor(null)).toBeNull();
  });

  it("makes one shell tab per default tab, each a cell of its own, the command typed ahead and the title kept", () => {
    let n = 10;
    const out = tabPanes([tab("Dev", "pnpm dev", "#E00"), tab(null, "tail -f log"), tab(null, null)], "C:/w", "main", () => n++);
    expect(out.panes.map((p) => [p.key, p.title, p.typed, p.agent, p.cwd])).toEqual([
      [10, "Dev", "pnpm dev", "shell", "C:/w"],
      [11, "tail", "tail -f log", "shell", "C:/w"],
      [12, "Terminal", undefined, "shell", "C:/w"],
    ]);
    expect(out.panes.some((p) => "group" in p)).toBe(false);
    expect(out.colors).toEqual({ 10: "red" });
  });

  it("opens the tabs in the cells right after the workspace's first pane and colours them", async () => {
    const { w, deps } = windowState([shell(1, "C:/other"), shell(2, "C:/w"), shell(3, "C:/w")]);
    const r = fakeRust([tab("Dev", "pnpm dev", "#0af"), tab("Logs", null)], null);
    await openDefaultTabs("C:/r", "C:/w", "b", { ...deps, invoke: r.invoke });
    expect(w.panes.map((p) => [p.key, p.title])).toEqual([[1, undefined], [2, undefined], [100, "Dev"], [101, "Logs"], [3, undefined]]);
    expect(w.colors).toEqual({ 100: "blue" });
    expect(w.said).toEqual([]);
  });

  it("opens nothing and says why when kolux.yaml was refused", async () => {
    const { w, deps } = windowState([shell(2, "C:/w")]);
    const r = fakeRust([], null, "kolux.yaml is larger than 64 KB, so its shared settings are ignored");
    await openDefaultTabs("C:/r", "C:/w", "b", { ...deps, invoke: r.invoke });
    expect(w.panes).toHaveLength(1);
    expect(w.said).toEqual(["kolux.yaml is larger than 64 KB, so its shared settings are ignored"]);
  });

  it("says, never throws, when reading the tabs fails", async () => {
    const { w, deps } = windowState([shell(2, "C:/w")]);
    await openDefaultTabs("C:/r", "C:/w", "b", { ...deps, invoke: async () => Promise.reject("no such command") });
    expect(w.panes).toHaveLength(1);
    expect(w.said).toEqual(["no such command"]);
  });
});
