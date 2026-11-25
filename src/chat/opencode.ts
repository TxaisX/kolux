// OpenCode behind the chat page (2026-11-24). Every chat, Claude's models included, runs through OpenCode:
// the Rust engine keeps one hidden OpenCode server and asks it for the models, a folder's saved chats and
// their history. This file is the page's side of those three questions; sending and hearing a chat stay in
// live/client.ts. The contract is docs/chat-engine.md.
import { invoke } from "@tauri-apps/api/core";

export interface ChatModel { id: string; label: string; provider: string; efforts: string[] }
// id = the exact string `opencode models` prints, e.g. "openrouter/anthropic/claude-opus-5.5".
// label = a readable name ("Claude Opus 5.5"); provider = the vendor segment ("anthropic").
// efforts = reasoning levels OpenCode can pass for that model, [] when none.
export interface ChatSessionSummary { id: string; title: string; updatedAt: number /* ms epoch */ }

/** The model a new chat starts on before another is picked: cheap and quick. OpenCode lists it (checked 2026-11-24). */
export const DEFAULT_CHAT_MODEL: string = "openrouter/deepseek/deepseek-v4.1-flash-1017";
/** The agent name the chat engine knows OpenCode by. */
export const CHAT_AGENT = "opencode";

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const rowOf = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);

/** An OpenRouter alias id carries a "~" on its maker (`~anthropic/claude-opus-latest`): it names whichever
 *  model the maker calls the latest. It is filed under the maker and its label says so. */
const isAlias = (id: string, provider: string): boolean => provider.startsWith("~") || id.split("/").some((part) => part.startsWith("~"));
const unTilde = (s: string): string => s.replace(/^~/, "");
export function aliasLabel(label: string): string {
  return /\(latest\)/i.test(label) ? label : `${label.replace(/[-\s]*latest$/i, "").trim()} (latest)`;
}

function modelsOf(answer: unknown): ChatModel[] {
  if (!Array.isArray(answer)) return [];
  const out: ChatModel[] = [];
  const seen = new Set<string>();
  for (const v of answer) {
    const r = rowOf(v);
    const id = text(r?.id);
    // A model listed twice is shown once, so a star cannot make a second row.
    if (!r || !id || seen.has(id)) continue;
    seen.add(id);
    const provider = text(r.provider);
    const label = text(r.label) || id;
    out.push({
      id,
      label: isAlias(id, provider) ? aliasLabel(label) : label,
      provider: unTilde(provider),
      efforts: Array.isArray(r.efforts) ? r.efforts.filter((e): e is string => typeof e === "string") : [],
    });
  }
  return out;
}

let listed: ChatModel[] | null = null;
let asking: Promise<ChatModel[]> | null = null;
/** Counts up each time the server's list may have changed under us, so an answer from before is not kept. */
let generation = 0;
let serverPid: number | null = null;
const staleHearers = new Set<() => void>();

/** Hears that the list may be out of date (the server restarted): ask `listChatModels` again. Returns the way to stop hearing. */
export function onModelsStale(fn: () => void): () => void {
  staleHearers.add(fn);
  return () => void staleHearers.delete(fn);
}

/** A chat's `started` event names the server's process. A different one than last time is a restarted
 *  server, whose model list may differ (a key was added, a provider came up), so the kept list is dropped. */
export function noteServer(pid: number): void {
  const before = serverPid;
  serverPid = pid;
  if (before === null || before === pid) return;
  generation += 1;
  listed = null;
  asking = null;
  for (const fn of [...staleHearers]) fn();
}

/** The models OpenCode lists. Cached once a list has arrived; never throws: a failure is an empty list
 *  and a console warning, and the next call asks again. One request at a time is shared by every asker. */
export async function listChatModels(): Promise<ChatModel[]> {
  if (listed) return listed;
  if (asking) return asking;
  const mine = generation;
  const request: Promise<ChatModel[]> = invoke<unknown>("chat_models")
    .then((answer) => {
      const list = modelsOf(answer);
      // OpenCode can answer with nothing in its first moments, so an empty list is never kept; neither is
      // an answer from a server that has restarted since the question.
      if (list.length > 0 && mine === generation) listed = list;
      return list;
    })
    .catch((err: unknown) => {
      console.warn("The chat's model list could not be read from OpenCode.", err);
      return [] as ChatModel[];
    })
    .finally(() => {
      if (asking === request) asking = null;
    });
  asking = request;
  return request;
}

/** OpenCode's saved sessions for that folder, newest first. */
export async function listChatSessions(cwd: string): Promise<ChatSessionSummary[]> {
  const answer = await invoke<unknown>("chat_sessions", { cwd });
  const out: ChatSessionSummary[] = [];
  for (const v of Array.isArray(answer) ? answer : []) {
    const r = rowOf(v);
    const id = text(r?.id);
    if (!r || !id) continue;
    out.push({ id, title: text(r.title), updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0 });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Deletes one saved session of that folder from OpenCode. It cannot be brought back. */
export async function deleteChatSession(cwd: string, id: string): Promise<void> {
  await invoke("chat_session_delete", { cwd, session: id });
}
