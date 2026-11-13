// The src/ui layer under a server render (the suite has no DOM: Base UI's popups need one, so the open-state
// behaviour is proved in the running app, see docs/base-ui-migration.md) plus the Escape bridge to Kolux's stack.
import dialogSrc from "./Dialog.tsx?raw";
import menuSrc from "./Menu.tsx?raw";
import popoverSrc from "./Popover.tsx?raw";
import selectSrc from "./Select.tsx?raw";
import layerSrc from "./layer.ts?raw";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pushModal } from "../chrome/modalStack";
import { Checkbox, ContextMenu, Dialog, Menu, MenuItem, Select, Switch, Tab, TabList, TabPanel, Tabs, pointAnchor } from "./index";

const SOURCES: Record<string, string> = { "Dialog.tsx": dialogSrc, "Menu.tsx": menuSrc, "Popover.tsx": popoverSrc, "Select.tsx": selectSrc, "layer.ts": layerSrc };
const src = (f: string) => SOURCES[f];

describe("src/ui wrappers (server render)", () => {
  it("a tab set keeps Kolux's classes, roles and one tab stop on the first paint", () => {
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
        <TabPanel value="b" className="rside-body" label="B">
          body
        </TabPanel>
      </Tabs>,
    );
    expect(html).toMatch(/role="tablist"[^>]*aria-label="Right sidebar tabs"|aria-label="Right sidebar tabs"[^>]*role="tablist"/);
    expect(html).toMatch(/<button[^>]*tabindex="0"[^>]*role="tab"[^>]*aria-selected="true"[^>]*data-testid="tab-b"[^>]*class="rside-tab"[^>]*>B</);
    expect(html).toMatch(/<button[^>]*tabindex="-1"[^>]*role="tab"[^>]*aria-selected="false"[^>]*>A</);
    expect(html).toMatch(/role="tabpanel"[^>]*>body</);
  });

  it("a closed menu, context menu or dialog draws nothing", () => {
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

  it("a select's closed control is a .field combobox showing the chosen label", () => {
    const html = renderToString(<Select label="commit message writer" value="b" onChange={() => {}} options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]} />);
    expect(html).toMatch(/<button[^>]*role="combobox"[^>]*>/);
    expect(html).toMatch(/class="field ui-select"/);
    expect(html).toMatch(/aria-label="commit message writer"/);
    expect(html).toMatch(/>Beta</);
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
});

describe("Escape bridge (layer.ts)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("every popup wrapper joins the Kolux layer, and Escape is caught on the window before Base UI or the terminal", () => {
    for (const f of ["Dialog.tsx", "Menu.tsx", "Popover.tsx", "Select.tsx"]) expect(src(f), f).toMatch(/useLayer\(/);
    const layer = src("layer.ts");
    expect(layer).toMatch(/pushModal\(modal\)/);
    expect(layer).toMatch(/watchEscape\(window, \(\) => close\.current\(\), \(\) => isTopModal\(modal\)\)/);
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
