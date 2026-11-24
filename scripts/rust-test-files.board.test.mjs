// RED-02-AUDIT (board-locked): which Rust files are pulled into the crate ONLY under #[cfg(test)].
// The privacy audit (scripts/privacy-audit.test.mjs, APP-070) skips exactly these files and reads
// every other .rs file as shipped code. A file nobody pulls in, or one pulled in at least once
// without #[cfg(test)], must stay in the audit, whatever its name.
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { testOnlyRustFiles } from "./rust-test-files.mjs";

const root = path.resolve(import.meta.dirname, "..");
const only = (files) => [...testOnlyRustFiles(files)].sort();

describe("testOnlyRustFiles", () => {
  test("a #[path] file registered under #[cfg(test)] on one line or over three lines is test-only", () => {
    const files = {
      "src/a.rs": 'fn shipped() {}\n#[cfg(test)] #[path = "a_board_tests.rs"] mod a_board_tests;\n',
      "src/a_board_tests.rs": "use super::*;\n",
      "src/b.rs": 'fn shipped() {}\n\n#[cfg(test)]\n#[path = "b_board_tests.rs"]\nmod b_board_tests;\n',
      "src/b_board_tests.rs": "use super::*;\n",
      "src/lib.rs": "mod a;\nmod b;\n",
    };
    const got = testOnlyRustFiles(files);
    expect(got).toBeInstanceOf(Set);
    expect([...got].sort()).toEqual(["src/a_board_tests.rs", "src/b_board_tests.rs"]);
  });

  test("CRLF line ends, extra spaces and a visibility keyword do not change the answer", () => {
    const files = {
      "src/c.rs": 'fn shipped() {}\r\n#[cfg( test )]\r\n#[path=\"c_tests.rs\"]\r\npub(crate) mod c_tests;\r\n',
      "src/c_tests.rs": "fn t() {}\r\n",
      "src/d.rs": '#[cfg(test)]   #[path = "d_tests.rs"]   pub   mod   d_tests ;\n',
      "src/d_tests.rs": "fn t() {}\n",
      "src/lib.rs": "pub mod c;\npub mod d;\n",
    };
    expect(only(files)).toEqual(["src/c_tests.rs", "src/d_tests.rs"]);
  });

  test("a mod line without #[path] resolves the way rustc does", () => {
    const files = {
      // lib.rs, main.rs and mod.rs look in their own folder; any other file looks in <folder>/<stem>/.
      "src/lib.rs": "#[cfg(test)] mod test_dir;\n#[cfg(test)]\nmod fixtures;\nmod git;\nmod foo;\n",
      "src/test_dir.rs": "pub fn d() {}\n",
      "src/fixtures/mod.rs": "pub fn f() {}\n",
      "src/main.rs": "#[cfg(test)] mod main_helpers;\n",
      "src/main_helpers.rs": "fn h() {}\n",
      "src/git.rs": "fn shipped() {}\n#[cfg(test)] mod extra;\n",
      "src/git/extra.rs": "fn e() {}\n",
      "src/extra.rs": "fn not_the_one_git_rs_means() {}\n",
      "src/foo/mod.rs": "#[cfg(test)]\nmod helpers;\n",
      "src/foo/helpers.rs": "fn h() {}\n",
    };
    expect(only(files)).toEqual(["src/fixtures/mod.rs", "src/foo/helpers.rs", "src/git/extra.rs", "src/main_helpers.rs", "src/test_dir.rs"]);
  });

  test("a #[path] is read from the declaring file's own folder, with ./ and ../ resolved", () => {
    const files = {
      "src/chat_engine/mod.rs": '#[cfg(test)] #[path = "replay_board_tests.rs"] mod replay_board_tests;\n',
      "src/chat_engine/replay_board_tests.rs": "fn t() {}\n",
      "src/replay_board_tests.rs": "fn same_name_other_folder() {}\n",
      "src/x/y.rs": '#[cfg(test)] #[path = "../shared_tests.rs"] mod shared;\n#[cfg(test)] #[path = "./near_tests.rs"] mod near;\n',
      "src/shared_tests.rs": "fn s() {}\n",
      "src/x/near_tests.rs": "fn n() {}\n",
      "src/lib.rs": '#[path = "chat_engine/mod.rs"] mod chat_engine;\n#[path = "x/y.rs"] mod y;\n',
    };
    expect(only(files)).toEqual(["src/chat_engine/replay_board_tests.rs", "src/shared_tests.rs", "src/x/near_tests.rs"]);
  });

  test("a _tests.rs file nobody pulls in, or one pulled in without #[cfg(test)], is not test-only", () => {
    const files = {
      "src/lib.rs": '#[path = "plain_tests.rs"] mod plain_tests;\nmod other_tests;\n',
      "src/plain_tests.rs": "fn shipped_after_all() {}\n",
      "src/other_tests.rs": "fn shipped_after_all() {}\n",
      "src/orphan_tests.rs": "fn nobody_pulls_me_in() {}\n",
      "src/orphan_board_tests.rs": "fn nobody_pulls_me_in() {}\n",
    };
    expect(only(files)).toEqual([]);
  });

  test("one declaration without #[cfg(test)] makes the file shipped, even if another one has it", () => {
    const files = {
      "src/a.rs": '#[cfg(test)] #[path = "both_tests.rs"] mod both;\n',
      "src/b.rs": '#[path = "both_tests.rs"] mod both;\n',
      "src/c.rs": '#[cfg(test)] #[path = "twice_tests.rs"] mod one;\n#[path = "twice_tests.rs"] mod two;\n',
      "src/both_tests.rs": "fn x() {}\n",
      "src/twice_tests.rs": "fn x() {}\n",
      "src/lib.rs": "mod a;\nmod b;\nmod c;\n",
    };
    expect(only(files)).toEqual([]);
  });

  test("only a plain #[cfg(test)] counts: not(test), any(test, ...) and cfg_attr do not", () => {
    const files = {
      "src/lib.rs": [
        '#[cfg(not(test))] #[path = "n_tests.rs"] mod n;',
        '#[cfg(any(test, feature = "dev"))] #[path = "any_tests.rs"] mod any;',
        '#[cfg_attr(test, path = "attr_tests.rs")] mod attr_tests;',
        '#[cfg(feature = "test")] #[path = "feat_tests.rs"] mod feat;',
        '#[test_case] #[path = "case_tests.rs"] mod case;',
        "",
      ].join("\n"),
      "src/n_tests.rs": "fn x() {}\n",
      "src/any_tests.rs": "fn x() {}\n",
      "src/attr_tests.rs": "fn x() {}\n",
      "src/feat_tests.rs": "fn x() {}\n",
      "src/case_tests.rs": "fn x() {}\n",
    };
    expect(only(files)).toEqual([]);
  });

  test("a #[cfg(test)] that belongs to another item, or sits in a comment, does not count", () => {
    const files = {
      "src/lib.rs": [
        "#[cfg(test)]",
        "fn helper() {}",
        '#[path = "after_helper_tests.rs"] mod after_helper;',
        '// #[cfg(test)] #[path = "line_comment_tests.rs"] mod line_comment;',
        '/// #[cfg(test)] #[path = "doc_comment_tests.rs"] mod doc_comment;',
        '/* #[cfg(test)] #[path = "block_comment_tests.rs"] mod block_comment; */',
        "/*",
        '#[cfg(test)] #[path = "long_block_tests.rs"] mod long_block;',
        "*/",
        "#[cfg(test)] // the next line is not this attribute's item",
        "const X: u8 = 1;",
        "mod later_tests;",
        "",
      ].join("\n"),
      "src/after_helper_tests.rs": "fn x() {}\n",
      "src/line_comment_tests.rs": "fn x() {}\n",
      "src/doc_comment_tests.rs": "fn x() {}\n",
      "src/block_comment_tests.rs": "fn x() {}\n",
      "src/long_block_tests.rs": "fn x() {}\n",
      "src/later_tests.rs": "fn x() {}\n",
    };
    expect(only(files)).toEqual([]);
  });

  test("a file that merely contains #[cfg(test)] code, and an inline test module, are not test-only files", () => {
    const files = {
      "src/lib.rs": '#[path = "hooks.rs"] mod hooks;\nmod net;\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn t() {}\n}\n',
      "src/hooks.rs": 'fn shipped() {}\n#[cfg(test)]\nfn helper() {}\n#[cfg(test)]\nmod tests {\n    fn t() {}\n}\n#[cfg(test)] #[path = "hooks_x_board_tests.rs"] mod x_board_tests;\n',
      "src/hooks_x_board_tests.rs": "fn t() {}\n",
      "src/net.rs": "#![cfg_attr(test, allow(dead_code))]\n#[cfg(test)]\nconst T: u8 = 0;\nfn shipped() {}\n",
      "src/tests.rs": "fn not_the_inline_module() {}\n",
    };
    expect(only(files)).toEqual(["src/hooks_x_board_tests.rs"]);
  });

  test("the answer names only keys of the input and does not change the input", () => {
    const files = {
      "src/lib.rs": '#[cfg(test)] #[path = "missing_tests.rs"] mod missing;\n#[cfg(test)] mod gone;\n#[cfg(test)] #[path = "real_tests.rs"] mod real;\n',
      "src/real_tests.rs": "fn x() {}\n",
    };
    const before = JSON.stringify(files);
    expect(only(files)).toEqual(["src/real_tests.rs"]);
    expect(JSON.stringify(files)).toBe(before);
    expect(only({})).toEqual([]);
  });

  test("on the real tree the three hooks board test files are test-only and the shipped files are not", () => {
    const base = path.join(root, "src-tauri", "src");
    const files = {};
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".rs")) files[path.relative(root, p).split(path.sep).join("/")] = fs.readFileSync(p, "utf8");
      }
    };
    walk(base);
    const got = testOnlyRustFiles(files);
    for (const f of ["hooks_land_board_tests.rs", "hooks_land_script_board_tests.rs", "hooks_nested_board_tests.rs"]) {
      expect(got.has(`src-tauri/src/${f}`), f).toBe(true);
    }
    for (const f of ["lib.rs", "hooks.rs", "hooks_nested.rs", "net.rs", "pty_service.rs", "update.rs", "land.rs", "agent_hooks/mod.rs"]) {
      expect(got.has(`src-tauri/src/${f}`), f).toBe(false);
    }
    for (const f of got) expect(Object.hasOwn(files, f), f).toBe(true);
  });
});
