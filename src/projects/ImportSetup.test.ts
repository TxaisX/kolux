import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";
import ImportSetup, { refusedLine, type SetupImport } from "./ImportSetup";

// The dialog is a src/ui Dialog, drawn only on a real DOM; what it shows is read here through a stand-in.
vi.mock("../ui/Dialog", async () => (await import("../tasks/dialogStandIn")).dialogModule);

const noop = () => {};
const offer: SetupImport = { file: "conductor.json", setup: "pnpm i", teardown: "./archive.sh", refused: null };
const bad: SetupImport = { file: ".codex/environments/environment.toml", setup: null, teardown: null, refused: "it is larger than 64 KB" };

test("VIEW-112: a supported config's setup and teardown commands are offered for import", () => {
  const html = renderToString(createElement(ImportSetup, { project: "app", path: "C:/r/app", list: [offer, bad], busy: false, onImport: noop, onClose: noop }));
  expect(html).toContain("Import setup commands?");
  expect(html).toContain("pnpm i");
  expect(html).toContain("./archive.sh");
  expect(html).toContain("Import from conductor.json");
  expect(html, "a refused file offers nothing, only why").not.toContain("Import from .codex");
  expect(html).toContain("was not read: it is larger than 64 KB");
});

test("VIEW-112: refused files are named with the reason", () => {
  expect(refusedLine([offer])).toBeNull();
  expect(refusedLine([bad, { ...bad, file: "conductor.json", refused: "it is not valid JSON (x)" }])).toBe(
    ".codex/environments/environment.toml was not read: it is larger than 64 KB. conductor.json was not read: it is not valid JSON (x).",
  );
});
