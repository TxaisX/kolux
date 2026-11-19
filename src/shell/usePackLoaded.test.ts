// Runs on the repo's own small DOM (src/test/fakeDom.ts): jsdom is not a dependency (bug 20261112-1410).
import { act, createElement } from "react";
import { expect, test } from "vitest";
import { loadPack, registerPack, t } from "../i18n/lookup";
import { applyLanguage } from "../language";
import { type FakeNode, installDom, mount } from "../test/fakeDom";
import { usePackLoaded } from "./usePackLoaded";

test("a screen drawn before its pack arrived redraws in the pack's language", async () => {
  const { doc } = installDom();
  let release!: (p: Record<string, string>) => void;
  registerPack("fr", () => new Promise((r) => (release = r)));
  applyLanguage("fr");
  function Word() {
    usePackLoaded();
    return createElement("span", null, t("sleep.wake"));
  }
  const m = await mount(createElement(Word), doc);
  const host = m.container as FakeNode;
  expect(host.textContent).toBe(t("sleep.wake", undefined, "en"));
  await act(async () => {
    release({ "sleep.wake": "Réveiller" });
    await loadPack("fr");
  });
  expect(host.textContent).toBe("Réveiller");
  await m.unmount();
  applyLanguage("en");
});
