// SESS-034 (T-187-b): start work on a GitHub issue or pull request straight from its row. A workspace
// is made for the item (a pull request on its own branch, with its number in the workspace name; the
// existing create-from-item command does that) and an agent starts there with the item as its opening
// prompt. Bad per-launch arguments are refused before any workspace is made, and a saved agent that is
// switched off is never launched. Trackers other than GitHub are cut (SESS-046).
import type { WorkItem } from "../projects/model";
import { NO_AGENT, parseArgs, pickSaved, startChecked, type Launch, type StartAgent, type StartResult } from "./rules";

/** The item's web address on its host. */
export const itemUrl = (i: WorkItem): string => `https://${i.host}/${i.owner}/${i.repo}/${i.kind === "pull" ? "pull" : "issues"}/${i.number}`;

const oneLine = (t: string, max = 200): string => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** The agent's opening prompt: what the item is and how to read all of it. */
export function itemPrompt(i: WorkItem, title: string, url: string = itemUrl(i)): string {
  const name = `${i.owner}/${i.repo}`;
  const what = oneLine(title);
  if (i.kind === "pull") {
    return `Work on pull request #${i.number}${what ? ` "${what}"` : ""} in ${name} (${url}). This workspace is on the pull request's own branch. Read the pull request, its review comments and its checks (gh pr view ${i.number} --comments, gh pr checks ${i.number}), then say what you will do before you change anything.`;
  }
  return `Work on issue #${i.number}${what ? ` "${what}"` : ""} in ${name} (${url}). Read the whole issue and its comments (gh issue view ${i.number} --comments), then say what you will do before you change anything.`;
}

export type FromItemRun = {
  item: WorkItem;
  title: string;
  agents: StartAgent[];
  saved: unknown;
  defaultId: string;
  /** Per-launch arguments typed for this start, "" for none. */
  argsText: string;
  /** The workspace already made for the item, when there is one: it is used, not made twice. */
  existing: string | null;
  makeWorkspace: (item: WorkItem) => Promise<{ path: string }>;
  ready: (dir: string) => Promise<void>;
  launch: Launch;
};

/** Makes the workspace and starts the agent. Order matters: the arguments and the agent are checked
 *  first, so a refusal leaves no workspace behind. */
export async function runFromItem(o: FromItemRun): Promise<StartResult> {
  const parsed = parseArgs(o.argsText);
  if ("error" in parsed) return { ok: false, stage: "arguments", message: parsed.error };
  const agent = pickSaved(o.agents, o.saved, o.defaultId);
  if (!agent) return { ok: false, stage: "agent", message: NO_AGENT };
  let dir = o.existing;
  if (!dir) {
    try {
      dir = (await o.makeWorkspace(o.item)).path;
    } catch (err) {
      return { ok: false, stage: "workspace", message: String(err instanceof Error ? err.message : err) };
    }
  }
  return startChecked({ agent, dir, prompt: itemPrompt(o.item, o.title), extra: parsed.args, what: o.item.kind === "pull" ? "the pull request" : "the issue", ready: o.ready, launch: o.launch });
}
