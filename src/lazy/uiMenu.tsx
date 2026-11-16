// src/ui's Menu, read the first time a menu opens rather than when the window starts. Base UI's menu and the
// floating layer under it were about 100 kB of start-up script for two menus that only open on a click: the right
// sidebar's More tabs and a hideable sidebar row's right-click menu. The code is read in stage 2 (it is far over
// what stage 1 carries, DT-C252), and at once when the pointer enters or focus lands on the control that opens a
// menu, so a first open is normally drawn at once; a click before that opens the menu when the code arrives.
// MenuItem draws only inside an open Menu, which is drawn only once the module is read, so it never waits itself.
import { createElement, type ComponentProps, type ReactElement } from "react";
import { deferred } from "./deferred";
import type * as UiMenu from "../ui/Menu";

let ui: typeof UiMenu | undefined;

export const Menu = deferred<UiMenu.MenuProps>(
  () =>
    import("../ui/Menu").then((m) => {
      ui = m;
      return { default: m.Menu };
    }),
  undefined,
  { warm: 2 },
);

type Point = { x: number; y: number };

/** A context menu: a Menu at the right-clicked point (see ui/Menu's ContextMenu). */
export const ContextMenu = ({ at, ...p }: Omit<UiMenu.MenuProps, "anchor" | "at" | "open"> & { at: Point | null }): ReactElement => createElement(Menu, { ...p, open: at !== null, at });

export const MenuItem = (p: ComponentProps<typeof UiMenu.MenuItem>): ReactElement | null => (ui ? createElement(ui.MenuItem, p) : null);
