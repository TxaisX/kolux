// T-591 (brief Phase 1): every command the front end invokes by name is one lib.rs registers.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, invoked, listed, registered } from "./invoke-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIB = `fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            app_info,
            hooks::agent_hooks::agent_hooks_sync, // STAT-044 [x]
            #[cfg(debug_assertions)]
            dev_only,
            update::update_check
        ])
}`;
const repo = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "krs-invoke-"));
  for (const [name, text] of Object.entries({ "src-tauri/src/lib.rs": LIB, ...files })) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
};

describe("invoke contract", () => {
  it("every command src/ invokes by name is registered in lib.rs today", () => {
    const r = check(ROOT);
    expect(r.unknown).toEqual([]);
    expect(r.checked).toBeGreaterThan(500);
  });

  it("a name lib.rs does not register fails, with where it is", () => {
    const root = repo({ "src/panes/Pane.tsx": 'import { invoke } from "@tauri-apps/api/core";\ninvoke("app_info");\nvoid invoke<string>("app_inof", {});\n' });
    expect(check(root).unknown).toEqual(["app_inof (src/panes/Pane.tsx:3)"]);
  });

  it("reads the handler list through module paths, comments and attributes", () => {
    expect([...registered(LIB)].sort()).toEqual(["agent_hooks_sync", "app_info", "dev_only", "update_check"]);
  });

  it("reads type arguments, either quote and spacing; leaves plugin calls and names in variables alone", () => {
    const text = [
      'invoke<Record<string, (a: number) => void>>("one");',
      "await invoke<string | null>( 'two', { a: 1 } );",
      'invoke("plugin:dialog|open", {});',
      "invoke(cmd, args); invoke(`three_${x}`);",
      "export const callAll = (invoke) => invoke;",
    ].join("\n");
    const found = invoked(text);
    expect(found.names.map((n) => n.name)).toEqual(["one", "two"]);
    expect(found.names.map((n) => n.line)).toEqual([1, 2]);
    expect(found.dynamic).toBe(2);
  });

  it("T-811: a name held in src/ipc/commands.ts is checked too, and no call passes a bare variable", () => {
    expect(check(ROOT).dynamic).toBe(0);
    expect(check(ROOT).mapped).toBeGreaterThan(30);
    const map = (names) => ({ "src/ipc/commands.ts": `export const NAMED_COMMANDS = [\n${names}\n] as const;\nexport const invokeNamed = (name, args) => invoke(name, args);\n` });
    expect(listed(map('  "app_info", "update_check",')["src/ipc/commands.ts"]).map((n) => n.name)).toEqual(["app_info", "update_check"]);
    expect(check(repo(map('  "app_info",\n  "app_inof",')))).toMatchObject({ unknown: ["app_inof (src/ipc/commands.ts:3)"], dynamic: 0, mapped: 2 });
  });

  it("does not check test files: they invoke made-up names on purpose", () => {
    const root = repo({ "src/a.test.ts": 'invoke("nope");', "src/__cards__/b.test.tsx": 'invoke("nope");', "src/c.ts": 'invoke("update_check");' });
    expect(check(root)).toMatchObject({ unknown: [], checked: 1 });
  });
});
