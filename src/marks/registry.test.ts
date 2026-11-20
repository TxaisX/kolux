// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { CREDIT_NAMES } from "../launch/paneMark";
import AgentMark from "./AgentMark";
import { agents } from "../keys/actions";
import { NAME_ONLY, VENDOR_MARKS, markKind, productName, vendorFiles, vendorMark, vendorUrl } from "./registry";

// Vite lists and reads the files, so no Node types are needed.
const svgText = import.meta.glob("../assets/vendors/*.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const noticeText = Object.values(import.meta.glob("../assets/vendors/NOTICE.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>)[0] ?? "";
const sources = import.meta.glob("/src/**/*.{ts,tsx,css}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
// Vitest hands back an empty string for any .css it is asked to load (even with ?raw), so the stylesheet's text is read
// from disk with Node's own file reader, reached through the global process because the project carries no Node types.
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const marksCss = nodeFs.readFileSync(new URL("./marks.css", import.meta.url), "utf8");

const fileOf = (key: string) => key.slice(key.lastIndexOf("/") + 1);
const sha256 = async (text: string) => {
  const bytes = new TextEncoder().encode(text.split("\r\n").join("\n"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};
/** NOTICE.md table rows: file name -> the SHA-256 in that row. */
const noticeRows = () => {
  const rows = new Map<string, string>();
  for (const line of noticeText.split("\n")) {
    const file = /^\| `([^`]+\.svg)` \|/.exec(line)?.[1];
    const hash = /`([0-9a-f]{64})` \|\s*$/.exec(line)?.[1];
    if (file) rows.set(file, hash ?? "");
  }
  return rows;
};

describe("T-335 vendor mark files", () => {
  test("every svg in the vendors folder has one NOTICE.md row, and every row names a file that ships", () => {
    const files = Object.keys(svgText).map(fileOf).sort();
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect([...noticeRows().keys()].sort()).toEqual(files);
  });

  test("each file is byte-for-byte what NOTICE.md recorded from the kit (SHA-256 over the text, LF line ends)", async () => {
    const rows = noticeRows();
    for (const [key, text] of Object.entries(svgText)) {
      expect(await sha256(text), fileOf(key)).toBe(rows.get(fileOf(key)));
    }
  });

  test("no file reaches out: no script, link, embedded picture, import or event handler", () => {
    for (const [key, text] of Object.entries(svgText)) {
      expect(text, fileOf(key)).not.toMatch(/<script|<foreignObject|<image|<use[^>]+href="(?!#)|@import|url\(\s*["']?https?:|\son[a-z]+=|data:/i);
      expect(text.match(/https?:\/\/[^"' )]+/g)?.filter((u) => u !== "http://www.w3.org/2000/svg" && u !== "http://www.w3.org/1999/xlink") ?? [], fileOf(key)).toEqual([]);
    }
  });

  test("every registry entry names files that ship, and every shipped file is used by an entry", () => {
    const used = new Set(VENDOR_MARKS.flatMap((m) => [m.light, m.dark]));
    for (const f of used) expect(vendorUrl(f), f).toBeTruthy();
    expect([...used].sort()).toEqual(vendorFiles().sort());
  });

  test("a vendor with two colour sets uses two different files; ids are unique", () => {
    const ids = VENDOR_MARKS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["codex", "copilot", "github", "cursor"]) {
      const m = vendorMark(id)!;
      expect(m.light, id).not.toBe(m.dark);
    }
    for (const id of ["claude", "vscode"]) expect(vendorMark(id)!.light).toBe(vendorMark(id)!.dark);
  });

  test("every agent id in the registry is an agent the credit rule knows", () => {
    const credit = new Set(CREDIT_NAMES.map(([id]) => id));
    for (const id of ["claude", "codex", "copilot"]) expect(credit.has(id), id).toBe(true);
  });
});

describe("T-335 AgentMark", () => {
  const html = (id: string, label?: string) => renderToStaticMarkup(createElement(AgentMark, { id, size: 14, label }));
  /** The picture addresses in rendered markup, with the HTML escaping undone (small SVGs are inlined as data addresses). */
  const srcs = (out: string) =>
    [...out.matchAll(/src="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));

  test("Codex draws the OpenAI mark twice, black for light surfaces and white for dark, and each picture names it", () => {
    const out = html("codex");
    expect(out.match(/<img/g)).toHaveLength(2);
    expect(srcs(out)).toEqual([vendorUrl("openai-blossom-black.svg"), vendorUrl("openai-blossom-white.svg")]);
    expect(vendorUrl("openai-blossom-black.svg")).not.toBe(vendorUrl("openai-blossom-white.svg"));
    // Both pictures carry the name (review 52195201 FIX-SOON 1): CSS display:none takes the hidden one out of the
    // accessibility tree, so only the shown picture is ever announced, and none is aria-hidden.
    expect(out.match(/<img/g)!.length).toBe(out.match(/alt="Codex"/g)!.length);
    expect(out.match(/alt="Codex"/g)).toHaveLength(2);
    expect(out).not.toContain("aria-hidden");
    expect(out).not.toContain('alt=""');
    expect(out).toContain('class="vmark vmark-light"');
    expect(out).toContain('class="vmark vmark-dark"');
  });

  test("Claude draws its one coloured mark once", () => {
    const out = html("claude");
    expect(out.match(/<img/g)).toHaveLength(1);
    expect(srcs(out)).toEqual([vendorUrl("anthropic-claude-spark.svg")]);
    expect(out).toContain('alt="Claude"');
  });

  test("an agent with no kit file draws the neutral glyph with its name as the text alternative, and no picture file", () => {
    const out = html("mistral-vibe", "Mistral Vibe");
    expect(out).not.toContain("<img");
    expect(out).toContain('aria-label="Mistral Vibe"');
    expect(out).toContain("<svg");
    // With no label given the registry's own plain-text name is the alternative; an id nobody knows keeps its id.
    expect(html("mistral-vibe")).toContain('aria-label="Mistral Vibe"');
    expect(html("no-such-agent")).toContain('aria-label="no-such-agent"');
  });

  test("Cursor draws its cube twice (the dark-ink file for light surfaces, the pale file for dark) and names it", () => {
    const out = html("cursor");
    expect(srcs(out)).toEqual([vendorUrl("cursor-cube-for-light.svg"), vendorUrl("cursor-cube-for-dark.svg")]);
    expect(out.match(/alt="Cursor"/g)).toHaveLength(2);
  });
});

describe("T-335 the light/dark switch", () => {
  test("marks.css keys on the attribute the theme code sets (data-mode), and on no other", () => {
    // theme.ts writes document.documentElement.dataset.mode, which is the data-mode attribute.
    expect(marksCss.length).toBeGreaterThan(100); // really read, not an empty stand-in
    expect(sources["/src/theme.ts"] ?? "").toMatch(/dataset\.mode\s*=/);
    expect(marksCss).toContain('[data-mode="dark"] .vmark-light');
    expect(marksCss).toContain('[data-mode="dark"] .vmark-dark');
    expect(marksCss).not.toMatch(/data-theme/);
    expect(marksCss).not.toMatch(/prefers-color-scheme/);
    // the dark picture is hidden unless the root is dark, the light one hidden when it is
    expect(marksCss).toMatch(/\.vmark-dark\s*\{\s*display:\s*none/);
  });
});

describe("T-335 cut features get no mark", () => {
  const CUT = /(^|[-_.])(gitlab|jira|linear|ios|android)([-_.]|$)/i;
  test("no file in the vendors folder is named for a cut feature (GitLab, Jira, Linear, iOS, Android)", () => {
    const files = vendorFiles();
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(files.filter((f) => CUT.test(f))).toEqual([]);
    expect([...noticeRows().keys()].filter((f) => CUT.test(f))).toEqual([]);
  });
  test("Jira is cut but Atlassian is not: a Rovo Dev file under Atlassian's name is allowed, a Jira one is not", () => {
    expect("atlassian-rovo-dev.svg").not.toMatch(CUT);
    expect("rovo-dev-atlassian.svg").not.toMatch(CUT);
    expect("jira-logo.svg").toMatch(CUT);
  });
  test("the registry has no entry for a cut feature", () => {
    for (const m of VENDOR_MARKS) {
      expect(m.id, m.id).not.toMatch(CUT);
      expect(m.light + m.dark, m.id).not.toMatch(CUT);
    }
  });
});

describe("T-335 nothing is fetched at run time", () => {
  test("no source asks a favicon or icon service for a picture, and none points an img at a remote host", () => {
    for (const [f, text] of Object.entries(sources)) {
      if (f.endsWith("registry.test.ts") || f.endsWith("noPetArt.test.ts")) continue;
      expect(text, f).not.toMatch(/s2\/favicons|favicon\.ico\?|gstatic\.com\/faviconV2|icon\.horse|logo\.clearbit|simpleicons\.org\/|cdn\.simpleicons/i);
      expect(text, f).not.toMatch(/<img[^>]+src=["']https?:/i);
    }
  });
});

describe("T-335-b every product has a kit mark or a plain-text name", () => {
  test("every agent in the catalogue is either a kit mark or a name-only entry carrying the catalogue's own name", () => {
    for (const [id, name] of agents) {
      expect(markKind(id), id).not.toBe("none");
      expect(productName(id), id).toBe(name);
    }
  });

  test("the card's calls: Cursor is a kit mark; Rovo Dev, Droid, Kilocode, Aider, Pi, OMP, OpenClaude and Mistral Vibe are name only", () => {
    for (const id of ["claude", "codex", "copilot", "cursor"]) expect(markKind(id), id).toBe("kit");
    for (const id of ["rovo", "droid", "kilo", "aider", "pi", "omp", "openclaude", "mistral-vibe"]) expect(markKind(id), id).toBe("name");
  });

  test("open-in editors, shells and terminal apps all have a name, and the open-in presets are all covered", () => {
    for (const id of ["windsurf", "sublime", "zed", "jetbrains", "warp", "ghostty", "powershell", "cmd", "wsl", "git-for-windows"]) expect(markKind(id), id).not.toBe("none");
    expect(markKind("vscode")).toBe("kit");
    expect(markKind("github")).toBe("kit");
  });

  test("ids are unique across kit and name-only entries, every name-only entry has a plain name, and an unknown id is none", () => {
    const ids = [...VENDOR_MARKS.map((m) => m.id), ...NAME_ONLY.map((n) => n.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const n of NAME_ONLY) expect(n.name.trim().length, n.id).toBeGreaterThan(1);
    expect(markKind("not-a-product")).toBe("none");
    expect(productName("not-a-product")).toBeUndefined();
  });

  test("no name-only entry is for a cut feature", () => {
    for (const n of NAME_ONLY) expect(`${n.id} ${n.name}`, n.id).not.toMatch(/(^|[\s._-])(gitlab|jira|linear|ios|android)([\s._-]|$)/i);
  });
});
