// USAGE-009: a system notification when a usage window reaches 80 % and again at 95 %. Each
// threshold fires once per window and is armed again only when the window moves on to a new
// reset time; the record of what fired is kept in state.db so a restart does not repeat it.
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usageAlertsAllowed } from "../status/notifyMaster";
import { resetWords, type UsageWindow } from "./codex";
import { onFigures, type ProviderUsage } from "./launchWarn";

export const THRESHOLDS = [80, 95] as const;
/** "provider:window:threshold" -> the reset time (unix seconds) of the window it fired in. */
export type Fired = Record<string, number>;
export type Alert = { title: string; body: string };

/** The window's name from its length; `named` is what the provider calls it when the length is unknown. */
export function windowWords(mins: number | null | undefined, named: string): string {
  if (mins == null) return named;
  if (mins === 10080) return "weekly";
  if (mins >= 40320 && mins <= 44640) return "monthly";
  if (mins % 1440 === 0) return `${mins / 1440}-day`;
  if (mins % 60 === 0) return `${mins / 60}-hour`;
  return "usage";
}

/** The alerts this reading calls for, and the fired record to keep afterwards. */
export function dueAlerts(provider: string, u: ProviderUsage, fired: Fired, now: Date = new Date()): { alerts: Alert[]; fired: Fired } {
  const next = { ...fired };
  const alerts: Alert[] = [];
  const windows: Array<[string, UsageWindow | null | undefined]> = [["5-hour", u.fiveHour], ["weekly", u.weekly], ["monthly", u.monthly]];
  for (const [named, w] of windows) {
    if (!w || w.resetsAt == null) continue;
    const label = windowWords(w.windowMins, named);
    for (const t of THRESHOLDS) {
      const key = `${provider}:${named}:${t}`;
      if (w.usedPercent < t || next[key] === w.resetsAt) continue;
      next[key] = w.resetsAt;
      alerts.push({ title: `${u.name} · usage alert`, body: `${u.name} has used ${Math.round(w.usedPercent)}% of its ${label} window (the ${t}% alert), ${resetWords(w.resetsAt, now)}.` });
    }
  }
  return { alerts, fired: next };
}

export const ALERTS_FIELD = "usageAlerts";
/** The usage-alerts preference, on unless turned off. */
export const alertsOn = (s: Record<string, unknown>) => s[ALERTS_FIELD] !== false;

/** Watches the shared usage figures and sends what is due. Nothing goes out until settings have
 * loaded (`settings` null) or while alerts are off. */
export function useUsageAlerts(settings: Record<string, unknown> | null) {
  const on = settings !== null && usageAlertsAllowed(settings, alertsOn); // STAT-042: the master switch holds them back too
  useEffect(() => {
    if (!on) return;
    let fired: Fired | null = null;
    let live = true;
    const check = (all: Record<string, ProviderUsage | undefined>) => {
      if (!fired) return;
      for (const [p, u] of Object.entries(all)) {
        if (!u) continue;
        const r = dueAlerts(p, u, fired);
        if (r.alerts.length === 0) continue;
        fired = r.fired;
        void invoke("usage_alert_send", { fired, alerts: r.alerts }).catch(() => {});
      }
    };
    const off = onFigures(check);
    void invoke<Fired>("usage_alerts_fired")
      .then((f) => {
        if (!live) return;
        fired = f ?? {};
        check(onFigures.current());
      })
      .catch(() => {});
    return () => {
      live = false;
      off();
    };
  }, [on]);
}
