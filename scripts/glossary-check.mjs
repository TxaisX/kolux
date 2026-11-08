// Proves docs/GLOSSARY.md matches the app (P4B-07): every UI label in LABELS has a bold entry, each
// label still appears in its source file (so this list cannot rot), and the words the app never
// shows (DROPPED) have no entry. Plural and singular count as one: **Automation** covers Automations.
//   node scripts/glossary-check.mjs      exit 0 = OK, 1 = problems listed
// Test: pnpm exec vitest run scripts/glossary-check.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** [label as the app shows it, a source file that still holds it]. */
export const LABELS = [
  ["Project", "src/projects/ProjectsPanel.tsx"],
  ["Folders", "src/projects/ProjectsPanel.tsx"],
  ["Group", "src/projects/ProjectsPanel.tsx"],
  ["Workspace", "src/projects/ProjectsPanel.tsx"],
  ["Sleeping", "src/keys/actions.ts"],
  ["Switch workspace", "src/keys/actions.ts"],
  ["Branch", "src/editor/AllChangesPane.tsx"],
  ["Space", "src/space/SpaceView.tsx"],
  ["Agents", "src/chrome/TopBar.tsx"],
  ["Terminals", "src/chrome/TopBar.tsx"],
  ["New session", "src/projects/ProjectsPanel.tsx"],
  ["Next that needs you", "src/projects/ProjectsPanel.tsx"],
  ["Session", "src/launch/ChooserPane.tsx"],
  ["Fork", "src/terminal/ForkDialog.tsx"],
  ["Pane", "src/floor/FloorView.tsx"],
  ["Tab", "src/browser/BrowserPane.tsx"],
  ["Layout", "src/chrome/LayoutStrip.tsx"],
  ["Seat", "src/launch/ChooserPane.tsx"],
  ["Shape", "src/launch/ChooserPane.tsx"],
  ["Solo", "src/launch/seats.ts"],
  ["Pair", "src/launch/seats.ts"],
  ["Workbench", "src/launch/seats.ts"],
  ["Swarm", "src/launch/seats.ts"],
  ["Custom", "src/automations/AutomationDialog.tsx"],
  ["Model routing", "src/settings/RoutingPage.tsx"],
  ["Board", "src/chrome/TopBar.tsx"],
  ["Show Workspace Statuses", "src/keys/actions.ts"],
  ["Inbox", "src/chrome/TopBar.tsx"],
  ["Tower", "src/chrome/TopBar.tsx"],
  ["Floor", "src/floor/FloorView.tsx"],
  ["Workspace View", "src/chrome/chromeItems.ts"],
  ["Status", "src/automations/RunsDashboard.tsx"],
  ["Usage", "src/automations/AutomationsPage.tsx"],
  ["Notifications", "src/settings/pages.ts"],
  ["Explorer", "src/chrome/RightSidebar.tsx"],
  ["Insights", "src/chrome/RightSidebar.tsx"],
  ["Checks", "src/chrome/RightSidebar.tsx"],
  ["Attached", "src/chrome/RightSidebar.tsx"],
  ["PR Checks", "src/chrome/RightSidebar.tsx"],
  ["History", "src/chrome/RightSidebar.tsx"],
  ["Tasks", "src/tasks/TasksPage.tsx"],
  ["Automations", "src/automations/AutomationsPage.tsx"],
  ["Run", "src/automations/AutomationDialog.tsx"],
  ["Artifacts", "src/artifacts/ArtifactsPage.tsx"],
  ["Skills", "src/skills/SkillsPage.tsx"],
  ["Review changes", "src/board/ChipRow.tsx"],
  ["All Changes", "src/editor/AllChangesPane.tsx"],
  ["Review notes", "src/editor/NoteRail.tsx"],
  ["Yolo", "src/settings/AgentsPage.tsx"],
  ["Manual", "src/projects/ProjectsPanel.tsx"],
  ["Settings", "src/settings/SettingsPage.tsx"],
  ["Accounts & keys", "src/settings/pages.ts"],
  ["Terminal & sessions", "src/settings/pages.ts"],
  ["Git & worktrees", "src/settings/pages.ts"],
  ["Shortcuts", "src/settings/pages.ts"],
  ["Resource Manager", "src/chrome/statusItems.ts"],
  ["Classic", "src/chrome/appLook.ts"],
  ["Getting Started", "src/onboarding/helpItems.ts"],
  ["Milestones", "src/onboarding/helpItems.ts"],
  ["Onboarding", "src/onboarding/Wizard.tsx"],
  ["Explore Kolux", "src/onboarding/helpItems.ts"],
];

/** Words the old glossary defined that the app never shows. */
export const DROPPED = ["Main checkout", "Worktree", "Worker", "Handoff note", "Fence"];

const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim().replace(/s$/, "");

export function entries(text) {
  const out = new Set();
  for (const m of text.matchAll(/\*\*([^*\n]+)\*\*/g)) {
    out.add(norm(m[1]));
    for (const part of m[1].split(/ and | \/ /)) out.add(norm(part));
  }
  return out;
}

export function check(root = ROOT) {
  const problems = [];
  const text = fs.readFileSync(path.join(root, "docs", "GLOSSARY.md"), "utf8");
  const have = entries(text);
  for (const [label, file] of LABELS) {
    if (!have.has(norm(label))) problems.push(`no glossary entry for the UI label "${label}"`);
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) problems.push(`${file} is gone; update LABELS for "${label}"`);
    else if (!fs.readFileSync(abs, "utf8").includes(label)) problems.push(`"${label}" no longer appears in ${file}; update LABELS`);
  }
  for (const word of DROPPED) if (have.has(norm(word))) problems.push(`the glossary still defines "${word}", which the app never shows`);
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const problems = check();
  if (problems.length) {
    for (const p of problems) console.error(`glossary-check: ${p}`);
    process.exit(1);
  }
  console.log(`glossary-check: OK (${LABELS.length} UI labels have an entry; ${DROPPED.length} unused terms are gone)`);
}
