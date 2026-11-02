// Harness for the APP-024..027 cards: the real UpdateCenter on the small DOM under fake time, the back end
// (update_status / update_check / update_download / update_restart) stood in by a scripted feed.
import { act, createElement } from "react";
import { vi } from "vitest";
import { type FakeDocument, type FakeNode, find, installDom, mount } from "../../tasks/fakeDom";

export type Info = { version: string; currentVersion: string; notes: string[] };
export const T0 = Date.UTC(2026, 9, 26, 12, 0, 0);

export const feed = {
  status: { enabled: true, reason: null as string | null, currentVersion: "0.1.0", lastCheckAt: T0 as number | null, dismissedVersion: null as string | null, tipDone: false, ready: null as Info | null },
  latest: null as Info | null, // what the release feed offers; null = nothing newer
  checkError: null as string | null,
  holdDownload: false,
  holdCheck: false,
  releaseCheck: null as null | (() => void),
  calls: [] as { cmd: string; args: Record<string, unknown> }[],
  release: null as null | (() => void),
};
export const sent = (cmd: string) => feed.calls.filter((c) => c.cmd === cmd);
export const info = (version: string, notes: string[] = ["One", "Two", "Three", "Four", "Five"]): Info => ({ version, currentVersion: "0.1.0", notes });

export const coreMock = {
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    feed.calls.push({ cmd, args });
    if (cmd === "update_status") return Promise.resolve(feed.status);
    if (cmd === "update_check" && feed.holdCheck) return new Promise((ok) => (feed.releaseCheck = () => ok(feed.latest)));
    if (cmd === "update_check") return feed.checkError ? Promise.reject(feed.checkError) : Promise.resolve(feed.latest);
    if (cmd === "update_download") {
      const done = feed.latest;
      if (!feed.holdDownload) return Promise.resolve(done);
      return new Promise((ok) => (feed.release = () => ok(done)));
    }
    return Promise.resolve(null);
  },
};
export const eventMock = { listen: () => Promise.resolve(() => {}) };

export function online(on: boolean) {
  Object.defineProperty(globalThis, "navigator", { value: { onLine: on, platform: "Win32", userAgent: "node" }, configurable: true });
}

/** Fake time, a window that carries events and timers, and the connection up. */
export function installUpdateDom(): FakeDocument {
  vi.useFakeTimers({ now: T0, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  const dom = installDom();
  const bus = new Map<string, Set<(e: Event) => void>>();
  Object.assign(dom.win, {
    setTimeout: (...a: Parameters<typeof setTimeout>) => globalThis.setTimeout(...a),
    clearTimeout: (h: number) => globalThis.clearTimeout(h),
    setInterval: (...a: Parameters<typeof setInterval>) => globalThis.setInterval(...a),
    clearInterval: (h: number) => globalThis.clearInterval(h),
    addEventListener: (t: string, f: (e: Event) => void) => void (bus.get(t) ?? bus.set(t, new Set()).get(t)!).add(f),
    removeEventListener: (t: string, f: (e: Event) => void) => void bus.get(t)?.delete(f),
    dispatchEvent: (e: Event) => (bus.get(e.type)?.forEach((f) => f(e)), true),
  });
  const proto = (dom.doc.createElement("div") as FakeNode).constructor.prototype as Record<string, unknown>;
  proto.getAnimations = () => [];
  online(true);
  feed.status = { enabled: true, reason: null, currentVersion: "0.1.0", lastCheckAt: T0, dismissedVersion: null, tipDone: false, ready: null };
  Object.assign(feed, { latest: null, checkError: null, holdDownload: false, holdCheck: false, releaseCheck: null, calls: [], release: null });
  return dom.doc as FakeDocument;
}

export async function mountCenter(doc: FakeDocument) {
  const { default: UpdateCenter } = await import("../UpdateCenterView"); // the screen itself; UpdateCenter.tsx is its lazy door
  const m = await mount(createElement(UpdateCenter), doc);
  await pump(0);
  return m;
}
/** Moves the fake clock, running React's effects and the scripted promises as it goes. */
export const pump = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
export async function sendWindow(name: string) {
  await act(async () => {
    (globalThis as unknown as { window: Window }).window.dispatchEvent(new Event(name));
  });
}

const cls = (n: FakeNode) => `${n.attrs.class ?? ""} ${n.attrs.className ?? ""}`;
export const byClass = (root: FakeNode, c: string) => find(root, (n) => cls(n).split(" ").includes(c));
export const card = (root: FakeNode) => byClass(root, "upd-card")[0] ?? null;
export const popup = (root: FakeNode) => byClass(root, "upd-pop")[0] ?? null;
/** The notice (the ready pop-up): its sentence and its Update now / Later buttons. */
export const popupText = (root: FakeNode) => byClass(root, "upd-pop-text")[0]?.textContent ?? null;
export const popupButton = (root: FakeNode, label: string) => find(popup(root) ?? root, (n) => n.localName === "button" && n.textContent === label)[0];
export const cardTitle = (root: FakeNode) => byClass(root, "upd-title")[0]?.textContent ?? null;
export const notes = (root: FakeNode) => byClass(root, "upd-notes").flatMap((u) => find(u, (n) => n.localName === "li").map((l) => l.textContent));
export const byTitle = (root: FakeNode, t: string) => find(root, (n) => n.localName === "button" && n.attrs.title === t)[0];
export const errorText = (root: FakeNode) => byClass(root, "upd-err").map((n) => n.textContent);
