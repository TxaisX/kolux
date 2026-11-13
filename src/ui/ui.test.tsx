// The src/ui layer under a server render (the first frame, drawn before Base UI is read) plus the Escape bridge to
// Kolux's stack. The open state, on a real DOM, is ui.dom.test.tsx.
import dialogSrc from "./Dialog.tsx?raw";
import menuSrc from "./Menu.tsx?raw";
import popoverSrc from "./Popover.tsx?raw";
import selectSrc from "./Select.tsx?raw";
import layerSrc from "./layer.ts?raw";
import tabsSrc from "./Tabs.tsx?raw";
import tooltipSrc from "./Tooltip.tsx?raw";
import partSrc from "./part.ts?raw";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pushModal } from "../chrome/modalStack";
import { Checkbox, ContextMenu, Dialog, Menu, MenuItem, Select, Switch, Tab, TabList, TabPanel, Tabs, pointAnchor } from "./index";

const SOURCES: Record<string, string> = { "Dialog.tsx": dialogSrc, "Menu.tsx": menuSrc, "Popover.tsx": popoverSrc, "Select.tsx": selectSrc, "Tabs.tsx": tabsSrc, "Tooltip.tsx": tooltipSrc, "part.ts": partSrc, "layer.ts": layerSrc };
const src = (f: string) => SOURCES[f];

describe("src/ui wrappers (server render: the first frame, before Base UI is read)", () => {
  it("a tab set keeps Kolux's classes, roles and one tab stop on the first paint, and links the open tab to its panel", () => {
    const html = renderToString(
      <Tabs value="b" onValue={() => {}}>
        <TabList label="Right sidebar tabs" className="rside-tabs">
          <Tab value="a" selected={false} className="rside-tab">
            A
          </Tab>
          <Tab value="b" selected className="rside-tab" data-testid="tab-b">
            B
          </Tab>
        </TabList>
        <TabPanel value="b" className="rside-body">
          body
        </TabPanel>
      </Tabs>,
    );
    expect(html).toMatch(/<div role="tablist" aria-label="Right sidebar tabs" class="rside-tabs">/);
    const b = /<button([^>]*)>B</.exec(html)![1];
    expect(b).toMatch(/tabindex="0"[^>]*role="tab"[^>]*aria-selected="true"/);
    expect(b).toMatch(/class="rside-tab"/);
    expect(b).toMatch(/data-testid="tab-b"/);
    expect(/<button([^>]*)>A</.exec(html)![1]).toMatch(/tabindex="-1"[^>]*role="tab"[^>]*aria-selected="false"/);
    const id = /id="([^"]+)"[^>]*>B</.exec(html)![1];
    const controls = /aria-controls="([^"]+)"/.exec(b)![1];
    expect(html).toContain(`<div role="tabpanel" id="${controls}" class="rside-body" aria-labelledby="${id}">body</div>`);
  });

  it("a closed menu, context menu or dialog draws nothing (and reads no code)", () => {
    const html = renderToString(
      <>
        <Menu open={false} onClose={() => {}} label="More">
          <MenuItem>x</MenuItem>
        </Menu>
        <ContextMenu at={null} onClose={() => {}} label="Row">
          <MenuItem>x</MenuItem>
        </ContextMenu>
        <Dialog open={false} onClose={() => {}} label="About" className="menu">
          x
        </Dialog>
      </>,
    );
    expect(html).toBe("");
  });

  it("a select's closed control is the .field combobox Base UI draws, showing the chosen label, as wide as its longest option", () => {
    const html = renderToString(<Select label="commit message writer" value="b" onChange={() => {}} options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]} />);
    expect(html).toMatch(/^<button type="button" role="combobox" aria-expanded="false" aria-haspopup="listbox" aria-label="commit message writer" class="field ui-select">/);
    expect(html).toMatch(/<span class="ui-select-box"><span class="ui-select-value">Beta<\/span><span class="ui-select-sizer" aria-hidden="true"><span>Alpha<\/span><span>Beta<\/span><\/span><\/span><span class="ui-select-icon" aria-hidden="true"><svg/);
  });

  it("switch and checkbox stay native inputs inside the .check label", () => {
    const sw = renderToString(<Switch checked onChange={() => {}}>Wrap lines</Switch>);
    expect(sw).toMatch(/<label class="check"><input type="checkbox" role="switch" aria-checked="true" checked=""/);
    const cb = renderToString(<Checkbox checked={false} onChange={() => {}} aria-label="pick" />);
    expect(cb).toMatch(/<input type="checkbox"[^>]*aria-label="pick"/);
    expect(cb).not.toMatch(/role=/);
  });

  it("a right-click point becomes a zero-size anchor rectangle", () => {
    const r = pointAnchor(40, 70).getBoundingClientRect();
    expect([r.left, r.top, r.right, r.bottom, r.width, r.height]).toEqual([40, 70, 40, 70, 0, 0]);
  });

  it("no wrapper imports Base UI itself: only base.tsx does, and it is read on demand", () => {
    for (const f of ["Dialog.tsx", "Menu.tsx", "Popover.tsx", "Select.tsx", "Tabs.tsx", "Tooltip.tsx", "part.ts"]) expect(src(f), f).not.toMatch(/from "@base-ui/);
    expect(src("part.ts")).toMatch(/import\("\.\/base"\)/);
    expect(src("part.ts")).toMatch(/ahead\(1, readBase\)/);
  });
});

describe("Escape bridge (layer.ts)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("every popup wrapper joins the Kolux layer, and Escape is caught on the window before Base UI or the terminal", () => {
    for (const f of ["Dialog.tsx", "Menu.tsx", "Popover.tsx", "Select.tsx"]) expect(src(f), f).toMatch(/useLayer\(/);
    const layer = src("layer.ts");
    expect(layer).toMatch(/pushModal\(modal\)/);
    expect(layer).toMatch(/watchEscape\(window, \(\) => close\.current\("escape"\), \(\) => isTopModal\(modal\) && !composing\)/);
  });

  it("only the newest popup answers Escape, and it stops the key there", async () => {
    const { watchEscape } = await import("../switcher/accounts");
    const { isTopModal } = await import("../chrome/modalStack");
    const listeners: ((e: Event) => void)[] = [];
    const win = { addEventListener: (_: string, f: (e: Event) => void) => listeners.push(f), removeEventListener: () => {} };
    const under = { shown: () => true };
    const over = { shown: () => true };
    const releaseUnder = pushModal(under);
    const releaseOver = pushModal(over);
    const closed: string[] = [];
    watchEscape(win, () => closed.push("under"), () => isTopModal(under));
    watchEscape(win, () => closed.push("over"), () => isTopModal(over));
    const stop = vi.fn();
    const key = { key: "Escape", stopPropagation: stop, preventDefault: () => {} } as unknown as Event;
    for (const f of listeners) f(key);
    expect(closed).toEqual(["over"]);
    expect(stop).toHaveBeenCalledTimes(1);
    releaseOver();
    for (const f of listeners) f(key);
    expect(closed).toEqual(["over", "under"]);
    releaseUnder();
  });
});
