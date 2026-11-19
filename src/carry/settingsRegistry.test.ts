// @vitest-environment node
import { describe, expect, test } from "vitest";
import registry from "./settingsRegistry.json";

// T-213 (after-list row 651): the importer's carried list lives in settingsRegistry.json, which import.rs reads at
// build time. These tests keep it and the settings fields in src/** in step.
const sources = import.meta.glob("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const code = Object.entries(sources).filter(([path]) => !/\.test\.tsx?$/.test(path));

/** Settings fields named by an exported `*_FIELD` / `*_KEY` constant holding a plain camelCase string. */
function fieldsInSource(): Map<string, string> {
  const found = new Map<string, string>();
  for (const [path, text] of code) {
    for (const m of text.matchAll(/^export const [A-Z0-9_]+_(?:FIELD|KEY) = "([a-z][A-Za-z0-9]*)"/gm)) if (!found.has(m[1])) found.set(m[1], path);
  }
  return found;
}

const carried = registry.carried.map((c) => c.name);
const listed = new Set([...carried, ...registry.notCarried]);

describe("settings registry", () => {
  test("every shape is one the importer knows, and no name is listed twice", () => {
    for (const c of registry.carried) expect(["bool", "number", "word", "words"], c.name).toContain(c.shape);
    const all = [...carried, ...registry.notCarried];
    expect(all.filter((n, i) => all.indexOf(n) !== i)).toEqual([]);
  });

  test("a settings field added in src/** is classified: carried with a shape, or knowingly left off", () => {
    const missing = [...fieldsInSource()].filter(([name]) => !listed.has(name)).map(([name, path]) => `${name} (${path})`);
    expect(missing, "add each to carried (with a shape) or notCarried in src/carry/settingsRegistry.json").toEqual([]);
  });

  test("a registry name that no source file spells any more is flagged (a renamed or removed field)", () => {
    const all = code.map(([, text]) => text).join("\n");
    const gone = [...listed].filter((name) => !all.includes(`"${name}"`));
    expect(gone, "renamed or removed in src/**: update the registry").toEqual([]);
  });

  test("the scan sees the settings fields it is meant to (a loose pattern would pass with an empty set)", () => {
    const names = [...fieldsInSource().keys()];
    expect(names.length).toBeGreaterThan(60);
    for (const name of ["language", "uiLook", "keepAwake", "defaultModel", "httpProxy"]) expect(names).toContain(name);
  });

  test("a secret-bearing field is never on the carried side", () => {
    for (const secret of ["httpProxy", "claudeOauthToken", "openrouterApiKey"]) expect(carried).not.toContain(secret);
  });
});
