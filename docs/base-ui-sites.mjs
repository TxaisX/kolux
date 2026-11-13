// Lists every hand-rolled popup, tab set, switch, checkbox, select and tooltip still in src/ (tests and src/ui left
// out), grouped by folder, for docs/base-ui-migration.md. Run from the repo root:
//   node docs/base-ui-sites.mjs            the checklist as markdown
//   node docs/base-ui-sites.mjs --counts   only the per-folder counts table
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(process.cwd(), "src");
// One line per pattern; a line that matches is one site. Ask is the shared confirm dialog: each <Ask is a call site
// that moves to <AlertDialog> when chrome/Ask.tsx does.
const PRIMITIVES = [
  ["Dialog", /\brole="(alert)?dialog"|<Ask\b/],
  ["Menu", /\brole="menu"/],
  ["ContextMenu", /\bonContextMenu=/],
  ["Popover", /\baria-haspopup="(dialog|true)"/],
  ["Tabs", /\brole="tablist"/],
  ["Switch", /\brole="switch"/],
  ["Checkbox", /type="checkbox"(?![^>]*role="switch")/],
  ["Select", /<select\b/],
  ["Tooltip", /\btitle=[{"]|<Tip\b/],
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

const sites = []; // { folder, file, line, kind }
for (const f of files.sort()) {
  const rel = relative(ROOT, f).split(sep).join("/");
  const folder = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "(root)";
  readFileSync(f, "utf8")
    .split(/\r?\n/)
    .forEach((text, i) => {
      for (const [kind, re] of PRIMITIVES) if (re.test(text)) sites.push({ folder, file: rel, line: i + 1, kind });
    });
}

const kinds = PRIMITIVES.map(([k]) => k);
const folders = [...new Set(sites.map((s) => s.folder))].sort();
const count = (pred) => sites.filter(pred).length;
const out = [];
out.push(`| Folder | ${kinds.join(" | ")} | All |`, `|---|${kinds.map(() => "---:").join("|")}|---:|`);
for (const d of folders) out.push(`| ${d} | ${kinds.map((k) => count((s) => s.folder === d && s.kind === k)).join(" | ")} | ${count((s) => s.folder === d)} |`);
out.push(`| **Total** | ${kinds.map((k) => `**${count((s) => s.kind === k)}**`).join(" | ")} | **${sites.length}** |`);
if (!process.argv.includes("--counts")) {
  for (const d of folders) {
    out.push("", `### ${d}`, "");
    const byFile = new Map();
    for (const s of sites.filter((s) => s.folder === d)) byFile.set(s.file, [...(byFile.get(s.file) ?? []), `${s.kind} :${s.line}`]);
    for (const [file, list] of byFile) out.push(`- [ ] \`src/${file}\`: ${list.join(", ")}`);
  }
}
console.log(out.join("\n"));
