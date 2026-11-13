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
   `z-index: calc(var(--z-top) + 2)`, above every Kolux dialog (the raised guard is `--z-top + 1`), because a menu or
   a select's list is often opened from inside one; `.menu` inside it is `position: static`. Every popup is put in one
   empty out-of-flow box on the body (`.out-of-flow[data-ui-layer]`), for the reason menus use `OutOfFlow` (DT-C269).
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
10. **The box mounts after its owner.** A popup's children are drawn once Base UI is read and its portal is in, a step
   after the component that renders the popup has run its first effects. An effect that reads a ref inside the box on
   mount (`ref.current.focus()`, `getContext`, a measure) finds `null` and never runs again: the share card stayed
   blank this way. Focus goes through `initialFocus`; anything else hangs off a callback ref or state that holds the
   element, so the effect runs when the element arrives (`usage/ShareCard.tsx`, `board/WorkspaceBoard.tsx`).
11. **React events cross the portal.** A click or key in a popup bubbles up the React tree, not the DOM tree, so it
   reaches the `onClick` and `onKeyDown` of every component around the call site even though the box is drawn on the
   body. Put the popup beside, not inside, an element whose handler must not see it (the board's Move to list sits
   next to its card, so a picked lane does not also select the card).
12. **Why it closes.** `onClose` is called with `"escape"`, `"outside"` (a press outside the popup) or `"other"`. A popup that
   steps back one level on Escape reads it: the Resource Manager closes an open End question first on Escape, and the
   whole panel on a click outside. A press on the button a menu or popover hangs from (`anchor`) is that button's own,
   so its click toggles the popup shut instead of Base UI closing it and the click opening it again.
13. **Styles scoped by an element around the call site** (`.trust-prompt .ask`) no longer reach a popup, which is drawn in
   a portal on the body. Give the popup classes of its own (`Ask` takes `className` and `layer`; the wrappers take
   `className`, `viewport`, `backdrop`, `positioner`).

## Remaining call sites

Produced by the script, run from the repo root:

```
node docs/base-ui-sites.mjs            # the checklist below
node docs/base-ui-sites.mjs --counts   # the table only
```

It counts matching source lines. **To do** is the sum of the Dialog, Menu, Tabs and Select columns, the hand-rolled
popups, tab strips and native selects, and it reaches zero when the migration is done. A role inside a selector string
(`'[role="dialog"]'`, a query for any open dialog) or a comment is not counted, nor is an element that carries a dialog
role but is not a popup (the list under the checklist: the chat's permission and question cards, and questions asked in
place inside the surface that asked them). The other columns are for reference and stay above zero: **Opener** is the
right-click handler or `aria-haspopup` button that opens a popup, which stays when the popup moves; **Switch** and
**Checkbox** stay native inputs (see above); **Tooltip** counts every `title=` prop, Kolux components' own included, and
a plain hover hint can stay a `title`.

Folders other agents own right now: `src/terminal/**` and `src/settings/NativeTerminalCard.*`. Leave those for last.

<!-- SITES:START -->
| Folder | Dialog | Menu | Tabs | Select | Opener | Switch | Checkbox | Tooltip | To do |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| agents | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 0 |
| artifacts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 | 0 |
| automations | 1 | 1 | 1 | 13 | 1 | 1 | 1 | 14 | 16 |
| board | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 7 | 0 |
| chat | 0 | 1 | 0 | 2 | 0 | 1 | 0 | 13 | 3 |
| chrome | 0 | 0 | 0 | 0 | 3 | 1 | 1 | 22 | 0 |
| editmenu | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| editor | 2 | 6 | 0 | 4 | 8 | 0 | 4 | 128 | 12 |
| feedback | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 2 | 1 |
| floor | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 0 |
| inbox | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 0 |
| insights | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 0 |
| launch | 1 | 1 | 0 | 3 | 2 | 0 | 2 | 32 | 5 |
| look | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 3 | 0 |
| onboarding | 6 | 0 | 1 | 1 | 1 | 6 | 2 | 9 | 8 |
| ports | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 3 | 0 |
| projects | 6 | 1 | 1 | 17 | 7 | 0 | 19 | 75 | 25 |
| recovery | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 |
| scm | 3 | 5 | 0 | 6 | 4 | 0 | 5 | 98 | 14 |
| sessions | 0 | 0 | 0 | 4 | 0 | 0 | 2 | 16 | 4 |
| settings | 2 | 1 | 1 | 27 | 0 | 30 | 10 | 43 | 31 |
| setup | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 |
| shell | 2 | 1 | 2 | 0 | 2 | 0 | 1 | 24 | 5 |
| skills | 2 | 3 | 0 | 0 | 4 | 0 | 2 | 19 | 5 |
| space | 0 | 0 | 0 | 1 | 0 | 0 | 2 | 4 | 1 |
| status | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 9 | 0 |
| switcher | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 4 | 1 |
| tasks | 2 | 0 | 2 | 14 | 0 | 0 | 3 | 41 | 18 |
| terminal | 6 | 2 | 0 | 0 | 5 | 0 | 0 | 29 | 8 |
| tower | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 0 |
| update | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 1 |
| usage | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 13 | 0 |
| **Total** | **36** | **24** | **8** | **92** | **41** | **42** | **57** | **646** | **160** |

Left to migrate (the Dialog, Menu, Tabs and Select lines):

### automations

- [ ] `src/automations/AutomationDetail.tsx`: Tabs :97
- [ ] `src/automations/AutomationDialog.tsx`: Dialog :311, Select :358, Select :375, Select :385, Select :399, Select :412, Select :432, Select :443, Select :464, Select :502, Select :523
- [ ] `src/automations/AutomationsPage.tsx`: Select :346, Select :351, Menu :493
- [ ] `src/automations/RunsDashboard.tsx`: Select :99

### chat

- [ ] `src/chat/ChatText.tsx`: Menu :117
- [ ] `src/chat/ModelControls.tsx`: Select :37, Select :51

### editmenu

- [ ] `src/editmenu/EditMenuHost.tsx`: Menu :153

### editor

- [ ] `src/editor/AllChangesPane.tsx`: Select :387
- [ ] `src/editor/CodeLabel.tsx`: Select :50
- [ ] `src/editor/DiffPane.tsx`: Menu :517, Dialog :621
- [ ] `src/editor/Explorer.tsx`: Menu :868, Menu :880
- [ ] `src/editor/NotebookView.tsx`: Select :193
- [ ] `src/editor/PreviewPane.tsx`: Menu :238
- [ ] `src/editor/ReviewNotes.tsx`: Dialog :71, Menu :150
- [ ] `src/editor/RichToolbar.tsx`: Select :77
- [ ] `src/editor/TableControls.tsx`: Menu :113

### feedback

- [ ] `src/feedback/FeedbackDialog.tsx`: Dialog :170

### launch

- [ ] `src/launch/ChooserPane.tsx`: Dialog :55, Select :616
- [ ] `src/launch/KeepAwakeCard.tsx`: Select :37
- [ ] `src/launch/PlusMenu.tsx`: Menu :144
- [ ] `src/launch/TeamsModeCard.tsx`: Select :18

### onboarding

- [ ] `src/onboarding/Guides.tsx`: Dialog :177, Dialog :269, Tabs :279, Dialog :488, Dialog :562
- [ ] `src/onboarding/StepPanels.tsx`: Select :150
- [ ] `src/onboarding/Tours.tsx`: Dialog :130
- [ ] `src/onboarding/Wizard.tsx`: Dialog :117

### projects

- [ ] `src/projects/AddProject.tsx`: Dialog :120
- [ ] `src/projects/CleanupDialog.tsx`: Dialog :133, Select :150, Select :158, Select :164, Select :169, Select :174
- [ ] `src/projects/ImportSetup.tsx`: Dialog :17
- [ ] `src/projects/ProjectsPanel.tsx`: Select :1141, Select :1177, Select :1182, Select :1514, Select :1554, Select :2329, Select :2412, Tabs :2531, Select :2587, Select :2624, Select :2631, Menu :2735
- [ ] `src/projects/ScanRepos.tsx`: Dialog :107
- [ ] `src/projects/StartGit.tsx`: Dialog :30
- [ ] `src/projects/WorktreePalette.tsx`: Dialog :302, Select :328, Select :336

### recovery

- [ ] `src/recovery/CrashReportDialog.tsx`: Dialog :92

### scm

- [ ] `src/scm/CommentsPanel.tsx`: Menu :212
- [ ] `src/scm/FileOpenWith.tsx`: Select :47
- [ ] `src/scm/HandoffNote.tsx`: Select :94
- [ ] `src/scm/PrStart.tsx`: Dialog :279
- [ ] `src/scm/SourceControlPanel.tsx`: Select :699, Menu :886, Menu :911, Dialog :1041, Dialog :1106, Select :1115, Menu :1289, Menu :1317
- [ ] `src/scm/WriterPicker.tsx`: Select :63, Select :87

### sessions

- [ ] `src/sessions/AgentsPanel.tsx`: Select :231, Select :252, Select :262, Select :272

### settings

- [ ] `src/settings/AgentCredentials.tsx`: Select :89
- [ ] `src/settings/AgentsPage.tsx`: Select :152, Select :166, Select :174, Select :252
- [ ] `src/settings/AiRecipesSection.tsx`: Select :66
- [ ] `src/settings/AppearancePage.tsx`: Select :200, Select :313, Select :517
- [ ] `src/settings/ClaudeSetupPage.tsx`: Select :433
- [ ] `src/settings/ConnectGrid.tsx`: Menu :54
- [ ] `src/settings/GeneralPage.tsx`: Select :207
- [ ] `src/settings/GitPage.tsx`: Select :71, Select :134
- [ ] `src/settings/GrokCard.tsx`: Dialog :161
- [ ] `src/settings/NotificationsPage.tsx`: Select :110
- [ ] `src/settings/RepoPage.tsx`: Select :41
- [ ] `src/settings/RepoSetup.tsx`: Select :93, Select :141
- [ ] `src/settings/RoutingPage.tsx`: Tabs :51, Select :86, Select :97
- [ ] `src/settings/SafetyRules.tsx`: Select :157, Select :193
- [ ] `src/settings/SettingsPage.tsx`: Dialog :402
- [ ] `src/settings/SetupPolicyRow.tsx`: Select :15
- [ ] `src/settings/ShortcutsPage.tsx`: Select :109
- [ ] `src/settings/TerminalPage.tsx`: Select :76, Select :232
- [ ] `src/settings/autoPr.tsx`: Select :68, Select :83

### shell

- [ ] `src/shell/LinkAskDialog.tsx`: Dialog :23
- [ ] `src/shell/TabSearch.tsx`: Dialog :48
- [ ] `src/shell/window/Content.tsx`: Tabs :203
- [ ] `src/shell/window/Grid.tsx`: Tabs :101
- [ ] `src/shell/window/TabMenuView.tsx`: Menu :29

### skills

- [ ] `src/skills/SkillUpdate.tsx`: Dialog :141
- [ ] `src/skills/SkillsPage.tsx`: Menu :181, Menu :236, Dialog :279, Menu :394

### space

- [ ] `src/space/SpaceView.tsx`: Select :141

### switcher

- [ ] `src/switcher/AccountSwitcher.tsx`: Menu :133

### tasks

- [ ] `src/tasks/NewIssueDialog.tsx`: Dialog :137, Select :146
- [ ] `src/tasks/ProjectsView.tsx`: Select :44, Select :56, Select :412, Select :421, Select :431
- [ ] `src/tasks/PullRequestPage.tsx`: Tabs :305, Select :423, Select :435
- [ ] `src/tasks/RoadmapTimeline.tsx`: Select :44
- [ ] `src/tasks/TaskDialog.tsx`: Dialog :143, Select :232, Select :303
- [ ] `src/tasks/TasksPage.tsx`: Select :48, Tabs :313, Select :337, Select :370

### terminal

- [ ] `src/terminal/ForkDialog.tsx`: Dialog :23
- [ ] `src/terminal/LinkActionMenu.tsx`: Menu :67
- [ ] `src/terminal/PaneMenu.tsx`: Menu :166
- [ ] `src/terminal/PlanSheet.tsx`: Dialog :50
- [ ] `src/terminal/TerminalPane.tsx`: Dialog :1952, Dialog :1981, Dialog :2028, Dialog :2055

### update

- [ ] `src/update/UpdateCenterView.tsx`: Dialog :283

Not popups, so not counted (a dialog role on an element no src/ui wrapper fits):

- `src/chat/PermissionCard.tsx` (askTitle(card.tool)): a card in the chat
- `src/chat/QuestionCard.tsx` (Question from the agent): a card in the chat
- `src/projects/AddProject.tsx` (Stop copying?): asked in place, inside the Add project dialog
- `src/projects/CleanupDialog.tsx` (Confirm removal): asked in place, inside the clean-up dialog
- `src/scm/StackMap.tsx` (Confirm the stack merge): asked in place, under the stack map
- `src/status/manage.tsx` (`End ${name}`): asked in place, in the session's row
- `src/status/manage.tsx` (`End ${what}`): asked in place, in the Resource Manager
- `src/status/ResourceManager.tsx` (bulkQ.label): asked in place, in the Resource Manager
- `src/terminal/BackgroundSessions.tsx` (`End ${what}`): asked in place, in the Resource Manager
- `src/recovery/RecoveryMount.tsx` (Graphics): a notice strip in the window
<!-- SITES:END -->
