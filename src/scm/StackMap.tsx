// GIT-034 (T-313-b): the stack the checked pull request belongs to, in the Checks tab. Lists the
// chain bottom first, links to the next pull request up, and merges from the bottom up to a chosen
// one after a confirmation that names them. The rules are stack.ts's; this only asks GitHub and shows.
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { mergeActions, mergeLabel, type MergeInfo, type Pr } from "./model";
import { chainThrough, mergeThrough, nextInStack, type StackItem } from "./stack";
import { createNext } from "./stackCreate";
import { openFailed } from "./panelUx";
import "./scmUx.css";

type StackList = { trunk: string; prs: StackItem[] };
type Open = { trunk: string; prs: StackItem[] };
type Shown = { items: StackItem[]; infos: Record<number, MergeInfo>; holds: Record<number, string | null>; error: string | null };

export default function StackMap({ dir, pr }: { dir: string; pr: Pr }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [confirm, setConfirm] = useState<{ upTo: number; order: number[]; text: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // GIT-034: the form that makes the next pull request of the stack (its branch is already pushed).
  const [making, setMaking] = useState<{ branch: string; title: string; draft: boolean } | null>(null);
  const [list, setList] = useState<Open | null>(null);

  const load = async () => {
    setNote(null);
    setConfirm(null);
    try {
      const list = await invoke<StackList>("scm_stack_prs", { worktree: dir });
      setList(list);
      const chain = pr.head ? chainThrough(list.prs, list.trunk, pr.head) : { items: [] as StackItem[], error: "this pull request's branch is not known" };
      const infos: Record<number, MergeInfo> = {};
      const holds: Record<number, string | null> = {};
      for (const p of chain.items) {
        try {
          const info = await invoke<MergeInfo>("scm_merge_info", { worktree: dir, url: p.url });
          infos[p.number] = info;
          const label = mergeLabel(info);
          holds[p.number] = label === "Ready to merge" ? null : label;
        } catch (e) {
          holds[p.number] = String(e);
        }
      }
      setShown({ items: chain.items, infos, holds, error: chain.error });
    } catch (e) {
      setShown({ items: [], infos: {}, holds: {}, error: String(e) });
    }
  };

  const ask = (upTo: number) => {
    if (!shown) return;
    const plan = mergeThrough(shown.items, upTo, shown.holds);
    if (plan.refused) return setNote(plan.refused);
    setNote(null);
    setConfirm({ upTo, order: plan.order, text: plan.confirm });
  };

  const run = async () => {
    if (!shown || !confirm) return;
    setBusy(true);
    const done: number[] = [];
    try {
      for (const n of confirm.order) {
        const p = shown.items.find((x) => x.number === n)!;
        const step = mergeActions(shown.infos[n]).find((a) => a.action === "merge");
        if (!step) throw new Error(`#${n} offers no direct merge, so the stack stopped there`);
        await invoke("scm_merge", { worktree: dir, url: p.url, action: step.action, method: step.method });
        done.push(n);
      }
      setNote(`Merged ${done.map((n) => `#${n}`).join(", ")}.`);
    } catch (e) {
      setNote(`${done.length ? `Merged ${done.map((n) => `#${n}`).join(", ")}, then stopped: ` : ""}${String(e)}`);
    }
    setConfirm(null);
    setBusy(false);
    void load();
  };

  const create = async () => {
    if (!shown || !list || !making || !pr.head) return;
    setBusy(true);
    try {
      const made = await createNext(invoke, dir, { open: list.prs, trunk: list.trunk, chain: shown.items, current: pr.head, next: making.branch.trim(), title: making.title, draft: making.draft });
      setNote(`Made #${made.number} on top of ${pr.head} and recorded the stack in ${made.recorded.length === 0 ? "no description (they already said so)" : made.recorded.map((n) => `#${n}`).join(", ")}.`);
      setMaking(null);
    } catch (e) {
      setNote(String(e instanceof Error ? e.message : e));
    }
    setBusy(false);
    void load();
  };

  const next = shown ? nextInStack(shown.items, pr.number) : null;
  /** A link that will not open says so in the note, never silently. */
  const openOut = (url: string) => void invoke("open_external", { url }).catch((e) => setNote(openFailed(e)));
  return (
    <details className="stack-map" data-stack-map onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && void load()}>
      <summary>Stack</summary>
      {shown?.error && <div className="sb-hint">{shown.error}</div>}
      {shown && shown.items.length > 0 && (
        <ol className="stack-list">
          {shown.items.map((p) => (
            <li key={p.number} aria-current={p.number === pr.number ? "true" : undefined}>
              <a href={p.url} onClick={(e) => (e.preventDefault(), openOut(p.url))}>
                #{p.number}
              </a>{" "}
              <span className="name">{p.title || p.head}</span> <code>{p.head}</code> <span className="sb-hint">{shown.holds[p.number] ?? "Ready to merge"}</span>
              <button className="btn" disabled={busy} onClick={() => ask(p.number)}>
                Merge through #{p.number}
              </button>
            </li>
          ))}
        </ol>
      )}
      {next && (
        <button className="btn" data-stack-next onClick={() => openOut(next.url)}>
          Open the next pull request (#{next.number})
        </button>
      )}
      {shown && !next && shown.items.some((p) => p.number === pr.number) && !making && (
        <button className="btn" data-stack-create onClick={() => setMaking({ branch: "", title: "", draft: false })}>
          Make the next pull request on top of this one
        </button>
      )}
      {making && (
        <div className="note" data-stack-form>
          <div className="sb-hint">The branch must already be pushed. The new pull request rests on {pr.head}, and every description in the stack gets a note listing it.</div>
          <input className="input" aria-label="Branch of the next pull request" placeholder="branch name" value={making.branch} onChange={(e) => setMaking({ ...making, branch: e.target.value })} />
          <input className="input" aria-label="Title of the next pull request" placeholder="title" value={making.title} onChange={(e) => setMaking({ ...making, title: e.target.value })} />
          <label>
            <input type="checkbox" checked={making.draft} onChange={(e) => setMaking({ ...making, draft: e.target.checked })} /> Draft
          </label>
          <button className="btn" disabled={busy || !making.branch.trim() || !making.title.trim()} onClick={() => void create()}>
            Make it
          </button>
          <button className="btn" disabled={busy} onClick={() => setMaking(null)}>
            Cancel
          </button>
        </div>
      )}
      {confirm && (
        <div role="alertdialog" aria-label="Confirm the stack merge" className="note" data-stack-confirm>
          {confirm.text}{" "}
          <button className="btn" disabled={busy} onClick={() => void run()}>
            Merge
          </button>
          <button className="btn" disabled={busy} onClick={() => setConfirm(null)}>
            Cancel
          </button>
        </div>
      )}
      {note && <div className="sb-hint" role="status">{note}</div>}
    </details>
  );
}
