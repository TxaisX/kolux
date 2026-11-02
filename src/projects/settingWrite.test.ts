import { describe, expect, it } from "vitest";
import { CLEAR_FILTERS, FILTER_DEFAULT_SETTING, FILTER_PROJECTS_SETTING, filtersFrom, toggleProject } from "./filter";
import { applySetting, applySettings, pendingWrites, rebaseSettings, type Settings } from "./settingWrite";
import { FOLDER_TAB_KEY, rememberTab } from "../sessions/folderTabs";
import { ROUTING_KEY, resetProvider, withPick } from "../settings/routing";
import { settingsDiff } from "../settings/saveChanged";

// Stands in for App and the Projects panel: state moves only on render, the ref follows each render
// (as App.settingsRef does), and every save goes to a fake disk as a diff (as saveChanged does).
function fakeApp(initial: Settings) {
  let state = initial;
  let queued = initial;
  const cell = { current: initial };
  const panel = pendingWrites();
  const disk: Settings = { ...initial };
  return {
    render() {
      state = queued;
      cell.current = state;
      panel.reset();
    },
    get state() {
      return state;
    },
    disk,
    // App.saveSetting
    saveSetting(key: string, value: unknown) {
      const { was, next } = applySetting(cell, key, value);
      queued = next;
      Object.assign(disk, settingsDiff(was, next).set);
    },
    // ProjectsPanel.setFilter, and the tick on a project's box
    setFilter(key: string, value: unknown) {
      panel.put(key, value);
      this.saveSetting(key, value);
    },
    clear() {
      CLEAR_FILTERS.forEach(([k, v]) => this.setFilter(k, v));
    },
    tick(id: string) {
      this.setFilter(FILTER_PROJECTS_SETTING, toggleProject(filtersFrom(panel.latest(state)), ALL, id));
    },
  };
}

const ALL = ["p1", "p2", "p3", "p4"];

describe("settings writes before a render (after-list row 794)", () => {
  const start = { [FILTER_PROJECTS_SETTING]: ["p1"], [FILTER_DEFAULT_SETTING]: true, showSleeping: false, other: 1 };

  it("a tick right after Clear filters builds on the cleared filters", () => {
    const app = fakeApp(start);
    app.render();
    app.clear();
    app.tick("p3");
    app.render();
    expect(filtersFrom(app.state).projects).toEqual(["p1", "p2", "p4"]);
    expect(app.state[FILTER_DEFAULT_SETTING]).toBe(false);
    expect(app.state.showSleeping).toBe(true);
    expect(app.state.other).toBe(1);
  });

  it("the page state and the saved file agree after the burst", () => {
    const app = fakeApp(start);
    app.render();
    app.clear();
    app.tick("p2");
    app.render();
    expect(app.disk).toEqual(app.state);
  });

  it("every Clear filters write lands, not only the last", () => {
    const app = fakeApp(start);
    app.render();
    app.clear();
    app.render();
    expect(app.state).toEqual({ ...start, [FILTER_PROJECTS_SETTING]: [], [FILTER_DEFAULT_SETTING]: false, showSleeping: true });
  });

  it("two ticks in a row both count", () => {
    const app = fakeApp({});
    app.render();
    app.tick("p2");
    app.tick("p3");
    app.render();
    expect(filtersFrom(app.state).projects).toEqual(["p1", "p4"]);
  });

  it("the first and the last project behave the same as a middle one", () => {
    for (const [id, want] of [["p1", ["p2", "p3", "p4"]], ["p4", ["p1", "p2", "p3"]]] as const) {
      const app = fakeApp(start);
      app.render();
      app.clear();
      app.tick(id);
      app.render();
      expect(filtersFrom(app.state).projects).toEqual(want);
    }
  });

  it("a render forgets the pending writes", () => {
    const panel = pendingWrites();
    panel.put("a", 1);
    expect(panel.latest({ b: 2 })).toEqual({ a: 1, b: 2 });
    panel.reset();
    expect(panel.latest({ b: 2 })).toEqual({ b: 2 });
  });
});

// Row 794-b: the other App.saveChanged sites (nest toggle, Automations / Routing pages, right-sidebar tab)
// each built `next` from the last render. Same stand-in as above, driven through the shapes App now uses.
describe("the other settings writers build on the latest settings (after-list row 794-b)", () => {
  function app(initial: Settings) {
    let state = initial;
    let queued = initial;
    const cell = { current: initial };
    const disk: Settings = { ...initial };
    const save = ({ was, next }: { was: Settings; next: Settings }) => {
      queued = next;
      const { set, remove } = settingsDiff(was, next);
      Object.assign(disk, set);
      remove.forEach((k) => delete disk[k]);
    };
    return {
      disk,
      get rendered() {
        return state;
      },
      render() {
        state = queued;
        cell.current = state;
      },
      // App.onNest / onTab
      patch: (p: Settings) => save(applySettings(cell, p)),
      latest: () => cell.current,
      // App.onSettings of AutomationsPage / RoutingPage: the page builds the whole object from what it rendered
      page: (build: (rendered: Settings) => Settings) => save(rebaseSettings(cell, state, build(state))),
    };
  }

  it("a nest toggle right after a sidebar tab change keeps both, in page state and on disk", () => {
    const a = app({ rightSidebarTab: "explorer", workspaceNesting: true });
    a.render();
    a.patch({ rightSidebarTab: "insights" });
    a.patch({ workspaceNesting: false });
    a.render();
    expect(a.rendered).toEqual({ rightSidebarTab: "insights", workspaceNesting: false });
    expect(a.disk).toEqual(a.rendered);
  });

  it("two folder-workspace tab changes before a render both stay remembered", () => {
    const a = app({});
    a.render();
    for (const dir of ["C:\one", "C:\two"]) {
      a.patch({ rightSidebarTab: "prchecks", [FOLDER_TAB_KEY]: rememberTab(a.latest()[FOLDER_TAB_KEY], dir, "prchecks") });
    }
    a.render();
    expect(Object.values(a.rendered[FOLDER_TAB_KEY] as object)).toHaveLength(2);
    expect(a.disk).toEqual(a.rendered);
  });

  it("a page write keeps a setting written just before it", () => {
    const a = app({ workspaceNesting: true, confirmAutomationDelete: true });
    a.render();
    a.patch({ workspaceNesting: false });
    a.page((s) => ({ ...s, confirmAutomationDelete: false }));
    a.render();
    expect(a.rendered).toEqual({ workspaceNesting: false, confirmAutomationDelete: false });
    expect(a.disk).toEqual(a.rendered);
  });

  it("two Routing picks on different tiers before a render both land", () => {
    const a = app({});
    a.render();
    a.page((s) => withPick(s, "claude", "fast", { model: "m1", effort: "low" }));
    a.page((s) => withPick(s, "claude", "deep", { model: "m2", effort: "high" }));
    a.render();
    const routing = a.rendered[ROUTING_KEY] as Record<string, Record<string, unknown>>;
    expect(Object.keys(routing.claude).sort()).toEqual(["deep", "fast"]);
    expect(a.disk).toEqual(a.rendered);
  });

  it("a Routing reset of one provider keeps another provider's pick made before it", () => {
    const a = app({ [ROUTING_KEY]: { claude: { fast: { model: "m0", effort: "" } } } });
    a.render();
    a.page((s) => withPick(s, "codex", "fast", { model: "c1", effort: "" }));
    a.page((s) => resetProvider(s, "claude"));
    a.render();
    expect(a.rendered[ROUTING_KEY]).toEqual({ codex: { fast: { model: "c1", effort: "" } } });
    expect(a.disk).toEqual(a.rendered);
  });

  it("the same key written twice: the later write wins", () => {
    const a = app({});
    a.render();
    a.page((s) => withPick(s, "claude", "fast", { model: "m1", effort: "" }));
    a.page((s) => withPick(s, "claude", "fast", { model: "m2", effort: "" }));
    a.render();
    expect(a.rendered[ROUTING_KEY]).toEqual({ claude: { fast: { model: "m2", effort: "" } } });
  });

  it("a page write that changes nothing leaves the settings as they are", () => {
    const a = app({ a: 1 });
    a.render();
    a.patch({ a: 2 });
    a.page((s) => ({ ...s }));
    a.render();
    expect(a.rendered).toEqual({ a: 2 });
  });
});
