// STUB: replaced by the engine lane at merge
// The chat screen's whole view of OpenCode: the models it reaches and the chats it keeps. The real file
// asks OpenCode; this one answers from a fixed list so the screen can be built and tested alone.
// Only these names are imported by the screen (src/chat/webui/**, src/chat/live/ChatPane.tsx).

export interface ChatModel { id: string; label: string; provider: string; efforts: string[] }
export interface ChatSessionSummary { id: string; title: string; updatedAt: number /* ms epoch */ }

export const DEFAULT_CHAT_MODEL = "openrouter/anthropic/claude-sonnet-5.5";
export const CHAT_AGENT = "opencode";

const LEVELS = ["low", "medium", "high"];

const MODELS: ChatModel[] = [
  { id: "openrouter/anthropic/claude-opus-5.5", label: "Claude Opus 5.5", provider: "anthropic", efforts: LEVELS },
  { id: "openrouter/anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", provider: "anthropic", efforts: LEVELS },
  { id: "openrouter/anthropic/claude-haiku-5", label: "Claude Haiku 5", provider: "anthropic", efforts: [] },
  { id: "openrouter/openai/gpt-5.5", label: "GPT-5.5", provider: "openai", efforts: ["minimal", ...LEVELS] },
  { id: "openrouter/openai/gpt-5.5-mini", label: "GPT-5.5 mini", provider: "openai", efforts: LEVELS },
  { id: "openrouter/openai/gpt-oss-120b", label: "gpt-oss 120B", provider: "openai", efforts: [] },
  { id: "openrouter/google/gemini-3-pro", label: "Gemini 3 Pro", provider: "google", efforts: LEVELS },
  { id: "openrouter/google/gemini-3-flash", label: "Gemini 3 Flash", provider: "google", efforts: [] },
  { id: "openrouter/x-ai/grok-5", label: "Grok 5", provider: "x-ai", efforts: [] },
  { id: "openrouter/x-ai/grok-5-fast", label: "Grok 5 Fast", provider: "x-ai", efforts: [] },
  { id: "openrouter/deepseek/deepseek-v4.1", label: "DeepSeek V4.1", provider: "deepseek", efforts: [] },
  { id: "openrouter/deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", provider: "deepseek", efforts: [] },
];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const sessions = (): ChatSessionSummary[] => {
  const now = Date.now();
  return [
    { id: "ses-1", title: "Why does the build fail on Windows", updatedAt: now - 2 * HOUR },
    { id: "ses-2", title: "Rename the settings page", updatedAt: now - 30 * HOUR },
    { id: "ses-3", title: "Write release notes for 0.3.1", updatedAt: now - 3 * DAY },
    { id: "ses-4", title: "Explain the update feed", updatedAt: now - 9 * DAY },
    { id: "ses-5", title: "Plan the Open WebUI chat screen", updatedAt: now - 20 * DAY },
  ];
};
let kept: ChatSessionSummary[] | null = null;

export async function listChatModels(): Promise<ChatModel[]> {
  return MODELS.map((m) => ({ ...m, efforts: [...m.efforts] }));
}

export async function listChatSessions(_cwd: string): Promise<ChatSessionSummary[]> {
  kept ??= sessions();
  return [...kept].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteChatSession(_cwd: string, id: string): Promise<void> {
  kept = (kept ?? sessions()).filter((s) => s.id !== id);
}
