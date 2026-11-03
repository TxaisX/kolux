import { describe, expect, test } from "vitest";
import type { Platform, Scope } from "./actions";
import { matchEvent, resolve, type KeyLike } from "./keymap";
import { scopesFor, type KeySurface } from "./keyScopes";
import { heldByTerminal } from "./terminalPolicy";

// APP-013: Ctrl+Tab switches tabs wherever focus sits. The Ctrl key is the Control key on every
// platform (on a Mac Cmd+Tab belongs to the system), so one chord covers all three.
const press = (o: Partial<KeyLike> = {}): KeyLike => ({ key: "Tab", code: "Tab", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, ...o });
const platforms: Platform[] = ["win32", "linux", "darwin"];
const surfaces: Array<[string, KeySurface]> = [
  ["terminal", { screen: "terminals", inTree: false }],
  ["agent", { screen: "terminals", inTree: false }],
  ["browser", { screen: "terminals", kind: "browser", inTree: false }],
  ["editor", { screen: "terminals", kind: "editor", inTree: false }],
  ["diff", { screen: "terminals", kind: "diff", inTree: false }],
  ["preview", { screen: "terminals", kind: "preview", inTree: false }],
  ["changes", { screen: "terminals", kind: "changes", inTree: false }],
  ["explorer tree", { screen: "terminals", inTree: true }],
  ["explorer tree beside an editor", { screen: "terminals", kind: "editor", inTree: true }],
];

describe("APP-013 tab keys from every focus", () => {
  for (const platform of platforms) {
    for (const [name, s] of surfaces) {
      test(`${platform}: Ctrl+Tab steps the recent-tab list from ${name}`, () => {
        const map = resolve(null, platform);
        expect(matchEvent(map, press(), scopesFor(s))?.id).toBe("tab.previousRecent");
        expect(matchEvent(map, press({ shiftKey: true }), scopesFor(s))?.id).toBe("tab.nextRecent");
      });
    }
  }

  test("the tab-number chord follows the platform: Alt+2 on Windows and Linux, Ctrl+2 on a Mac", () => {
    const digit = (o: Partial<KeyLike>) => press({ key: "2", code: "Digit2", ...o });
    for (const [name, s] of surfaces) {
      expect(matchEvent(resolve(null, "win32"), digit({ ctrlKey: false, altKey: true }), scopesFor(s))?.index, name).toBe(2);
      expect(matchEvent(resolve(null, "linux"), digit({ ctrlKey: false, altKey: true }), scopesFor(s))?.index, name).toBe(2);
      expect(matchEvent(resolve(null, "darwin"), digit({}), scopesFor(s))?.index, name).toBe(2);
    }
  });

  test("a plain Tab or Alt+Tab never matches a tab command", () => {
    const map = resolve(null, "win32");
    for (const [, s] of surfaces) {
      expect(matchEvent(map, press({ ctrlKey: false }), scopesFor(s))?.id ?? "").not.toMatch(/^tab\./);
      expect(matchEvent(map, press({ ctrlKey: false, altKey: true }), scopesFor(s))).toBeNull();
    }
  });

  test("with Terminal first the chord still reaches the window, because the command is marked terminal-safe", () => {
    const t = { closest: (sel: string) => (sel === ".xterm" ? {} : null) } as unknown as Element; // a node inside an xterm view
    expect(heldByTerminal("tab.previousRecent", { terminalShortcuts: "terminal" }, t)).toBe(false);
    expect(heldByTerminal("tab.nextRecent", { terminalShortcuts: "terminal" }, t)).toBe(false);
  });

  test("the surfaces keep the scopes they had before the tree was added", () => {
    expect(scopesFor({ screen: "terminals", inTree: false })).toEqual(["global", "terminal", "tabs"]);
    expect(scopesFor({ screen: "terminals", kind: "editor", inTree: false })).toEqual(["editor", "global", "tabs"]);
    expect(scopesFor({ screen: "terminals", kind: "preview", inTree: false })).toEqual(["global", "tabs"]);
    expect(scopesFor({ screen: "settings", inTree: false })).toEqual(["global"]);
  });
});

// T-717 (DT-C153): no default chord is bound twice among the scopes one key handler tries together. Each set below
// is one that a handler passes to matchEvent: the window's (scopesFor), a focused terminal's (shellKeys), the
// floating panel's, and each pane's own. Two actions on one chord in a live set means the table order picks the
// winner and the other's chord is dead.
// The pane close ships unbound, so a menu or tooltip that showed its chord would show none; they show tab.close's.
const SRC = import.meta.glob(["/src/**/*.{ts,tsx}", "!/src/**/*.test.{ts,tsx}", "!/src/**/__cards__/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
test("T-717: no menu or tooltip reads the pane close's chord (Mod+W is tab.close's)", () => {
  const readers = Object.entries(SRC).filter(([, s]) => /(labelOf|chordsOf)\(\w+, "terminal\.closePane"\)|key: "terminal\.closePane"/.test(s)).map(([f]) => f);
  expect(readers).toEqual([]);
});

describe("T-717 every default chord is unique per live scope set", () => {
  const live: Scope[][] = [
    ...surfaces.map(([, s]) => scopesFor(s)),
    scopesFor({ screen: "settings", inTree: false }),
    ["global", "terminal", "tabs"],
    ["global", "tabs"],
    ["global", "tabs", "editor"],
    ["browser"], ["editor"], ["explorer"], ["settings"],
  ];
  // "Mod" is Ctrl or Cmd, and modifier order does not matter: Mod+Shift+W and Shift+Ctrl+W are one chord on Windows.
  const norm = (chord: string, platform: Platform) => {
    const parts = chord.split("+");
    const key = parts.pop()!;
    const mods = parts.map((m) => (m === "Mod" ? (platform === "darwin" ? "Cmd" : "Ctrl") : m)).sort();
    return [...mods, key].join("+");
  };
  for (const platform of platforms) {
    test(`${platform}: no chord has two owners in one live scope set`, () => {
      const map = resolve(null, platform);
      const dupes: string[] = [];
      for (const scopes of live) {
        const owners = new Map<string, string[]>();
        for (const b of map.bindings.values()) {
          if (!scopes.includes(b.action.scope)) continue;
          for (const c of b.chords) owners.set(norm(c, platform), [...(owners.get(norm(c, platform)) ?? []), b.action.id]);
        }
        for (const [c, ids] of owners) if (ids.length > 1) dupes.push(`${scopes.join("+")}: ${c} -> ${ids.join(", ")}`);
      }
      expect([...new Set(dupes)]).toEqual([]);
    });
  }
});
