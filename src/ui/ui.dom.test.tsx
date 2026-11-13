// @vitest-environment happy-dom
// The src/ui wrappers open, on a real DOM: what Base UI gives (roles, focus in and back, arrow keys, picking a row) and
// what stays Kolux's (Escape caught on the window and stopped, only the newest popup answering it, the first frame
// drawn before Base UI is read and handed over once it is).
import { act, useRef, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog, Menu, MenuItem, Select, Tab, TabList, TabPanel, Tabs, Tooltip } from "./index";
import { readBase } from "./part";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const wait = (ms = 20) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
let unmounts: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const u of unmounts.splice(0)) await u();
  document.body.innerHTML = "";
});

async function show(el: ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(el));
  await act(async () => void (await readBase()));
  await wait();
  unmounts.push(() => act(async () => root.unmount()));
  return host;
}

const press = (target: EventTarget, key: string) => act(async () => void target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
/** A select's list stays in the page once opened (Base UI keeps it, hidden): the shown one. */
const list = () => qa('[role="listbox"]').find((l) => !l.closest("[hidden]")) ?? null;

describe("Dialog", () => {
  it("names itself, takes focus, keeps Escape from the terminal underneath, and hands focus back on close", async () => {
    const terminal = vi.fn();
    window.addEventListener("keydown", terminal);
    const closed = vi.fn();
    function Page() {
      const [open, setOpen] = useState(false);
      const ok = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button id="opener" onClick={() => setOpen(true)}>
            Open
          </button>
          {open && (
            <Dialog onClose={() => (closed(), setOpen(false))} label="Rename" className="ask" viewport="ask-backdrop" initialFocus={ok}>
              <input aria-label="name" />
              <button ref={ok}>OK</button>
            </Dialog>
          )}
        </>
      );
    }
    await show(<Page />);
    const opener = q<HTMLButtonElement>("#opener")!;
    opener.focus();
    await act(async () => opener.click());
    await wait();
    const box = q('[role="dialog"]')!;
    expect(box.getAttribute("aria-label")).toBe("Rename");
    expect(box.getAttribute("aria-modal")).toBe("true");
    expect(box.className).toBe("ask");
    expect(box.parentElement!.className).toBe("ask-backdrop");
    expect(document.activeElement!.textContent).toBe("OK");
    await press(document.activeElement!, "Escape");
    await wait();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(terminal).not.toHaveBeenCalled();
    expect(q('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    window.removeEventListener("keydown", terminal);
  });
});

describe("Escape and an input method", () => {
  it("leaves Escape to an input method that is composing, and closes on the next one", async () => {
    const closed = vi.fn();
    await show(
      <Dialog onClose={closed} label="Name" className="ask">
        <input aria-label="name" />
      </Dialog>,
    );
    const field = q<HTMLInputElement>('[aria-label="name"]')!;
    await act(async () => void field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true })));
    expect(closed).not.toHaveBeenCalled();
    await press(field, "Escape");
    expect(closed).toHaveBeenCalledTimes(1);
  });
});

describe("Menu", () => {
  it("is a menu of menuitems; the arrow keys move between rows and a picked row runs and closes it", async () => {
    const picked = vi.fn();
    function Page() {
      const [open, setOpen] = useState(true);
      const anchor = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={anchor}>More</button>
          <Menu open={open} onClose={() => setOpen(false)} label="More tabs" anchor={anchor}>
            <MenuItem onClick={() => picked("a")}>Alpha</MenuItem>
            <MenuItem onClick={() => picked("b")}>Beta</MenuItem>
          </Menu>
        </>
      );
    }
    await show(<Page />);
    const menu = q('[role="menu"]')!;
    expect(menu.getAttribute("aria-label")).toBe("More tabs");
    expect(menu.className).toBe("menu");
    expect(menu.parentElement!.className).toBe("ui-positioner");
    const rows = qa('[role="menuitem"]');
    expect(rows.map((r) => [r.tagName, r.className, r.textContent])).toEqual([
      ["BUTTON", "menu-item", "Alpha"],
      ["BUTTON", "menu-item", "Beta"],
    ]);
    await press(menu, "ArrowDown");
    await wait();
    const first = document.activeElement;
    await press(document.activeElement!, "ArrowDown");
    await wait();
    expect(document.activeElement).not.toBe(first);
    expect(rows).toContain(document.activeElement);
    await act(async () => rows[1].click());
    await wait();
    expect(picked).toHaveBeenCalledWith("b");
    expect(q('[role="menu"]')).toBeNull();
  });
});

describe("Select", () => {
  it("opens on the first press (reading Base UI then), picks a row, and leaves focus on the control", async () => {
    const changed = vi.fn();
    function Page() {
      const [v, setV] = useState("a");
      return <Select label="writer" value={v} onChange={(x) => (changed(x), setV(x))} options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]} />;
    }
    await show(<Page />);
    const control = q<HTMLButtonElement>('[role="combobox"]')!;
    expect(control.getAttribute("aria-label")).toBe("writer");
    expect(control.textContent).toBe("Alpha");
    await act(async () => control.click());
    await wait(50);
    expect(list()).not.toBeNull();
    const options = qa('[role="option"]');
    expect(options.map((o) => o.textContent)).toEqual(["Alpha", "Beta"]);
    expect(options[0].className).toContain("menu-item");
    await act(async () => options[1].click());
    await wait(50);
    expect(changed).toHaveBeenCalledWith("b");
    expect(list()).toBeNull();
    const after = q<HTMLButtonElement>('[role="combobox"]')!;
    expect(after.textContent).toBe("Beta");
    expect(document.activeElement).toBe(after);
  });

  it("inside a dialog, Escape closes the open list and leaves the dialog up", async () => {
    const closed = vi.fn();
    await show(
      <Dialog onClose={closed} label="Settings" className="ask">
        <Select label="theme" value="a" onChange={() => {}} options={[{ value: "a", label: "Dark" }, { value: "b", label: "Light" }]} />
      </Dialog>,
    );
    await act(async () => q<HTMLButtonElement>('[role="combobox"]')!.click());
    await wait(50);
    expect(list()).not.toBeNull();
    await press(document.activeElement ?? document.body, "Escape");
    await wait(50);
    expect(list()).toBeNull();
    expect(closed).not.toHaveBeenCalled();
    expect(q('[role="dialog"]')).not.toBeNull();
  });
});

describe("Tabs", () => {
  it("hands the strip to Base UI once read; Right moves to and opens the next tab; the panel is named by its tab", async () => {
    const opened = vi.fn();
    function Page() {
      const [v, setV] = useState("a");
      return (
        <Tabs value={v} onValue={(x) => (opened(x), setV(x))}>
          <TabList label="Sidebar tabs" className="rside-tabs">
            <Tab value="a" selected={v === "a"} className="rside-tab">
              Alpha
            </Tab>
            <Tab value="b" selected={v === "b"} className="rside-tab">
              Beta
            </Tab>
          </TabList>
          <TabPanel value={v} className="rside-body">
            {v}
          </TabPanel>
        </Tabs>
      );
    }
    await show(<Page />);
    const strip = q('[role="tablist"]')!;
    expect(strip.parentElement!.className).toBe("ui-tabs"); // Base UI's root, display: contents
    const tabs = qa('[role="tab"]');
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1]);
    tabs[0].focus();
    await press(tabs[0], "ArrowRight");
    await wait();
    expect(opened).toHaveBeenCalledWith("b");
    expect(document.activeElement!.textContent).toBe("Beta");
    const panel = q('[role="tabpanel"]')!;
    expect(panel.getAttribute("aria-labelledby")).toBe(document.activeElement!.id);
    expect(document.activeElement!.getAttribute("aria-controls")).toBe(panel.id);
  });
});

describe("Tooltip", () => {
  it("shows after the pointer settles, describes the element by it, and goes on leave", async () => {
    await show(
      <Tooltip tip="Refresh the list">
        <button aria-label="Refresh">R</button>
      </Tooltip>,
    );
    const b = q<HTMLButtonElement>('[aria-label="Refresh"]')!;
    await act(async () => void b.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
    await act(async () => void b.dispatchEvent(new PointerEvent("pointerenter", { bubbles: false })));
    await wait(260);
    const tip = q('[role="tooltip"]')!;
    expect(tip.textContent).toBe("Refresh the list");
    expect(tip.className).toBe("tip ui-tip");
    expect(b.getAttribute("aria-describedby")).toBe(tip.id);
    await act(async () => void b.dispatchEvent(new PointerEvent("pointerout", { bubbles: true })));
    await act(async () => void b.dispatchEvent(new PointerEvent("pointerleave", { bubbles: false })));
    await wait();
    expect(q('[role="tooltip"]')).toBeNull();
    expect(b.hasAttribute("aria-describedby")).toBe(false);
  });
});
