import { expect, test, vi } from "vitest";
import { CardPorts, ownPorts } from "./cardPorts";
import type { PortRow } from "../ports/ports";

const row = (port: number, external = false, pid = 1): PortRow => ({ port, addr: "127.0.0.1", pid, external, started: "", terminal: external ? null : 1 });

test("PROJ-062 (T-266-b): a workspace's ports are its own rows, once each, smallest first", () => {
  expect(ownPorts([row(5173), row(3000), row(5173, false, 2), row(135, true), row(80, true)])).toEqual([3000, 5173]);
  expect(ownPorts([])).toEqual([]);
  expect(ownPorts([row(1, true)])).toEqual([]);
});

test("PROJ-062 (T-266-b): hovering a card asks the back end for that workspace and reports the change once", async () => {
  const ask = vi.fn(async (_w: string[], _a: string) => [row(4000), row(22, true)]);
  const changed = vi.fn();
  const c = new CardPorts(ask, changed, () => 0);
  expect(c.portsFor("C:\\w\\fox")).toEqual([]);
  await c.load("C:\\w\\fox", ["C:\\w\\fox", "C:\\w\\owl"]);
  expect(ask).toHaveBeenCalledWith(["C:\\w\\fox", "C:\\w\\owl"], "C:\\w\\fox");
  expect(c.portsFor("c:/w/fox/")).toEqual([4000]);
  expect(c.portsFor("C:\\w\\owl")).toEqual([]);
  expect(changed).toHaveBeenCalledTimes(1);
});

test("PROJ-062 (T-266-b): a fresh answer is reused, a stale one asked again, a running scan is not doubled", async () => {
  let t = 0;
  let release: (r: PortRow[]) => void = () => {};
  const ask = vi.fn((_w: string[], _a: string) => new Promise<PortRow[]>((r) => (release = r)));
  const changed = vi.fn();
  const c = new CardPorts(ask, changed, () => t, 5_000);
  const first = c.load("W", ["W"]);
  void c.load("W", ["W"]);
  expect(ask).toHaveBeenCalledTimes(1);
  release([row(3000)]);
  await first;
  t = 4_000;
  await c.load("W", ["W"]);
  expect(ask).toHaveBeenCalledTimes(1);
  t = 6_000;
  const again = c.load("W", ["W"]);
  release([row(3000)]);
  await again;
  expect(ask).toHaveBeenCalledTimes(2);
  expect(changed, "same ports: no repaint").toHaveBeenCalledTimes(1);
});

test("PROJ-062 (T-266-b): a failed scan keeps the last answer and says nothing", async () => {
  let t = 0;
  const ask = vi.fn(async (_w: string[], _a: string): Promise<PortRow[]> => []);
  ask.mockResolvedValueOnce([row(8080)]);
  const c = new CardPorts(ask, () => {}, () => t, 1_000);
  await c.load("W", ["W"]);
  t = 2_000;
  ask.mockRejectedValueOnce(new Error("netstat did not finish"));
  await expect(c.load("W", ["W"])).resolves.toBeUndefined();
  expect(c.portsFor("W")).toEqual([8080]);
  const none = new CardPorts(async () => Promise.reject(new Error("x")));
  await none.load("V", ["V"]);
  expect(none.portsFor("V")).toEqual([]);
});
