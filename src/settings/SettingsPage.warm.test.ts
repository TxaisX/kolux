// Settings pages read in the background: every rail page drawn from a lazy chunk has its code named for the warm-up.
import { expect, test, vi } from "vitest";
import { PAGES } from "./pages";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.reject("not stubbed") }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));

test("every lazy Settings page has its code in the warm-up list (Accounts is drawn from the Settings chunk itself)", async () => {
  const { PAGE_CODE } = await import("./SettingsPage");
  const lazyPages = Object.keys(PAGES).filter((p) => p !== "accounts");
  expect(Object.keys(PAGE_CODE).sort()).toEqual(lazyPages.sort());
  for (const p of lazyPages) expect(PAGE_CODE[p as keyof typeof PAGE_CODE]!.length).toBeGreaterThan(0);
});
