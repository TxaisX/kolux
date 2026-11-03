// Settings > Git & worktrees. SET-031 / GIT-066: how new branches begin (the git user name,
// then the gh login; custom text; or none), the default compare base, and whether a new
// workspace refreshes its base first, and the order of the Source Control groups. PROJ-070: whether deleting one clean workspace asks first. T-116-a-fix moved the prefix and compare base here from the sidebar gear.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CONFIRM_DELETE_FIELD, asksBeforeDelete } from "../projects/deleting";
import { prefixSample, type PrefixCheck } from "../projects/model";
import { budgetLine, budgetLow, type Budget, SUMMARY_UPSTREAM_KEY } from "../scm/model";
import { useSettings } from "./useSettings";
import { WRITER_INSTRUCTIONS_KEY } from "../scm/generate";
import WriterPicker from "../scm/WriterPicker";
import { autoBranchOn, autoBranchPatch } from "../scm/autoBranch";
import SetupPolicyRow from "./SetupPolicyRow";
import { RENAME_FOLDERS_KEY, renamesFolders } from "../projects/folderRename";
import AiRecipesSection from "./AiRecipesSection";
import AutoPrSettings from "./autoPr";
import { useDraft } from "./useDraft";
import { useLeaveSave } from "./leave";
import { REVIEW_BOTS_KEY } from "../scm/review";
import { botsText, parseBots } from "./reviewBots";

const REFRESH_FIELD = "refreshBaseFirst";
/** SET-031 / PROJ-039: branches are renamed after the work; on unless saved as false. */
export const RENAME_FIELD = "renameBranches";
export const renamesBranches = (s: Record<string, unknown>) => s[RENAME_FIELD] !== false;

type BudgetView = { rows: Budget[] | null; error: string | null; at: number };

type ViewProps = {
  settings: Record<string, unknown>;
  save: (patch: Record<string, unknown>) => unknown;
  draft: string;
  setDraft: (v: string) => void;
  check: PrefixCheck | null;
  /** GIT-028: the GitHub API budget as last read, and how to read it again. */
  budget?: BudgetView;
  onBudget?: () => void;
};

const modeOf = (s: Record<string, unknown>) => (typeof s.branchPrefix === "string" ? s.branchPrefix : "user");

/** ACCT-058: the review authors to show as bots, a draft that saves like the other text fields. */
function BotsField({ value, onSave }: { value: string; onSave: (text: string) => Promise<unknown> }) {
  const { props } = useDraft(value, onSave);
  return <input aria-label="review bot authors" className="field" maxLength={600} placeholder="e.g. reviewbot, ci-helper" {...props} />;
}

/** SET-036: the commit message instructions, a draft that saves after a pause, on leaving the field and when the page closes. */
function InstructionsField({ value, onSave }: { value: string; onSave: (text: string) => Promise<unknown> }) {
  const { props } = useDraft(value, onSave);
  return <textarea aria-label="commit message instructions" className="field multi" maxLength={2000} placeholder="Your own instructions for the message, e.g. use the imperative mood (optional)" {...props} />;
}

export function GitView({ settings, save, draft, setDraft, check, budget = { rows: null, error: null, at: 0 }, onBudget }: ViewProps) {
  const mode = modeOf(settings);
  const sample = prefixSample(mode, draft, check);
  return (
    <>
      <section className="conn-card" data-section="branches">
        <h2 className="conn-name">Branch names</h2>
        <div className="look-select">
          <span>Branch prefix</span>
          <select aria-label="branch prefix" className="field" value={mode} onChange={(e) => void save({ branchPrefix: e.target.value })}>
            <option value="user">Git user name (or gh login)</option>
            <option value="custom">Custom text</option>
            <option value="none">None: the bare name</option>
          </select>
        </div>
        {mode === "custom" && (
          <input
            aria-label="custom branch prefix"
            className="field"
            placeholder="e.g. feat"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => draft !== String(settings.branchPrefixCustom ?? "") && void save({ branchPrefixCustom: draft })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        )}
        <p className="conn-detail" data-prefix-sample>
          Next branch: <code>{sample.sample}</code>
        </p>
        {sample.note && (
          <p className="conn-detail warn" role="alert">
            {sample.note}
          </p>
        )}
        {mode === "user" && check && !check.prefix && <p className="conn-detail">No git user name or gh login was found, or it is too long, so new branches get the bare name.</p>}
        <label className="conn-switch">
          <input type="checkbox" role="switch" aria-label="Rename branches after the work" checked={renamesBranches(settings)} onChange={(e) => void save({ [RENAME_FIELD]: e.target.checked })} />
          Rename branches after the work
        </label>
        <p className="conn-detail" data-rename-note>
          {renamesBranches(settings)
            ? "When the agent starts real work in a workspace that still has the name Kolux suggested, its branch (and the name shown for it) is renamed to a short description of that work. A name you typed or edited is never replaced."
            : "Off: a workspace keeps the branch name Kolux suggested, whatever work is done in it."}
        </p>
        {renamesBranches(settings) && (
          <>
            <label className="conn-switch">
              <input type="checkbox" role="switch" aria-label="Ask to rename the folder too" checked={renamesFolders(settings)} onChange={(e) => void save({ [RENAME_FOLDERS_KEY]: e.target.checked })} />
              Ask to rename the folder too
            </label>
            <p className="conn-detail" data-rename-folders-note>
              {renamesFolders(settings) ? "After the branch is renamed, Kolux asks before renaming the folder on disk to match; nothing in it is removed." : "Off: the branch and the shown name change, the folder keeps its name."}
            </p>
          </>
        )}
      </section>
      <section className="conn-card" data-section="base">
        <h2 className="conn-name">Base branch</h2>
        <div className="look-select">
          <span>Default compare base</span>
          <select aria-label="default compare base" className="field" value={settings[SUMMARY_UPSTREAM_KEY] === true ? "upstream" : "default"} onChange={(e) => void save({ [SUMMARY_UPSTREAM_KEY]: e.target.value === "upstream" })}>
            <option value="default">Repository default</option>
            <option value="upstream">Branch upstream</option>
          </select>
        </div>
        <label className="conn-switch">
          <input type="checkbox" role="switch" aria-label="Refresh the base first" checked={settings[REFRESH_FIELD] === true} onChange={(e) => void save({ [REFRESH_FIELD]: e.target.checked })} />
          Refresh the base first
        </label>
        <p className="conn-detail">A new workspace brings its local base branch up to the remote first. It only fast-forwards: a base with commits of its own, or with uncommitted changes in its worktree, is left as it is. With this off, Kolux says when the base is behind.</p>
      </section>
      <section className="conn-card" data-section="auto-branch">
        <h2 className="conn-name">Branch names</h2>
        <label className="conn-switch">
          <input type="checkbox" role="switch" aria-label="Name the branch after the work" checked={autoBranchOn(settings)} onChange={(e) => void save(autoBranchPatch(e.target.checked))} />
          Name the branch after the work
        </label>
        <p className="conn-detail">A new workspace starts on a placeholder branch. When an agent is given its first task, the branch is renamed to a short name describing that task, with your prefix. A branch that already tracks a remote branch keeps its name. With this off, the placeholder name stays.</p>
      </section>
      <section className="conn-card" data-section="commit-writer">
        <h2 className="conn-name">Commit messages</h2>
        <WriterPicker settings={settings} save={save} />
        <InstructionsField value={String(settings[WRITER_INSTRUCTIONS_KEY] ?? "")} onSave={(text) => Promise.resolve(save({ [WRITER_INSTRUCTIONS_KEY]: text }))} />
        <p className="conn-detail">The spark button beside the commit message asks for a message describing what is staged.</p>
      </section>
      <section className="conn-card" data-section="review-bots">
        <h2 className="conn-name">Review bots</h2>
        <BotsField value={botsText(settings[REVIEW_BOTS_KEY])} onSave={(text) => Promise.resolve(save({ [REVIEW_BOTS_KEY]: parseBots(text) }))} />
        <p className="conn-detail">Authors of review comments to mark as bots, besides the ones GitHub already marks. Separate names with commas; capital letters do not matter.</p>
      </section>
      <section className="conn-card" data-section="gh-budget">
        <h2 className="conn-name">GitHub API budget</h2>
        {budget.rows === null && budget.error === null && <p className="conn-detail">Reading the budget{"\u2026"}</p>}
        {budget.error && <p className="conn-detail warn">{budget.error}</p>}
        {budget.rows?.map((b) => (
          <p key={b.name} className={budgetLow(b) ? "conn-detail warn" : "conn-detail"} data-budget={b.name}>
            {budgetLine(b, budget.at)}
          </p>
        ))}
        <div className="btn-row">
          <button className="btn" data-budget-refresh onClick={onBudget}>
            Check again
          </button>
        </div>
      </section>
      <section className="conn-card" data-section="deleting">
        <h2 className="conn-name">Deleting workspaces</h2>
        <label className="conn-switch">
          <input type="checkbox" role="switch" checked={asksBeforeDelete(settings)} onChange={(e) => save({ [CONFIRM_DELETE_FIELD]: e.target.checked })} />
          Ask before deleting a workspace
        </label>
        <p className="conn-detail">With this off, a workspace with nothing uncommitted is deleted at once. One with changes, a lock or another workspace inside it always asks.</p>
      </section>
      <SetupPolicyRow settings={settings} save={save} />
      <AiRecipesSection settings={settings} save={save} />
      <AutoPrSettings />
    </>
  );
}

export default function GitPage() {
  const { settings, error, save } = useSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const [check, setCheck] = useState<PrefixCheck | null>(null);
  const typed = draft ?? String(settings?.branchPrefixCustom ?? "");
  // SET-036: the custom prefix saves on leaving the field; changing page or closing must keep it too.
  useLeaveSave(() => settings && draft !== null && draft !== String(settings.branchPrefixCustom ?? "") && void save({ branchPrefixCustom: draft }));
  const mode = settings ? modeOf(settings) : null;
  useEffect(() => {
    if (!mode) return;
    let live = true;
    invoke<PrefixCheck>("branch_prefix_check", { mode, custom: typed })
      .then((c) => live && setCheck(c))
      .catch(() => live && setCheck(null));
    return () => {
      live = false;
    };
  }, [mode, typed]);
  // GIT-066 / GIT-028: the GitHub API budget, read when the page opens and on request.
  const [budget, setBudget] = useState<{ rows: Budget[] | null; error: string | null; at: number }>({ rows: null, error: null, at: 0 });
  const readBudget = () =>
    invoke<Budget[]>("scm_gh_budget")
      .then((rows) => setBudget({ rows, error: null, at: Date.now() / 1000 }))
      .catch((err) => setBudget({ rows: null, error: String(err), at: Date.now() / 1000 }));
  useEffect(() => void readBudget(), []);
  return (
    <>
      {error && <p className="conn-detail warn">{error}</p>}
      {settings && <GitView settings={settings} save={save} draft={typed} setDraft={setDraft} check={check} budget={budget} onBudget={() => void readBudget()} />}
    </>
  );
}
