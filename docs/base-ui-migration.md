# Moving popups, tabs and selects onto Base UI

Kolux's menus, dialogs, popovers, tab sets, selects and tooltips are moving from hand-rolled code onto
[Base UI](https://base-ui.com) (`@base-ui/react`, pinned at **1.9.0**). Base UI is read on demand, never with the
window's first frame: only `src/ui/base.tsx` imports it, and `src/ui/part.ts` reads that module at the first idle moment
after the first frame, or sooner when a popup opens (see 9). Base UI supplies the keyboard handling, focus
trapping and screen-reader wiring. The look stays Kolux's own: every wrapper draws with the existing classes
(`.menu`, `.menu-item`, `.field`, `.ask`, `.rside-tab`, `.tip`) and theme variables. There is no new palette and no
new motion.

Import from `src/ui` (`import { Menu, MenuItem } from "../ui/Menu"`, or the barrel `../ui`). Never import
`@base-ui/react` directly in a feature folder. The wrappers carry the Kolux rules described below, and a direct import
would skip them.

The API reference for the pinned version ships in the package:
`node_modules/@base-ui/react/docs/react/components/<name>.md`.

## Which wrapper replaces which pattern

| Hand-rolled pattern today | Wrapper | Notes |
|---|---|---|
| `role="dialog"` box + `useDialogFocus` / `trapDialog` / `trapTab` + `.ask-backdrop` or `.menu-backdrop` | `Dialog` | `viewport="ask-backdrop"` for a centred dialog, `backdrop="menu-backdrop"` for one that places itself |
| `<Ask>` and every `role="alertdialog"` | `AlertDialog` | `chrome/Ask.tsx` is one; a test that opens it runs on happy-dom (`src/tasks/realDom.ts`) |
| `.menu role="menu"` opened from a button + `useMenuFocus` / `trapMenu` | `Menu` + `MenuItem` / `MenuCheckboxItem` / `MenuTitle` | `anchor={buttonRef}`, `align="end"` to line up with the button's right edge |
| `onContextMenu` → `.menu` at `{left: e.clientX, top: e.clientY}` | `ContextMenu` | `at={{x, y}}`; flips when there is no room |
| `.menu role="dialog"` hanging from a status-bar item + `watchEscape` + `restoreFocus` | `Popover` | non-modal by default; focus returns to `anchor` |
| `role="tablist"` + roving `tabIndex` + `onKeyDown` arrow code (`tabStep`) | `Tabs` / `TabList` / `Tab` / `TabPanel` | `render={<aside .../>}` keeps the page's own element instead of a wrapper `<div>` |
| `<select className="field">` | `Select` | the open list becomes a Kolux `.menu`, see "Gotchas" |
| `<input type="checkbox" role="switch">` | `Switch` | stays a native input (see below) |
| `<input type="checkbox">` | `Checkbox` | stays a native input |
| `title="..."` on a button, `<Tip>` | `Tooltip` (+ one `TooltipProvider` near the root) | shown on keyboard focus too; leave a plain `title` where a hover hint is enough |

`Switch` and `Checkbox` stay native on purpose. A native checkbox already answers Space, is a tab stop and is
announced correctly, with no script. Base UI's versions draw a `<span>`, which would change the look of all 99 sites.
The wrappers only give the sites one shape: `checked`, `onChange(boolean)` and the label text.

## Before and after, one per primitive

### Dialog (migrated: `shell/AboutPanel.tsx`)

```tsx
// before
<OutOfFlow>
  <div className="menu-backdrop" onMouseDown={() => setOpen(false)} />
  <div className="menu about-panel" role="dialog" aria-label="About Kolux" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
    ...
    <button className="btn" autoFocus onClick={() => setOpen(false)}>Close</button>
  </div>
</OutOfFlow>

// after
<Dialog onClose={() => setOpen(false)} label="About Kolux" className="menu about-panel" backdrop="menu-backdrop" initialFocus={close}>
  ...
  <button ref={close} className="btn" onClick={() => setOpen(false)}>Close</button>
</Dialog>
```

The old panel did not trap Tab and did not hand focus back. Base UI now does both.

### AlertDialog (migrated: `chrome/Ask.tsx`, so every `<Ask>` call site)

```tsx
// before (Ask.tsx)
<div className="ask-backdrop" onMouseDown={backOut}>
  <div ref={box} className="ask" role="alertdialog" aria-modal="true" aria-label={title} onKeyDown={...}>...</div>
</div>
// with useDialogFocus(box, backOut, () => cancel.current)

// after
<AlertDialog onClose={backOut} label={title} className="ask" viewport="ask-backdrop" initialFocus={cancel} data-testid="ask-dialog"
  onKeyDown={(e) => { e.stopPropagation(); if (askKey(e.key, e.target === ok.current, enter) === "block") e.preventDefault(); }}>
  ...
</AlertDialog>
```

A test written on the fake DOM that opens an Ask moves to a real one with two lines: `// @vitest-environment happy-dom`
at the top and `../tasks/realDom` in place of `../tasks/fakeDom` (same helpers; `mount` hands back the body, so a search
finds the portal). Stubs of focus, `isConnected` or a window listener list become real focus and real events.

### Menu (migrated: the right sidebar's "More" menu)

```tsx
// before
const moreMenu = useRef<HTMLDivElement>(null);
useMenuFocus(moreMenu, menu !== null, () => setMenu(null));
...
<OutOfFlow>
  <div className="menu-backdrop" onClick={() => setMenu(null)} aria-hidden="true" />
  <div ref={moreMenu} className="menu" role="menu" aria-label="More tabs" style={{ left: menu.x, top: menu.y }}>
    <button type="button" role="menuitem" className="menu-item" onClick={() => { setMenu(null); onTab(t.id); }}>...</button>
  </div>
</OutOfFlow>

// after
<Menu open onClose={() => setMenu(false)} label="More tabs" anchor={moreButton} align="end" offset={4}>
  <MenuItem onClick={() => onTab(t.id)}>...</MenuItem>
</Menu>
```

Picking a row closes the menu by itself, so the `setMenu(null)` before the action goes away.

### ContextMenu (migrated: `projects/HideableRow.tsx`, the sidebar's Automations and Skills rows)

```tsx
// before
<OutOfFlow>
  <div className="menu-backdrop" onClick={shut} onContextMenu={(e) => { e.preventDefault(); shut(); }} />
  <div className="menu" role="menu" style={{ left: menu.x, top: menu.y }} onKeyDown={(e) => e.key === "Escape" && shut()}>
    <button className="menu-item" role="menuitem" autoFocus onClick={() => { shut(); onHide(); }}>...</button>
  </div>
</OutOfFlow>

// after
<ContextMenu at={menu} onClose={shut} label={label}>
  <MenuItem onClick={onHide}>...</MenuItem>
</ContextMenu>
```

### Popover (wrapper built; no exemplar, see "What is left")

```tsx
// before (ports/PortsItem.tsx shape)
useEffect(() => (open ? watchEscape(window, close) : undefined), [open]);
<div className="menu ports-menu" role="dialog" aria-label="Ports" style={{ left, bottom }}>...</div>

// after
<Popover open={open} onClose={close} label="Ports" anchor={button} side="top" className="ports-menu">...</Popover>
```

### Tabs (migrated: the right sidebar's tab strip)

```tsx
// before
<aside className="rside" ...>
  <div className="rside-tabs" role="tablist" aria-label="Right sidebar tabs" onKeyDown={onTabKey}>
    <button type="button" role="tab" aria-selected={t.id === current} tabIndex={t.id === current ? 0 : -1} className="rside-tab" onClick={() => onTab(t.id)}>...</button>
  </div>
  <div className="rside-body" role="tabpanel" aria-label={...}>...</div>
</aside>

// after
<Tabs value={current ?? ""} onValue={onTab} render={<aside className="rside" ... />}>
  <TabList className="rside-tabs" label="Right sidebar tabs">
    <Tab value={t.id} selected={t.id === current} className="rside-tab">...</Tab>
  </TabList>
  <TabPanel value={current ?? ""} className="rside-body" label={...}>...</TabPanel>
</Tabs>
```

The tab and its panel are now linked by `aria-controls` and `aria-labelledby`, and the hand-written `onTabKey` goes away.

### Select (migrated: Settings > Git, "Written by")

```tsx
// before
<select aria-label="commit message writer" className="field" value={v} onChange={(e) => save(e.target.value)}>
  <option value="custom">Custom command</option>
</select>

// after
<Select label="commit message writer" value={v} onChange={save} options={[{ value: "custom", label: "Custom command" }]} />
```

### Switch and Checkbox

```tsx
// before
<label className="check"><input type="checkbox" role="switch" checked={on} onChange={(e) => save(e.target.checked)} /> Wrap lines</label>
// after
<Switch checked={on} onChange={save}>Wrap lines</Switch>
```

### Tooltip

```tsx
// before
<button className="ib" title="Refresh">...</button>
// after
<Tooltip tip="Refresh"><button className="ib" aria-label="Refresh">...</button></Tooltip>
```

## Gotchas

1. **The test DOM.** About 96 test files mount components on the hand-built fake DOM (`src/tasks/fakeDom.ts`). Base
   UI's popups cannot open there (no `querySelector`, `matches` or focus). A test that opens a migrated popup runs on
   happy-dom instead: `// @vitest-environment happy-dom` as its first line (happy-dom 21.0.4 is a devDependency, test
   only, DT-C280). Do not switch the global environment. The fake DOM gained `Element` and `HTMLElement` only, so a tab
   strip that hands over to Base UI (see 9) still draws there. `src/ui/ui.dom.test.tsx` is the pattern to copy.
2. **Escape belongs to Kolux, not Base UI.** Escape also interrupts an agent's turn in the terminal underneath, so
   every Kolux popup catches it on the window in the capture phase and stops it there (`watchEscape`). The wrappers
   do this through `src/ui/layer.ts` (`useLayer`), which also pushes the popup onto `chrome/modalStack.ts`. As a
   result, only the newest popup on screen answers Escape, whether it is migrated or hand-rolled. Base UI's own
   Escape listener sits on the document and never sees the key. Do not pass Base UI's Escape options to work around
   this.
3. **Nested dialogs: migrate outer to inner.** A modal Base UI dialog makes everything outside its portal inert and
   pulls focus back into itself. A hand-rolled dialog opened on top of it, but rendered outside its portal, would lose
   focus. Migrate the outer dialog only together with, or after, the dialogs it opens. Alternatively, render the inner
   one inside the outer `Dialog`'s children.
4. **Layering.** Base UI places a positioner element and draws the popup inside it. `.ui-positioner` carries
   `z-index: var(--z-menu)`, and `.menu` inside it is `position: static`. A menu that must sit above a dialog needs
   its own positioner class with a higher `--z-*` token, not a z-index on the popup.
5. **First paint of tabs.** Base UI sets the roving `tabIndex` after mount, so `Tab` takes `selected` and writes
   `tabIndex` itself. A server render (`renderToString` tests) shows one tab stop. Attribute order in the HTML is
   `tabindex role aria-selected`, which matters for regex tests.
6. **The open select list changes look.** The closed control matches the old `.field` box. The open list is a Kolux
   `.menu` instead of the web view's native dropdown. This is the one visible change, and an intended one: it matches
   every other Kolux menu in both themes.
7. **Tests.** Base UI renders nothing for a closed or portalled popup under `renderToString`. Assert on the call site's
   source (`?raw` or `readFileSync`) or on the inline parts (tabs, select trigger), and prove the open state in the
   running app (`scripts/evidence/cdp.mjs`). After editing a file a `?raw` test reads, run
   `npx vitest run --no-fsModuleCache`.
8. **`chrome/reach.test.ts`.** It scans for `role="dialog"` literals. A dialog moved to `<Dialog>` has no literal at its
   call site, so remove its row from `DIALOGS` / `TRAPS`. The wrapper's Escape is proved once in `src/ui/ui.test.tsx`.
9. **Base UI is not in the first load.** Base UI and its positioning code are about 130 kB of script, and the first load
   had about 9 kB of room under its ceiling (`scripts/bundle-budget.mjs`). So every wrapper draws its closed state
   itself and calls Base UI (`base.tsx`, through `useBase` in `part.ts`) only when it opens: a closed dialog, menu or
   popover draws nothing; a select draws the same `.field` button Base UI would and reads Base UI on the first press or
   arrow key; a tab strip draws the same buttons and roles and hands over once the code is in (Base UI wraps only the
   strip, so the panel is not drawn again); a tooltip decides itself when to show and asks Base UI only to place it.
   Never import `@base-ui/react` outside `base.tsx`.

## Remaining call sites

Produced by the script, run from the repo root:

```
node docs/base-ui-sites.mjs            # the checklist below
node docs/base-ui-sites.mjs --counts   # the table only
```

It counts matching source lines, so one dialog with two matching lines counts twice. The **Tooltip** column counts every
`title=` prop, including `title` props of Kolux components such as `<Ask title=...>`. Treat it as an upper bound, not
a to-do list: a plain hover hint can stay a `title`.

Folders other agents own right now: `src/terminal/**` and `src/settings/NativeTerminalCard.*`. Leave those for last.

<!-- SITES:START -->
| Folder | Dialog | Menu | ContextMenu | Popover | Tabs | Switch | Checkbox | Select | Tooltip | All |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| agents | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 5 |
| agentstart | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| artifacts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 | 7 |
| automations | 3 | 3 | 0 | 0 | 1 | 1 | 1 | 13 | 14 | 36 |
| board | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 7 | 9 |
| chat | 2 | 1 | 0 | 0 | 0 | 1 | 0 | 2 | 13 | 19 |
| chrome | 0 | 1 | 2 | 1 | 0 | 1 | 1 | 0 | 22 | 28 |
| editmenu | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| editor | 6 | 6 | 4 | 0 | 0 | 0 | 4 | 4 | 128 | 152 |
| feedback | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 2 | 4 |
| floor | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 3 |
| inbox | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 4 |
| insights | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 8 |
| launch | 1 | 1 | 0 | 1 | 0 | 0 | 2 | 3 | 32 | 40 |
| look | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 3 | 5 |
| onboarding | 7 | 1 | 0 | 0 | 1 | 6 | 2 | 1 | 9 | 27 |
| ports | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 3 | 5 |
| projects | 8 | 1 | 6 | 0 | 1 | 0 | 19 | 17 | 75 | 127 |
| recovery | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 4 |
| scm | 4 | 5 | 2 | 0 | 0 | 0 | 5 | 6 | 98 | 120 |
| sessions | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 4 | 16 | 22 |
| settings | 3 | 1 | 0 | 0 | 1 | 30 | 10 | 27 | 43 | 115 |
| setup | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 3 |
| shell | 3 | 1 | 2 | 0 | 2 | 0 | 1 | 0 | 24 | 33 |
| skills | 2 | 3 | 0 | 1 | 0 | 0 | 2 | 0 | 19 | 27 |
| space | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 4 | 7 |
| status | 4 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 9 | 14 |
| switcher | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 5 |
| tasks | 2 | 0 | 0 | 0 | 2 | 0 | 3 | 14 | 41 | 62 |
| terminal | 7 | 2 | 3 | 0 | 0 | 0 | 0 | 0 | 29 | 41 |
| tower | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 4 |
| update | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 5 |
| usage | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 13 | 15 |
| **Total** | **61** | **29** | **20** | **4** | **8** | **42** | **57** | **92** | **646** | **959** |

### agents

- [ ] `src/agents/AgentsRail.tsx`: Tooltip :44, Tooltip :57, Tooltip :62, Tooltip :70, Tooltip :75

### agentstart

- [ ] `src/agentstart/AgentStartHost.tsx`: Dialog :56

### artifacts

- [ ] `src/artifacts/ArtifactsPage.tsx`: Tooltip :240, Tooltip :468, Tooltip :482, Tooltip :502, Tooltip :517, Tooltip :541, Tooltip :557

### automations

- [ ] `src/automations/AutomationDetail.tsx`: Switch :68, Tooltip :72, Tabs :97
- [ ] `src/automations/AutomationDialog.tsx`: Dialog :311, Select :358, Select :375, Select :385, Checkbox :397, Select :399, Select :412, Select :432, Select :443, Select :464, Select :502, Select :523, Tooltip :564, Tooltip :571
- [ ] `src/automations/AutomationsPage.tsx`: Dialog :200, Menu :200, Dialog :208, Menu :208, Tooltip :295, Tooltip :337, Select :346, Select :351, Tooltip :368, Tooltip :371, Tooltip :379, Tooltip :461, Tooltip :473, Menu :493, Tooltip :496
- [ ] `src/automations/RunsDashboard.tsx`: Select :99, Tooltip :107, Tooltip :174, Tooltip :175

### board

- [ ] `src/board/ChipRow.tsx`: Tooltip :13, Tooltip :18, Tooltip :24, Tooltip :27, Tooltip :34
- [ ] `src/board/WorkspaceBoard.tsx`: Dialog :131, Tooltip :199, Tooltip :221, Menu :223

### chat

- [ ] `src/chat/ChatText.tsx`: Tooltip :61, Menu :117, Tooltip :118
- [ ] `src/chat/ChatView.tsx`: Tooltip :396, Tooltip :398, Switch :530, Tooltip :546
- [ ] `src/chat/MessageBox.tsx`: Tooltip :383, Tooltip :430
- [ ] `src/chat/ModelControls.tsx`: Select :37, Tooltip :37, Select :51, Tooltip :51, Tooltip :64
- [ ] `src/chat/PermissionCard.tsx`: Dialog :7, Tooltip :10
- [ ] `src/chat/QuestionCard.tsx`: Dialog :27, Tooltip :31
- [ ] `src/chat/StepRows.tsx`: Tooltip :190

### chrome

- [ ] `src/chrome/AppLookCard.tsx`: Switch :39
- [ ] `src/chrome/Ask.tsx`: Checkbox :72
- [ ] `src/chrome/LayoutStrip.tsx`: Tooltip :33, Tooltip :44
- [ ] `src/chrome/RightSidebar.tsx`: Tooltip :180, Tooltip :189, Tooltip :201
- [ ] `src/chrome/StatusBar.tsx`: ContextMenu :70, Tooltip :72, Tooltip :80, Popover :87, Tooltip :87, Tooltip :95, Tooltip :101, ContextMenu :110, Menu :111, Tooltip :122
- [ ] `src/chrome/TopBar.tsx`: Tooltip :96, Tooltip :111, Tooltip :114, Tooltip :117, Tooltip :134, Tooltip :139, Tooltip :142, Tooltip :147, Tooltip :154, Tooltip :157, Tooltip :160

### editmenu

- [ ] `src/editmenu/EditMenuHost.tsx`: ContextMenu :152, Menu :153

### editor

- [ ] `src/editor/AddProjectRow.tsx`: Tooltip :49
- [ ] `src/editor/AllChangesPane.tsx`: Tooltip :376, Tooltip :383, Select :387, Tooltip :387, Tooltip :392, Tooltip :395, Tooltip :399, Checkbox :400, Tooltip :402, Checkbox :403, Tooltip :413, Tooltip :422, Tooltip :428, Tooltip :431, Tooltip :446, Tooltip :449, Tooltip :453, Tooltip :467, Tooltip :472, Tooltip :473, Tooltip :481, Tooltip :511, Tooltip :636, Checkbox :639, Tooltip :639, Tooltip :640, Tooltip :643, Tooltip :647, Tooltip :652, Tooltip :657
- [ ] `src/editor/ChangeTree.tsx`: Checkbox :44, Tooltip :44, Tooltip :45, Tooltip :48
- [ ] `src/editor/CloseDialog.tsx`: Dialog :101
- [ ] `src/editor/CodeLabel.tsx`: Select :50, Tooltip :53
- [ ] `src/editor/ContentSearch.tsx`: Tooltip :75, Tooltip :103, Tooltip :113
- [ ] `src/editor/DiffPane.tsx`: Tooltip :511, Menu :517, Tooltip :533, Tooltip :536, Tooltip :543, Tooltip :546, Tooltip :559, Tooltip :567, Tooltip :572, Tooltip :573, Tooltip :577, Tooltip :585, Dialog :621
- [ ] `src/editor/DiskBanner.tsx`: Tooltip :30, Tooltip :33, Tooltip :36, Tooltip :50, Tooltip :53, Tooltip :89, Tooltip :92, Tooltip :95
- [ ] `src/editor/DrawPanel.tsx`: Tooltip :53
- [ ] `src/editor/EditorPane.tsx`: Tooltip :152, Tooltip :173, Tooltip :770, Tooltip :774, Tooltip :775, Tooltip :780, Tooltip :794, Tooltip :804, Tooltip :811, Tooltip :816, Tooltip :823, Tooltip :826, Tooltip :832, Tooltip :846
- [ ] `src/editor/Explorer.tsx`: Tooltip :825, Tooltip :828, Tooltip :831, Tooltip :834, Tooltip :837, Tooltip :843, Tooltip :849, Tooltip :852, Tooltip :855, Tooltip :858, Tooltip :861, ContextMenu :867, Menu :868, ContextMenu :879, Menu :880, Tooltip :913, Tooltip :933, ContextMenu :951, ContextMenu :977, Tooltip :978, Tooltip :992
- [ ] `src/editor/FilePicker.tsx`: Dialog :104
- [ ] `src/editor/ImageCanvas.tsx`: Tooltip :92, Tooltip :95, Tooltip :98, Tooltip :101, Tooltip :104
- [ ] `src/editor/ImageView.tsx`: Tooltip :47, Tooltip :51, Tooltip :56, Tooltip :68, Tooltip :73
- [ ] `src/editor/LinkHover.tsx`: Tooltip :69
- [ ] `src/editor/NamePrompt.tsx`: Dialog :79
- [ ] `src/editor/NoteRail.tsx`: Tooltip :80, Tooltip :92, Tooltip :136
- [ ] `src/editor/NoteTools.tsx`: Tooltip :111, Tooltip :114, Tooltip :120, Tooltip :123, Tooltip :126, Tooltip :173, Tooltip :191
- [ ] `src/editor/NotebookView.tsx`: Tooltip :158, Tooltip :173, Select :193
- [ ] `src/editor/PdfView.tsx`: Tooltip :244, Tooltip :248, Tooltip :253, Tooltip :265, Tooltip :270, Tooltip :283, Tooltip :286, Tooltip :289, Tooltip :292
- [ ] `src/editor/PreviewPane.tsx`: Tooltip :207, Tooltip :212, Tooltip :216, Tooltip :221, Tooltip :232, Menu :238, Tooltip :246
- [ ] `src/editor/ReviewNotes.tsx`: Dialog :71, Tooltip :118, Menu :150, Tooltip :191
- [ ] `src/editor/RichToolbar.tsx`: Tooltip :59, Select :77, Tooltip :80
- [ ] `src/editor/TableControls.tsx`: Tooltip :102, Tooltip :108, Menu :113, Tooltip :115
- [ ] `src/editor/TemplatePicker.tsx`: Dialog :66

### feedback

- [ ] `src/feedback/FeedbackDialog.tsx`: Dialog :170, Checkbox :202, Tooltip :214, Tooltip :215

### floor

- [ ] `src/floor/FloorView.tsx`: Tooltip :73, Tooltip :76, Tooltip :86

### inbox

- [ ] `src/inbox/InboxView.tsx`: Tooltip :63, Tooltip :91, Tooltip :95, Tooltip :166

### insights

- [ ] `src/insights/InsightsPanel.tsx`: Tooltip :43, Tooltip :165, Tooltip :167, Tooltip :168, Tooltip :172, Tooltip :176, Tooltip :197, Tooltip :205

### launch

- [ ] `src/launch/AgentPicker.tsx`: Tooltip :41, Checkbox :42
- [ ] `src/launch/ChooserPane.tsx`: Tooltip :37, Dialog :55, Tooltip :317, Tooltip :321, Tooltip :331, Tooltip :348, Tooltip :356, Tooltip :362, Tooltip :365, Tooltip :370, Tooltip :441, Tooltip :471, Tooltip :475, Tooltip :509, Tooltip :536, Tooltip :542, Popover :550, Tooltip :550, Tooltip :567, Select :616, Tooltip :627, Checkbox :628, Tooltip :648, Tooltip :669, Tooltip :673
- [ ] `src/launch/KeepAwakeCard.tsx`: Select :37, Tooltip :74
- [ ] `src/launch/NewTabEntryBox.tsx`: Tooltip :74
- [ ] `src/launch/PlusMenu.tsx`: Menu :144, Tooltip :185, Tooltip :195, Tooltip :207, Tooltip :216, Tooltip :225, Tooltip :235, Tooltip :250, Tooltip :275
- [ ] `src/launch/TeamsModeCard.tsx`: Select :18

### look

- [ ] `src/look/CardDetailsChooser.tsx`: Checkbox :15, Tooltip :15
- [ ] `src/look/FinishSettings.tsx`: Tooltip :42
- [ ] `src/look/HeaderBadge.tsx`: Tooltip :26
- [ ] `src/look/SidebarSettings.tsx`: Switch :63

### onboarding

- [ ] `src/onboarding/CliSetup.tsx`: Checkbox :79
- [ ] `src/onboarding/Guides.tsx`: Dialog :177, Tooltip :190, Tooltip :211, Dialog :269, Tabs :279, Tooltip :305, Dialog :427, Dialog :488, Dialog :562, Switch :565
- [ ] `src/onboarding/HelpMenu.tsx`: Tooltip :16
- [ ] `src/onboarding/HelpSheet.tsx`: Menu :63
- [ ] `src/onboarding/SidebarStart.tsx`: Tooltip :45, Tooltip :54
- [ ] `src/onboarding/StepPanels.tsx`: Switch :145, Select :150, Switch :346, Checkbox :364, Switch :365
- [ ] `src/onboarding/Tours.tsx`: Dialog :130
- [ ] `src/onboarding/Wizard.tsx`: Dialog :117, Tooltip :122, Tooltip :127, Switch :151, Switch :176, Tooltip :217

### ports

- [ ] `src/ports/PortsItem.tsx`: Popover :112, Tooltip :112, Dialog :118, Tooltip :129, Tooltip :133

### projects

- [ ] `src/projects/AddProject.tsx`: Dialog :120, Tooltip :144, Tooltip :174, Dialog :200, Tooltip :226
- [ ] `src/projects/AttachedTabs.tsx`: Tooltip :17
- [ ] `src/projects/CacheTimer.tsx`: Tooltip :10, Tooltip :15
- [ ] `src/projects/CleanupDialog.tsx`: Dialog :133, Select :150, Select :158, Select :164, Select :169, Select :174, Tooltip :197, Checkbox :198, Checkbox :206, Dialog :222, Checkbox :247, Tooltip :274
- [ ] `src/projects/FolderRenameAsk.tsx`: Tooltip :16, Tooltip :26
- [ ] `src/projects/HideableRow.tsx`: ContextMenu :17
- [ ] `src/projects/IconPicker.tsx`: Tooltip :28
- [ ] `src/projects/ImportSetup.tsx`: Dialog :17
- [ ] `src/projects/KeptBranches.tsx`: Checkbox :62
- [ ] `src/projects/MessageNote.tsx`: Tooltip :17
- [ ] `src/projects/Picker.tsx`: Tooltip :26, Tooltip :66
- [ ] `src/projects/ProjectsPanel.tsx`: Tooltip :1133, Select :1141, Checkbox :1166, Checkbox :1170, Select :1177, Select :1182, Checkbox :1190, Checkbox :1212, Tooltip :1419, Tooltip :1507, Tooltip :1510, Select :1514, Tooltip :1519, Tooltip :1547, Tooltip :1550, Select :1554, Tooltip :1560, Tooltip :1586, Tooltip :1590, Tooltip :1715, ContextMenu :1887, Tooltip :1893, Tooltip :1898, Tooltip :1926, Tooltip :1937, Tooltip :1942, Tooltip :1947, Tooltip :1956, Tooltip :1969, Tooltip :1981, Tooltip :1994, Tooltip :2006, Tooltip :2018, Tooltip :2032, Tooltip :2095, Tooltip :2142, Tooltip :2158, Checkbox :2202, Checkbox :2208, Tooltip :2233, Tooltip :2267, ContextMenu :2280, Tooltip :2287, Tooltip :2288, Tooltip :2291, Tooltip :2294, Tooltip :2300, ContextMenu :2309, Tooltip :2310, Select :2329, Tooltip :2340, Tooltip :2380, Tooltip :2386, Tooltip :2389, Select :2412, Tooltip :2424, Checkbox :2430, ContextMenu :2461, Tooltip :2462, Tooltip :2470, Tooltip :2473, Tooltip :2508, Tooltip :2512, Tooltip :2515, Tooltip :2518, Tooltip :2522, Tabs :2531, Tooltip :2535, Select :2587, Tooltip :2598, Checkbox :2609, Select :2624, Select :2631, Checkbox :2638, Checkbox :2641, Checkbox :2645, Checkbox :2649, Checkbox :2658, ContextMenu :2733, Menu :2735, Tooltip :2781, Tooltip :2820, Tooltip :2824, Tooltip :2829, Tooltip :2834
- [ ] `src/projects/ScanRepos.tsx`: Dialog :107, Tooltip :132, Checkbox :133, Tooltip :169
- [ ] `src/projects/StartGit.tsx`: Dialog :30, Tooltip :43, Checkbox :49, Tooltip :64
- [ ] `src/projects/WorktreePalette.tsx`: Dialog :302, Select :328, Select :336, Tooltip :352, Tooltip :370

### recovery

- [ ] `src/recovery/CrashReportDialog.tsx`: Dialog :92
- [ ] `src/recovery/RecoveryMount.tsx`: Dialog :93
- [ ] `src/recovery/RecoveryNotes.tsx`: Tooltip :14, Tooltip :18

### scm

- [ ] `src/scm/AutoPrStatus.tsx`: Tooltip :53, Tooltip :57, Tooltip :65, Tooltip :76, Tooltip :80, Tooltip :85, Tooltip :92, Tooltip :102, Tooltip :107
- [ ] `src/scm/CheckPane.tsx`: Tooltip :48, Tooltip :51, Tooltip :55, Tooltip :108, Tooltip :180, Tooltip :186
- [ ] `src/scm/ChecksPanel.tsx`: Tooltip :118, Tooltip :151, Tooltip :163, Tooltip :190, Tooltip :199, Tooltip :208, Tooltip :231
- [ ] `src/scm/CommentsPanel.tsx`: Tooltip :198, Tooltip :208, Menu :212, Tooltip :217, Tooltip :241, Tooltip :245, Tooltip :291, Tooltip :299, Tooltip :307, Tooltip :353, Tooltip :356, Tooltip :359, Tooltip :400
- [ ] `src/scm/FailureNotice.tsx`: Tooltip :33, Tooltip :36, Tooltip :44
- [ ] `src/scm/FileOpenWith.tsx`: Select :47
- [ ] `src/scm/HandoffNote.tsx`: Select :94, Tooltip :102
- [ ] `src/scm/LineNotes.tsx`: Tooltip :64, Tooltip :75, Tooltip :78, Tooltip :84, Tooltip :89, Tooltip :92
- [ ] `src/scm/LocalOnlyIcon.tsx`: Tooltip :17
- [ ] `src/scm/OneClickNotice.tsx`: Tooltip :32, Tooltip :44
- [ ] `src/scm/PrStart.tsx`: Dialog :279, Tooltip :284, Checkbox :299, Tooltip :303
- [ ] `src/scm/SourceControlPanel.tsx`: Tooltip :322, Tooltip :328, Tooltip :586, ContextMenu :587, Tooltip :599, Tooltip :604, Tooltip :610, Tooltip :616, Tooltip :639, Tooltip :643, Tooltip :652, Tooltip :658, Tooltip :687, Tooltip :694, Select :699, Tooltip :699, Tooltip :708, Tooltip :712, Tooltip :716, Tooltip :720, Tooltip :723, Tooltip :734, Checkbox :760, Tooltip :801, Tooltip :819, Tooltip :831, Tooltip :837, Tooltip :853, Tooltip :860, Tooltip :866, Tooltip :878, Menu :886, Tooltip :895, Menu :911, Tooltip :920, Tooltip :935, Tooltip :951, Tooltip :955, Tooltip :963, Tooltip :968, Tooltip :972, Tooltip :976, Dialog :1041, Checkbox :1056, Tooltip :1065, Tooltip :1093, Tooltip :1097, Dialog :1106, Select :1115, Checkbox :1124, Tooltip :1145, Tooltip :1148, Tooltip :1151, Tooltip :1154, Tooltip :1208, Tooltip :1225, ContextMenu :1243, Tooltip :1250, Tooltip :1255, Menu :1289, Menu :1317, Tooltip :1347
- [ ] `src/scm/StackMap.tsx`: Checkbox :139, Dialog :151
- [ ] `src/scm/WriterPicker.tsx`: Select :63, Select :87

### sessions

- [ ] `src/sessions/AgentsPanel.tsx`: Tooltip :218, Select :231, Tooltip :238, Select :252, Select :262, Select :272, Checkbox :281, Checkbox :286, Tooltip :291, Tooltip :318, Tooltip :329, Tooltip :337, Tooltip :341, Tooltip :345, Tooltip :348
- [ ] `src/sessions/SessionDetail.tsx`: Tooltip :35, Tooltip :57, Tooltip :65, Tooltip :69
- [ ] `src/sessions/SessionFiles.tsx`: Tooltip :71, Tooltip :74, Tooltip :77

### settings

- [ ] `src/settings/AccountRow.tsx`: Tooltip :35, Tooltip :66
- [ ] `src/settings/AgentCredentials.tsx`: Select :89, Checkbox :107
- [ ] `src/settings/AgentsPage.tsx`: Switch :48, Switch :80, Select :152, Select :166, Select :174, Switch :212, Switch :244, Select :252
- [ ] `src/settings/AiRecipesSection.tsx`: Checkbox :55, Select :66, Tooltip :74
- [ ] `src/settings/AppearancePage.tsx`: Select :200, Tooltip :226, Tooltip :260, Tooltip :264, Tooltip :295, Select :313, Tooltip :330, Checkbox :423, Checkbox :430, Switch :492, Select :517, Switch :541, Switch :549, Checkbox :558
- [ ] `src/settings/ClaudeAccounts.tsx`: Tooltip :57, Tooltip :66, Switch :99
- [ ] `src/settings/ClaudeSetupPage.tsx`: Tooltip :64, Tooltip :86, Tooltip :107, Tooltip :134, Tooltip :138, Tooltip :189, Tooltip :203, Tooltip :218, Tooltip :244, Tooltip :259, Tooltip :262, Tooltip :275, Tooltip :283, Tooltip :293, Tooltip :319, Tooltip :320, Tooltip :321, Tooltip :330, Select :433
- [ ] `src/settings/CodexAccounts.tsx`: Tooltip :58, Tooltip :67
- [ ] `src/settings/ConnectGrid.tsx`: Menu :54
- [ ] `src/settings/CustomThemeEditor.tsx`: Tooltip :59, Tooltip :60, Tooltip :63, Tooltip :274
- [ ] `src/settings/ExperimentalCard.tsx`: Switch :19
- [ ] `src/settings/GeneralPage.tsx`: Checkbox :52, Checkbox :56, Switch :125, Switch :141, Select :207, Switch :289
- [ ] `src/settings/GitPage.tsx`: Select :71, Switch :98, Switch :109, Switch :121, Select :134, Switch :140, Switch :180
- [ ] `src/settings/GrokCard.tsx`: Dialog :161
- [ ] `src/settings/InputCards.tsx`: Switch :19
- [ ] `src/settings/NativeTerminalCard.tsx`: Switch :35
- [ ] `src/settings/NotificationsPage.tsx`: Switch :73, Switch :85, Switch :90, Switch :98, Select :110, Switch :169
- [ ] `src/settings/RepoPage.tsx`: Select :41
- [ ] `src/settings/RepoSetup.tsx`: Select :93, Checkbox :136, Select :141
- [ ] `src/settings/RoutingPage.tsx`: Tabs :51, Tooltip :53, Tooltip :61, Select :86, Select :97
- [ ] `src/settings/SafetyPage.tsx`: Switch :73, Switch :89
- [ ] `src/settings/SafetyRules.tsx`: Tooltip :112, Tooltip :115, Select :157, Switch :171, Select :193
- [ ] `src/settings/SchemePicker.tsx`: Tooltip :41
- [ ] `src/settings/SettingsPage.tsx`: Switch :121, Dialog :386, Dialog :402, Tooltip :467
- [ ] `src/settings/SetupPolicyRow.tsx`: Select :15
- [ ] `src/settings/ShortcutsPage.tsx`: Select :109, Tooltip :174, Tooltip :177
- [ ] `src/settings/TerminalImport.tsx`: Checkbox :141, Checkbox :148
- [ ] `src/settings/TerminalPage.tsx`: Switch :66, Select :76, Select :232, Switch :250
- [ ] `src/settings/autoPr.tsx`: Select :68, Tooltip :80, Select :83

### setup

- [ ] `src/setup/TrustDialog.tsx`: Tooltip :39, Checkbox :52
- [ ] `src/setup/TrustPrompt.tsx`: Dialog :71

### shell

- [ ] `src/shell/ConfirmClear.tsx`: Tooltip :12, Tooltip :15
- [ ] `src/shell/LinkAskDialog.tsx`: Dialog :1, Dialog :23
- [ ] `src/shell/ProjectsExtras.tsx`: Tooltip :21, Tooltip :26, Checkbox :40, Tooltip :57, Tooltip :60, Tooltip :66, Tooltip :164, Tooltip :173, Tooltip :204
- [ ] `src/shell/TabSearch.tsx`: Dialog :48
- [ ] `src/shell/WindowView.tsx`: Tooltip :32
- [ ] `src/shell/window/Content.tsx`: Tooltip :73, Tooltip :192, Tabs :203, Tooltip :205
- [ ] `src/shell/window/Dialogs.tsx`: Tooltip :48
- [ ] `src/shell/window/Grid.tsx`: Tabs :101, ContextMenu :151, Tooltip :165, Tooltip :171, Tooltip :177
- [ ] `src/shell/window/Notices.tsx`: Tooltip :24
- [ ] `src/shell/window/Pane.tsx`: Tooltip :269
- [ ] `src/shell/window/TabMenuView.tsx`: ContextMenu :24, Menu :29, Tooltip :42, Tooltip :47, Tooltip :57, Tooltip :83

### skills

- [ ] `src/skills/SkillBarItem.tsx`: Tooltip :11
- [ ] `src/skills/SkillInstall.tsx`: Checkbox :26
- [ ] `src/skills/SkillPill.tsx`: Tooltip :10
- [ ] `src/skills/SkillUpdate.tsx`: Dialog :141
- [ ] `src/skills/SkillUpdateNotice.tsx`: Tooltip :39
- [ ] `src/skills/SkillsPage.tsx`: Tooltip :157, Tooltip :167, Menu :181, Tooltip :186, Tooltip :200, Menu :236, Popover :273, Dialog :279, Tooltip :288, Tooltip :299, Checkbox :373, Tooltip :377, Tooltip :388, Menu :394, Tooltip :396, Tooltip :407, Tooltip :418, Tooltip :426, Tooltip :436, Tooltip :452, Tooltip :483, Tooltip :498

### space

- [ ] `src/space/SpaceView.tsx`: Tooltip :132, Select :141, Checkbox :148, Checkbox :178, Tooltip :178, Tooltip :181, Tooltip :206

### status

- [ ] `src/status/GeneratedTitlesCard.tsx`: Switch :10
- [ ] `src/status/ResourceManager.tsx`: Dialog :159, Tooltip :176, Tooltip :179, Dialog :201, Tooltip :216, Tooltip :219, Tooltip :230, Tooltip :238, Tooltip :245, Tooltip :262
- [ ] `src/status/manage.tsx`: Dialog :82, Dialog :117, Tooltip :135

### switcher

- [ ] `src/switcher/AccountSwitcher.tsx`: Tooltip :98, Tooltip :108, Tooltip :117, Menu :133, Tooltip :138

### tasks

- [ ] `src/tasks/MarkdownView.tsx`: Tooltip :12
- [ ] `src/tasks/NewIssueDialog.tsx`: Dialog :137, Tooltip :140, Select :146, Tooltip :153
- [ ] `src/tasks/ProjectsView.tsx`: Select :44, Select :56, Tooltip :285, Tooltip :298, Tooltip :301, Tooltip :315, Tooltip :361, Select :412, Select :421, Select :431, Tooltip :452, Checkbox :461
- [ ] `src/tasks/PullRequestPage.tsx`: Tooltip :219, Tooltip :259, Tooltip :274, Tabs :305, Tooltip :340, Tooltip :385, Tooltip :393, Tooltip :402, Tooltip :414, Select :423, Select :435, Tooltip :448, Tooltip :482, Checkbox :502
- [ ] `src/tasks/RoadmapTimeline.tsx`: Select :44, Tooltip :67, Tooltip :73, Tooltip :79, Tooltip :81
- [ ] `src/tasks/TaskDialog.tsx`: Dialog :143, Tooltip :164, Tooltip :216, Tooltip :225, Select :232, Tooltip :245, Select :303, Tooltip :322
- [ ] `src/tasks/TasksPage.tsx`: Select :48, Tooltip :65, Tooltip :78, Tooltip :84, Checkbox :85, Tabs :313, Select :337, Tooltip :352, Tooltip :368, Select :370, Tooltip :388, Tooltip :394, Tooltip :406, Tooltip :454, Tooltip :472, Tooltip :498, Tooltip :499, Tooltip :528

### terminal

- [ ] `src/terminal/BackgroundSessions.tsx`: Dialog :18, Tooltip :40
- [ ] `src/terminal/FindBar.tsx`: Tooltip :70, Tooltip :73, Tooltip :76, Tooltip :79, Tooltip :82
- [ ] `src/terminal/ForkDialog.tsx`: Dialog :23
- [ ] `src/terminal/LinkActionMenu.tsx`: ContextMenu :66, Menu :67, Tooltip :68
- [ ] `src/terminal/PaneMenu.tsx`: ContextMenu :165, Menu :166, Tooltip :174
- [ ] `src/terminal/PlanSheet.tsx`: Dialog :50, Tooltip :54
- [ ] `src/terminal/TerminalPane.tsx`: ContextMenu :1644, Tooltip :1655, Tooltip :1677, Tooltip :1695, Tooltip :1700, Tooltip :1705, Tooltip :1721, Tooltip :1747, Tooltip :1752, Tooltip :1757, Tooltip :1763, Tooltip :1768, Tooltip :1775, Tooltip :1791, Tooltip :1796, Tooltip :1803, Tooltip :1813, Tooltip :1932, Dialog :1952, Dialog :1981, Dialog :2028, Dialog :2055
- [ ] `src/terminal/UsageReadout.tsx`: Tooltip :18, Tooltip :20, Tooltip :37

### tower

- [ ] `src/tower/TowerView.tsx`: Tooltip :90, Tooltip :95, Tooltip :159, Tooltip :177

### update

- [ ] `src/update/UpdateCenterView.tsx`: Tooltip :275, Dialog :283, Tooltip :303, Tooltip :306, Tooltip :373

### usage

- [ ] `src/usage/ClaudePill.tsx`: Tooltip :53, Tooltip :65
- [ ] `src/usage/CodexPill.tsx`: Tooltip :26
- [ ] `src/usage/ShareButton.tsx`: Tooltip :8
- [ ] `src/usage/ShareCard.tsx`: Dialog :81
- [ ] `src/usage/TokenAnalytics.tsx`: Tooltip :129, Tooltip :177, Switch :222, Tooltip :256
- [ ] `src/usage/UsagePill.tsx`: Tooltip :17
- [ ] `src/usage/WorkspaceSpend.tsx`: Tooltip :60, Tooltip :72, Tooltip :97, Tooltip :102, Tooltip :164
<!-- SITES:END -->
