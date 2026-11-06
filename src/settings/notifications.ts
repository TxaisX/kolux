// SET-034: Settings > Notifications. Which kinds of event may raise a notification, which sound it
// plays and how loud. STAT-043: the real notifications (raiseNotification, called by the status
// hooks) play the same choice the test button does: the system's sound, one of nine Kolux tones, or
// a custom audio file, at the saved volume, with the toast silent whenever Kolux plays its own.
import { invoke } from "@tauri-apps/api/core";
import { newPaceMemory, paced, type NotifyEvent } from "../notify/pace";
import { masterOn } from "../status/notifyMaster";

/** The kinds of notification, their settings keys and what they are when nothing is saved. The
 * finish and stop keys are the ones the agent notifications read (STAT-041, STAT-023); usage alerts
 * have their own section below (USAGE-009). */
export const KINDS = [
  { key: "notifyOnFinish", label: "An agent finishes its task or needs permission", on: true },
  { key: "notifyBell", label: "A terminal rings its bell", on: false },
  { key: "notifyOnStopped", label: "An agent halts on a usage limit, a lapsed sign-in or a provider error", on: true },
] as const;
export type KindKey = (typeof KINDS)[number]["key"];
export const SUPPRESS_FOCUSED_FIELD = "notifySuppressFocused";
/** The key an earlier build of the hook read; the page never wrote it. Read once as a fallback so a choice saved there is not lost. */
export const LEGACY_QUIET_FIELD = "notifyQuietWhenFocused";

/** STAT-042: whether a focused window stays quiet. The page's key wins, then the old key, else on. One reader for the page and the status hook. */
export function suppressFocused(s: Record<string, unknown>): boolean {
  const v = s[SUPPRESS_FOCUSED_FIELD];
  if (typeof v === "boolean") return v;
  const old = s[LEGACY_QUIET_FIELD];
  return typeof old === "boolean" ? old : true;
}
export const SOUND_FIELD = "notificationSound";
export const VOLUME_FIELD = "notificationVolume";
export const CUSTOM_FIELD = "notificationCustomFile";
/** STAT-043: the audio types a custom sound may be (the Rust side checks the file's bytes too). */
export const AUDIO_TYPES = ["wav", "mp3", "ogg", "oga", "opus", "m4a", "aac", "flac"] as const;
export function audioTypeAllowed(path: string): boolean {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path.trim())?.[1]?.toLowerCase();
  return ext !== undefined && (AUDIO_TYPES as readonly string[]).includes(ext);
}

/** Kolux's own tones, made for Kolux (DECISIONS section 5): short note sequences, in hertz. */
export const TONES = {
  chime: [880, 1320],
  ping: [1568],
  pulse: [523, 523],
  rise: [523, 659, 784],
  fall: [784, 659, 523],
  bell: [1047, 784],
  drop: [988, 740],
  twin: [1175, 1175],
  glow: [440, 554, 659],
} as const;
export type Tone = keyof typeof TONES;
export type Sound = "system" | Tone | "custom";
export const SOUNDS: Array<{ id: Sound; label: string }> = [
  { id: "system", label: "System default" },
  { id: "chime", label: "Chime" },
  { id: "ping", label: "Ping" },
  { id: "pulse", label: "Pulse" },
  { id: "rise", label: "Rise" },
  { id: "fall", label: "Fall" },
  { id: "bell", label: "Bell" },
  { id: "drop", label: "Drop" },
  { id: "twin", label: "Twin" },
  { id: "glow", label: "Glow" },
  { id: "custom", label: "Custom file" },
];

export function readNotifications(s: Record<string, unknown>) {
  const kinds = Object.fromEntries(KINDS.map((k) => [k.key, typeof s[k.key] === "boolean" ? (s[k.key] as boolean) : k.on])) as Record<KindKey, boolean>;
  const v = s[VOLUME_FIELD];
  // SAFE-028: a saved volume out of range is held to 0..100; one that is not a number is the default.
  const volume = typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 100;
  const sound = SOUNDS.some((o) => o.id === s[SOUND_FIELD]) ? (s[SOUND_FIELD] as Sound) : "system";
  const f = s[CUSTOM_FIELD];
  const customFile = typeof f === "string" && f.trim() !== "" && audioTypeAllowed(f) ? f : null;
  return { kinds, suppressFocused: suppressFocused(s), sound, volume, customFile, closeToTray: s[CLOSE_TO_TRAY_FIELD] === true };
}

/** APP-007: the close button hides the window to the tray instead of quitting (Windows; off by
 * default). The Rust side (tray.rs close_hides) reads the same key. */
export const CLOSE_TO_TRAY_FIELD = "closeToTray";

/** What a notification plays: Kolux's tone or custom file over a silent toast, or the system's own
 * sound; only ever one of them, and nothing at volume 0. A custom choice with no usable file is the
 * system sound. */
export function testPlan({ sound, volume, customFile = null }: { sound: Sound; volume: number; customFile?: string | null }) {
  const gain = volume / 100;
  if (gain === 0) return { toastSound: false, tone: null, file: null, gain };
  if (sound === "custom") return customFile ? { toastSound: false, tone: null, file: customFile, gain } : { toastSound: true, tone: null, file: null, gain };
  return sound === "system" ? { toastSound: true, tone: null, file: null, gain } : { toastSound: false, tone: sound, file: null, gain };
}
export type Plan = ReturnType<typeof testPlan>;

/** Plays one of Kolux's tones at `gain` (0 to 1): each note a short sine with a soft fade. */
export function playTone(tone: Tone, gain: number): void {
  const ctx = new AudioContext();
  TONES[tone].forEach((hz, i) => {
    const at = ctx.currentTime + i * 0.16;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.frequency.value = hz;
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.5 * gain), at + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
    osc.connect(amp).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.32);
  });
  setTimeout(() => void ctx.close(), 1000);
}

/** STAT-043: reads a custom sound through the app (type and size checked there) and returns a
 * function that plays it once at `gain`. Throws when the file is missing, not an allowed type or
 * not decodable. */
export async function loadSound(path: string, gain: number): Promise<(() => void) & { close: () => void }> {
  const b64 = await invoke<string>("notification_sound_load", { path });
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(bytes.buffer);
    const play = () => {
      const src = ctx.createBufferSource();
      const amp = ctx.createGain();
      src.buffer = buffer;
      amp.gain.value = gain;
      src.connect(amp).connect(ctx.destination);
      src.onended = () => void ctx.close();
      void ctx.resume().then(() => src.start());
    };
    return Object.assign(play, { close: () => void ctx.close() });
  } catch (e) {
    void ctx.close();
    throw e;
  }
}

/** The plan for the saved choices with the custom file loaded: if the file cannot be played the
 * system sound stands in (never silence by accident), and `problem` says why. */
export async function preparePlan(n: { sound: Sound; volume: number; customFile: string | null }): Promise<{ plan: Plan; play: () => void; close: () => void; problem: string | null }> {
  let plan = testPlan(n);
  let problem: string | null = null;
  let play: () => void = () => {};
  let close: () => void = () => {};
  if (plan.file) {
    try {
      const sound = await loadSound(plan.file, plan.gain);
      play = sound;
      close = sound.close;
    } catch (e) {
      problem = String(e);
      plan = { toastSound: true, tone: null, file: null, gain: plan.gain };
    }
  } else if (plan.tone) {
    const tone = plan.tone;
    play = () => playTone(tone, plan.gain);
  }
  return { plan, play, close, problem };
}

/** STAT-044: one pacer for the window; `resetPacer` is for tests. */
let pacer = newPaceMemory();
export function resetPacer(): void {
  pacer = newPaceMemory();
}

/** STAT-043: a desktop notification with the chosen sound. The toast is silent whenever Kolux plays
 * its own tone or file, so one sound plays; the sound starts once the toast is shown. STAT-044: with
 * an `event` the notification is merged and paced (`paced`) and the backend learns its id and pane,
 * so a click can focus that pane; a merged or repeated event raises nothing. With "Stay quiet" on,
 * nothing is shown while the window has focus. A "gone quiet" warning (it may be stuck) skips the
 * pacer. */
export async function raiseNotification(settings: Record<string, unknown>, title: string, body: string, event?: NotifyEvent): Promise<void> {
  if (!masterOn(settings)) return; // STAT-042 (T-124-b): the master switch silences every notification
  const prefs = readNotifications(settings);
  if (event && event.kind !== "quiet") {
    const focused = typeof document !== "undefined" && document.hasFocus();
    if (!paced(pacer, event.worktree, event.id, Date.now(), { focused, quietWhenFocused: prefs.suppressFocused, test: event.kind === "test", kind: event.kind })) return;
  }
  const { plan, play, close } = await preparePlan(prefs);
  try {
    if (event) {
      await invoke("notify_event", { title, body, sound: plan.toastSound, id: event.id, pane: event.pane, kind: event.kind });
    } else {
      await invoke("notify", { title, body, sound: plan.toastSound });
    }
  } catch (e) {
    close();
    throw e;
  }
  play();
}

/** A slider or number box that saves when it is let go: the value to save when the draft differs from what is saved, else null. */
export const settledValue = (draft: number | null, saved: number): number | null => (draft !== null && draft !== saved ? draft : null);

/** The quiet-alert minutes typed so far: whole minutes from 0, and an empty or unreadable box reads as 0 (off). */
export const quietFromText = (text: string): number => Math.max(0, Math.floor(Number(text)) || 0);
