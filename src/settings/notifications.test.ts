import { afterEach, expect, test, vi } from "vitest";
import { audioTypeAllowed, AUDIO_TYPES, CLOSE_TO_TRAY_FIELD, quietFromText, raiseNotification, readNotifications, resetPacer, settledValue, SOUNDS, TONES, testPlan } from "./notifications";

test("APP-007: close to tray is off by default and on only when saved as true", () => {
  expect(CLOSE_TO_TRAY_FIELD).toBe("closeToTray");
  expect(readNotifications({}).closeToTray).toBe(false);
  expect(readNotifications({ closeToTray: "yes" }).closeToTray).toBe(false);
  expect(readNotifications({ closeToTray: true }).closeToTray).toBe(true);
});

const calls: Array<[string, Record<string, unknown>]> = [];
let loadFails = false;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown>) => {
    calls.push([cmd, args]);
    if (cmd === "notification_sound_load") return loadFails ? Promise.reject("the file does not look like a .wav sound") : Promise.resolve(btoa("RIFFxxxxWAVE"));
    return Promise.resolve();
  },
}));
const started: string[] = [];
class FakeAudio {
  currentTime = 0;
  destination = {};
  createOscillator() {
    const o = { frequency: { value: 0 }, connect: (x: unknown) => x, start: () => started.push("tone:" + o.frequency.value), stop: () => {} };
    return o;
  }
  createGain() {
    return { gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, value: 0 }, connect: (x: unknown) => x };
  }
  createBufferSource() {
    return { buffer: null, connect: (x: unknown) => x, start: () => started.push("file"), onended: null };
  }
  decodeAudioData() {
    return Promise.resolve({});
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}
vi.stubGlobal("AudioContext", FakeAudio);
afterEach(() => {
  calls.length = 0;
  started.length = 0;
  loadFails = false;
});

test("SET-034: with nothing saved, every kind is on except the bell, focused worktrees stay quiet, full volume, system sound", () => {
  const n = readNotifications({});
  // one switch per kind: the finish and stop kinds are the keys the notifications read (STAT-041, STAT-023)
  expect(n.kinds).toEqual({ notifyOnFinish: true, notifyBell: false, notifyOnStopped: true });
  expect(n.suppressFocused).toBe(true);
  expect(n.sound).toBe("system");
  expect(n.volume).toBe(100);
});

test("SET-034: saved choices are read back; a broken volume or sound falls back to the default", () => {
  const n = readNotifications({ notifyBell: true, notifyOnStopped: false, notificationSound: "chime", notificationVolume: 35 });
  expect(n.kinds.notifyBell).toBe(true);
  expect(n.kinds.notifyOnStopped).toBe(false);
  expect(n.sound).toBe("chime");
  expect(n.volume).toBe(35);
  expect(readNotifications({ notificationVolume: 400, notificationSound: "trumpet" })).toMatchObject({ volume: 100, sound: "system" });
  expect(readNotifications({ notificationVolume: "loud" }).volume).toBe(100);
});

test("SET-034: the test plays one sound: Kolux's tone with a silent toast, or the system sound; volume 0 is silent", () => {
  expect(testPlan({ sound: "chime", volume: 40 })).toEqual({ toastSound: false, tone: "chime", file: null, gain: 0.4 });
  expect(testPlan({ sound: "system", volume: 80 })).toEqual({ toastSound: true, tone: null, file: null, gain: 0.8 });
  expect(testPlan({ sound: "chime", volume: 0 })).toEqual({ toastSound: false, tone: null, file: null, gain: 0 });
  expect(testPlan({ sound: "system", volume: 0 })).toEqual({ toastSound: false, tone: null, file: null, gain: 0 });
  // STAT-043: a custom file is played over a silent toast; with no usable file the system sound stands in
  expect(testPlan({ sound: "custom", volume: 50, customFile: "C:/s/a.wav" })).toEqual({ toastSound: false, tone: null, file: "C:/s/a.wav", gain: 0.5 });
  expect(testPlan({ sound: "custom", volume: 50, customFile: null })).toEqual({ toastSound: true, tone: null, file: null, gain: 0.5 });
});

test("SET-034: the page lists the kinds, the sound and volume, the test button and the system link", async () => {
  const { createElement } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { NotificationsView } = await import("./NotificationsPage");
  const html = renderToString(createElement(NotificationsView, { settings: { notificationVolume: 0 }, onSave: () => {} }));
  for (const t of ["An agent finishes its task", "A terminal rings its bell", "Usage alerts", "Stay quiet about the worktree you are looking at", "System default", "Silent", "Send a test notification", "System notification settings"]) expect(html).toContain(t);
});

test("STAT-043: there are nine built-in tones, the system default and a custom file to choose from", () => {
  expect(Object.keys(TONES)).toHaveLength(9);
  expect(SOUNDS.map((o) => o.id)).toEqual(["system", ...Object.keys(TONES), "custom"]);
});

test("STAT-043: a custom sound must be an allowed audio type; a saved file of another type is not read back", () => {
  for (const ok of ["a.wav", "C:/x/Ding.MP3", "b.flac"]) expect(audioTypeAllowed(ok)).toBe(true);
  for (const bad of ["a.exe", "a.txt", "wav", "a.wav.exe", ""]) expect(audioTypeAllowed(bad)).toBe(false);
  expect(AUDIO_TYPES).toContain("ogg");
  expect(readNotifications({ notificationSound: "custom", notificationCustomFile: "C:/x/a.wav" })).toMatchObject({ sound: "custom", customFile: "C:/x/a.wav" });
  expect(readNotifications({ notificationSound: "custom", notificationCustomFile: "C:/x/a.exe" }).customFile).toBeNull();
  expect(readNotifications({}).customFile).toBeNull();
});

test("STAT-043: a real notification plays the chosen tone once and its toast is silent", async () => {
  await raiseNotification({ notificationSound: "bell", notificationVolume: 60 }, "t", "b");
  expect(calls).toEqual([["notify", { title: "t", body: "b", sound: false }]]);
  expect(started).toEqual(["tone:1047", "tone:784"]);
});

test("STAT-043: the system sound plays through the toast and Kolux plays nothing; volume 0 is silent", async () => {
  await raiseNotification({}, "t", "b");
  expect(calls).toEqual([["notify", { title: "t", body: "b", sound: true }]]);
  expect(started).toEqual([]);
  calls.length = 0;
  await raiseNotification({ notificationSound: "chime", notificationVolume: 0 }, "t", "b");
  expect(calls).toEqual([["notify", { title: "t", body: "b", sound: false }]]);
  expect(started).toEqual([]);
});

test("STAT-044: an event goes through notify_event with its id and pane, and the same event never shows twice", async () => {
  resetPacer();
  const ev = { id: "p1:s:done:x:1", worktree: "C:/w/a", pane: "1", kind: "finish" as const };
  await raiseNotification({ notifySuppressFocused: false }, "t", "b", ev);
  expect(calls).toEqual([["notify_event", { title: "t", body: "b", sound: true, id: ev.id, pane: "1", kind: "finish" }]]);
  calls.length = 0;
  await raiseNotification({ notifySuppressFocused: false }, "t", "b", ev);
  expect(calls).toEqual([]);
  // a second finish in the same worktree right after is merged into the first
  await raiseNotification({ notifySuppressFocused: false }, "t", "b", { ...ev, id: "p2:s:done:y:1", pane: "2" });
  expect(calls).toEqual([]);
  resetPacer();
});

test("STAT-043: a custom file plays and not the system sound; a file that cannot load falls back to the system sound", async () => {
  const settings = { notificationSound: "custom", notificationCustomFile: "C:/x/a.wav", notificationVolume: 80 };
  await raiseNotification(settings, "t", "b");
  expect(calls).toEqual([["notification_sound_load", { path: "C:/x/a.wav" }], ["notify", { title: "t", body: "b", sound: false }]]);
  expect(started).toEqual(["file"]);
  calls.length = 0;
  started.length = 0;
  loadFails = true;
  await raiseNotification(settings, "t", "b");
  expect(calls[1]).toEqual(["notify", { title: "t", body: "b", sound: true }]);
  expect(started).toEqual([]);
});

test("STAT-044: with Kolux focused and 'Stay quiet' on (the default), nothing is shown; a gone-quiet warning still is", async () => {
  resetPacer();
  // these tests run without a DOM: stand in for a focused window
  const g = globalThis as { document?: { hasFocus: () => boolean } };
  const had = g.document;
  g.document = { hasFocus: () => true };
  const before = calls.length;
  try {
    await raiseNotification({}, "t", "b", { id: "q:1", worktree: "C:/w/a", pane: "1", kind: "finish" });
    await raiseNotification({}, "t", "b", { id: "q:2", worktree: "C:/w/b", pane: "2", kind: "finish" });
    expect(calls.slice(before)).toEqual([]);
    await raiseNotification({}, "t", "b", { id: "q:3", worktree: "C:/w/a", pane: "1", kind: "quiet" });
    await raiseNotification({}, "t", "b", { id: "q:4", worktree: "C:/w/a", pane: "1", kind: "quiet" });
    expect(calls.slice(before).map(([c]) => c)).toEqual(["notify_event", "notify_event"]);
  } finally {
    if (had === undefined) delete g.document;
    else g.document = had;
    resetPacer();
  }
});

test("UX-audit: a slider saves on release only when the value moved, and the quiet minutes read whole numbers from 0", () => {
  expect(settledValue(null, 50)).toBeNull();
  expect(settledValue(50, 50)).toBeNull();
  expect(settledValue(35, 50)).toBe(35);
  expect(settledValue(0, 50)).toBe(0);
  expect(quietFromText("12.9")).toBe(12);
  expect(quietFromText("-4")).toBe(0);
  expect(quietFromText("")).toBe(0);
  expect(quietFromText("abc")).toBe(0);
});

test("T-692 (E1): a stop right after a finish in the same worktree still shows; it keeps its own cooldown", async () => {
  resetPacer();
  const finish = { id: "p1:s:done:x:1", worktree: "C:/w/a", pane: "1", kind: "finish" as const };
  await raiseNotification({ notifySuppressFocused: false }, "t", "b", finish);
  await raiseNotification({ notifySuppressFocused: false }, "t", "b", { ...finish, id: "p1:s:stop:x:2", kind: "stop" as const });
  expect(calls.map(([c, a]) => [c, a.kind])).toEqual([["notify_event", "finish"], ["notify_event", "stop"]]);
  resetPacer();
});
