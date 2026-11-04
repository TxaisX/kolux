// T-241 (BROW-038) and T-240 (BROW-035): the page's picture. The back end takes it from the engine
// (browser_capture); a drawing or a grabbed element's picture is saved (browser_save_picture) and
// the agent is told its path. Pure parts and the calls, with `invoke` passed in so a test fakes it.

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** What browser_capture answers: the PNG as base64 and the CSS size of the page it shows. */
export type Picture = { data: string; cssWidth: number; cssHeight: number };

/** The answer as a picture; anything short of a PNG with a size is `null`. */
export function readPicture(answer: unknown): Picture | null {
  const a = (answer ?? {}) as Partial<Picture>;
  if (typeof a.data !== "string" || !a.data) return null;
  if (!(typeof a.cssWidth === "number" && a.cssWidth >= 1) || !(typeof a.cssHeight === "number" && a.cssHeight >= 1)) return null;
  return { data: a.data, cssWidth: a.cssWidth, cssHeight: a.cssHeight };
}

export const asDataUrl = (p: Pick<Picture, "data">): string => `data:image/png;base64,${p.data}`;

/** Takes the tab's picture; throws the reason in words. */
export async function capturePage(invoke: Invoke, id: number): Promise<Picture> {
  const p = readPicture(await invoke("browser_capture", { id }));
  if (!p) throw new Error("The page gave no picture");
  return p;
}

/** Saves a PNG data URL as `name` in the captures folder, then hands `text(path)` to the agent pane `key`.
 * Nothing is sent when the save fails, and the failure reaches the caller. */
export async function sendPicture(invoke: Invoke, onSend: ((key: number, text: string) => Promise<void> | void) | undefined, key: number, a: { dataUrl: string; name: string; text: (path: string) => string }): Promise<string> {
  if (!onSend) throw new Error("No agent sessions in this workspace");
  const path = await invoke<string>("browser_save_picture", { data: a.dataUrl, name: a.name });
  await onSend(key, a.text(path));
  return path;
}
