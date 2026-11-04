// Cycle 2 (the App.tsx split): everything the window makes in one render, as one object. The window fills it
// before it draws (App.tsx); the window's key handler (keys/useWindowKeys.ts) and its drawing
// (shell/WindowView.tsx) read it, as they read the window's own variables when they sat in App.tsx.
import type { WindowState } from "./windowStore";
import type { WindowLate } from "./windowLate";
import type { WindowSave } from "./useWindowSave";
import type { Plumbing } from "../settings/useSettingsPlumbing";
import type { WindowChrome } from "../chrome/useWindowChrome";
import type { Screens } from "../chrome/useScreens";
import type { LaunchActions } from "../launch/launchActions";
import type { PaneActions } from "../terminal/paneActions";
import type { ReviewActions } from "../editor/reviewActions";
import type { WorkspaceActions } from "../projects/useWorkspaces";
import type { CliBridge } from "../projects/useCliBridge";
import type { StatusSurfaces } from "../status/useStatusSurfaces";
import type { PaneGrid } from "../terminal/paneGrid";
import type { RailAndTower } from "../agents/useRailAndTower";
import type { LayoutReport } from "../terminal/useLayoutReport";
import type { usePrRows } from "../scm/usePrRows";
import type { useWizard } from "../onboarding/useWizard";
import type { useAgentEvents } from "../status/useAgentStatus";
import type { useWindowStart } from "./useWindowStart";
import type { useBrowserChords } from "../browser/useBrowserChords";
import type { Pane } from "../App";
import type { SendTarget } from "../editor/notes";

export type WindowBag = WindowState & WindowLate & WindowSave & Plumbing & WindowChrome & Screens & LaunchActions & PaneActions & ReviewActions &
  WorkspaceActions & CliBridge & StatusSurfaces & PaneGrid & RailAndTower & LayoutReport & ReturnType<typeof useWizard> &
  ReturnType<typeof useWindowStart> & ReturnType<typeof useBrowserChords> & Pick<ReturnType<typeof useAgentEvents>, "noticed"> & {
    prRows: ReturnType<typeof usePrRows>;
    /** EDIT-020: the agents the Send menu offers, while it is open. */
    reviewTargets: SendTarget[];
    /** SAFE-002: the pane whose plan the sheet shows. */
    reviewPane: Pane | null | undefined;
    /** EDIT-031: the file names with unsaved text in these workspaces, for the delete question. */
    wsUnsaved: (paths: string[]) => string[];
    /** EDIT-031: asks about those tabs; true when the removal may go on. */
    askWsUnsaved: (paths: string[]) => Promise<boolean>;
  };
