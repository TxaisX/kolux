// Documentation builder: every `docs/**/*.md` that declares a title gets a styled `.html` twin
// beside it, so a reader can open either form and the two never drift.
//
//   node scripts/docs/build.mjs            build every doc that needs it
//   node scripts/docs/build.mjs --check    exit 1 if any .html is stale (for CI and gates)
//   node scripts/docs/build.mjs <file.md>  build one
//
// The HTML is self-contained: the stylesheet is inlined and no font, script or image is fetched
// from anywhere. That matters because these pages are also opened inside Kolux, whose artifact
// viewer allows only its own origin.
//
// A doc opts in with a `<!-- html -->` marker in its first six lines. Opt-in rather than automatic:
// a generated twin is a committed file, and most docs do not need one. A doc that opts in also needs
// a `# Title` line, which becomes the page title.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOCS = path.join(root, "docs");

const CSS = `
:root{
  --ink:#0b0820;--ink-2:#130e2c;--violet:#251c52;--cream:#fffaea;--sand:#f1e2c2;
  --muted:#a99fc4;--line:rgba(241,226,194,.13);--good:#6ee7a8;--warn:#f5c451;--bad:#ff7a6b;
  --mono:ui-monospace,"Cascadia Mono",Menlo,Consolas,monospace;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  --sans:ui-sans-serif,"Segoe UI",Inter,system-ui,sans-serif;
}
*{box-sizing:border-box}
html{background:var(--ink)}
body{
  margin:0;color:var(--cream);font:400 16px/1.7 var(--sans);
  background:radial-gradient(900px 520px at 88% -10%,rgba(58,45,120,.45),transparent 62%),
    radial-gradient(640px 400px at -8% 2%,rgba(37,28,82,.65),transparent 60%),var(--ink);
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:860px;margin:0 auto;padding:58px 28px 88px}
.doc-head{border-bottom:1px solid var(--line);padding-bottom:26px;margin-bottom:34px}
.kicker{font:600 11px/1 var(--mono);letter-spacing:.22em;text-transform:uppercase;color:var(--sand);opacity:.7}
h1{font:600 clamp(32px,5vw,46px)/1.1 var(--serif);letter-spacing:-.02em;margin:16px 0 0}
h2{font:600 24px/1.25 var(--serif);letter-spacing:-.01em;margin:44px 0 10px;padding-top:10px}
h3{font:600 17px/1.35 var(--sans);margin:28px 0 8px;color:var(--sand)}
h4{font:600 11px/1 var(--mono);letter-spacing:.15em;text-transform:uppercase;color:var(--muted);margin:24px 0 8px}
p{margin:12px 0;color:rgba(255,250,234,.86)}
ul,ol{margin:12px 0;padding-left:22px;color:rgba(255,250,234,.86)}
li{margin:6px 0}
a{color:var(--sand);text-decoration:none;border-bottom:1px solid rgba(241,226,194,.3)}
a:hover{border-bottom-color:var(--sand)}
strong{color:var(--cream);font-weight:650}
em{color:var(--sand)}
hr{border:0;height:1px;background:var(--line);margin:38px 0}
code{font:400 13px/1.5 var(--mono);background:rgba(241,226,194,.09);padding:2px 5px;border-radius:2px;color:var(--sand)}
pre{background:#0d0a24;border:1px solid var(--line);border-radius:3px;padding:15px 17px;overflow:auto;margin:16px 0}
pre code{background:none;padding:0;color:var(--sand);font-size:12.5px;line-height:1.75}
blockquote{margin:16px 0;padding:12px 18px;border-left:2px solid var(--warn);background:rgba(245,196,81,.06);color:rgba(255,250,234,.88);border-radius:0 3px 3px 0}
blockquote p{margin:4px 0}
table{border-collapse:collapse;width:100%;margin:18px 0;font-size:14.5px;border:1px solid var(--line);border-radius:3px;overflow:hidden}
th{text-align:left;padding:11px 14px;background:rgba(37,28,82,.55);font:600 10.5px/1.3 var(--mono);
  letter-spacing:.14em;text-transform:uppercase;color:var(--sand);border-bottom:1px solid var(--line)}
td{padding:11px 14px;border-bottom:1px solid var(--line);vertical-align:top;color:rgba(255,250,234,.85)}
tr:last-child td{border-bottom:0}
footer{margin-top:56px;padding-top:22px;border-top:1px solid var(--line);
  font:400 12px/1.7 var(--mono);color:var(--muted);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
`.trim();

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s) => s.replace(/[&<>"]/g, (c) => ESC[c]);

/** The docs that opt in: a `<!-- html -->` marker near the top and a `# Title`. */
function wantsHtml(text) {
  const head = text.split(/\r?\n/).slice(0, 6);
  return head.some((l) => /<!--\s*html\s*-->/.test(l)) && head.some((l) => /^#\s+\S/.test(l));
}

function render(mdPath) {
  const text = fs.readFileSync(mdPath, "utf8");
  const lines = text.split(/\r?\n/);
  const titleLine = lines.find((l) => /^#\s+\S/.test(l));
  const title = titleLine ? titleLine.replace(/^#\s+/, "").trim() : path.basename(mdPath, ".md");

  // The standfirst: the first real paragraph, if it sits before any other heading.
  let standfirst = "";
  for (let i = lines.indexOf(titleLine) + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    if (l.startsWith("#")) break;
    if (l.startsWith("```") || l.startsWith("|") || l.startsWith("-") || l.startsWith("*")) break;
    standfirst = l;
    break;
  }

  const body = marked.parse(text, { gfm: true, mangle: false, headerIds: false });
  const rel = path.relative(root, mdPath).replace(/\\/g, "/");
  const stamp = new Date().toISOString().slice(0, 10);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <header class="doc-head">
    <div class="kicker">Kolux · documentation</div>
    <h1>${esc(title)}</h1>
  </header>
  <main>
${body}
  </main>
  <footer>
    <span>${esc(rel)}</span>
    <span>generated ${stamp} by scripts/docs/build.mjs</span>
  </footer>
</div>
</body>
</html>
`;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

const args = process.argv.slice(2);
const check = args.includes("--check");
const only = args.filter((a) => !a.startsWith("--"))[0];

const files = only ? [path.resolve(only)] : walk(DOCS);
let built = 0;
let stale = [];

for (const md of files) {
  if (!fs.existsSync(md) || !wantsHtml(fs.readFileSync(md, "utf8"))) continue;
  const htmlPath = md.replace(/\.md$/, ".html");
  const html = render(md);
  const exists = fs.existsSync(htmlPath);
  const same = exists && fs.readFileSync(htmlPath, "utf8") === html;
  if (same) continue;
  if (check) {
    stale.push(path.relative(root, htmlPath).replace(/\\/g, "/"));
    continue;
  }
  fs.writeFileSync(htmlPath, html);
  built++;
  console.log(`built ${path.relative(root, htmlPath).replace(/\\/g, "/")}`);
}

if (check) {
  if (stale.length) {
    console.error(`stale docs (run node scripts/docs/build.mjs):\n  ${stale.join("\n  ")}`);
    process.exit(1);
  }
  console.log("docs: all HTML is up to date");
} else {
  console.log(`docs: ${built} built`);
}
