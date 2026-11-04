// T-740: the window toast clears itself after 4 s, but not while the pointer is on it (it is still being read).
import { act, createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { installDom, mount } from "../tasks/fakeDom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.reject("not stubbed") }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

afterEach(() => {
  vi.useRealTimers();
});

test("T-740: a hovered toast stays past its 4 s; once the pointer leaves it clears within the next 4 s", async () => {
  vi.useFakeTimers();
  const { doc, win } = installDom();
  Object.assign(win, { setTimeout, clearTimeout });
  let hovered = false;
  Object.assign(doc, { querySelector: (s: string) => (hovered && s === ".toast:hover" ? {} : null) });
  const { useChrome } = await import("./useChrome");
  let api: ReturnType<typeof useChrome> | null = null;
  function Probe() {
    api = useChrome();
    return null;
  }
  const m = await mount(createElement(Probe), doc);

  await act(async () => api!.setToast("Copied"));
  hovered = true;
  await act(async () => void vi.advanceTimersByTime(12000));
  expect(api!.toast, "still shown while the pointer is on it").toBe("Copied");
  hovered = false;
  await act(async () => void vi.advanceTimersByTime(4000));
  expect(api!.toast, "gone once the pointer has left").toBe(null);

  // A new toast while hovered replaces the text and keeps holding; it goes within 4 s of the pointer leaving.
  await act(async () => api!.setToast("First"));
  hovered = true;
  await act(async () => void vi.advanceTimersByTime(3000));
  await act(async () => api!.setToast("Second"));
  await act(async () => void vi.advanceTimersByTime(9000));
  expect(api!.toast).toBe("Second");
  hovered = false;
  await act(async () => void vi.advanceTimersByTime(4000));
  expect(api!.toast).toBe(null);

  // Not hovered: it clears after 4 s, as before.
  await act(async () => api!.setToast("Saved"));
  await act(async () => void vi.advanceTimersByTime(3999));
  expect(api!.toast).toBe("Saved");
  await act(async () => void vi.advanceTimersByTime(1));
  expect(api!.toast).toBe(null);
  await m.unmount();
});
