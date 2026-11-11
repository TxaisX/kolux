// The sidebar's dialogs and pop-ups, each read the first time it is drawn rather than when the window
// starts: none of them is on screen at the first frame, and together they were about 30 kB of start-up
// script. They sit in their own file so pages.tsx (the screens) stays small and the sidebar's list is in one place.
import type { ComponentProps, ComponentType } from "react";
import { deferred } from "./deferred";
import type { IconPicker as IconPickerView } from "../projects/IconPicker";

export const AddProject = deferred(() => import("../projects/AddProject"));
export const ScanRepos = deferred(() => import("../projects/ScanRepos"));
export const StartGit = deferred(() => import("../projects/StartGit"));
export const ImportSetup = deferred(() => import("../projects/ImportSetup"));
export const KeptBranches = deferred(() => import("../projects/KeptBranches"));
export const IconPicker = deferred<ComponentProps<typeof IconPickerView>>(() => import("../projects/IconPicker").then((m) => ({ default: m.IconPicker as ComponentType<ComponentProps<typeof IconPickerView>> })));
export const StatusEditor = deferred(() => import("../projects/StatusEditorForm"));
export const ResourceManager = deferred(() => import("../status/ResourceManager"));
export const WorkspaceSpend = deferred(() => import("../usage/WorkspaceSpend"));
