// Lists every hand-rolled popup, tab set and select still in src/ (tests and src/ui left out), grouped by folder, for
// docs/base-ui-migration.md, and counts the native switches, checkboxes and title hints next to them. Run from the
// repo root:
//   node docs/base-ui-sites.mjs            the checklist as markdown
//   node docs/base-ui-sites.mjs --counts   only the per-folder counts table
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(process.cwd(), "src");
// One line per pattern; a line that matches is one site. These four are what moves onto a src/ui wrapper, and their
// sum ("To do") reaches zero when the migration is done, less the selects kept native on purpose and the lines #255
// removes (both named below, and printed under the checklist with the reason for each). Ask, the shared confirm dialog, is drawn with <AlertDialog>
// (chrome/Ask.tsx), so its call sites are not counted. A role written inside a selector string ('[role="dialog"]', a
// query for any open dialog) or in a comment is not a site.
const MIGRATE = [
  ["Dialog", /(?<!\[)\brole="(alert)?dialog"/],
  ["Menu", /(?<!\[)\brole="menu"/],
  ["Tabs", /(?<!\[)\brole="tablist"/],
  ["Select", /<select\b/],
];
// Counted for reference, not a to-do list, and expected to stay above zero:
//   Opener: the element that opens a popup (a right-click handler, an aria-haspopup button). It stays when its popup
//           moves (projects/HideableRow.tsx opens a src/ui ContextMenu from one); the popup is counted above.
//   Switch, Checkbox: native inputs on purpose (see "Switch and Checkbox" in the notes); the src/ui wrappers only give
//           them one shape.
//   Tooltip: every title= prop, Kolux components' own title props included; a plain hover hint may stay a title.
const REFERENCE = [
  ["Opener", /\bonContextMenu=|\baria-haspopup="(dialog|menu|true)"/],
  ["Switch", /\brole="switch"/],
  ["Checkbox", /type="checkbox"(?![^>]*role="switch")/],
  ["Tooltip", /\btitle=[{"]|<Tip\b/],
];
// Elements that carry a dialog or menu role but are not popups, so no src/ui wrapper fits them: a card in the chat stream (its
// Escape interrupts the agent, reach.test.ts calls them exempt), a question or form drawn in place inside the surface
// that asked it, which a modal Base UI dialog would lift out of its row, and a card docked in a corner of the window
// that is not opened over anything (its Escape folds or dismisses it). File and the label text within two lines of it.
const NOT_POPUPS = [
  ["chat/PermissionCard.tsx", "askTitle(card.tool)", "a card in the chat"],
  ["chat/QuestionCard.tsx", "Question from the agent", "a card in the chat"],
  ["projects/AddProject.tsx", "Stop copying?", "asked in place, inside the Add project dialog"],
  ["projects/CleanupDialog.tsx", "Confirm removal", "asked in place, inside the clean-up dialog"],
  ["scm/StackMap.tsx", "Confirm the stack merge", "asked in place, under the stack map"],
  ["status/manage.tsx", "`End ${name}`", "asked in place, in the session's row"],
  ["status/manage.tsx", "`End ${what}`", "asked in place, in the Resource Manager"],
  ["status/ResourceManager.tsx", "bulkQ.label", "asked in place, in the Resource Manager"],
  ["terminal/BackgroundSessions.tsx", "`End ${what}`", "asked in place, in the Resource Manager"],
  ["recovery/RecoveryMount.tsx", "Graphics", "a notice strip in the window"],
  ["projects/CleanupDialog.tsx", "`Clean up workspaces in ${project.name}`", "a form drawn in place in the sidebar (.sb-form)"],
  ["scm/PrStart.tsx", "Create pull request", "a form drawn in place in Source Control (.scm-ask)"],
  ["scm/SourceControlPanel.tsx", "Create pull request", "a form drawn in place in Source Control (.scm-ask)"],
  ["scm/SourceControlPanel.tsx", "Resolve conflicts with an agent", "a form drawn in place in Source Control (.scm-ask)"],
  ["update/UpdateCenterView.tsx", "Updates", "the update card, docked in a corner; Escape folds it"],
  ["onboarding/Guides.tsx", "\"Tip\"", "a tip card docked in a corner, aria-modal false"],
  ["onboarding/Guides.tsx", "Agent status hooks", "a tip card docked in a corner, aria-modal false"],
  ["settings/ConnectGrid.tsx", "conn-more-list", "a list that opens in place under its summary (a <details>), not over the card"],
  ["editor/ReviewNotes.tsx", "Send the notes to", "a list that opens in place in the review tray, not over it"],
  ["shell/window/Content.tsx", "Workspaces being created", "placeholders for workspaces Git is still making: nothing to pick, so not a tab set"],
];
// Native on purpose, so not to do: inline editors that close when they lose focus. A src/ui Select opens its list in a
// portal that takes focus, which would close them before a pick. File and the label text within two lines of it.
const NATIVE = [
  ["editor/CodeLabel.tsx", "Code language", "the code block's language, laid over the editor; it goes on blur"],
  ["tasks/ProjectsView.tsx", "issue_type", "a cell editor that commits on change and cancels on blur"],
  ["tasks/ProjectsView.tsx", "single_select", "a cell editor that commits on change and cancels on blur"],
];
// Lines PR #255 (one session per cell) deletes or rewrites with src/ui, so they are not to do here; they drop out of the
// count when #255 merges. File and the text within two lines of it.
const BY_255 = [
  ["shell/window/Grid.tsx", 'aria-label="Tabs"', "the per-cell tab strip, which #255 removes"],
  ["shell/window/TabMenuView.tsx", 'aria-label="Tab"', "the tab menu, which #255 moves onto a src/ui ContextMenu"],
];

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "ui" && name !== "__cards__") walk(p);
    } else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) files.push(p);
  }
})(ROOT);

const comment = (text) => /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(text);
const sites = []; // { folder, file, line, kind, todo }
for (const f of files.sort()) {
  const rel = relative(ROOT, f).split(sep).join("/");
  const folder = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "(root)";
  const lines = readFileSync(f, "utf8").split(/\r?\n/);
  lines.forEach((text, i) => {
    if (comment(text)) return;
    for (const [kind, re] of MIGRATE) {
      if (!re.test(text)) continue;
      const near = lines.slice(Math.max(0, i - 2), i + 3).join("\n");
      const named = (list) => list.find(([file, label]) => file === rel && near.includes(label));
      if (kind !== "Select" && named(NOT_POPUPS)) continue;
      const set = kind === "Select" && named(NATIVE) ? "native" : named(BY_255) ? "by255" : null;
      sites.push({ folder, file: rel, line: i + 1, kind, todo: set === null, set });
    }
    for (const [kind, re] of REFERENCE) if (re.test(text)) sites.push({ folder, file: rel, line: i + 1, kind, todo: false });
  });
}

const kinds = [...MIGRATE, ...REFERENCE].map(([k]) => k);
const folders = [...new Set(sites.map((s) => s.folder))].sort();
const count = (pred) => sites.filter(pred).length;
const out = [];
out.push(`| Folder | ${kinds.join(" | ")} | To do |`, `|---|${kinds.map(() => "---:").join("|")}|---:|`);
for (const d of folders) out.push(`| ${d} | ${kinds.map((k) => count((s) => s.folder === d && s.kind === k)).join(" | ")} | ${count((s) => s.folder === d && s.todo)} |`);
out.push(`| **Total** | ${kinds.map((k) => `**${count((s) => s.kind === k)}**`).join(" | ")} | **${count((s) => s.todo)}** |`);
out.push("", `To do: ${count((s) => s.todo)}. Native on purpose: ${count((s) => s.set === "native")}. Removed by #255: ${count((s) => s.set === "by255")}.`);
if (!process.argv.includes("--counts")) {
  out.push("", "Left to migrate (the Dialog, Menu, Tabs and Select lines):");
  for (const d of folders.filter((d) => count((s) => s.folder === d && s.todo) > 0)) {
    out.push("", `### ${d}`, "");
    const byFile = new Map();
    for (const s of sites.filter((s) => s.folder === d && s.todo)) byFile.set(s.file, [...(byFile.get(s.file) ?? []), `${s.kind} :${s.line}`]);
    for (const [file, list] of byFile) out.push(`- [ ] \`src/${file}\`: ${list.join(", ")}`);
  }
  const listed = (set) => sites.filter((s) => s.set === set).map((s) => `- \`src/${s.file}\` ${s.kind} :${s.line}`);
  out.push("", "Native on purpose, counted in their column but not to do:", "");
  for (const [file, label, why] of NATIVE) out.push(`- \`src/${file}\` (${label}): ${why}`);
  out.push("", `Removed by #255, counted in their column but not to do (${count((s) => s.set === "by255")} lines):`, "", ...listed("by255"));
  for (const [file, , why] of BY_255) out.push(`  - \`src/${file}\`: ${why}`);
  out.push("", "Not popups, so not counted (a dialog, menu or tab role on an element no src/ui wrapper fits):", "");
  for (const [file, label, why] of NOT_POPUPS) out.push(`- \`src/${file}\` (${label}): ${why}`);
}
console.log(out.join("\n"));
