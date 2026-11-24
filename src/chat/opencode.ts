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

function modelsOf(answer: unknown): ChatModel[] {
  if (!Array.isArray(answer)) return [];
  const out: ChatModel[] = [];
  for (const v of answer) {
    const r = rowOf(v);
    const id = text(r?.id);
    if (!r || !id) continue;
    out.push({ id, label: text(r.label) || id, provider: text(r.provider), efforts: Array.isArray(r.efforts) ? r.efforts.filter((e): e is string => typeof e === "string") : [] });
  }
  return out;
}

let listed: ChatModel[] | null = null;
let asking: Promise<ChatModel[]> | null = null;

/** The models OpenCode lists. Cached once a list has arrived; never throws: a failure is an empty list
 *  and a console warning, and the next call asks again. */
export async function listChatModels(): Promise<ChatModel[]> {
  if (listed) return listed;
  asking ??= invoke<unknown>("chat_models")
    .then((answer) => {
      const list = modelsOf(answer);
      // OpenCode can answer with nothing in its first moments, so an empty list is never kept.
      if (list.length > 0) listed = list;
      return list;
    })
    .catch((err: unknown) => {
      console.warn("The chat's model list could not be read from OpenCode.", err);
      return [] as ChatModel[];
    })
    .finally(() => {
      asking = null;
    });
  return asking;
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
