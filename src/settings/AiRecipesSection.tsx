// GIT-019 / T-313-b: the Source Control AI actions under Settings, Git: the one switch, the recipe of
// each action (with variable chips and the reason a recipe cannot be saved), and a mode per repository.
import { useEffect, useState } from "react";
import { RECIPE_ACTIONS, RECIPES_KEY, REPO_AI_KEY, migrateRecipes, recipeProblem, recipeVariables, recipesOf, repoAiMode, withRepoAi, type Recipe, type RecipeAction, type RepoAiMode } from "../scm/recipes";
import { typedRepoId } from "../scm/repoId";
import { SCM_AI_HIDDEN_KEY, aiControlsShown } from "../scm/rules";
import { ResetButton } from "./SafetyRules";

type Props = { settings: Record<string, unknown>; save: (patch: Record<string, unknown>) => unknown };
const BLANK: Recipe = { agent: null, args: "", template: "" };
const MODES: [RepoAiMode, string][] = [["follow", "Follow the global choice"], ["on", "AI actions on"], ["off", "AI actions off"]];

function RecipeEditor({ action, label, saved, onSave }: { action: RecipeAction; label: string; saved: Recipe | undefined; onSave: (r: Recipe | null) => void }) {
  const [draft, setDraft] = useState<Recipe>(saved ?? BLANK);
  const problem = recipeProblem(action, draft);
  const chip = (v: string) => setDraft({ ...draft, template: `${draft.template}{${v}}`, agent: draft.agent });
  return (
    <div className="recipe" data-recipe={action}>
      <h3 className="conn-name">{label}</h3>
      <input className="field" aria-label={`${label} agent`} placeholder="Agent, e.g. claude" value={draft.agent ?? ""} onChange={(e) => setDraft({ ...draft, agent: e.target.value || null })} />
      <input className="field" aria-label={`${label} extra arguments`} placeholder="Extra arguments" value={draft.args} onChange={(e) => setDraft({ ...draft, args: e.target.value })} />
      <input className="field" aria-label={`${label} command template`} placeholder="Or a command template" value={draft.template} onChange={(e) => setDraft({ ...draft, template: e.target.value })} />
      <div className="recipe-chips">
        {recipeVariables(action).map((v) => (
          <button key={v} type="button" className="btn" aria-label={`Insert {${v}}`} onClick={() => chip(v)}>{`{${v}}`}</button>
        ))}
      </div>
      {problem && <p className="conn-detail" role="alert">{problem}</p>}
      <button type="button" className="btn" disabled={problem !== null} onClick={() => onSave(draft)}>Save</button>
      {saved && <ResetButton label="Clear" ariaLabel={`Clear ${label} recipe`} yes="Yes, clear" onReset={() => (setDraft(BLANK), onSave(null))} />}
    </div>
  );
}

export default function AiRecipesSection({ settings, save }: Props) {
  const recipes = recipesOf(settings[RECIPES_KEY]);
  const [repo, setRepo] = useState("");
  const [repoError, setRepoError] = useState(false);
  // First launch after recipes exist: the earlier single agent choice becomes recipes.
  useEffect(() => {
    const m = migrateRecipes(settings);
    if (m) void save({ [RECIPES_KEY]: m });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const put = (action: RecipeAction, r: Recipe | null) => {
    const next = { ...recipes };
    if (r) next[action] = r;
    else delete next[action];
    void save({ [RECIPES_KEY]: next });
  };
  const modes = (settings[REPO_AI_KEY] as Record<string, RepoAiMode> | undefined) ?? {};
  return (
    <section className="conn-card" data-section="ai-recipes">
      <h2 className="conn-name">Let AI write Git text (branch names, pull request titles and descriptions)</h2>
      <label className="look-select">
        <input type="checkbox" checked={aiControlsShown(settings)} onChange={(e) => void save({ [SCM_AI_HIDDEN_KEY]: !e.target.checked })} /> Show the AI actions in Source Control
      </label>
      <p className="conn-detail">One switch for the generate and Fix with AI controls. A repository below can follow it or override it.</p>
      {RECIPE_ACTIONS.map((a) => (
        <RecipeEditor key={`${a.id}:${JSON.stringify(recipes[a.id] ?? null)}`} action={a.id} label={a.label} saved={recipes[a.id]} onSave={(r) => put(a.id, r)} />
      ))}
      <h3 className="conn-name">Per repository</h3>
      <ul className="conn-list">
        {Object.keys(modes).map((r) => (
          <li key={r}>
            <span className="name">{r}</span>{" "}
            <select aria-label={`AI actions for ${r}`} className="field" value={repoAiMode(settings, r)} onChange={(e) => void save({ [REPO_AI_KEY]: withRepoAi(settings, r, e.target.value as RepoAiMode) })}>
              {MODES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      <input className="field" aria-label="Repository to override" title="Paste a remote URL or type host/owner/name, or a folder path when there is no remote; it is saved under the id the app resolves. Source Control also has a switch for the repository you are in." placeholder="https://github.com/owner/name, or a folder path" value={repo} onChange={(e) => (setRepo(e.target.value), setRepoError(false))} />
      <button
        type="button"
        className="btn"
        disabled={repo.trim() === ""}
        onClick={() =>
          void typedRepoId(repo).then((id) => {
            if (id === null) return setRepoError(true);
            void save({ [REPO_AI_KEY]: withRepoAi(settings, id, "off") });
            setRepo("");
          })
        }
      >
        Turn AI actions off for it
      </button>
      {repoError && <div className="note warn" role="status">That repository could not be read.</div>}
    </section>
  );
}
