// The window's drawing. Cycle 2 moved it out of App.tsx as one file (this one, 1,077 lines); cycle 3
// split it into one module per surface under shell/window, behind one store: the top bar, the dialogs
// and menus, the left card and Agents rail, the content column and its grid, one pane, the right
// sidebar, and the window-wide hosts. This file only puts them in the order the window had, so the
// element tree is still the one App.tsx returned.
import Tip from "../chrome/Tip";
import Content from "./window/Content";
import Dialogs from "./window/Dialogs";
import Hosts from "./window/Hosts";
import Right from "./window/Right";
import Sidebar from "./window/Sidebar";
import WindowTopBar from "./window/TopBar";
import { WindowStoreProvider, useWindow } from "./window/store";
import type { WindowBag } from "./windowBag";
import { useShowTerminalsOnBrowserOpen } from "./browserOpen";
import type { CSSProperties } from "react";

/** The window's drawing, as a plain function App.tsx calls last in its render. */
export function windowView(w: WindowBag) {
  return (
    <WindowStoreProvider store={w}>
      <WindowSurfaces />
    </WindowStoreProvider>
  );
}

function WindowSurfaces() {
  const { leftWidth, setScreen, setPage } = useWindow();
  useShowTerminalsOnBrowserOpen(setScreen, setPage); // GIT-036: a page asked for in the browser is shown, whatever screen asked
  return (
    <div className="app">
      <Tip />
      <WindowTopBar />
      <div className="body" style={{ "--sidebar-w": `${leftWidth}px` } as CSSProperties}>
        <Dialogs />
        <Sidebar />
        <Content />
        <Right />
      </div>
      <Hosts />
    </div>
  );
}
