// The Claude half of the usage pill (STAT-040): the last status-line report at start, then
// every report as it arrives; a report with no windows (context only) changes nothing here.
// USAGE-023 (T-070): the stored report is read again on the five-minute timer, on a window focus
// and on a manual refresh through the shared scheduler; a report pushed while the start-up read is
// still running is kept, because an empty answer never replaces figures already shown.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { heldListen } from "../recovery/hidden";
import VendorMark from "../chrome/VendorMark";
import { StatusGlyph } from "../chrome/icons";
import { pillDetail, pillText, weeklyOf, type ClaudeLimit } from "./claude";
import { tone } from "./meter";
import { publishClaude as publishLaunch } from "./launchWarn";
import { publishClaude as publishPlan, readPlan, usePlan, useResetTick } from "./plan";
import { claudeFetched, runner, useRefresh } from "./refresh";
import { lineFor, record } from "./forecast";

/** The top bar's read goes to the plan line and the launch screen's warning alike. This is the
 * stored last report (at start, on the timer, on a focus, on a manual refresh): it carries no time
 * of its own and may be a day old, so it is never a forecast reading (FIX-1: stamped now, yesterday's
 * 40% then today's live 52% would read as a steep climb). */
export const publishStored = (limits: ClaudeLimit[]) => {
  publishPlan(limits);
  publishLaunch(limits);
};

/** T-548-b: the active account's stored windows, published even when there are none. After an account switch
 *  the figures shown still belong to the old account; the new one may not have reported yet, and an empty
 *  answer must clear them rather than leave another account's numbers under its name. */
export const readActiveClaude = (call: (command: string) => Promise<unknown> = (c) => invoke(c)) => call("claude_usage").then((l) => publishStored(l as ClaudeLimit[]));

/** A report the status line pushed just now: the same, and a forecast reading at the time it
 * arrived (USAGE-031). FIX-2 (council FS-4): the event carries the windows merged with the last
 * stored ones, so only the windows this report itself carried are readings; a window kept from an
 * older report would be stamped now. `carried` names them when the backend says so; without it, a
 * window that matches what is shown is taken as kept.
 * ponytail: the fallback also skips an unchanged carried window (a flat reading); the carried list fixes that. */
export const publishLive = (limits: ClaudeLimit[], now: number = Date.now(), carried?: string[]) => {
  const shown = readPlan().claude;
  const fresh = (l: ClaudeLimit) =>
    carried ? carried.includes(l.kind) : !shown.some((s) => s.kind === l.kind && s.usedPercent === l.usedPercent && s.resetsAt === l.resetsAt);
  for (const l of limits) if (fresh(l)) record(`claude:${l.kind}`, l.usedPercent, l.resetsAt, now);
  publishStored(limits);
};

/** USAGE-023: the steady mark's words while the last read failed; the figures shown are the last good ones. */
export const TROUBLE = "The last usage read failed; these are the last figures that arrived";

/** USAGE-023: a steady error mark inside the pill; no spinner, no blanked figures. */
export function TroubleMark() {
  return (
    <span className="mark" role="img" aria-label="last read failed" title={TROUBLE}>
      <StatusGlyph glyph="failed" size={10} />
    </span>
  );
}

/** USAGE-008: drawn only for an installed Claude with a known weekly window, tinted by its use. */
export function ClaudePillView({ limits, installed = true, trouble = false }: { limits: ClaudeLimit[]; installed?: boolean; trouble?: boolean }) {
  const w = weeklyOf(limits);
  useResetTick([w?.resetsAt]); // USAGE-024: the hover countdown keeps itself current
  if (!installed || !w) return null;
  return (
    <span className={`usage-part ${tone(w.usedPercent)}`.trim()} title={[pillDetail(limits), lineFor(`claude:${w.kind}`, w.resetsAt)].filter(Boolean).join("\n")} data-claude-state="ok" data-usage-trouble={trouble ? "1" : undefined}>
      <VendorMark agent="claude" size={13} />
      <span>{pillText(limits)}</span>
      {trouble && <TroubleMark />}
    </span>
  );
}

/** Starts the pill's reads and listeners; the returned function stops them. */
export function startClaudePill(): () => void {
  const r = runner<ClaudeLimit[]>({ name: "claude", fetch: () => invoke<ClaudeLimit[]>("claude_usage").then(claudeFetched), onOk: publishStored });
  r.start();
  // T-286-b (APP-017): held while the window is hidden, the newest figures replayed when it is shown.
  const off = heldListen<{ limits: ClaudeLimit[]; carried?: string[] }>(
    "claude-usage",
    (e) => {
      if (e.payload.limits.length) publishLive(e.payload.limits, Date.now(), e.payload.carried);
    },
    { latestOnly: true },
  );
  // T-548-b: a switch (or any change to the account list) re-reads the active account's windows and clears the old ones.
  const offAccounts = heldListen("claude-accounts", () => void readActiveClaude().catch(() => {}), { latestOnly: true });
  return () => {
    r.stop();
    void off.then((u) => u()).catch(() => {});
    void offAccounts.then((u) => u()).catch(() => {});
  };
}

export default function ClaudePill({ installed }: { installed?: boolean }) {
  const { claude: limits } = usePlan();
  const sched = useRefresh("claude");
  useEffect(() => startClaudePill(), []);
  return <ClaudePillView limits={limits} installed={installed} trouble={sched.failures > 0} />;
}
