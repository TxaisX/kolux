import { describe, expect, it, vi } from "vitest";
import { dueAlerts, useUsageAlerts, windowWords, type Fired } from "./alerts";

// T-716: the hook runs outside React here; useEffect runs at once, the figures feed and invoke are stand-ins.
const h = vi.hoisted(() => ({ feed: (_: Record<string, unknown>) => {}, send: vi.fn() }));
vi.mock("react", async (orig) => ({ ...(await orig<object>()), useEffect: (f: () => void) => f() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, a: unknown) => (cmd === "usage_alerts_fired" ? Promise.resolve({}) : h.send(a)) }));
vi.mock("./launchWarn", () => ({ onFigures: Object.assign((f: (a: Record<string, unknown>) => void) => ((h.feed = f), () => {}), { current: () => ({}) }) }));
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("T-716 an alert counts as sent only once the send succeeds", () => {
  it("a failed send is tried again on the next reading; a sent alert is not repeated", async () => {
    h.send.mockRejectedValueOnce(new Error("no notification")).mockResolvedValue(undefined);
    useUsageAlerts({});
    await settle(); // the saved record has loaded
    const reading = { codex: codex(82) };
    h.feed(reading);
    h.feed(reading); // a reading while the send is out does not send it twice
    expect(h.send).toHaveBeenCalledTimes(1);
    await settle(); // the send fails
    h.feed(reading);
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.send.mock.calls[1][0]).toMatchObject({ fired: { "codex:5-hour:80": at(17) }, alerts: [{ title: "Codex · usage alert" }] });
    await settle(); // this one goes out
    h.feed(reading);
    expect(h.send).toHaveBeenCalledTimes(2);
  });
});

const now = new Date(2026, 9, 11, 12, 0);
const at = (h: number) => Math.floor(new Date(2026, 9, 11, h, 5).getTime() / 1000);
const codex = (used: number, resetsAt: number | null = at(17)) => ({ name: "Codex", fiveHour: { usedPercent: used, resetsAt, windowMins: 300 } });

describe("USAGE-009 usage alerts", () => {
  it("70% then 82% gives one 80% alert, and later refreshes in the same window add nothing", () => {
    let fired: Fired = {};
    let r = dueAlerts("codex", codex(70), fired, now);
    expect(r.alerts).toEqual([]);
    r = dueAlerts("codex", codex(82), r.fired, now);
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0].title).toBe("Codex · usage alert");
    expect(r.alerts[0].body).toMatch(/^Codex has used 82% of its 5-hour window \(the 80% alert\), resets today/);
    fired = r.fired;
    expect(dueAlerts("codex", codex(84), fired, now).alerts).toEqual([]);
    expect(dueAlerts("codex", codex(90), fired, now).alerts).toEqual([]);
  });
  it("first seen at 97% fires both alerts once each", () => {
    const r = dueAlerts("codex", codex(97), {}, now);
    expect(r.alerts.map((a) => a.body.match(/the (\d+)% alert/)?.[1])).toEqual(["80", "95"]);
    expect(dueAlerts("codex", codex(99), r.fired, now).alerts).toEqual([]);
  });
  it("a window that moves on to a new reset time arms both alerts again", () => {
    const first = dueAlerts("codex", codex(97, at(17)), {}, now);
    expect(dueAlerts("codex", codex(30, at(22)), first.fired, now).alerts).toEqual([]);
    expect(dueAlerts("codex", codex(81, at(22)), first.fired, now).alerts).toHaveLength(1);
  });
  it("no reset time never alerts; under 80% never alerts; each window is tracked on its own", () => {
    expect(dueAlerts("codex", codex(99, null), {}, now).alerts).toEqual([]);
    expect(dueAlerts("codex", codex(79.9), {}, now).alerts).toEqual([]);
    const both = { name: "Codex", fiveHour: { usedPercent: 85, resetsAt: at(17), windowMins: 300 }, weekly: { usedPercent: 96, resetsAt: at(23), windowMins: 10080 } };
    const r = dueAlerts("codex", both, {}, now);
    expect(r.alerts.map((a) => a.body.split(" (")[0])).toEqual(["Codex has used 85% of its 5-hour window", "Codex has used 96% of its weekly window", "Codex has used 96% of its weekly window"]);
  });
  it("words any window length", () => {
    expect(windowWords(300, "5-hour")).toBe("5-hour");
    expect(windowWords(10080, "weekly")).toBe("weekly");
    expect(windowWords(43200, "monthly")).toBe("monthly");
    expect(windowWords(4320, "weekly")).toBe("3-day");
    expect(windowWords(1440, "weekly")).toBe("1-day");
    expect(windowWords(120, "5-hour")).toBe("2-hour");
    expect(windowWords(45, "5-hour")).toBe("usage");
    expect(windowWords(null, "monthly")).toBe("monthly");
  });
});

describe("USAGE-009 preference", () => {
  it("usage alerts are on unless turned off", async () => {
    const { alertsOn } = await import("./alerts");
    expect(alertsOn({})).toBe(true);
    expect(alertsOn({ usageAlerts: false })).toBe(false);
  });
});
