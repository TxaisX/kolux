// Native chat, attachments (CHAT-021; T-334): an image pasted into the box, a file dropped on the chat or
// picked with Attach file becomes a chip above the box; the message goes to the agent with the files' paths
// after the text. Pure rules here; the chips and the listeners are in MessageBox.tsx.
import { overRect } from "../terminal/drop";

/** Attachments waiting at once; more are refused with a message. */
export const MAX_ATTACHMENTS = 5;
/** The agents that take an image by its path. */
export const IMAGE_AGENTS = ["claude", "codex"];

export type Attachment = {
  id: string;
  name: string;
  /** Where the file is, once saved. */
  path?: string;
  image: boolean;
  state: "saving" | "ready" | "failed";
  /** A small picture for an image pasted from the clipboard. */
  thumb?: string;
  error?: string;
};

export const canTakeImages = (agent: string | undefined) => !!agent && IMAGE_AGENTS.includes(agent);
export const NO_IMAGES_NOTE = "This agent cannot take images, so the pasted image was not attached.";
export const TOO_MANY_NOTE = `At most ${MAX_ATTACHMENTS} attachments can wait at once. Send the message or remove one.`;

/** A refusal for one more attachment, or null. `image`: it is a pasted image, which some agents cannot take. */
export function refusal(list: readonly Attachment[], agent: string | undefined, pastedImage: boolean): string | null {
  if (pastedImage && !canTakeImages(agent)) return NO_IMAGES_NOTE;
  if (list.length >= MAX_ATTACHMENTS) return TOO_MANY_NOTE;
  return null;
}

/** Send is held while any attachment is still being saved. */
export const saving = (list: readonly Attachment[]) => list.some((a) => a.state === "saving");

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp" };
/** A pasted image gets a plain generic name; `n` counts the pasted images of this message (from 1). */
export const pastedName = (kind: string, n: number) => `Pasted image ${n}.${EXT[kind] ?? "png"}`;

/** A picked or dropped file keeps its own name. */
export const nameOf = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
export const isImageName = (name: string) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(name);

/** Whether the message can be sent: some text or at least one attachment, and nothing still saving. */
export const sendable = (text: string, list: readonly Attachment[]) => !saving(list) && (text.trim() !== "" || list.some((a) => a.state === "ready"));

const quoted = (p: string) => (/\s/.test(p) ? `"${p}"` : p);
/** The message as the agent gets it: the text, then the paths of the ready attachments on a line of their own. */
export function withPaths(text: string, list: readonly Attachment[]): string {
  const paths = list.filter((a) => a.state === "ready" && a.path).map((a) => quoted(a.path as string));
  if (paths.length === 0) return text;
  const body = text.replace(/\s+$/, "");
  return body ? `${body}\n${paths.join(" ")}` : paths.join(" ");
}

export const without = (list: readonly Attachment[], id: string) => list.filter((a) => a.id !== id);
export const update = (list: readonly Attachment[], id: string, patch: Partial<Attachment>) => list.map((a) => (a.id === id ? { ...a, ...patch } : a));

/** A drop counts only when it lands on this pane: the point is inside the pane's box and the element under it belongs to the pane. */
export function dropHere(point: { x: number; y: number }, rect: { left: number; top: number; right: number; bottom: number }, underInside: boolean): boolean {
  return overRect(point.x, point.y, rect) && underInside;
}
