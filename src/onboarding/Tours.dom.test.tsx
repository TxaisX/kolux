// @vitest-environment happy-dom
// ONB-031 on a real DOM: a tour step is a src/ui Dialog that is not modal (the window stays usable, a step can ask for a
// click on a real control), so a press outside never ends the tour; focus starts on Next; Escape is Skip.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import { TourPanel } from "./Tours";
import type { Tour } from "./tour";
import { byLabel, fire, installDom, mount, settle, until } from "../tasks/realDom";

const words = { title: "The sidebar", body: "Your projects live here." };
const tour = { id: "sidebar", name: "Sidebar", trigger: "", steps: [{ target: "#target", side: "right", en: words, ko: words }, { target: "#target", side: "right", en: words, ko: words }] } as unknown as Tour;

let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  installDom();
  const target = document.createElement("button");
  target.id = "target";
  target.getBoundingClientRect = () => ({ x: 10, y: 10, left: 10, top: 10, right: 60, bottom: 30, width: 50, height: 20, toJSON: () => ({}) });
  document.body.appendChild(target);
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

test("ONB-031: the tour card is a non-modal dialog; a press outside leaves it, focus starts on Next, Escape skips", async () => {
  const onEnd = vi.fn();
  const m = await mount(createElement(TourPanel, { tour, at: 0, onAt: () => {}, onEnd }));
  unmount = m.unmount;
  const c = m.container;
  await until(() => byLabel(c, "div", "Sidebar tour").length === 1, "the tour card");
  const card = byLabel(c, "div", "Sidebar tour")[0];
  expect(card.getAttribute("role")).toBe("dialog");
  expect(card.hasAttribute("aria-modal") && card.getAttribute("aria-modal") !== "false").toBe(false);
  expect(card.classList.contains("tour")).toBe(true);
  expect(card.getAttribute("data-tour")).toBe("sidebar");
  await until(() => document.activeElement?.textContent === "Next", "focus on Next");

  const target = document.getElementById("target")!;
  await fire(c, "pointerdown", target);
  await fire(c, "mousedown", target);
  await fire(c, "click", target);
  await settle();
  expect(onEnd).not.toHaveBeenCalled();
  expect(byLabel(c, "div", "Sidebar tour")).toHaveLength(1);

  await fire(c, "keydown", document.activeElement ?? document.body, { key: "Escape" });
  expect(onEnd).toHaveBeenCalledWith("skipped");
});
