// C26-R3-01: a pane kills its terminal when it unmounts. A closed tab must; a tree the root replaces must not,
// or an agent started during a slow start dies with the drawing it happened to live in.
import { expect, test } from "vitest";
import { killsOnUnmount, nextGeneration, windowGeneration } from "./paneGeneration";

test("a pane kills its terminal only in the generation that mounted it", () => {
  const mountedIn = windowGeneration.current;
  expect(killsOnUnmount(mountedIn)).toBe(true); // a tab closed in place still reaps its terminal
  nextGeneration(); // a re-draw hands its terminals to the next drawing
  expect(killsOnUnmount(mountedIn)).toBe(false); // nothing is reaped by the old tree
  expect(killsOnUnmount(windowGeneration.current)).toBe(true);
});
