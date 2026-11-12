// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { loadPack, registerPack, t } from "../i18n/lookup";
import { applyLanguage } from "../language";
import { usePackLoaded } from "./usePackLoaded";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("a screen drawn before its pack arrived redraws in the pack's language", async () => {
  let release!: (p: Record<string, string>) => void;
  registerPack("fr", () => new Promise((r) => (release = r)));
  applyLanguage("fr");
  function Word() {
    usePackLoaded();
    return createElement("span", null, t("sleep.wake"));
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(createElement(Word)));
  const english = host.textContent;
  expect(english).toBe(t("sleep.wake", undefined, "en"));
  await act(async () => {
    release({ "sleep.wake": "Réveiller" });
    await loadPack("fr");
  });
  expect(host.textContent).toBe("Réveiller");
  act(() => root.unmount());
  applyLanguage("en");
});
