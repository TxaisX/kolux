// Lists every hand-rolled popup, tab set and select still in src/ (tests and src/ui left out), grouped by folder, for
// docs/base-ui-migration.md, and counts the native switches, checkboxes and title hints next to them. Run from the
// repo root:
//   node docs/base-ui-sites.mjs            the checklist as markdown
//   node docs/base-ui-sites.mjs --counts   only the per-folder counts table
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(process.cwd(), "src");
// One line per pattern; a line that matches is one site. These four are what moves onto a src/ui wrapper, and their
// sum ("To do") reaches zero when the migration is done. Ask, the shared confirm dialog, is drawn with <AlertDialog>
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
// Elements that carry a dialog role but are not popups, so no src/ui wrapper fits them: a card in the chat stream (its
// Escape interrupts the agent, reach.test.ts calls them exempt) and a question drawn in place inside the surface that
// asked it, which a modal Base UI dialog would lift out of its row. File and the label text on the line or the next two.
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
      const near = [text, lines[i + 1] ?? "", lines[i + 2] ?? ""].join("\n");
      if (kind === "Dialog" && NOT_POPUPS.some(([file, label]) => file === rel && near.includes(label))) continue;
      sites.push({ folder, file: rel, line: i + 1, kind, todo: true });
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
if (!process.argv.includes("--counts")) {
  out.push("", "Left to migrate (the Dialog, Menu, Tabs and Select lines):");
  for (const d of folders.filter((d) => count((s) => s.folder === d && s.todo) > 0)) {
    out.push("", `### ${d}`, "");
    const byFile = new Map();
    for (const s of sites.filter((s) => s.folder === d && s.todo)) byFile.set(s.file, [...(byFile.get(s.file) ?? []), `${s.kind} :${s.line}`]);
    for (const [file, list] of byFile) out.push(`- [ ] \`src/${file}\`: ${list.join(", ")}`);
  }
  out.push("", "Not popups, so not counted (a dialog role on an element no src/ui wrapper fits):", "");
  for (const [file, label, why] of NOT_POPUPS) out.push(`- \`src/${file}\` (${label}): ${why}`);
}
console.log(out.join("\n"));
