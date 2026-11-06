import { describe, expect, it } from "vitest";
import { actionLabel, barItem, cardReducer, initialCard, mainAction, tipVisible, type Action, type CardState, type UpdateInfo } from "./card";

const info = (version: string, notes: string[] = ["One", "Two", "Three", "Four", "Five"]): UpdateInfo => ({ version, currentVersion: "0.1.0", notes });
const run = (s: CardState, ...actions: Action[]) => actions.reduce(cardReducer, s);

describe("update card (APP-026)", () => {
  it("a requested check on the newest version reports up to date, then fades away", () => {
    let s = run(initialCard(null, false), { type: "checkStart", requested: true });
    expect(s.shown).toBe(true);
    expect(s.phase.kind).toBe("checking");
    s = run(s, { type: "checkDone", requested: true, found: null });
    expect(s.phase.kind).toBe("upToDate");
    expect(mainAction(s.phase)).toBe("close");
    s = run(s, { type: "faded" });
    expect(s.shown).toBe(false);
  });

  it("background checks never bring up the card, not even when they fail", () => {
    let s = run(initialCard(null, false), { type: "checkStart", requested: false }, { type: "checkDone", requested: false, found: null });
    expect(s.shown).toBe(false);
    s = run(s, { type: "checkStart", requested: false }, { type: "checkFailed", requested: false, message: "x", offline: true });
    expect(s.shown).toBe(false);
    s = run(s, { type: "checkStart", requested: false }, { type: "checkDone", requested: false, found: info("0.2.0") });
    expect(s.shown).toBe(false);
    expect(s.phase.kind).toBe("available");
  });

  it("a requested check that fails shows the error with a next step", () => {
    const s = run(initialCard(null, false), { type: "checkStart", requested: true }, { type: "checkFailed", requested: true, message: "no answer", offline: true });
    expect(s.shown).toBe(true);
    expect(s.phase.kind === "error" && s.phase.next).toMatch(/offline/);
    expect(mainAction(s.phase)).toBe("retryCheck");
  });

  it("a download error brings up the card even after a quiet check", () => {
    const s = run(
      initialCard(null, false),
      { type: "checkDone", requested: false, found: info("0.2.0") },
      { type: "downloadStart", info: info("0.2.0") },
      { type: "downloadFailed", info: info("0.2.0"), message: "signature mismatch", offline: false },
    );
    expect(s.shown).toBe(true);
    expect(s.phase.kind).toBe("error");
    expect(mainAction(s.phase)).toBe("retryDownload");
  });

  it("walks available, downloading with progress, ready; the card waits for Restart", () => {
    let s = run(initialCard(null, true), { type: "checkStart", requested: true }, { type: "checkDone", requested: true, found: info("0.2.0") });
    expect(s.phase.kind).toBe("available");
    expect(mainAction(s.phase)).toBe("download");
    s = run(s, { type: "downloadStart", info: info("0.2.0") }, { type: "progress", version: "0.2.0", received: 50, total: 100 });
    expect(s.phase.kind === "downloading" && s.phase.received / (s.phase.total ?? 1)).toBe(0.5);
    s = run(s, { type: "ready", info: info("0.2.0") });
    expect(s.phase.kind).toBe("ready");
    expect(mainAction(s.phase)).toBe("restart");
  });

  it("collapsing hides the body and every change of phase reopens it", () => {
    let s = run(initialCard(null, true), { type: "checkStart", requested: true }, { type: "checkDone", requested: true, found: info("0.2.0") }, { type: "collapse" });
    expect(s.collapsed).toBe(true);
    s = run(s, { type: "downloadStart", info: info("0.2.0") });
    expect(s.collapsed).toBe(false);
    s = run(s, { type: "collapse" }, { type: "ready", info: info("0.2.0") });
    expect(s.collapsed).toBe(false);
  });

  it("a dismissed version stays away; a newer one comes back", () => {
    let s = run(initialCard(null, true), { type: "checkStart", requested: true }, { type: "checkDone", requested: true, found: info("0.2.0") }, { type: "dismiss" });
    expect(s.shown).toBe(false);
    expect(s.dismissed).toBe("0.2.0");
    s = run(s, { type: "downloadStart", info: info("0.2.0") }, { type: "progress", version: "0.2.0", received: 1, total: 2 });
    expect(s.shown).toBe(false);
    s = run(s, { type: "checkDone", requested: false, found: info("0.2.0") });
    expect(s.shown).toBe(false);
    s = run(s, { type: "checkStart", requested: true }, { type: "checkDone", requested: true, found: info("0.3.0") });
    expect(s.shown).toBe(true);
    expect(s.phase.kind === "available" && s.phase.info.version).toBe("0.3.0");
  });

  it("the reassurance tip shows the first time only and is gone once dismissed or a download starts", () => {
    let s = run(initialCard(null, false), { type: "checkStart", requested: true }, { type: "checkDone", requested: true, found: info("0.2.0") });
    expect(tipVisible(s)).toBe(true);
    s = run(s, { type: "downloadStart", info: info("0.2.0") });
    expect(s.tipDone).toBe(true);
    s = run(s, { type: "checkStart", requested: true }, { type: "checkDone", requested: true, found: info("0.3.0") });
    expect(tipVisible(s)).toBe(false);
    let t = run(initialCard(null, false), { type: "checkStart", requested: true }, { type: "checkDone", requested: true, found: info("0.2.0") }, { type: "tipDismiss" });
    expect(tipVisible(t)).toBe(false);
    expect(t.tipDone).toBe(true);
    t = run(t, { type: "checkStart", requested: true }, { type: "checkDone", requested: true, found: info("0.2.0") });
    expect(tipVisible(t)).toBe(false);
  });
});

describe("error wording", () => {
  it("turns the updater's words into a plain sentence", async () => {
    const { plainError } = await import("./card");
    expect(plainError("error sending request for url (http://127.0.0.1:18790/latest.json)")).toBe("Kolux could not reach the update server.");
    expect(plainError("The update check got no answer within 45 seconds.")).toBe("Kolux could not reach the update server.");
    expect(plainError("signature verification failed")).toMatch(/signature did not match/);
    expect(plainError("something odd")).toBe("something odd");
  });
});

describe("release notes (APP-027)", () => {
  it("stay through available, downloading, ready and error, and clear when a new check begins", () => {
    let s = run(initialCard(null, true), { type: "checkStart", requested: true }, { type: "checkDone", requested: true, found: info("0.2.0") });
    expect(s.notes).toHaveLength(5);
    s = run(s, { type: "downloadStart", info: info("0.2.0") });
    expect(s.notes).toHaveLength(5);
    s = run(s, { type: "downloadFailed", info: info("0.2.0"), message: "x", offline: false });
    expect(s.notes).toHaveLength(5);
    s = run(s, { type: "checkStart", requested: true });
    expect(s.notes).toEqual([]);
  });

  it("an update without notes still goes through", () => {
    const s = run(initialCard(null, true), { type: "checkDone", requested: true, found: info("0.2.0", []) }, { type: "downloadStart", info: info("0.2.0", []) }, { type: "ready", info: info("0.2.0", []) });
    expect(s.phase.kind).toBe("ready");
    expect(s.notes).toEqual([]);
  });
});

describe("ready pop-up (APP-025)", () => {
  const quietReady = (s: CardState, v: string) =>
    run(s, { type: "checkDone", requested: false, found: info(v) }, { type: "downloadStart", info: info(v) }, { type: "ready", info: info(v) });

  it("appears once per version per launch; closed, it does not come back", () => {
    let s = quietReady(initialCard(null, true), "0.2.0");
    expect(s.popup).toBe("0.2.0");
    expect(s.shown).toBe(false);
    s = run(s, { type: "popupClose" });
    expect(s.popup).toBeNull();
    s = run(s, { type: "ready", info: info("0.2.0") });
    expect(s.popup).toBeNull();
    // A newer version gets its own pop-up.
    s = quietReady(s, "0.3.0");
    expect(s.popup).toBe("0.3.0");
  });

  it("stays silent while the update card shows that same update", () => {
    const s = run(
      initialCard(null, true),
      { type: "checkStart", requested: true },
      { type: "checkDone", requested: true, found: info("0.2.0") },
      { type: "downloadStart", info: info("0.2.0") },
      { type: "ready", info: info("0.2.0") },
    );
    expect(s.shown).toBe(true);
    expect(s.popup).toBeNull();
  });

  it("goes away when the update stops being ready", () => {
    let s = quietReady(initialCard(null, true), "0.2.0");
    s = run(s, { type: "notReady" });
    expect(s.popup).toBeNull();
  });
});

describe("status bar item (VIEW-100)", () => {
  it("shows nothing while idle, checking or up to date", () => {
    expect(barItem({ kind: "idle" })).toBeNull();
    expect(barItem({ kind: "checking" })).toBeNull();
    expect(barItem({ kind: "upToDate" })).toBeNull();
  });

  it("names an available, downloading, ready or failed update", () => {
    expect(barItem({ kind: "available", info: info("0.2.0") })).toMatchObject({ tone: "info", text: "Update 0.2.0" });
    expect(barItem({ kind: "downloading", info: info("0.2.0"), received: 25, total: 100 })).toMatchObject({ tone: "info", text: "Downloading 0.2.0 · 25%" });
    expect(barItem({ kind: "downloading", info: info("0.2.0"), received: 25, total: null })).toMatchObject({ text: "Downloading 0.2.0" });
    expect(barItem({ kind: "ready", info: info("0.2.0") })).toMatchObject({ tone: "ready", text: "Restart to update" });
    const failed = barItem({ kind: "error", message: "m", next: "n", info: info("0.2.0"), retry: "download" });
    expect(failed).toMatchObject({ tone: "error", text: "Update failed" });
  });

  it("a click brings back a dismissed or collapsed card, and the failure item stays until then", () => {
    let s = run(initialCard(null, true), { type: "checkStart", requested: false }, { type: "checkDone", requested: false, found: info("0.2.0") }, { type: "downloadStart", info: info("0.2.0") });
    s = run(s, { type: "downloadFailed", info: info("0.2.0"), message: "signature", offline: false }, { type: "collapse" });
    expect(barItem(s.phase)?.tone).toBe("error");
    s = run(s, { type: "show" });
    expect(s.shown && !s.collapsed).toBe(true);
    s = run(initialCard(null, true), { type: "ready", info: info("0.2.0") }, { type: "dismiss" }, { type: "show" });
    expect(s.shown).toBe(true);
    expect(run(initialCard(null, true), { type: "show" }).shown).toBe(false);
  });

  it("T-293 (APP-030): a refused installer shows a security stop with no install or retry button", () => {
    let s = run(initialCard(null, true), { type: "checkStart", requested: false }, { type: "checkDone", requested: false, found: info("0.2.0") }, { type: "downloadStart", info: info("0.2.0") });
    s = run(s, { type: "downloadFailed", info: info("0.2.0"), message: "update:refused|Kolux refused this update: signed by Mallory.", offline: false });
    expect(s.shown && !s.collapsed).toBe(true);
    expect(s.phase).toMatchObject({ kind: "error", retry: "none", security: true, message: "Kolux refused this update: signed by Mallory." });
    expect(mainAction(s.phase)).toBe("close");
    expect(barItem(s.phase)).toMatchObject({ tone: "error", text: "Update refused" });
    expect(s.popup).toBeNull();
  });

  it("FIX-2 AFTER 5: the stop card closes with a Close button, not OK", () => {
    let s = run(initialCard(null, true), { type: "downloadStart", info: info("0.2.0") });
    s = run(s, { type: "downloadFailed", info: info("0.2.0"), message: "update:refused|Kolux refused this update: signed by Mallory.", offline: false });
    expect(actionLabel(s.phase)).toBe("Close");
    expect(actionLabel({ kind: "upToDate" })).toBe("OK");
    expect(actionLabel(run(s, { type: "dismiss" }).phase)).toBeNull();
  });

  it("T-199 (APP-029): an installer that cannot start keeps the update ready with the reason and Restart again", () => {
    let s = run(initialCard(null, true), { type: "ready", info: info("0.2.0") });
    s = run(s, { type: "restartFailed", message: "Windows refused permission to run the installer." });
    expect(s.shown && !s.collapsed).toBe(true);
    expect(s.phase).toMatchObject({ kind: "error", retry: "restart", message: "Windows refused permission to run the installer.", info: { version: "0.2.0" } });
    expect(mainAction(s.phase)).toBe("restart");
    expect(run(s, { type: "restartFailed", message: "again" }).phase).toMatchObject({ retry: "restart", message: "again" });
    expect(run(initialCard(null, true), { type: "restartFailed", message: "x" }).phase.kind).toBe("idle");
  });

  it("T-199 (APP-031): a half-published release is calm, silent on a quiet check, and a protocol error offers compatibility mode", () => {
    const quiet = "update:quiet|Kolux 0.2.0 is still being published. Kolux will look again soon.";
    expect(run(initialCard(null, true), { type: "checkFailed", requested: false, message: quiet, offline: false }).shown).toBe(false);
    let s = run(initialCard(null, true), { type: "checkStart", requested: true }, { type: "checkFailed", requested: true, message: quiet, offline: false });
    expect(s.phase).toMatchObject({ kind: "error", calm: true, retry: "none", message: "Kolux 0.2.0 is still being published. Kolux will look again soon." });
    expect(barItem(s.phase)).toBeNull();
    expect(mainAction(s.phase)).toBeNull();
    s = run(initialCard(null, true), { type: "checkStart", requested: false }, { type: "downloadStart", info: info("0.2.0") }, { type: "downloadFailed", info: info("0.2.0"), message: quiet, offline: false });
    expect(s.phase.kind).toBe("idle");
    s = run(initialCard(null, true), { type: "checkStart", requested: true }, { type: "checkFailed", requested: true, message: "update:compat|error sending request", offline: false });
    expect(s.phase).toMatchObject({ kind: "error", retry: "compat" });
    expect(mainAction(s.phase)).toBe("compat");
    expect(barItem(s.phase)).toMatchObject({ tone: "error", text: "Update failed" });
  });
});

describe("T-600: the card never opens itself or takes the user's place (F02-settings-update.1)", () => {
  const quiet = (s: CardState, v: string) =>
    run(s, { type: "checkStart", requested: false }, { type: "checkDone", requested: false, found: info(v) }, { type: "downloadStart", info: info(v) }, { type: "ready", info: info(v) });

  it("rule 1: background checks and download errors may show the card but never mark it as the user's (requested)", () => {
    let s = run(initialCard(null, true), { type: "checkStart", requested: false }, { type: "checkDone", requested: false, found: info("0.2.0") }, { type: "downloadStart", info: info("0.2.0") });
    expect(s.requested).toBe(false);
    s = run(s, { type: "downloadFailed", info: info("0.2.0"), message: "error sending request", offline: false });
    expect(s).toMatchObject({ shown: true, collapsed: false, requested: false }); // download errors bring the card up (APP-026)
    expect(run(s, { type: "downloadFailed", info: info("0.2.0"), message: "update:refused|Kolux refused this update: signed by Mallory.", offline: false })).toMatchObject({ shown: true, requested: false });
    expect(run(s, { type: "downloadFailed", info: info("0.2.0"), message: "update:compat|error sending request", offline: false })).toMatchObject({ shown: true, requested: false });
    // A quiet check after the user's own is not the user's either.
    s = run(initialCard(null, true), { type: "checkStart", requested: true }, { type: "checkDone", requested: true, found: info("0.2.0") }, { type: "checkStart", requested: false });
    expect(s.requested).toBe(false);
    // ... and its failure shows no error on the card the user left open (APP-024).
    s = run(s, { type: "checkFailed", requested: false, message: "no answer", offline: true });
    expect(s.phase.kind).toBe("available");
  });

  it("rule 2: collapsing clears requested; the user's own expand or status-bar click gives it back", () => {
    let s = run(initialCard(null, true), { type: "checkStart", requested: true }, { type: "checkDone", requested: true, found: info("0.2.0") });
    expect(s.requested).toBe(true);
    s = run(s, { type: "collapse" });
    expect(s).toMatchObject({ collapsed: true, requested: false });
    s = run(s, { type: "expand" });
    expect(s).toMatchObject({ collapsed: false, requested: true });
    s = run(s, { type: "collapse" }, { type: "show" });
    expect(s).toMatchObject({ collapsed: false, requested: true });
  });

  it("rule 3: background checks never re-expand a collapsed card (APP-026), for the same version or a newer one", () => {
    // The user's own check got 0.2.0 ready; they collapse the card; the half-hourly check finds 0.2.0 again, then 0.3.0.
    let s = run(initialCard(null, true), { type: "checkStart", requested: true }, { type: "checkDone", requested: true, found: info("0.2.0") }, { type: "downloadStart", info: info("0.2.0") }, { type: "ready", info: info("0.2.0") }, { type: "collapse" });
    s = quiet(s, "0.2.0");
    expect(s).toMatchObject({ shown: true, collapsed: true, requested: false });
    s = quiet(s, "0.3.0");
    expect(s).toMatchObject({ shown: true, collapsed: true, requested: false });
    // A background download fails, so the card comes up; collapsed, the quiet checks that follow leave it collapsed.
    let t = run(initialCard(null, true), { type: "checkDone", requested: false, found: info("0.2.0") }, { type: "downloadStart", info: info("0.2.0") }, { type: "downloadFailed", info: info("0.2.0"), message: "error sending request", offline: true }, { type: "collapse" });
    t = quiet(t, "0.2.0");
    expect(t).toMatchObject({ shown: true, collapsed: true, requested: false });
    expect(t.phase.kind).toBe("ready");
    // The user's own check still reopens it.
    t = run(t, { type: "checkStart", requested: true });
    expect(t).toMatchObject({ collapsed: false, requested: true });
  });
});
