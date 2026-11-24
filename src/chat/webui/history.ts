// The chat history column's rules (2026-11-24): which day-group a chat falls in, the title search, and when
// the column is shown. Pure, so the day boundaries and the width rule are tested without a screen.
import type { ChatSessionSummary } from "../opencode";
import { readKey, writeKey, type Store } from "./storage";

export type GroupLabel = "Today" | "Yesterday" | "Previous 7 days" | "Older";
export type Group = { label: GroupLabel; sessions: ChatSessionSummary[] };

const ORDER: GroupLabel[] = ["Today", "Yesterday", "Previous 7 days", "Older"];

/** Local midnight at the start of the day `at` falls on, stepped back `days` whole days (by the calendar, so a clock change cannot shift it). */
function dayStart(at: number, days = 0): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - days).getTime();
}

export function labelFor(updatedAt: number, now: number): GroupLabel {
  if (updatedAt >= dayStart(now)) return "Today";
  if (updatedAt >= dayStart(now, 1)) return "Yesterday";
  if (updatedAt >= dayStart(now, 7)) return "Previous 7 days";
  return "Older";
}

/** Chats under Today, Yesterday, Previous 7 days and Older, newest first inside each; a group with no chat is left out. */
export function groupSessions(sessions: readonly ChatSessionSummary[], now: number): Group[] {
  const by = new Map<GroupLabel, ChatSessionSummary[]>();
  for (const s of [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const label = labelFor(s.updatedAt, now);
    by.set(label, [...(by.get(label) ?? []), s]);
  }
  return ORDER.filter((l) => by.has(l)).map((label) => ({ label, sessions: by.get(label)! }));
}

/** The chats whose title holds every word typed (any case). An empty search keeps them all. */
export function filterSessions(sessions: readonly ChatSessionSummary[], query: string): ChatSessionSummary[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...sessions];
  return sessions.filter((s) => {
    const title = s.title.toLowerCase();
    return words.every((w) => title.includes(w));
  });
}

/** Below this pane width the column hides itself and the chat gets the room. */
export const NARROW_PX = 640;

export type ColumnMode = "hidden" | "rail" | "full";

/** `width` is the chat pane's width, or null before it is measured (then the saved choice decides). */
export function columnMode(width: number | null, collapsed: boolean): ColumnMode {
  if (width !== null && width < NARROW_PX) return "hidden";
  return collapsed ? "rail" : "full";
}

export const COLLAPSED_KEY = "kolux.chat.historyCollapsed";

export const loadCollapsed = (store?: Store): boolean => readKey(COLLAPSED_KEY, store) === "1";
export const saveCollapsed = (collapsed: boolean, store?: Store): void => writeKey(COLLAPSED_KEY, collapsed ? "1" : "0", store);
