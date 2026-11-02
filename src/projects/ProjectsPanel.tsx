// The sidebar card (design/DESIGN.md section 5): Tasks and Artifacts rows, the Projects header
// with its icon row, Workspaces / Status tabs, then each project with its main checkout and
// workspaces, "Next that needs you", "New session" and the footer row. The working parts are
// T-003's: add a Git folder as a project (type or browse), set where workspace folders live,
// create a workspace (a new branch in its own folder), open a shell in one, remove one again.
// Every action goes to the Rust side; this file only draws the state it gets back.
// T-013: adding a project opens its main checkout (PROJ-007); Mod+N or the header's plus opens
// the name field for the project in front, a stand-in row shows while Git works, and the new
// workspace opens with a shell of its own unless the user moved on meanwhile (PROJ-020).
// T-014-a: the name field also takes a start ref, an agent and a first prompt (PROJ-028,
// PROJ-038); the footer gear sets the global workspaces folder and layout, a project's own gear
// its folder and base ref (PROJ-025).
// T-077: a child workspace sits indented under the one it was made from and folds with it; the
// gear's checkbox switches nesting off (PROJ-047). Folding hides child rows only; the agent summary
// a card can show (PROJ-062, T-266) must stay open when its parent folds, and is built there.
// ponytail: which rows are folded lasts until the window closes; nothing saves it.
// T-022: rows carry the strongest live agent state and an unread mark (PROJ-063), the list can be
// grouped by project, status or pull request and sorted Smart or by name (PROJ-045, PROJ-050).
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { projectDrop } from "../editor/desktopDrops";
import CacheTimer from "./CacheTimer";
import { dialogWhere, setupMode } from "../launch/launchOrder";
import { asksBeforeDelete, blocker, commitsNote, deleteTarget, isTextField, keepsAtFirst, pointerDelete, shownChanges, shownCommits, skipsQuestion, type RemoveCheck } from "./deleting";
import ShortcodeInput from "./ShortcodeInput";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { GROUP_SETTING, HIDE_AUTOMATION_SETTING, PIN_COPIES_SETTING, PIN_SETTING, SHOW_SLEEPING_SETTING, SLEEP_SETTING, asleepAfter, renameTo, showSleepingFrom, SORT_SETTING, jumpUnhides, withoutAutomationMade, groupFromSetting, groupRows, pathKey, pinnedSet, recentOrder, smartOrder, sortFromSetting, type AgentState, type PrState, type RowInfo } from "./rows";
import { linkedPrs, pushBadge, SCM_LINKED_PR_KEY, type Pushed } from "../scm/model";
import { mergePoll, nextDelay, pollItems, STALE_MS, type PrPoll } from "../scm/poll";
import { recordPoll } from "../scm/prSearch";
import { ScanGate, scanProjects, type Scanned } from "./worktreeScan";
import { afterScan, matchLetters, middle, nestRows, openedWorktree, parentChoices, pathHints, rankProjects, shortcodes, type ProjectMatch, orderWorktrees, relPath, placeFieldAction, previewSentence, worktreeLabel, projectLabel, splitGitSaid, type Created, type PlaceInfo, type Preview, type Project, type VisSource, type Worktree, createOpens, overtakenBy, prItems, waitsForSetup, workItem, keepOnSwitch, itemLabel, bound, stoppedNote, type Linked, type PendingCreate, type PrHead, type SetupLine, type SetupWhere } from "./model";
import { ArrowRight, Bell, ChevronDown, Close, EyeOff, FileCode, FolderPlus, Gear, List, Plus, Rail, Refresh, Rocket, Sliders, Target, Box, Pin, Moon } from "../chrome/icons";
import AddProject from "./AddProject";
import CleanupDialog from "./CleanupDialog";
import KeptBranches from "./KeptBranches";
import { addKept, type KeptBranch, type KeptItem } from "./cleanup";
import CardLine from "../look/CardLine";
import { HeaderBadge, HeaderColourPicker } from "../look/HeaderBadge";
import { CardDetailsChooser } from "../look/CardDetailsChooser";
import { HEADER_COLOURS_SETTING, colourSaveAfterDelete, headerColourOf, headersGoneWithGroup } from "../look/headerColour";
import { cardTitle, readCardDetails, type CardFacts } from "../look/cards";
import { useCardPorts } from "../look/cardPorts";
import { useCardChanges } from "../look/cardChanges";
import { takeSuggestion } from "./suggest";
import { IconPicker } from "./IconPicker";
import { ProjectIcon } from "./IconView";
import { SetupCard } from "./SetupCard";
import { cardView, saveArgs, type SetupSuggestion } from "./setupSuggestion";
import { cardProjectOf, newestOnly } from "./cardAsk";
import Picker, { type PickItem } from "./Picker";
import StartGit, { type FirstFile } from "./StartGit";
import ScanRepos from "./ScanRepos";
import { ADD_PROJECT } from "../onboarding/firstRun";
import PlusMenu, { type AgentInfo } from "../launch/PlusMenu";
import { openSettings as openSettingsPage } from "../settings/pages";
import { BehindNote, ListButtons, OutsideCard, PickedBar } from "../shell/ProjectsExtras";
import { dismissedOutside, jumpToCurrent, outsideOf, toggleRow, useAutoIcons, useTopButton, withDismissed, OUTSIDE_DISMISSED_SETTING } from "../shell/projectsGlue";
import { headerLabels } from "./headers";
import { renameTarget } from "../keys/commands";
import { behindHint, HINT_DISMISSED_SETTING, isBehindHint, REFRESH_SETTING, refreshesOnCreate } from "./baseHint";
import { outsideCard } from "./outsideCard";
import { isToggleClick } from "./selection";
import AutomationsRow from "./AutomationsRow";
import SkillsRow from "./SkillsRow";
import { chromeShown } from "../chrome/chromeItems";
import { VOCAB } from "../terminal/status";
import { workingWord } from "../status/working";
import { onFinish, REFRESH_AFTER_MS, wantsRefresh } from "../status/finished";
import type { AgentPass } from "../launch/agents";
import { KeyText } from "../keys/KeymapContext";
import { requestUpdateCheck } from "../update/UpdateCenter";
import { GLOSSARY } from "../glossary";
import HelpMenu from "../onboarding/HelpMenu";
import VendorMark, { type Agent } from "../chrome/VendorMark";
import ImportSetup, { refusedLine, type SetupImport } from "./ImportSetup";
import { issueCommand } from "../setup/IssueCommand";
import { trustedSetup } from "../setup/TrustPrompt";
import { NO_GROUPS, groupChoices, groupTree, keepNewer, type Group, type Groups, type Node } from "./groups";
import { dropBand, parentDropTarget } from "./parentDrop";
import { HEADER_ORDER_SETTING, MANUAL_ORDER_SETTING, dragStart, dropBefore, dropOutcome, edgeScroll, idsFrom, manualOrder, moveHeader, moveRows, siblingIds } from "./order";
import { pendingWrites } from "./settingWrite";
import { CLEAR_FILTERS, FILTER_DEFAULT_SETTING, FILTER_PROJECTS_SETTING, filtersFrom, filtersOn, rowShown, toggleProject } from "./filter";
import { deletePlan, rowMenu, type MenuItem } from "./menu";
import { commentBlocks, itemFromPaste, type Span } from "./details";
import { onWorkspaceStatus } from "./statusRefresh";
import StatusEditor from "./StatusEditorForm";
import { editorRows, savePayload, type StatusRow } from "./statusEditor";
import { useMissingFolders } from "./missingFolders";
import { folderMissingNote } from "./folderWorkspace";
import { FILE_MANAGER, loadTargets, openIn } from "../editor/openIn";

/** The pages that open over the content column from the sidebar footer. */
export type Page = "automations" | "routing" | "tasks";

type Props = {
  /** EDIT-041: bumped by Open in Code; the selected row is scrolled into sight once it is drawn. */
  reveal?: number;
  /** Folders a pane is open in: those workspace rows show a live dot. */
  openDirs: string[];
  /** VIEW-051: the window's agent and shell panes; a workspace lists its running ones as rows
   * (own agent mark, own title) and counts them. `onOpenSession` shows that pane. */
  sessions?: { key: number; agent: string; title: string; cwd: string | null; running: boolean }[];
  onOpenSession?: (key: number) => void;
  /** PROJ-063: each open folder's strongest agent state and when it last changed. */
  states: Record<string, RowInfo>;
  /** PROJ-063 / TERM-118: workspace paths marked unread, kept by the window; `onUnread` flips one. */
  unread: Set<string>;
  onUnread: (dir: string, unread: boolean) => void;
  /** PROJ-045 / PROJ-050: the remembered group-by and sort choices, saved through `onSetting`. */
  settings: Record<string, unknown>;
  onSetting: (key: string, value: unknown) => void;
  /** The workspace the grid shows (PROJ-066); its row is the selected one. */
  activeDir: string | null;
  /** A click on a row shows that workspace. */
  /** `fresh`: the workspace was just made (TERM-005 seeds its grid). */
  onSelect: (dir: string, branch: string | null, fresh?: boolean) => void;
  /** A new project was added and its main checkout opened (ONB-010 starts the default agent there once). */
  onAdded?: (dir: string, branch: string | null) => void;
  /** After a workspace and its folder are gone, so the window drops its panes. */
  onRemoved: (path: string) => void;
  /** T-614: the same for several at once (a batch, the cleanup dialog, the multi-select bar): one call
   *  with every path, so the shown workspace gives way to one that is not going too. */
  onRemovedAll?: (paths: string[]) => void;
  /** PROJ-053: these workspaces went to sleep; close their panes. */
  onSleep: (paths: string[]) => void;
  /** The plus menu behind "New session" (T-004): agents found on the PATH, and the launch. */
  agents: AgentInfo[];
  launching: boolean;
  onLaunch: (agent: AgentInfo, projectId: string | null) => void;
  defaultId: string;
  onSetDefault: (id: string) => void;
  onChoose: () => void;
  /** SESS-009: the dropdown's blank-terminal row (a plain shell tab). */
  onTerminal?: () => void;
  /** SESS-003 / SESS-002: every installed agent is off; where the agent search stands. */
  allOff?: boolean;
  pass?: AgentPass;
  onRefresh?: () => void;
  /** DT-17 / AUTO-023: the Automations page is opened from the sidebar's Automations row. */
  /** Which page (Automations, Model routing) is open over the content column, if any. */
  page: Page | null;
  onPage: (page: Page) => void;
  /** Bump to reload the list after something outside the sidebar made a workspace. */
  refresh: number;
  /** Hands the window the project list and which project owns each workspace folder. */
  onIndex: (projects: Project[], owner: Record<string, string>, names: Record<string, string>) => void;
  /** Bumped by Mod+N (workspace.create): opens the name field for the project in front. */
  createRequest: number;
  /** PROJ-057: a name typed in the palette, put in the name field that createRequest opens. */
  createName?: string;
  /** Bumped by Mod+Shift+Backspace (workspace.delete): asks to delete the workspace shown (PROJ-070). */
  deleteRequest: number;
  /** T-611: bumped by workspace.rename (PROJ-059): starts the inline rename of the workspace shown. */
  renameRequest?: number;
  /** T-611: the rename request was served (renamed, or nothing to rename); the window clears it. */
  onRenameTaken?: () => void;
  /** PROJ-038: starts an agent with a first prompt in a workspace just made; `show` brings it in front. */
  onStartIn: (agent: AgentInfo, dir: string, branch: string | null, prompt: string, show: boolean) => Promise<number | null> | void;
  /** PROJ-047: child workspaces nest under their parent unless this is off. */
  nest: boolean;
  onNest: (on: boolean) => void;
  /** SKILL-036: the Artifacts row opens the library and shows as current while it is up. */
  artifactsOn: boolean;
  onArtifacts: () => void;
  /** SKILL-018: the Skills button opens the Skills page and shows as current while it is up. */
  skillsOn?: boolean;
  onSkills?: () => void;
  /** PROJ-020: the creates Git is still working on, for the stand-in tabs beside the panes. */
  onPending?: (pending: PendingCreate[]) => void;
  /** PROJ-033: open a Setup terminal in a new workspace; `then` runs once it has ended. */
  onSetup?: (dir: string, branch: string | null, line: SetupLine, where: SetupWhere, show: boolean, then?: () => Promise<number | null> | void) => void;
};

// SESS-035: the projects the composer last made workspaces in, newest first (this computer only).
/** T-543-b: controls not built yet stay in the code but are not shown. */
const NOT_BUILT = false;
const RECENT_KEY = "kolux.composer.recentProjects";
const ADD_ITEM = "+add";
// PROJ-031: Kolux's sentence first; Git's own output stays one click away.
function MessageNote({ kind, text }: { kind: string; text: string }) {
  const { summary, git } = splitGitSaid(text);
  return (
    <div className={`note ${kind}`}>
      {summary}
      {git && (
        <details>
          <summary>Git's full output</summary>
          <pre>{git}</pre>
        </details>
      )}
    </div>
  );
}

const readRecent = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};
const noteRecent = (id: string) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, 5)));
  } catch {
    // a remembered order is a convenience; without storage the list keeps its own order
  }
};

export default function ProjectsPanel({ reveal = 0, openDirs, sessions = [], onOpenSession = () => {}, states, unread, onUnread, settings, onSetting, activeDir, onSelect, onAdded = () => {}, onRemoved, onRemovedAll = (paths) => paths.forEach(onRemoved), onSleep, agents, launching, onLaunch, defaultId, onSetDefault, onChoose, onTerminal, allOff, pass, onRefresh, page, onPage, refresh, onIndex, createRequest, createName = "", deleteRequest, renameRequest = 0, onRenameTaken = () => {}, onStartIn, nest, onNest, artifactsOn, onArtifacts, onPending, onSetup, skillsOn = false, onSkills = () => {} }: Props) {
  const [moving, setMoving] = useState<string | null>(null); // the workspace whose parent picker is open (PROJ-048)
  // PROJ-065: the right-click menu, PROJ-060: the details form, T-055: a parent deleted together with its children.
  const [menu, setMenu] = useState<{ x: number; y: number; projectId: string; path: string; items: MenuItem[] } | null>(null);
  const [detailsOf, setDetailsOf] = useState<{ path: string; name: string; item: string; comment: string; error?: string } | null>(null);
  const [batch, setBatch] = useState<{ root: string; order: string[]; error?: string } | null>(null);
  const [statusesOf, setStatusesOf] = useState<{ path: string; rows: StatusRow[]; error?: string } | null>(null); // PROJ-084
  // EDIT-041: coming from the Inbox the workspace rows can take seconds to list, so each render
  // looks for the selected row until it is there, then scrolls to it once.
  const revealed = useRef(0);
  useEffect(() => {
    if (!reveal || revealed.current === reveal) return;
    const row = document.querySelector(".sidebar :is(button.branch, .sess[role=button]).sel");
    if (!row) return;
    revealed.current = reveal;
    row.scrollIntoView({ block: "nearest" });
  });
  const [shutKids, setShutKids] = useState<ReadonlySet<string>>(new Set()); // parent workspaces folded shut (PROJ-047)
  const [projects, setProjects] = useState<Project[]>([]);
  const [plusOpen, setPlusOpen] = useState(false);
  const index = useRef(onIndex);
  index.current = onIndex;
  const live = useRef({ settings, onSetting }); // the settings as of the latest render, for steps that finish after an await
  live.current = { settings, onSetting };
  // Row 794: a filter choice made before the page re-renders (Clear filters, then a tick) builds on the one before it.
  const pend = useRef(pendingWrites());
  pend.current.reset();
  const setFilter = (key: string, value: unknown) => (pend.current.put(key, value), onSetting(key, value));
  const [listed, setWorktrees] = useState<Record<string, Worktree[]>>({}); // the ones not hidden by hand
  // AUTO-024: the switch that leaves out worktrees made by automation runs; moving to one turns it off.
  const hideAuto = settings[HIDE_AUTOMATION_SETTING] === true;
  const worktrees = useMemo(() => withoutAutomationMade(listed, hideAuto), [listed, hideAuto]); // the ones the sidebar shows
  const wasActive = useRef(activeDir);
  useEffect(() => {
    if (jumpUnhides(wasActive.current, activeDir, listed, hideAuto, same)) onSetting(HIDE_AUTOMATION_SETTING, false);
    wasActive.current = activeDir;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDir, listed]);
  const [hiddenWts, setHiddenWts] = useState<Record<string, Worktree[]>>({}); // PROJ-042: hidden by the user
  const [fresh, setFresh] = useState<Record<string, Worktree[]>>({}); // PROJ-041: made outside Kolux, not yet reviewed
  const [pushedBy, setPushedBy] = useState<Record<string, Pushed>>({}); // GIT-065: by worktree path
  const [prBy, setPrBy] = useState<Record<string, PrState>>({}); // GIT-027: the background poll, by worktree path
  const polled = useRef({ failures: 0, at: 0, next: 0, limited: 0 });
  const pushTag = (w: Worktree) => {
    const b = pushBadge(pushedBy[w.path]);
    return b && <span className={`hint push ${b.tone}`}>{b.text}</span>;
  };
  const [review, setReview] = useState<string | null>(null); // project id whose new-worktree review is open
  const [hiddenPage, setHiddenPage] = useState(0);
  const [visGlobal, setVisGlobal] = useState<VisSource[]>([]); // SET-032: the global choice per source
  const [visOwn, setVisOwn] = useState<VisSource[]>([]); // PROJ-042: the open project's own, over the global
  const [rootPath, setRootPath] = useState("");
  const [rootError, setRootError] = useState("");
  const [place, setPlace] = useState<PlaceInfo>({ dir: "", flat: false, used: [], fromEnv: false });
  const [rootDraft, setRootDraft] = useState("");
  const [flatDraft, setFlatDraft] = useState(false);
  const [settingsFor, setSettingsFor] = useState<string | null>(null); // project id whose folder / base form is open
  const [dirDraft, setDirDraft] = useState("");
  const [projectBaseDraft, setProjectBaseDraft] = useState("");
  const [baseDraft, setBaseDraft] = useState(""); // PROJ-028: the start ref for the workspace being made
  const [agentDraft, setAgentDraft] = useState(""); // PROJ-038: agent id, "" for a shell
  const [promptDraft, setPromptDraft] = useState("");
  const [pathDraft, setPathDraft] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  // PROJ-002: the Add Project dialog, from the folder button or the composer's Add project item.
  const [adding, setAdding] = useState(false);
  // ONB-004: the first-run wizard's 'Pick a folder' opens Add Project here.
  useEffect(() => {
    const open = () => setAdding(true);
    window.addEventListener(ADD_PROJECT, open);
    return () => window.removeEventListener(ADD_PROJECT, open);
  }, []);
  const [creating, setCreating] = useState<string | null>(null); // project id whose name field is open; "" with no project yet
  const [pending, setPendingList] = useState<PendingCreate[]>([]); // the stand-in rows while Git works
  const pendingNow = useRef<PendingCreate[]>([]);
  const setPending = (next: PendingCreate[]) => {
    pendingNow.current = next;
    setPendingList(next);
    onPending?.(next);
  };
  const tickets = useRef(Date.now()); // PROJ-020: one ticket per create, never reused in a session
  const overtaken = useRef(new Set<number>());
  const [stopping, setStopping] = useState<number[]>([]); // SESS-038: creates the user cancelled mid-submit
  const stopped = useRef(new Set<number>());
  const stopCreate = (ticket: number) => {
    stopped.current.add(ticket);
    setStopping((s) => [...s, ticket]);
    invoke("workspace_create_cancel", { ticket }).catch(() => {});
  };
  const shown = useRef(activeDir); // the workspace in front, read when a create finishes
  shown.current = activeDir;
  const [name, setName] = useState("");
  const [existing, setExisting] = useState(false); // PROJ-030: open a branch that already exists instead of making one
  const [branchList, setBranchList] = useState<string[]>([]);
  const [prList, setPrList] = useState<PrHead[] | null>(null); // PROJ-030: the open pull requests, null when not opening one
  const [prDraft, setPrDraft] = useState<PrHead | null>(null);
  const [branchDraft, setBranchDraft] = useState(""); // SESS-037: Advanced branch name (the branch to reuse with existing)
  const [parentDraft, setParentDraft] = useState<string | null>(null); // SESS-037: the parent worktree, none by default
  const [advanced, setAdvanced] = useState(false);
  const [more, setMore] = useState(false); // SESS-038: Create more
  const [linked, setLinked] = useState<Linked | null>(null); // SESS-036: the GitHub item the workspace is named from
  const [found, setFound] = useState<Linked[]>([]); // SESS-036: issues and pull requests matching the name
  const [findNote, setFindNote] = useState("");
  const [setupSkip, setSetupSkip] = useState(false); // PROJ-033: the setup policy; the project's script runs unless skipped
  const [setupWhere, setSetupWhere] = useState<SetupWhere>("tab");
  const [setupWait, setSetupWait] = useState(false);
  const waitTouched = useRef(false); // the user clicked the wait box since the project last changed
  const whereTouched = useRef(false); // likewise the "setup opens in" choice
  const nameRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewAnswered, setPreviewAnswered] = useState(false); // Git has answered for the name now shown
  const [confirm, setConfirm] = useState<{ projectId: string; path: string; branch: string; check: RemoveCheck; force: boolean; keep?: boolean; refusal?: string } | null>(null);
  const [forgetAsk, setForgetAsk] = useState<{ projectId: string; path: string; label: string; refused?: string } | null>(null); // row 364: the question before a folder workspace is taken out of Kolux; `refused` is why it cannot be (364b)
  const [busy, setBusy] = useState("");
  const [startGit, setStartGit] = useState<{ folder: string; files: FirstFile[] } | null>(null);
  const [importing, setImporting] = useState<{ project: string; path: string; list: SetupImport[] } | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "warn" | "error"; text: string } | null>(null);
  const [gitVersion, setGitVersion] = useState("");
  const indexed = useRef(""); // the last project list and owner map handed to the window
  const [filterOpen, setFilterOpen] = useState(false);
  const [folded, setFolded] = useState<Set<string>>(new Set()); // group titles folded away
  const [groups, setGroups] = useState<Groups>(NO_GROUPS); // PROJ-014: project groups
  const [activity, setActivity] = useState<Record<string, number>>({}); // PROJ-051: path key -> last activity
  const [cleanupFor, setCleanupFor] = useState<string | null>(null); // PROJ-080: project id whose cleanup dialog is open
  const [kept, setKept] = useState<KeptItem[]>([]); // PROJ-073: branches that stayed when their workspaces went
  const [renaming, setRenaming] = useState<string | null>(null); // PROJ-059: the row being renamed
  const [renameText, setRenameText] = useState("");
  const [groupFor, setGroupFor] = useState<string | null>(null); // the group whose settings form is open
  const [groupName, setGroupName] = useState("");
  const [groupParent, setGroupParent] = useState("");
  const [scanRoot, setScanRoot] = useState<string | null>(null); // PROJ-012: the folder being scanned for repositories
  const [dropProject, setDropProject] = useState<string | null>(null); // PROJ-008: the id being asked about
  const [dropGroup, setDropGroup] = useState<{ remove: boolean } | null>(null); // PROJ-015: the delete question
  const seen = useRef<Record<string, AgentState>>({});
  const groupBy = groupFromSetting(settings[GROUP_SETTING]);
  const cardPorts = useCardPorts(); // PROJ-062 (T-266-b): the hover lists the ports, scanned when the pointer enters a card
  const cardDetails = readCardDetails(settings); // PROJ-062, SET-021: Compact, Default, Detailed or a chosen set

  const sortBy = sortFromSetting(settings[SORT_SETTING]);
  // PROJ-050: an old "Recent" choice is moved to Smart once and saved that way.
  useEffect(() => {
    if (settings[SORT_SETTING] === "recent") onSetting(SORT_SETTING, "smart");
  }, [settings, onSetting]);
  // PROJ-063: a state change in a workspace that is not in front marks its row unread.
  useEffect(() => {
    const was = seen.current;
    const now: Record<string, AgentState> = {};
    const fresh: string[] = [];
    for (const [dir, i] of Object.entries(states)) {
      now[dir] = i.state;
      if (dir in was && was[dir] !== i.state && !(activeDir !== null && same(dir, activeDir))) fresh.push(dir);
      if (dir in was && was[dir] !== i.state) stamp(dir); // PROJ-051: an agent's state change is activity
    }
    seen.current = now;
    for (const dir of fresh) onUnread(dir, true);
  }, [states, activeDir, onUnread]);

  // PROJ-051: stamps a workspace as just used, here at once and in the store for the next start.
  function stamp(path: string) {
    setActivity((a) => ({ ...a, [pathKey(path)]: Date.now() }));
    invoke("activity_touch", { path }).catch(() => {});
  }
  const say = (kind: "ok" | "warn" | "error", text: string) => setMessage({ kind, text });
  const [icons, setIcons] = useState<Record<string, string>>({}); // PROJ-019: icons chosen by hand, by project id
  const autoIcons = useAutoIcons(projects.map((p) => p.id)); // PROJ-018: the icon found in each repository
  const top = useTopButton(); // PROJ-054
  const [picked, setPicked] = useState<string[]>([]); // PROJ-058: Ctrl/Cmd-clicked rows, by folder
  const [behind, setBehind] = useState<string | null>(null); // PROJ-029: the "base is behind" suggestion of the last create
  const setIcon = async (p: Project, icon: string) => {
    try {
      const kept = await invoke<string | null>("project_icon_set", { projectId: p.id, icon });
      setIcons((o) => {
        const { [p.id]: _gone, ...rest } = o;
        return kept ? { ...rest, [p.id]: kept } : rest;
      });
    } catch (err) {
      say("error", String(err));
    }
  };
  const fail = (err: unknown) => say("error", String(err));

  const scanned = useRef<Record<string, Worktree[]>>({}); // ACCT-056: the last list each scan gave
  const unseenKnown = useRef<Record<string, Worktree[]>>({});
  const scanGate = useRef(new ScanGate()); // T-442-c: a scan never overlaps itself
  const pushedBusy = useRef(false);
  const showScanned = (next: Record<string, Worktree[]>, unseen: Record<string, Worktree[]>) => {
    setWorktrees(Object.fromEntries(Object.entries(next).map(([id, ws]) => [id, ws.filter((w) => !w.hidden)])));
    setHiddenWts(Object.fromEntries(Object.entries(next).map(([id, ws]) => [id, ws.filter((w) => w.hidden)])));
    setFresh(unseen);
  };
  // `tick`: the 5 s poll, skipped while a scan runs; any other caller waits its turn and runs once.
  const refreshWorktrees = useCallback((list: Project[], opts?: { tick?: boolean }) => scanGate.current.run(() => sweepWorktrees(list), { skipIfBusy: opts?.tick }), []);
  const sweepWorktrees = async (list: Project[]) => {
    const ids = new Set(list.map((p) => p.id));
    const keep = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([id]) => ids.has(id)));
    const next = keep(scanned.current);
    const unseen = keep(unseenKnown.current);
    let shownAt = 0;
    // Each project's answer shows as it arrives (at most ~8 repaints a second), not after the whole sweep.
    await scanProjects(
      list,
      (p) => invoke<Scanned>("workspace_scan", { projectId: p.id }),
      (p, answer) => {
        if ("ok" in answer) {
          next[p.id] = answer.ok.list;
          unseen[p.id] = answer.ok.unseen;
        } else {
          // ACCT-056: a failed scan removes nothing; the worktrees already known stay listed.
          next[p.id] = afterScan(next[p.id], null);
          say("warn", `Could not list the workspaces of ${p.name}, so the last known list stays: ${answer.error}`);
        }
        scanned.current = next;
        unseenKnown.current = unseen;
        if (Date.now() - shownAt >= 120) {
          shownAt = Date.now();
          showScanned({ ...next }, { ...unseen });
        }
      },
    );
    showScanned({ ...next }, { ...unseen });
    // GIT-065: the same poll keeps each row's unpushed badge current; a failed read keeps the last.
    const shown = Object.values(next).flat().filter((w) => !w.hidden).map((w) => w.path);
    // One read at a time: a slow round must not pile up behind the next poll.
    if (!pushedBusy.current) {
      pushedBusy.current = true;
      invoke<Pushed[]>("scm_pushed", { worktrees: shown })
        .then((list) => setPushedBy(Object.fromEntries(list.map((p) => [p.path, p]))))
        .catch(() => {})
        .finally(() => (pushedBusy.current = false));
    }
    const owner: Record<string, string> = {};
    const names: Record<string, string> = {};
    for (const p of list)
      for (const w of next[p.id] ?? []) {
        owner[w.path] = p.id;
        if (w.name) names[w.path] = w.name;
      }
    const key = JSON.stringify([list, owner, names]);
    if (key !== indexed.current) index.current(list, owner, names);
    indexed.current = key;
  };
  // GIT-027 / GIT-028: every shown workspace's pull request, polled in the background: the visible
  // workspace first, one gh call per GitHub project, a round every few minutes while the window is
  // shown (backing off after failures, waiting out a rate limit), and again on focus when stale.
  const pollPaths = Object.values(worktrees).flat().map((w) => w.path);
  const goneFolders = useMissingFolders(pollPaths); // PROJ-086
  // T-609: the changed-file count on the cards, read from git while the cards show it (look/cardChanges.ts).
  const cardChanges = useCardChanges(pollPaths, cardDetails.shown.includes("changes"));
  const norm = (d: string) => d.replace(/[\\/]+$/, "").toLowerCase();
  const pollActive = activeDir === null ? null : (pollPaths.find((p) => norm(p) === norm(activeDir)) ?? null);
  const pollLinks = linkedPrs(settings[SCM_LINKED_PR_KEY]);
  const pollKey = JSON.stringify([pollPaths, pollActive, pollLinks]);
  useEffect(() => {
    if (pollPaths.length === 0) return;
    const st = polled.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dead = false;
    const later = (ms: number) => {
      clearTimeout(timer);
      st.next = Date.now() + ms;
      timer = setTimeout(round, ms);
    };
    const round = () => {
      if (document.hidden) return later(60_000);
      invoke<PrPoll>("scm_prs_poll", { items: pollItems(pollPaths, pollActive, pollLinks) })
        .then((answer) => {
          if (dead) return;
          setPrBy((prev) => mergePoll(prev, answer));
          recordPoll(answer); // VIEW-043: the palette lists these pull requests
          st.failures = answer.prs.some((x) => x.error !== null) ? st.failures + 1 : 0;
          st.at = Date.now();
          st.limited = answer.limitedUntil ?? 0;
          later(nextDelay(st.failures, answer.limitedUntil, Date.now()));
        })
        .catch(() => {
          if (dead) return;
          st.failures += 1;
          later(nextDelay(st.failures, null, Date.now()));
        });
    };
    later(Math.max(1500, st.next - Date.now()));
    const focus = () => {
      if (Date.now() - st.at > STALE_MS && st.limited * 1000 < Date.now()) later(0);
    };
    window.addEventListener("focus", focus);
    // STAT-038: an agent finishing in a listed workspace brings the next round forward, once per finish.
    const off = onFinish((cwd) => wantsRefresh({ hidden: document.hidden, paths: pollPaths, cwd, limitedUntil: st.limited, now: Date.now() }) && later(REFRESH_AFTER_MS));
    return () => {
      dead = true;
      clearTimeout(timer);
      off();
      window.removeEventListener("focus", focus);
    };
  }, [pollKey]);
  // PROJ-063: a branch switched inside a workspace folder shows on its row within a few seconds.
  // PROJ-041: the same poll notices worktrees made outside Kolux, in both layouts (DT-O2).
  useEffect(() => {
    const t = window.setInterval(() => document.visibilityState === "visible" && refreshWorktrees(projects, { tick: true }).catch(fail), 5000);
    return () => window.clearInterval(t);
  }, [projects, refreshWorktrees]);
  // A Board status or nest change shows here at once, not on the next poll.
  useEffect(() => onWorkspaceStatus(window, () => void refreshWorktrees(projects).catch(fail)), [projects, refreshWorktrees]);

  const reload = useCallback(async () => {
    const list = await invoke<Project[]>("project_list");
    setProjects(list);
    const g = await invoke<Groups>("groups_get");
    setGroups((o) => keepNewer(o, g));
    setIcons(await invoke<Record<string, string>>("project_icons_list").catch(() => ({}))); // PROJ-019
    const a = await invoke<Record<string, number>>("activity_get");
    setActivity((o) => ({ ...a, ...Object.fromEntries(Object.entries(o).filter(([k, t]) => t > (a[k] ?? 0))) }));
    await refreshWorktrees(list);
  }, [refreshWorktrees]);

  const loadPlace = useCallback(async () => {
    const p = await invoke<PlaceInfo>("workspaces_place_get");
    setPlace(p);
    setRootDraft(p.dir);
    setFlatDraft(p.flat);
  }, []);
  useEffect(() => {
    invoke<string>("git_version").then(setGitVersion).catch(fail);
    loadPlace().catch(fail);
  }, [loadPlace]);
  useEffect(() => {
    reload().catch(fail);
  }, [reload, refresh]);

  useEffect(() => {
    if (name.trim() === "") {
      setPreview(null);
      setPreviewAnswered(false);
      return;
    }
    let live = true;
    setPreviewAnswered(false);
    invoke<Preview | null>("workspace_preview", { name, projectId: creating || null, branch: existing ? null : branchDraft.trim() || null })
      .then((s) => live && (setPreview(s), setPreviewAnswered(true)))
      .catch(fail);
    return () => {
      live = false;
    };
  }, [name, creating, branchDraft, existing]);
  useEffect(() => {
    setPrList(null); // PROJ-030: another project's pull requests are not this one's
    setPrDraft(null);
    setLinked((l) => (creating === null ? null : keepOnSwitch(l))); // SESS-038
  }, [creating]);
  const waitPath = projects.find((x) => x.id === creating)?.path;
  useEffect(() => {
    // SET-033: the repository's own choice of whether the agent waits for setup starts the checkbox
    waitTouched.current = false;
    whereTouched.current = false;
    setSetupWhere("tab");
    setSetupWait(false); // another repository's choice is not this one's while the read is out
    if (!waitPath) return;
    let live = true;
    // a late reply never undoes a click: the box the user touched stays as they set it
    invoke<{ wait: boolean; mode?: unknown }>("repo_setup_get", { path: waitPath })
      .then((s) => {
        if (!live) return;
        if (!waitTouched.current) setSetupWait(s.wait);
        if (!whereTouched.current) setSetupWhere(dialogWhere(setupMode(s.mode))); // T-150: the repository's own launch mode
      })
      .catch(() => {});
    return () => void (live = false);
  }, [waitPath]);
  useEffect(() => {
    // SESS-036: the chosen project's own issues and pull requests matching the name, and a pasted
    // link resolved to its item (its title seeds the name). Lookups that fail for want of gh stay quiet.
    setFound([]);
    setFindNote("");
    const item = workItem(name);
    const q = name.trim();
    if (!creating || linked || existing || prList !== null || (!item && q.length < 2)) return;
    let live = true;
    const t = setTimeout(() => {
      const ask = item
        ? invoke<Linked>("workspace_item", { projectId: creating, item }).then((l) => live && (setLinked(bound(l)), setName(l.title)))
        : invoke<Linked[]>("workspace_items", { projectId: creating, query: q }).then((l) => live && setFound(l.map(bound)));
      ask.catch((err) => live && (item || String(err).startsWith("That lookup")) && setFindNote(String(err)));
    }, item ? 0 : 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [name, creating, linked, existing, prList]);

  // PROJ-023: the name field opens with a creature name nobody uses; one the user has changed stays.
  const shownSuggestion = useRef<string | null>(null);
  useEffect(() => {
    if (!creating) {
      shownSuggestion.current = null;
      return;
    }
    let live = true;
    invoke<string>("workspace_suggest_name", { projectId: creating })
      .then((s) => {
        if (!live) return;
        setName((cur) => takeSuggestion(cur, shownSuggestion.current, s));
        shownSuggestion.current = s;
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [creating]);

  useEffect(() => {
    // SESS-036: the name field suggests the project's branches too.
    if (!creating) return;
    let live = true;
    invoke<string[]>("workspace_branches", { projectId: creating }).then((b) => live && setBranchList(b)).catch(fail);
    return () => {
      live = false;
    };
  }, [creating]);

  // PROJ-007: the new project's main checkout becomes the workspace in front, its worktrees listed.
  // PROJ-003: a project just cloned goes straight to its checkout, with no setup question first.
  const added = async (p: Project, offerSetup = true) => {
    say("ok", `${p.name} is a project (${p.path})`);
    setPathDraft("");
    setShowAdd(false);
    await reload();
    const open = openedWorktree(await invoke<Worktree[]>("workspace_list", { projectId: p.id }), p.path);
    if (open) {
      onSelect(open.path, open.branch);
      onAdded(open.path, open.branch);
    }
    if (!offerSetup) return;
    // VIEW-112: another tool's setup file in the new project is offered for import.
    const list = await invoke<SetupImport[]>("setup_imports_list", { path: p.path }).catch(() => [] as SetupImport[]);
    if (list.some((i) => !i.refused)) setImporting({ project: p.name, path: p.path, list });
    else if (refusedLine(list)) say("warn", `No setup commands imported. ${refusedLine(list)}`);
  };
  const importSetup = async (file: string) => {
    if (!importing) return;
    setBusy("importing");
    try {
      await invoke("setup_import", { path: importing.path, file });
      say("ok", `The setup commands from ${file} are in kolux.yaml; commit it so new workspaces run them.`);
      setImporting(null);
    } catch (err) {
      fail(err);
    } finally {
      setBusy("");
    }
  };
  const addPath = async (path: string) => {
    if (!path.trim()) return;
    setBusy("adding");
    try {
      await added(await invoke<Project>("project_add", { path }));
    } catch (err) {
      // GIT-061: a plain folder is offered Git and a first commit; a relative or missing path is refused.
      if (!String(err).includes("not inside a Git repository")) fail(err);
      else
        await invoke<FirstFile[]>("git_first_commit_preview", { path })
          .then((files) => setStartGit({ folder: path.trim(), files }))
          .catch(fail);
    } finally {
      setBusy("");
    }
  };
  // PROJ-005: the plain folder can also be opened as a folder project, with no Git.
  const openAsFolder = async () => {
    if (!startGit) return;
    setBusy("adding");
    try {
      await added(await invoke<Project>("project_add_folder", { path: startGit.folder }), false);
      setStartGit(null);
    } catch (err) {
      fail(err);
    } finally {
      setBusy("");
    }
  };
  // PROJ-008: the question, then the removal; its folders and files stay on disk.
  const removeProject = async (p: Project) => {
    try {
      const gone = await invoke<{ name: string; path: string; ended: number }>("project_remove", { projectId: p.id });
      onRemoved(gone.path);
      setDropProject(null);
      setSettingsFor(null);
      say("ok", `${gone.name} is out of Kolux${gone.ended ? `; ${gone.ended} terminal${gone.ended === 1 ? "" : "s"} closed` : ""}. Its folder is still on disk`);
      await reload();
    } catch (err) {
      fail(err);
    }
  };
  const startGitAndAdd = async (files: string[]) => {
    if (!startGit) return;
    setBusy("adding");
    try {
      await added(await invoke<Project>("git_start", { path: startGit.folder, files }));
      setStartGit(null);
    } catch (err) {
      fail(err);
    } finally {
      setBusy("");
    }
  };

  // EDIT-039: folders dropped from the desktop onto the project list are added one after another.
  useEffect(() => {
    projectDrop.add = (paths) => void paths.reduce((chain, dir) => chain.then(() => addPath(dir)), Promise.resolve());
    return () => {
      projectDrop.add = null;
    };
  });

  const browse = async () => {
    try {
      const picked = await open({ directory: true, multiple: true, title: "Choose project folders" });
      const list = Array.isArray(picked) ? picked : picked ? [picked] : [];
      for (const dir of list) await addPath(dir);
    } catch (err) {
      fail(err);
    }
  };

  // SET-032: a failed save leaves the draft as typed, so Enter or leaving the field sends it again.
  const saveRoot = async (dir = rootDraft) => {
    try {
      const p = await invoke<PlaceInfo>("workspaces_place_set", { dir, flat: flatDraft });
      setPlace(p);
      setRootDraft(p.dir);
      say("ok", `workspaces go under ${p.dir}, ${p.flat ? "side by side" : "a folder per project"}`);
    } catch (err) {
      fail(err);
    }
  };

  const browseRoot = async () => {
    try {
      const picked = await open({ directory: true, title: "Choose the workspaces folder" });
      if (typeof picked === "string") {
        setRootDraft(picked);
        await saveRoot(picked);
      }
    } catch (err) {
      fail(err);
    }
  };

  const rootKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const action = placeFieldAction(e.key, e.nativeEvent.isComposing);
    if (action === "save") saveRoot();
    else if (action === "revert") setRootDraft(place.dir);
  };

  // PROJ-025 / PROJ-028: a project's own workspaces folder (empty: the global one) and base ref
  // (empty: the default branch Git reports).
  const openSettings = (p: Project) => {
    setSettingsFor(p.id);
    loadVis(p.id);
    setDirDraft(p.workspacesDir ?? "");
    setProjectBaseDraft(p.base ?? "");
  };
  // PROJ-014 / PROJ-015: every group change answers with the whole set; the newer one is kept.
  const takeGroups = (g: Groups) => {
    setGroups((o) => keepNewer(o, g));
    return g;
  };
  const openGroup = (g: Group) => {
    setGroupFor(g.id);
    setGroupName(g.name);
    setGroupParent(g.parent ?? "");
    setDropGroup(null);
  };
  const newGroup = () =>
    invoke<Groups>("group_create", { name: "", parent: null })
      .then((g) => openGroup(takeGroups(g).groups[g.groups.length - 1]))
      .catch(fail);
  const saveGroup = async (g: Group) => {
    try {
      if (groupName.trim() !== g.name) takeGroups(await invoke<Groups>("group_rename", { id: g.id, name: groupName }));
      if (groupParent !== (g.parent ?? "")) takeGroups(await invoke<Groups>("group_nest", { id: g.id, parent: groupParent || null }));
      setGroupFor(null);
    } catch (err) {
      fail(err);
    }
  };
  const deleteGroup = async (g: Group, remove: boolean) => {
    try {
      const gone = headersGoneWithGroup(groups.members, g.id, remove); // read before the delete: the answer no longer lists the members
      takeGroups(await invoke<Groups>("group_delete", { id: g.id, removeProjects: remove }));
      const colours = colourSaveAfterDelete(live.current.settings, gone); // null when none of them had a colour: nothing is saved
      if (colours) live.current.onSetting(HEADER_COLOURS_SETTING, colours);
      setGroupFor(null);
      setDropGroup(null);
      say("ok", remove ? `Deleted the group ${g.name} and took its projects out of Kolux; their folders are still on disk` : `Deleted the group ${g.name}; its projects are at the top level now`);
      if (remove) await reload();
    } catch (err) {
      fail(err);
    }
  };
  const putInGroup = (p: Project, group: string) => invoke<Groups>("group_put", { projectId: p.id, group: group || null }).then(takeGroups).catch(fail);

  const saveProject = async (p: Project) => {
    try {
      const u = await invoke<Project>("project_set", { projectId: p.id, workspacesDir: dirDraft, base: projectBaseDraft });
      say("ok", `${u.name}: workspaces ${u.workspacesDir ? `under ${u.workspacesDir}` : "in the global folder"}, starting from ${u.base ?? "the default branch"}`);
      setSettingsFor(null);
      await reload();
      await loadPlace();
    } catch (err) {
      fail(err);
    }
  };

  // PROJ-020: a stand-in row at once, then the workspace opens with a shell of its own; if the
  // user moved to another workspace meanwhile the create finishes without pulling focus back.
  // A newer create overtakes a running one (unless that one was made with Create more): Kolux
  // cancels it, and Git's half-made checkout is removed; one that finished first stays, in the
  // background. Each running create shows a stand-in row here and a stand-in tab by the panes.
  // PROJ-038: with a prompt and no agent picked, the default agent runs it, else the first installed.
  const installed = agents.filter((a) => a.installed);
  const fallbackAgent = installed.find((a) => a.id === defaultId) ?? installed[0] ?? null;
  const create = async (project: Project) => {
    const base = baseDraft.trim();
    const branch = branchDraft.trim();
    // SESS-036: a name that is an existing branch opens that branch rather than making a new one.
    const reuse = existing ? branch : !linked && branchList.includes(name.trim()) ? name.trim() : "";
    // PROJ-030: open a pull request's branch; SESS-036: a linked pull request opens the same way
    const pr = prList !== null ? prDraft : linked?.kind === "pull" ? { number: linked.number } : null;
    const issue = linked?.kind === "issue" ? linked : null;
    if (prList !== null ? !pr : existing ? !reuse : !name.trim() || preview === null) return;
    const keepOpen = more; // SESS-038: Create more keeps the composer open for the next one
    const typed = name.trim();
    const parent = parentDraft;
    const from = shown.current;
    const prompt = promptDraft.trim();
    const agent = agentDraft ? (installed.find((a) => a.id === agentDraft) ?? null) : prompt ? fallbackAgent : null;
    const mine: PendingCreate = { ticket: ++tickets.current, projectId: project.id, name: typed || (pr ? `#${pr.number}` : reuse), more: keepOpen };
    for (const t of overtakenBy(pendingNow.current, mine)) {
      overtaken.current.add(t);
      invoke("workspace_create_cancel", { ticket: t }).catch(() => {});
    }
    setPending([...pendingNow.current.filter((p) => !overtaken.current.has(p.ticket)), mine]);
    setName("");
    setBranchDraft("");
    setPromptDraft("");
    setPrDraft(null);
    setLinked(null); // SESS-038: Create more drops the linked item, ready for the next one
    if (!keepOpen) {
      setCreating(null);
      setBaseDraft("");
      setParentDraft(null);
    }
    try {
      const wt = pr
        ? await invoke<Created>("workspace_open_pr", { projectId: project.id, number: pr.number, folder: typed || null, name: typed || null, parent, ticket: mine.ticket, activeFolder: from })
        : reuse
        ? await invoke<Created>("workspace_open_branch", { projectId: project.id, branch: reuse, folder: existing ? typed || null : null, parent, ticket: mine.ticket, activeFolder: from })
        : await invoke<Created>("workspace_create", { projectId: project.id, name: typed, base: base || null, branch: branch || null, parent, ticket: mine.ticket, issue, activeFolder: from, suggested: typed === shownSuggestion.current }); // PROJ-039 (T-107-d): a suggested name left as it was may be renamed by the first work
      const lost = overtaken.current.has(mine.ticket);
      noteRecent(project.id);
      if (stopped.current.has(mine.ticket)) {
        const n = stoppedNote(worktreeLabel(wt), null);
        say(n.kind, n.text);
        return void (await reload());
      }
      setBehind(behindHint(wt.warnings, live.current.settings));
      const extra = [wt.note, ...wt.warnings.filter((x) => !isBehindHint(x))].filter(Boolean).join(" · ");
      say(extra ? "warn" : "ok", `created ${worktreeLabel(wt)} in ${wt.path} from ${wt.base}${extra ? ` · ${extra}` : ""}`);
      await reload();
      // The agent's tab is the workspace's first; a shell is only opened when no agent runs. With
      // Create more the new workspace does not take the front, so the next name can be typed.
      // A create overtaken after Git had already finished it stays, but never takes the front.
      const front = !keepOpen && !lost && shown.current === from;
      // PROJ-033: the project's setup script runs in a Setup terminal; a script that cannot run says why.
      const setup = setupSkip || !onSetup ? null : await trustedSetup(wt.path).catch((err) => (say("warn", String(err)), null));
      if (agent && setup && onSetup && waitsForSetup(setupWhere, setupWait, true, true)) {
        onSetup(wt.path, wt.branch, setup, setupWhere, front, () => onStartIn(agent, wt.path, wt.branch, prompt, front));
      } else {
        if (agent) onStartIn(agent, wt.path, wt.branch, prompt, front);
        else if (front) onSelect(wt.path, wt.branch, true);
        if (setup && onSetup) onSetup(wt.path, wt.branch, setup, setupWhere, false);
      }
      // PROJ-036: a workspace made from a linked issue runs the project's issue command in a tab.
      const run = setupSkip || !onSetup ? null : await issueCommand(project.path, wt.path, issue).catch((err) => (say("warn", String(err)), null));
      if (run && onSetup) onSetup(wt.path, wt.branch, run.line, "tab", false);
    } catch (err) {
      if (stopped.current.has(mine.ticket)) {
        const n = stoppedNote(mine.name, String(err));
        say(n.kind, n.text);
      } else if (overtaken.current.has(mine.ticket)) say("warn", `${mine.name}: ${String(err)}`);
      else fail(err);
    } finally {
      overtaken.current.delete(mine.ticket);
      stopped.current.delete(mine.ticket);
      setStopping((s) => s.filter((t) => t !== mine.ticket));
      setPending(pendingNow.current.filter((p) => p.ticket !== mine.ticket));
      if (keepOpen) nameRef.current?.focus();
    }
  };

  // The project in front: the one whose workspace is shown, else the first; "" with none yet.
  const projectInFront = () => projects.find((p) => (worktrees[p.id] ?? []).some((w) => activeDir !== null && same(activeDir, w.path)))?.id ?? projects[0]?.id ?? "";
  const openCreate = () => {
    const id = projectInFront();
    if (createOpens(id) === "add") setShowAdd(true);
    else setCreating(id);
  };
  useEffect(() => {
    if (createRequest === 0) return;
    openCreate();
    if (createName) setName(createName);
  }, [createRequest]);
  useEffect(() => {
    // VIEW-048: the row under the pointer, read at key time so a row that just went away never counts
    const hovered = [...document.querySelectorAll<HTMLElement>("[data-path]:hover")].pop()?.dataset.path ?? null;
    const target = deleteTarget(hovered, activeDir);
    if (deleteRequest === 0 || target === null) return;
    if (hovered !== null) {
      // PROJ-075: the row under the pointer; nothing on a main checkout, a row already deleting, or while a text field has focus
      const row = projects.flatMap((p) => (worktrees[p.id] ?? []).map((w) => ({ p, w }))).find(({ w }) => same(hovered, w.path));
      const act = row ? pointerDelete(row.w, { fieldFocused: isTextField(document.activeElement), deleting: new Set(busy === "removing" && confirm ? [confirm.path] : []) }) : null;
      if (!row || act === null) return;
      if (act.action === "forget") return void askForget({ projectId: row.p.id, path: act.path, label: worktreeLabel(row.w) });
      return void ask(row.p.id, row.w.path, worktreeLabel(row.w));
    }
    for (const p of projects) {
      const w = (worktrees[p.id] ?? []).find((x) => !x.isMain && same(target, x.path));
      if (w) return void ask(p.id, w.path, worktreeLabel(w));
    }
    say("warn", `The workspace ${hovered === null ? "shown" : "under the pointer"} is not one Kolux can delete (a project's main folder, or no workspace).`);
  }, [deleteRequest]);
  // T-611 (PROJ-059): workspace.rename opens the same inline rename as F2 on the workspace shown. A sidebar
  // the command just opened has no list yet, so the request stays pending until the lists come in; taking it
  // clears it, so it never fires later on another workspace or when the panel mounts again.
  useEffect(() => {
    if (renameRequest === 0) return;
    const w = renameTarget(activeDir, projects, worktrees, same);
    if (w === "wait") return;
    if (w === "none") say("warn", "There is no workspace in front to rename.");
    else startRename(w);
    onRenameTaken();
  }, [renameRequest, worktrees, projects, activeDir]);
  // SESS-035: Recent (projects the composer made workspaces in), then the rest by match, then Add project.
  const projectItems = (q: string): PickItem[] => {
    const hints = pathHints(projects);
    const r = rankProjects(projects, q, readRecent());
    const item = (group: string) => (m: ProjectMatch<Project>): PickItem => ({ key: m.p.id, label: projectLabel(m.p), hits: m.hits, group, title: m.p.path, hint: hints[m.p.id] && middle(hints[m.p.id], 28) });
    return [...r.recent.map(item("Recent")), ...r.rest.map(item("Projects")), { key: ADD_ITEM, label: "Add project…" }];
  };
  const pickProject = (id: string) => {
    if (id === ADD_ITEM) {
      setCreating(null);
      setAdding(true);
    } else if (id !== creating) {
      setCreating(id);
      setParentDraft(null); // the parent belongs to the old project
    }
  };
  // SESS-037: any workspace of the project but its main checkout can be the parent.
  const parentItems = (p: Project) => (q: string): PickItem[] => [
    ...(q.trim() ? [] : [{ key: "", label: "No parent" }]),
    ...(worktrees[p.id] ?? []).flatMap((w) => {
      const hits = w.isMain ? null : q.trim() ? matchLetters(q.trim(), worktreeLabel(w)) : [];
      return hits ? [{ key: w.path, label: worktreeLabel(w), hits, title: w.path }] : [];
    }),
  ];
  const parentLabel = (p: Project) => {
    const w = parentDraft ? (worktrees[p.id] ?? []).find((x) => same(x.path, parentDraft)) : undefined;
    return w ? worktreeLabel(w) : "No parent";
  };
  // SESS-038: Enter submits from the name and branch fields only, never mid input-method composition.
  const submitKeys = (p: Project | null) => (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && p) create(p);
    else if (e.key === "Escape") setCreating(null);
  };
  const reusing = !existing && prList === null && !linked && branchList.includes(name.trim());
  const openPrs = (p: Project) => {
    setExisting(false);
    setPrList([]);
    invoke<PrHead[]>("workspace_prs", { projectId: p.id }).then(setPrList).catch((err) => {
      setPrList(null);
      fail(err);
    });
  };
  const nameField = (p: Project | null) => (
    <div className="sb-form composer" data-create={p?.id ?? ""}>
      <Picker key={`project-${p?.id ?? ""}`} name="Project" value={p?.name ?? "pick a project"} items={projectItems} onPick={pickProject} startOpen={!p} />
      <input
        ref={nameRef}
        aria-label="workspace name"
        className="field"
        list="branch-list"
        placeholder={existing ? "folder name (optional: the branch name)" : "name, or an existing branch"}
        value={name}
        autoFocus={!!p}
        onChange={(e) => setName(shortcodes(e.target.value))}
        onKeyDown={submitKeys(p)}
      />
      <div className="preview">
        {linked ? `linked to ${itemLabel(linked)}${linked.kind === "pull" ? ", its branch checked out" : ", on a new branch"}` : prList !== null ? (prDraft ? `checks out pull request #${prDraft.number} (${prDraft.headRefName}) at its latest commit, linked to it` : prList.length ? "Pick the pull request under Advanced." : "No open pull requests.") : existing ? (branchDraft.trim() ? `checks out ${branchDraft.trim()} as it is, its commits kept` : "Pick the branch to open under Advanced.") : reusing ? `uses the existing branch ${name.trim()} as it is, its commits kept` : previewSentence(name, preview, p, !previewAnswered)}
      </div>
      {linked && (
        <div className="btn-row">
          <button className="link" onClick={() => setLinked(null)}>
            Unlink {linked.kind === "pull" ? "the pull request" : "the issue"}
          </button>
        </div>
      )}
      {findNote && <div className="preview warn">{findNote}</div>}
      {found.length > 0 && (
        <div className="pick-list" aria-label="issues and pull requests">
          {found.map((f) => (
            <button key={f.url} type="button" className="pick-item" title={f.url} onClick={() => (setLinked(f), setName(f.title), nameRef.current?.focus())}>
              <span className="name">#{f.number} {f.title}</span>
              <span className="hint">{f.kind === "pull" ? "pull request" : "issue"}</span>
            </button>
          ))}
        </div>
      )}
      {p && <Picker key={`parent-${p.id}`} name="Parent" value={parentLabel(p)} items={parentItems(p)} onPick={(k) => setParentDraft(k || null)} onEmptyEnter={() => setParentDraft(null)} />}
      <select aria-label="agent" className="field" value={agentDraft} onChange={(e) => setAgentDraft(e.target.value)}>
        <option value="">{promptDraft.trim() && fallbackAgent ? `${fallbackAgent.name} (default)` : "No agent: a terminal"}</option>
        {installed.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <textarea aria-label="note" className="field multi grow" placeholder="note: the first prompt for the agent (optional)" value={promptDraft} onChange={(e) => setPromptDraft(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setCreating(null)} />
      <button className="link" aria-expanded={advanced || existing || prList !== null} onClick={() => setAdvanced(!(advanced || existing || prList !== null))}>
        {advanced || existing || prList !== null ? "Hide advanced" : "Advanced…"}
      </button>
      {(advanced || existing || prList !== null) && (
        <div className="composer-advanced" data-advanced>
          <label>Branch name</label>
          <input
            aria-label="branch name"
            className="field"
            list={existing ? "branch-list" : undefined}
            placeholder={existing ? "existing branch, e.g. feat/x" : `from the name${preview && name.trim() ? `: ${preview.branch}` : ""}`}
            value={branchDraft}
            onChange={(e) => setBranchDraft(e.target.value)}
            onKeyDown={submitKeys(p)}
          />
          <label className="check">
            <input type="checkbox" aria-label="reuse an existing branch" checked={existing} onChange={(e) => (setExisting(e.target.checked), setPrList(null), setPrDraft(null))} />
            Reuse an existing branch (check it out, make none)
          </label>
          <label className="check">
            <input type="checkbox" aria-label="open a pull request" checked={prList !== null} onChange={(e) => (e.target.checked && p ? openPrs(p) : (setPrList(null), setPrDraft(null)))} />
            Open a pull request (its branch, linked to it)
          </label>
          {prList !== null && (
            <Picker key={`pr-${p?.id ?? ""}`} name="Pull request" value={prDraft ? `#${prDraft.number} ${prDraft.title}` : "pick a pull request"} items={(q) => prItems(prList, q)} onPick={(k) => setPrDraft(prList.find((x) => String(x.number) === k) ?? null)} startOpen={!prDraft} />
          )}
          <label>Setup</label>
          <select aria-label="setup policy" className="field" value={setupSkip ? "skip" : "run"} onChange={(e) => setSetupSkip(e.target.value === "skip")}>
            <option value="run">Run the project's setup script (kolux.yaml)</option>
            <option value="skip">Skip setup</option>
          </select>
          {!setupSkip && (
            <select aria-label="setup opens in" className="field" value={setupWhere} onChange={(e) => ((whereTouched.current = true), setSetupWhere(e.target.value as SetupWhere))}>
              <option value="tab">Setup in a new tab</option>
              <option value="right">Setup in a split to the right</option>
              <option value="down">Setup in a split below</option>
            </select>
          )}
          {!setupSkip && setupWhere === "tab" && (
            <label className="check">
              <input type="checkbox" aria-label="wait for setup" checked={setupWait} onChange={(e) => ((waitTouched.current = true), setSetupWait(e.target.checked))} />
              Wait for setup to finish before the agent starts
            </label>
          )}
          {!existing && prList === null && (
            <input aria-label="start from" className="field" placeholder={p?.base ? `start from: ${p.base} (saved)` : "start from: the default branch"} value={baseDraft} onChange={(e) => setBaseDraft(e.target.value)} onKeyDown={submitKeys(p)} />
          )}
        </div>
      )}
      <datalist id="branch-list">
        {branchList.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <div className="btn-row">
        <button className="btn" onClick={() => p && create(p)} disabled={busy !== "" || !p || (prList !== null ? !prDraft : existing ? !branchDraft.trim() : !name.trim() || preview === null)}>
          Create workspace
        </button>
        <button className="btn" onClick={() => setCreating(null)}>
          Cancel
        </button>
        <label className="check">
          <input type="checkbox" aria-label="create more" checked={more} onChange={(e) => setMore(e.target.checked)} />
          Create more
        </label>
      </div>
    </div>
  );

  // PROJ-070: look at the workspace first; the question shows what would be lost, and a clean
  // one with the question switched off goes straight to deleting. T-613: commits found on no other
  // branch and on no remote always ask, with Keep the branch ticked at first.
  const ask = async (projectId: string, path: string, branch: string) => {
    setBusy("checking");
    let asked = null;
    try {
      const check = await invoke<RemoveCheck>("workspace_remove_check", { projectId, path });
      const settings = await invoke<Record<string, unknown>>("get_settings");
      asked = { projectId, path, branch, check, force: false, keep: keepsAtFirst(check) };
      if (!skipsQuestion(check, settings)) {
        setConfirm(asked);
        asked = null;
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy("");
    }
    if (asked) await remove(asked);
  };
  // Row 364b: the backend's own verdict decides up front whether the question is offered; a check that cannot be asked still asks.
  const askForget = (f: { projectId: string; path: string; label: string }) => {
    invoke<string | null>("workspace_forget_check", { projectId: f.projectId, path: f.path })
      .catch(() => null)
      .then((why) => setForgetAsk({ ...f, ...(why ? { refused: why } : {}) }));
  };
  // Row 364: forgetting drops Kolux's records only, but the row vanishes, so it is confirmed first.
  const forget = async (f: { projectId: string; path: string; label: string }) => {
    setForgetAsk(null);
    try {
      await invoke("workspace_forget", { projectId: f.projectId, path: f.path });
      onRemoved(f.path);
      say("ok", `took ${f.label} out of Kolux; its folder stays on disk`);
      await reload();
    } catch (err) {
      fail(err);
    }
  };
  const remove = async (c = confirm) => {
    if (!c) return;
    setBusy("removing");
    try {
      const kept = await invoke<KeptBranch | null>("workspace_remove", { projectId: c.projectId, path: c.path, force: c.force, stamp: c.check.stamp, keepBranch: c.keep });
      if (kept) setKept((old) => addKept(old, [{ ...kept, projectId: c.projectId }]));
      void invoke("editor_drafts_drop", { worktree: c.path }).catch(() => undefined); // EDIT-004: removing a worktree discards its drafts
      onRemoved(c.path);
      say("ok", kept ? `removed ${c.branch}'s folder; kept the branch ${kept.branch}` : `removed ${c.branch} and its folder`);
      setConfirm(null);
      await reload();
    } catch (err) {
      // refused: say why in the question, showing the workspace as it is now with the force box cleared
      const check = await invoke<RemoveCheck>("workspace_remove_check", { projectId: c.projectId, path: c.path }).catch(() => null);
      if (check) setConfirm({ ...c, check, force: false, keep: c.keep ?? keepsAtFirst(check), refusal: String(err) });
      else fail(err);
    } finally {
      setBusy("");
    }
  };

  // PROJ-065: right-click on a workspace row lists what can be done to it.
  const openMenu = async (e: { preventDefault(): void; altKey: boolean; clientX: number; clientY: number }, p: Project, w: Worktree) => {
    e.preventDefault();
    const { altKey: alt, clientX: x, clientY: y } = e;
    const [st, targets] = await Promise.all([
      invoke<{ list: { id: string; label: string }[] }>("workspace_statuses", { paths: [w.path] }).catch(() => ({ list: [] })),
      loadTargets().catch(() => []),
    ]);
    const deleting = busy === "removing" && confirm?.path === w.path;
    setMenu({ x, y, projectId: p.id, path: w.path, items: rowMenu({ count: 1, isMain: w.isMain, asleep: isAsleep(w), deleting, platform: navigator.platform, alt, statuses: st.list, editors: targets.filter((t) => !t.files) }) });
  };
  // T-055: a workspace with children offers only to delete them all; a lone one follows the question setting.
  const startDelete = async (p: Project, w: Worktree) => {
    const now = await invoke<Record<string, unknown>>("get_settings");
    const plan = deletePlan([w.path], (worktrees[p.id] ?? []).map((x) => ({ path: x.path, parent: x.parent })), asksBeforeDelete(now));
    if (plan.withChildren) setBatch({ root: w.path, order: plan.order });
    else await ask(p.id, w.path, worktreeLabel(w));
  };
  const labelOf = (path: string) => {
    const w = Object.values(worktrees).flat().find((x) => same(x.path, path));
    return w ? worktreeLabel(w) : path;
  };
  // Children first and the parent last; stops at the first one with something uncommitted, and says which.
  const removeBatch = async () => {
    const b = batch;
    const p = b && projects.find((x) => (worktrees[x.id] ?? []).some((y) => y.path === b.root));
    if (!b || !p) return;
    setBusy("removing");
    const gone: string[] = [];
    try {
      for (const path of b.order) {
        const check = await invoke<RemoveCheck>("workspace_remove_check", { projectId: p.id, path });
        if (blocker(check) !== null || check.changes.length > 0) {
          setBatch({ ...b, order: b.order.slice(b.order.indexOf(path)), error: `${labelOf(path)} has ${blocker(check) ?? "uncommitted changes"}; nothing after it was removed` });
          return;
        }
        // After-list row 112: a branch Git kept because another workspace has it checked out joins the kept list too.
        // T-613: no branch choice (null), so the workspace's own record decides and a branch holding commits found nowhere else stays.
        const kept = await invoke<KeptBranch | null>("workspace_remove", { projectId: p.id, path, force: false, stamp: check.stamp, keepBranch: null });
        if (kept) setKept((old) => addKept(old, [{ ...kept, projectId: p.id }]));
        gone.push(path);
      }
      say("ok", `removed ${b.order.length} workspaces, children first`);
      setBatch(null);
    } catch (err) {
      setBatch({ ...b, error: String(err) });
    } finally {
      onRemovedAll(gone); // T-614: once, with every one that went, also when the batch stopped part way
      setBusy("");
      await reload();
    }
  };
  const runMenu = async (id: string) => {
    const m = menu;
    setMenu(null);
    const p = m && projects.find((x) => x.id === m.projectId);
    const w = m && (worktrees[m.projectId] ?? []).find((x) => x.path === m.path);
    if (!m || !p || !w) return;
    try {
      if (id === "delete") await startDelete(p, w);
      else if (id === "sleep") sleep(w);
      else if (id === "wake") wake(w);
      else if (id === "parent") setMoving(w.path);
      else if (id === "details") {
        const d = await invoke<{ name: string | null; item: string | null; comment: string }>("workspace_details_get", { path: w.path });
        setDetailsOf({ path: w.path, name: d.name ?? "", item: d.item ?? "", comment: d.comment });
      } else if (id === "statuses:edit") {
        const st = await invoke<{ list: { id: string; label: string }[] }>("workspace_statuses", { paths: [w.path] });
        setStatusesOf({ path: w.path, rows: editorRows(st.list) });
      } else if (id.startsWith("status:")) {
        await invoke("workspace_status_set", { path: w.path, status: id.slice(7) });
        await reload();
      } else if (id === "open:files") await openIn(w.path, FILE_MANAGER);
      else if (id.startsWith("open:editor:")) await openIn(w.path, { label: "", command: id.slice(12) });
      else if (id === "open:terminal") show(w);
      else if (id === "dev:copy-path") await navigator.clipboard.writeText(w.path);
      else if (id === "dev:copy-branch") await navigator.clipboard.writeText(w.branch ?? "");
    } catch (err) {
      fail(err);
    }
  };
  // PROJ-060: saves the name, linked item and comment; a refused link says why and writes nothing.
  const saveDetails = async () => {
    if (!detailsOf) return;
    try {
      await invoke("workspace_details_save", { path: detailsOf.path, name: detailsOf.name, item: detailsOf.item, comment: detailsOf.comment });
      setDetailsOf(null);
      await reload();
    } catch (err) {
      setDetailsOf({ ...detailsOf, error: String(err) });
    }
  };
  const spanView = (sp: Span, i: number) =>
    sp.t === "text" ? <span key={i}>{sp.text}</span> : (
      <button key={i} className="link" title={sp.href} onClick={() => void invoke("open_external", { url: sp.href }).catch(fail)}>
        {sp.t === "image" ? `image: ${sp.alt}` : sp.text}
      </button>
    );

  // PROJ-042: hide or show one worktree; the poll shows the change, this just does not wait for it.
  // PROJ-048: the parents a workspace can move under, and the move itself. The picker closes
  // first, so a refusal shows once it is gone.
  const moveItems = (p: Project, w: Worktree) => (q: string): PickItem[] => {
    const all = worktrees[p.id] ?? [];
    const top = w.parent && all.some((x) => !x.isMain && same(x.path, w.parent as string)) && !q.trim() ? [{ key: "", label: "No parent", hint: "top level" }] : [];
    return [
      ...top,
      ...parentChoices(all, w).flatMap((x) => {
        const hits = q.trim() ? matchLetters(q.trim(), worktreeLabel(x)) : [];
        return hits ? [{ key: x.path, label: worktreeLabel(x), hits, title: x.path }] : [];
      }),
    ];
  };
  const move = async (p: Project, w: Worktree, parent: string) => {
    setMoving(null);
    try {
      await invoke("workspace_set_parent", { projectId: p.id, path: w.path, parent: parent || null });
      await refreshWorktrees(projects);
    } catch (err) {
      say("warn", `${worktreeLabel(w)} was not moved: ${String(err)}`);
    }
  };
  const hide = async (w: Worktree, hidden: boolean) => {
    try {
      await invoke("workspace_hide", { path: w.path, hidden });
      await refreshWorktrees(projects);
    } catch (err) {
      fail(err);
    }
  };
  const doneReview = async (p: Project) => {
    try {
      await invoke("workspace_seen", { projectId: p.id });
      setReview(null);
      await refreshWorktrees(projects);
    } catch (err) {
      fail(err);
    }
  };
  // SET-032 / PROJ-042: which worktrees made outside Kolux show, per source, globally and per project.
  const loadVis = async (projectId: string | null) => {
    try {
      const list = await invoke<VisSource[]>("visibility_get", { projectId });
      if (projectId) setVisOwn(list);
      else setVisGlobal(list);
    } catch (err) {
      fail(err);
    }
  };
  const setVis = async (projectId: string | null, source: string, show: boolean | null) => {
    try {
      await invoke("visibility_set", { projectId, source, show });
      await loadVis(projectId);
      await refreshWorktrees(projects);
    } catch (err) {
      fail(err);
    }
  };
  const addRoot = async () => {
    try {
      await invoke("visibility_root_add", { path: rootPath });
      setRootPath("");
      setRootError("");
      await loadVis(null);
      await refreshWorktrees(projects);
    } catch (err) {
      setRootError(String(err));
    }
  };
  const removeRoot = async (path: string) => {
    try {
      await invoke("visibility_root_remove", { path });
      await loadVis(null);
      await refreshWorktrees(projects);
    } catch (err) {
      fail(err);
    }
  };
  const showWord = (b: boolean) => (b ? "Shown" : "Hidden");
  const globalVis = () => (
    <div data-visibility-defaults>
      <label title={GLOSSARY.worktree.hover}>Workspaces Kolux did not make, by default</label>
      {visGlobal.map((s) => (
        <div key={s.key}>
          <div className="preview" title={s.root ?? s.label}>
            {s.label}
          </div>
          <div className="vis-row">
          <select aria-label={`default for ${s.label}`} className="field" value={s.global ? "show" : "hide"} onChange={(e) => setVis(null, s.key, e.target.value === "show")}>
            <option value="hide">Hidden</option>
            <option value="show">Shown</option>
          </select>
          {s.root && (
            <button className="ib" title={`Stop treating ${s.root} as its own source`} onClick={() => removeRoot(s.root!)}>
              <Close size={11} />
            </button>
          )}
          </div>
        </div>
      ))}
      <input
        aria-label="extra root folder"
        className="field"
        placeholder="another folder that holds workspaces (starts hidden)"
        value={rootPath}
        onChange={(e) => {
          setRootPath(e.target.value);
          setRootError("");
        }}
        onKeyDown={(e) => e.key === "Enter" && addRoot()}
      />
      {rootError && <div className="preview warn">{rootError}</div>}
      <div className="btn-row">
        <button className="btn" onClick={addRoot} disabled={!rootPath.trim()}>
          Add folder
        </button>
      </div>
    </div>
  );
  const ownVis = (p: Project) => (
    <>
      <label title={GLOSSARY.worktree.hover}>Workspaces Kolux did not make, in {p.name}</label>
      {visOwn.map((s) => (
        <div key={s.key}>
          <div className="preview" title={s.root ?? s.label}>
            {s.label}
          </div>
          <div className="vis-row">
          <select aria-label={`${p.name}: ${s.label}`} className="field" value={s.own === null ? "global" : s.own ? "show" : "hide"} onChange={(e) => setVis(p.id, s.key, e.target.value === "global" ? null : e.target.value === "show")}>
            <option value="global">As global: {showWord(s.global)}</option>
            <option value="hide">Hidden</option>
            <option value="show">Shown</option>
          </select>
          {s.own !== null && (
            <button className="btn" title={`Back to the global choice (${showWord(s.global)})`} onClick={() => setVis(p.id, s.key, null)}>
              Reset
            </button>
          )}
          </div>
        </div>
      ))}
      <button
        className="link"
        onClick={() => {
          setSettingsFor(null);
          loadVis(null);
          setShowAdd(true);
        }}
      >
        Global defaults…
      </button>
    </>
  );
  const PAGE = 10;
  const hiddenList = (p: Project) => {
    const all = hiddenWts[p.id] ?? [];
    const pages = Math.max(1, Math.ceil(all.length / PAGE));
    const at = Math.min(hiddenPage, pages - 1);
    return (
      <>
        <label title={GLOSSARY.worktree.hover}>Hidden workspaces ({all.length})</label>
        {all.length === 0 && <div className="preview">None hidden.</div>}
        {all.slice(at * PAGE, at * PAGE + PAGE).map((w) => (
          <div className="vis-row" key={w.path}>
            <span className="path" title={w.path}>{relPath(p.path, w.path)}</span>
            <button className="btn" onClick={() => hide(w, false)}>
              Show
            </button>
          </div>
        ))}
        {pages > 1 && (
          <div className="btn-row">
            <button className="btn" disabled={at === 0} onClick={() => setHiddenPage(at - 1)}>
              Previous
            </button>
            <span className="preview">
              page {at + 1} of {pages}
            </span>
            <button className="btn" disabled={at >= pages - 1} onClick={() => setHiddenPage(at + 1)}>
              Next
            </button>
          </div>
        )}
      </>
    );
  };

  const same = (a: string, b: string) => a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();
  // PROJ-035: the setup-script card for the project of the active workspace. It is asked again when the
  // window is focused or the project or the active folder changes (not on every worktrees update),
  // and an older answer never replaces a newer one. The setup policy is the app's one stored setting,
  // read on the Rust side by the card, the save and the runner alike.
  const [card, setCard] = useState<{ id: string; s: SetupSuggestion } | null>(null);
  const [cardBusy, setCardBusy] = useState(false);
  const cardProject = cardProjectOf(projects, worktrees, activeDir, same);
  const cardId = cardProject?.id ?? null;
  const cardPath = cardProject?.path ?? null;
  const cardAsks = useRef(newestOnly());
  const askCard = useCallback(async () => {
    const current = cardAsks.current.begin();
    if (!cardId || !cardPath) return setCard(null);
    const s = await invoke<SetupSuggestion>("setup_suggestion", { projectId: cardId, path: cardPath }).catch((err) => ({ kind: "error", message: String(err) }) as SetupSuggestion);
    if (current()) setCard(s.kind === "none" ? null : { id: cardId, s });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, cardPath, activeDir]);
  useEffect(() => {
    void askCard();
    window.addEventListener("focus", askCard);
    return () => window.removeEventListener("focus", askCard);
  }, [askCard]);
  const cardDo = async (cmd: string, args: Record<string, unknown>) => {
    setCardBusy(true);
    try {
      await invoke(cmd, args);
    } catch (err) {
      say("error", String(err)); // a refused save ("That suggestion changed") is followed by the card's new offer
    } finally {
      setCardBusy(false);
    }
    await askCard();
  };
  const openCount = (w: Worktree) => openDirs.filter((d) => same(d, w.path)).length;
  const isActive = (w: Worktree) => openCount(w) > 0;
  // VIEW-051: only running panes count, so an exited tab drops out; none shows no count.
  const liveIn = (w: Worktree) => sessions.filter((s) => s.running && s.cwd !== null && same(s.cwd, w.path));
  const liveCount = (w: Worktree) => {
    const n = liveIn(w).length;
    // STAT-036: the agents working here come first ("2 working"); a sleeping workspace shows none and says sleeping beside its name.
    const word = isAsleep(w) ? "" : workingWord(infoOf(w).working);
    if (word) return <span className="count working" title={`${word}; split panes are counted apart`}>{word}</span>;
    return n > 0 ? <span className="count">{n}</span> : null;
  };
  const paneRows = (w: Worktree, depth = 0) =>
    liveIn(w).map((s) => (
      <div key={s.key} className="sess pane-row" role="button" tabIndex={0} data-pane={s.key} data-agent={s.agent} style={{ paddingLeft: 44 + depth * 14 }} title={"Show " + s.title} onClick={() => onOpenSession(s.key)} onKeyDown={(e) => e.key === "Enter" && onOpenSession(s.key)}>
        <VendorMark agent={s.agent as Agent} size={12} />
        <span className="name">{s.title}</span>
      </div>
    ));
  const isSelected = (w: Worktree) => activeDir !== null && same(activeDir, w.path);
  const infoOf = (w: Worktree): RowInfo => {
    const info = Object.entries(states).find(([d]) => same(d, w.path))?.[1] ?? { state: "idle", changed: 0, pr: null };
    return w.path in prBy ? { ...info, pr: prBy[w.path] } : info;
  };
  const isUnread = (w: Worktree) => [...unread].some((d) => same(d, w.path));
  const setRead = (w: Worktree, read: boolean) => onUnread(w.path, !read);
  const show = (w: Worktree) => {
    setRead(w, true);
    stamp(w.path);
    wake(w);
    onSelect(w.path, w.branch);
  };
  type Entry = { p: Project; w: Worktree };
  const seenAt = (path: string) => activity[pathKey(path)] ?? 0;
  const order = (xs: Entry[]) =>
    sortBy === "manual" ? manualOrder(orderWorktrees(xs.map((x) => x.w)).map((w) => xs.find((x) => x.w === w) as Entry), (x) => pathKey(x.w.path), idsFrom(settings[MANUAL_ORDER_SETTING])) : sortBy === "smart" ? smartOrder(xs, (x) => infoOf(x.w)) : sortBy === "activity" ? recentOrder(orderWorktrees(xs.map((x) => x.w)).map((w) => xs.find((x) => x.w === w) as Entry), (x) => seenAt(x.w.path)) : orderWorktrees(xs.map((x) => x.w)).map((w) => xs.find((x) => x.w === w) as Entry);
  // PROJ-051: under Recent the projects follow their latest workspace too, so a new one is first.
  const projectOrder = sortBy === "activity" ? recentOrder(projects, (p) => Math.max(seenAt(p.path), ...(worktrees[p.id] ?? []).map((w) => seenAt(w.path)))) : projects;
  // PROJ-046: pinned rows (and the workspaces made from them) sit in a section at the top, and
  // leave their usual place unless the copies setting is on.
  const pins: string[] = Array.isArray(settings[PIN_SETTING]) ? (settings[PIN_SETTING] as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const copies = settings[PIN_COPIES_SETTING] === true;
  const everyEntry: Entry[] = projects.flatMap((p) => (worktrees[p.id] ?? []).map((w) => ({ p, w })));
  const pinned = pinnedSet(pins, everyEntry.map((x) => x.w));
  const isPinned = (w: Worktree) => pins.some((x) => pathKey(x) === pathKey(w.path));
  const elsewhere = (w: Worktree) => copies || !pinned.has(pathKey(w.path));
  // PROJ-053, VIEW-053: who sleeps (never the main checkout), and whether sleeping rows show.
  const asleep: string[] = Array.isArray(settings[SLEEP_SETTING]) ? (settings[SLEEP_SETTING] as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const isAsleep = (w: Worktree) => !w.isMain && asleep.includes(pathKey(w.path));
  const showSleeping = showSleepingFrom(settings[SHOW_SLEEPING_SETTING]);
  const filters = filtersFrom(settings);
  const projectOf = (w: Worktree) => projects.find((p) => (worktrees[p.id] ?? []).some((x) => x.path === w.path))?.id ?? "";
  // PROJ-052: hide-sleeping (the show-sleeping switch), the default-branch row and the project filter.
  const hidden = (w: Worktree) => !rowShown(filters, { projectId: projectOf(w), isMain: w.isMain, branch: w.branch, asleep: asleep.includes(pathKey(w.path)) });
  const inList = (w: Worktree) => elsewhere(w) && !hidden(w); // the lane's listed(), renamed: main's listed is the worktree state
  function sleep(w: Worktree) {
    const next = asleepAfter(asleep, everyEntry.map((x) => x.w).filter((x) => !x.isMain), w.path, true);
    const paths = everyEntry.map((x) => x.w.path).filter((d) => next.includes(pathKey(d)) && !asleep.includes(pathKey(d)));
    onSetting(SLEEP_SETTING, next);
    onSleep(paths);
    invoke("workspace_sleep", { paths }).catch((err) => say("warn", `Some terminals did not close: ${String(err)}`));
  }
  function wake(w: Worktree) {
    if (isAsleep(w)) onSetting(SLEEP_SETTING, asleepAfter(asleep, [], w.path, false));
  }
  // PROJ-059: Enter saves; blank or unchanged cancels, and so does Escape or clicking away.
  function startRename(w: Worktree) {
    setRenaming(w.path);
    setRenameText(worktreeLabel(w));
  }
  async function saveRename(w: Worktree) {
    const n = renameTo(renameText, worktreeLabel(w));
    setRenaming(null);
    if (n === null) return;
    try {
      await invoke("workspace_rename", { path: w.path, name: n });
      await reload();
    } catch (err) {
      say("error", `${worktreeLabel(w)} was not renamed: ${String(err)}`);
    }
  }
  // PROJ-016: a project or group header dragged among its siblings; the order is saved as a setting.
  const dragged = useRef<{ kind: "header" | "row"; id: string } | null>(null);
  const headerTree = groupBy === "project" ? groupTree(groups, projectOrder.filter((p) => filters.projects.length === 0 || filters.projects.includes(p.id)), sortBy === "activity" ? undefined : idsFrom(settings[HEADER_ORDER_SETTING])) : [];
  const headerDrag = (id: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.stopPropagation();
      dragged.current = { kind: "header", id };
      e.dataTransfer.effectAllowed = "move";
    },
    onDragOver: (e: DragEvent) => {
      const d = dragged.current;
      if (d?.kind !== "header") return;
      const sibs = siblingIds(headerTree, d.id);
      if (sibs && sibs.includes(id) && id !== d.id) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    onDrop: (e: DragEvent) => {
      const d = dragged.current;
      dragged.current = null;
      if (d?.kind !== "header") return;
      e.preventDefault();
      e.stopPropagation();
      const sibs = siblingIds(headerTree, d.id);
      const r = e.currentTarget.getBoundingClientRect();
      const before = sibs ? dropBefore(sibs, d.id, id, e.clientY < r.top + r.height / 2) : undefined;
      if (sibs && before !== undefined) onSetting(HEADER_ORDER_SETTING, moveHeader(idsFrom(settings[HEADER_ORDER_SETTING]), sibs, d.id, before));
    },
    onDragEnd: () => {
      dragged.current = null;
    },
  });
  // PROJ-049: a workspace row dragged to a new place; the first drag keeps the order on screen as the Manual order.
  const rowDrag = (w: Worktree) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      dragged.current = { kind: "row", id: pathKey(w.path) };
      e.dataTransfer.setData("application/x-kolux-workspace", JSON.stringify([w.path])); // T-142: droppable on a workspace board lane
      e.dataTransfer.effectAllowed = "move";
    },
    onDragOver: (e: DragEvent) => {
      if (dragged.current?.kind === "row") e.preventDefault();
    },
    onDrop: (e: DragEvent) => {
      const d = dragged.current;
      dragged.current = null;
      if (d?.kind !== "row") return;
      e.preventDefault();
      const rowEl = e.currentTarget.closest("[data-path]") as HTMLElement | null;
      const list = e.currentTarget.closest(".sb-list");
      if (!list) return;
      const keys = [...new Set([...list.querySelectorAll("[data-path]")].map((n) => pathKey((n as HTMLElement).dataset.path ?? "")))];
      const lane = (n: Element | null) => n?.closest("[data-group]")?.getAttribute("data-group") ?? "";
      const fromEl = [...list.querySelectorAll("[data-path]")].find((n) => pathKey((n as HTMLElement).dataset.path ?? "") === d.id) ?? null;
      if (dropOutcome(groupBy, sortBy, lane(fromEl), lane(rowEl)) === "status") return; // a status lane drop changes the status only (see kolux-rs-after.md)
      const r = e.currentTarget.getBoundingClientRect();
      // PROJ-048: the middle of a card nests the dragged workspace under it (same rules as Move to); the edges reorder.
      const dw = everyEntry.find((x) => pathKey(x.w.path) === d.id);
      const into = dw && projectOf(w) === dw.p.id ? parentDropTarget(worktrees[dw.p.id] ?? [], dw.w.path, w.path, dropBand(e.clientY - r.top, r.height)) : null;
      if (dw && into) {
        void move(dw.p, dw.w, into.path);
        return;
      }
      const before = dropBefore(keys, d.id, pathKey(w.path), e.clientY < r.top + r.height / 2);
      if (before === undefined) return;
      onSetting(MANUAL_ORDER_SETTING, moveRows(dragStart(sortBy, idsFrom(settings[MANUAL_ORDER_SETTING]), keys), [d.id], before));
      if (sortBy !== "manual") onSetting(SORT_SETTING, "manual");
    },
    onDragEnd: () => {
      dragged.current = null;
    },
  });
  const togglePin = (w: Worktree) => onSetting(PIN_SETTING, isPinned(w) ? pins.filter((x) => pathKey(x) !== pathKey(w.path)) : [...pins, w.path]);
  const toggleFold = (title: string) => setFolded((f) => new Set(f.has(title) ? [...f].filter((t) => t !== title) : [...f, title]));

  // One workspace row: its state dot, name, unread mark, and the Remove and Mark unread buttons;
  // under a project, a child sits `depth` steps in and a parent with `kids` folds them (PROJ-047).
  const row = ({ p, w }: Entry, depth = 0, kids = false) => {
    const asking = confirm?.path === w.path;
    const info = infoOf(w);
    // PROJ-062: what the card shows under its name, and what a hover adds for the rest.
    const facts: CardFacts = { agents: liveIn(w).length, state: info.state, pr: info.pr, changed: cardChanges.countFor(w.path), note: w.comment ?? null, ports: cardPorts.portsFor(w.path), task: w.number ?? null };
    const hoverTitle = cardTitle(worktreeLabel(w), w.branch, cardDetails.shown, facts, `Show ${w.path}${isAsleep(w) ? " (asleep: showing it wakes it)" : ""}`);
    const un = isUnread(w);
    const shut = shutKids.has(w.path);
    const up = w.parent ? (worktrees[p.id] ?? []).find((x) => !x.isMain && same(x.path, w.parent as string)) : undefined;
    return (
      <div key={w.path} data-worktree={worktreeLabel(w)} data-depth={depth} data-path={w.path}>
        <div {...rowDrag(w)} className={`sess${isSelected(w) ? " sel" : ""}${un ? " unread" : ""}${picked.some((x) => same(x, w.path)) ? " picked" : ""}`} role="button" tabIndex={0} onContextMenu={(e) => void openMenu(e, p, w)} onClick={(e) => (isToggleClick(e, /mac/i.test(navigator.platform)) ? setPicked(toggleRow(picked, w.path, activeDir, same)) : (setPicked([]), show(w)))} onPointerEnter={() => (cardPorts.load(w.path, pollPaths), cardChanges.load(w.path))} onKeyDown={(e) => (e.key === "Enter" ? show(w) : e.key === "F2" && startRename(w))} title={hoverTitle} data-state={info.state} style={depth || kids ? { paddingLeft: 26 + depth * 14 - (kids ? 24 : 0) } : undefined}>
          {kids && (
            <button
              className={`fold${shut ? " shut" : ""}`}
              aria-expanded={!shut}
              title={shut ? "Show the workspaces made from this one" : "Fold away the workspaces made from this one"}
              onClick={(e) => {
                e.stopPropagation();
                setShutKids((f) => new Set(shut ? [...f].filter((x) => x !== w.path) : [...f, w.path]));
              }}
            >
              <ChevronDown size={12} />
            </button>
          )}
          <span className={`dot ${info.state}${isActive(w) ? " live" : ""}`} role="img" aria-label={isActive(w) || info.state !== "idle" ? info.state : "idle"} data-tip={VOCAB[info.state].explain} />
          {renaming === w.path ? (
            <ShortcodeInput
              className="rename"
              autoFocus
              aria-label="Workspace name"
              value={renameText}
              onClick={(e) => e.stopPropagation()}
              onValue={setRenameText}
              onBlur={() => setRenaming(null)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") void saveRename(w);
                if (e.key === "Escape") setRenaming(null);
              }}
            />
          ) : (
            <span
              className="name"
              title={hoverTitle + "\nDouble-click (or F2) to rename"}
              onDoubleClick={(e) => {
                e.stopPropagation();
                startRename(w);
              }}
            >
              {worktreeLabel(w)}
            </span>
          )}
          {info.cache != null && <CacheTimer due={info.cache} />}
          {isAsleep(w) && (
            <span className="hint" title="Asleep: its tabs and terminals were closed; show it to wake it">
              sleeping
            </span>
          )}
          {w.kind === "external" && (
            <span className="hint" title="Made outside Kolux (plain Git or another tool); Kolux has no record of making it">
              external
            </span>
          )}
          {goneFolders.has(w.path) && (
            <span className="hint" title={folderMissingNote}>
              missing
            </span>
          )}
          {pushTag(w)}
          {groupBy !== "project" && <span className="hint">{projectLabel(p)}</span>}
          {liveCount(w)}
          {!asking && (
            <button
              className={`ib${isPinned(w) ? " on" : ""}`}
              title={isPinned(w) ? "Unpin: back to its usual place only" : "Pin to the top of the list"}
              aria-pressed={isPinned(w)}
              onClick={(e) => {
                e.stopPropagation();
                togglePin(w);
              }}
            >
              <Pin size={11} />
            </button>
          )}
          {!asking && (
            <button
              className="ib"
              title={un ? "Mark read" : "Mark unread"}
              onClick={(e) => {
                e.stopPropagation();
                setRead(w, un);
              }}
            >
              <Bell size={11} />
            </button>
          )}
          {!asking && !w.isMain && (
            <button
              className="ib"
              title="Change parent: move this workspace under another one, or back to the top level"
              aria-expanded={moving === w.path}
              onClick={(e) => {
                e.stopPropagation();
                setMoving(moving === w.path ? null : w.path);
              }}
            >
              <ArrowRight size={11} />
            </button>
          )}
          {!asking && !w.isMain && !isAsleep(w) && (
            <button
              className="ib"
              title="Sleep: close its tabs and terminals, and those of the workspaces made from it; show it again to wake it"
              onClick={(e) => {
                e.stopPropagation();
                sleep(w);
              }}
            >
              <Moon size={11} />
            </button>
          )}
          {!asking && !w.isMain && (
            <button
              className="ib"
              title="Hide this worktree from the sidebar (project settings list it to show again)"
              onClick={(e) => {
                e.stopPropagation();
                hide(w, true);
              }}
            >
              <EyeOff size={11} />
            </button>
          )}
          {!asking && !w.isMain && (
            <button
              className="ib"
              title="Remove this workspace: deletes its folder, and its branch unless it was opened on an existing one"
              disabled={busy !== ""}
              onClick={(e) => {
                e.stopPropagation();
                void ask(p.id, w.path, worktreeLabel(w));
              }}
            >
              <Close size={11} />
            </button>
          )}
        </div>
        <CardLine shown={cardDetails.shown} facts={facts} depth={depth} />
        {paneRows(w, depth)}
        {statusesOf?.path === w.path && !asking && (
          <StatusEditor
            initial={statusesOf.rows}
            error={statusesOf.error}
            onCancel={() => setStatusesOf(null)}
            onSave={(rows) =>
              void invoke("workspace_statuses_set", { list: savePayload(rows) })
                .then(() => {
                  setStatusesOf(null);
                  return reload();
                })
                .catch((err) => setStatusesOf({ ...statusesOf, rows, error: String(err) }))
            }
          />
        )}
        {detailsOf?.path === w.path && !asking && (
          <div className="sb-form" data-details={worktreeLabel(w)}>
            <input className="field" aria-label="Name" placeholder="Name (blank uses the branch)" value={detailsOf.name} onChange={(e) => setDetailsOf({ ...detailsOf, name: e.target.value })} />
            <input
              className="field"
              aria-label="Linked issue or pull request"
              placeholder="Issue or pull request address, or #number"
              value={detailsOf.item}
              onChange={(e) => setDetailsOf({ ...detailsOf, item: e.target.value })}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                if (itemFromPaste(text) !== text.trim()) {
                  e.preventDefault();
                  setDetailsOf({ ...detailsOf, item: itemFromPaste(text) });
                }
              }}
            />
            <textarea className="field multi" aria-label="Comment" placeholder="Comment: # headings, [links](https://example.com) and ![images](https://example.com/a.png)" value={detailsOf.comment} onChange={(e) => setDetailsOf({ ...detailsOf, comment: e.target.value })} />
            {commentBlocks(detailsOf.comment).map((b, i) => (
              <div key={i} data-block={b.kind} style={b.kind === "heading" ? { fontWeight: 600 } : undefined}>
                {b.spans.map(spanView)}
              </div>
            ))}
            {detailsOf.error && (
              <span className="note error" role="alert">
                {detailsOf.error}
              </span>
            )}
            <div className="btn-row">
              <button className="btn" onClick={() => void saveDetails()}>
                Save
              </button>
              <button className="btn" onClick={() => setDetailsOf(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {batch?.root === w.path && (
          <div className="sb-form warn" data-delete-all={worktreeLabel(w)}>
            <div>
              Delete <b>{worktreeLabel(w)}</b> and the {batch.order.length - 1} workspace{batch.order.length === 2 ? "" : "s"} made from it? They go children first, the parent last, each with its folder and branch. Anything with uncommitted changes stops the rest.
            </div>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {batch.order.map((d) => (
                <li key={d}>{labelOf(d)}</li>
              ))}
            </ul>
            {batch.error && (
              <span className="note error" role="alert">
                {batch.error}
              </span>
            )}
            <div className="btn-row">
              <button className="btn danger" onClick={() => void removeBatch()} disabled={busy !== ""}>
                {busy === "removing" ? "Removing…" : "Delete all"}
              </button>
              <button className="btn" onClick={() => setBatch(null)}>
                Keep
              </button>
            </div>
          </div>
        )}
        {moving === w.path && !asking && (
          <div className="sb-form" data-moving={worktreeLabel(w)}>
            <Picker key={`move-${w.path}`} name="Move under" value={up ? worktreeLabel(up) : "No parent"} startOpen items={moveItems(p, w)} onPick={(k) => void move(p, w, k)} />
            <div className="btn-row">
              <button className="btn" onClick={() => setMoving(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {forgetAsk && same(forgetAsk.path, w.path) && (
          <div className="sb-form warn" data-forget={forgetAsk.label}>
            {forgetAsk.refused ? (
              <>
                <span>{forgetAsk.refused}</span>
                <div className="btn-row">
                  <button className="btn" onClick={() => setForgetAsk(null)}>
                    OK
                  </button>
                </div>
              </>
            ) : (
              <>
                <span>
                  Take <b>{forgetAsk.label}</b> out of Kolux? Its folder stays on disk.
                </span>
                <div className="btn-row">
                  <button className="btn danger" onClick={() => void forget(forgetAsk)}>
                    Take out
                  </button>
                  <button className="btn" onClick={() => setForgetAsk(null)}>
                    Keep
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {asking && (
          <div className="sb-form warn">
            <span>
              Remove <b>{confirm.branch}</b> and its folder? Its branch is deleted too, unless the workspace was opened on a branch that already existed.{" "}
              {blocker(confirm.check) ?? (confirm.check.changes.length > 0 ? `${confirm.check.changes.length} uncommitted or untracked change${confirm.check.changes.length === 1 ? "" : "s"} would be lost:` : "Nothing uncommitted is there.")}
            </span>
            {confirm.check.changes.length > 0 && (
              <ul className="del-changes" aria-label="changes that would be lost">
                {shownChanges(confirm.check).lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
                {shownChanges(confirm.check).more > 0 && <li>and {shownChanges(confirm.check).more} more</li>}
              </ul>
            )}
            {commitsNote(confirm.check) && (
              <>
                <span>{commitsNote(confirm.check)}</span>
                <ul className="del-changes" aria-label="commits that would be lost">
                  {shownCommits(confirm.check).lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                  {shownCommits(confirm.check).more > 0 && <li>and {shownCommits(confirm.check).more} more</li>}
                </ul>
              </>
            )}
            {confirm.refusal && (
              <span className="note error" role="alert">
                {confirm.refusal}
              </span>
            )}
            {confirm.check.changes.length > 0 && !blocker(confirm.check) && (
              <label className="del-force">
                <input type="checkbox" checked={confirm.force} onChange={(e) => setConfirm({ ...confirm, force: e.target.checked })} />
                Delete my changes too
              </label>
            )}
            {!blocker(confirm.check) && (
              <label className="del-force">
                <input type="checkbox" checked={confirm.keep === true} onChange={(e) => setConfirm({ ...confirm, keep: e.target.checked })} />
                Keep the branch
              </label>
            )}
            <div className="btn-row">
              <button className="btn danger" onClick={() => remove()} disabled={busy !== "" || blocker(confirm.check) !== null}>
                {busy === "removing" ? "Removing…" : "Remove"}
              </button>
              <button className="btn" onClick={() => setConfirm(null)}>
                Keep
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };
  const standIn = (p: Project) =>
    pending
      .filter((c) => c.projectId === p.id)
      .map((c) => (
        <div key={c.ticket} className="sess pending" data-pending={c.name} aria-busy="true">
          <span className="dot" role="img" aria-label="creating" />
          <span className="name">{c.name}</span>
          <span className="hint">{stopping.includes(c.ticket) ? "stopping…" : "creating…"}</span>
          {!stopping.includes(c.ticket) && (
            <button className="ib" title={`Cancel creating ${c.name}; what Git made so far is removed`} aria-label={`cancel creating ${c.name}`} onClick={() => stopCreate(c.ticket)}>
              ×
            </button>
          )}
        </div>
      ));

  const labels = headerLabels(projects); // PROJ-009
  // PROJ-054: bring the open workspace into view, clearing the filters that hide it
  const jumpHere = () => {
    const cur = Object.values(worktrees).flat().find((w) => activeDir !== null && same(w.path, activeDir));
    return jumpToCurrent({
      path: activeDir,
      hiddenByFilters: !!cur && hidden(cur),
      clear: () => CLEAR_FILTERS.forEach(([k, v]) => setFilter(k, v)),
      find: (path) => Array.from(document.querySelectorAll('.sb-list [data-path]')).find((el) => same(el.getAttribute('data-path') ?? '', path)) ?? null,
      show: (row) => row.scrollIntoView({ block: 'center' }),
    });
  };
  const projectBlock = (p: Project) => {
      const list = worktrees[p.id] ?? [];
      const main = list.find((w) => w.isMain);
      const others = order(list.filter((w) => !w.isMain && inList(w)).map((w) => ({ p, w })));
      const opening = creating === p.id;
      return (
        <div key={p.id}>
          <div className="proj" title={p.path} {...headerDrag(p.id)}>
            <HeaderBadge colour={headerColourOf(settings, "p", p.id)} />
            <ProjectIcon value={icons[p.id]} name={projectLabel(p)} auto={autoIcons[p.id]} />
            <span className="name" title={p.displayName ? p.name : undefined}>{projectLabel(p)}{labels[p.id]?.hint && <span className="sb-name-hint" title={labels[p.id].hint ?? undefined}>{labels[p.id].hintCut}</span>}</span>
            <button className={`ib${settingsFor === p.id ? " on" : ""}`} title="Project settings: its workspaces folder and base ref" aria-pressed={settingsFor === p.id} onClick={() => (settingsFor === p.id ? setSettingsFor(null) : openSettings(p))}>
              <Gear />
            </button>
            <button className={`ib${opening ? " on" : ""}`} title="New workspace: a branch in its own folder" aria-pressed={opening} onClick={() => setCreating(opening ? null : p.id)}>
              <Plus size={13} />
            </button>
          </div>
          {main && (
            <button className={`branch${isSelected(main) ? " sel" : ""}`} onClick={() => show(main)} title={`Show ${main.path}`}>
              <span className={`dot ${infoOf(main).state}${isActive(main) ? " live" : ""}`} role="img" aria-label={infoOf(main).state} data-tip={VOCAB[infoOf(main).state].explain} />
              <span className="name">{worktreeLabel(main)}</span>
              {pushTag(main)}
              {liveCount(main)}
              <span className="chev">
                <ChevronDown size={12} />
              </span>
            </button>
          )}
          {main && paneRows(main)}
          {settingsFor === p.id && (
            <div className="sb-form" data-project-settings={p.id}>
              <label>Workspaces folder for {p.name}</label>
              <input aria-label="project workspaces folder" className="field" list="used-dirs" placeholder={`global: ${place.dir}`} value={dirDraft} onChange={(e) => setDirDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveProject(p)} />
              {hiddenList(p)}
              {ownVis(p)}
              <label>Base ref</label>
              <input aria-label="project base ref" className="field" placeholder="the default branch Git reports" value={projectBaseDraft} onChange={(e) => setProjectBaseDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveProject(p)} />
              <label>Group</label>
              <select aria-label="project group" className="field" value={groups.groups.some((g) => g.id === groups.members[p.id]) ? groups.members[p.id] : ""} onChange={(e) => putInGroup(p, e.target.value)}>
                <option value="">None: top level</option>
                {groups.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <label>Header colour</label>
              <HeaderColourPicker settings={settings} kind="p" id={p.id} onSetting={onSetting} />
              <IconPicker value={icons[p.id]} name={p.name} onSet={(icon) => setIcon(p, icon)} onProblem={(text) => say("warn", text)} />
              <button className="link" onClick={() => setCleanupFor(p.id)} title="Scan for workspaces that have gone quiet or are merged">
                Clean up workspaces…
              </button>
              <div className="btn-row">
                <button className="btn" onClick={() => saveProject(p)}>
                  Save
                </button>
                <button className="btn" onClick={() => setSettingsFor(null)}>
                  Cancel
                </button>
                <button className="btn danger" data-remove-project onClick={() => setDropProject(dropProject === p.id ? null : p.id)}>
                  Remove project
                </button>
              </div>
              {dropProject === p.id && (
                <div className="note" role="alertdialog" aria-label="Remove project">
                  <div>Remove {p.name} from Kolux? Its terminals close and its list entries, saved setup and remembered names are cleared. The folder and its files stay on disk.</div>
                  <div className="btn-row">
                    <button className="btn danger" data-remove-project-yes onClick={() => removeProject(p)}>
                      Remove {p.name}
                    </button>
                    <button className="btn" onClick={() => setDropProject(null)}>
                      Keep it
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {cleanupFor === p.id && (
            <CleanupDialog
              project={p}
              onClose={() => setCleanupFor(null)}
              onRemoved={(paths) => {
                onRemovedAll(paths);
                void reload();
              }}
              onKept={(items) => setKept((old) => addKept(old, items))}
              parentOf={(path) => (worktrees[p.id] ?? []).find((x) => same(x.path, path))?.parent}
            />
          )}
          {outsideCard({ outside: outsideOf(list), dismissed: dismissedOutside(settings).includes(p.id), collapsed: false, otherRows: others.length }).show && (
            <OutsideCard outside={outsideOf(list)} onDismiss={() => onSetting(OUTSIDE_DISMISSED_SETTING, withDismissed(settings, p.id))} />
          )}
          {(fresh[p.id] ?? []).length > 0 && review !== p.id && (
            <button className="sb-notice" onClick={() => setReview(p.id)} title="Worktrees made with plain Git or another tool since you last looked">
              {fresh[p.id].length} new workspace{fresh[p.id].length === 1 ? "" : "s"}
            </button>
          )}
          {review === p.id && (
            <div className="sb-form" data-review={p.id}>
              <label title={GLOSSARY.worktree.hover}>New workspaces in {p.name}</label>
              {(fresh[p.id] ?? []).map((w) => (
                <div className="vis-row" key={w.path}>
                  <span className="path" title={w.path}>{relPath(p.path, w.path)}</span>
                  <button className="btn" onClick={() => hide(w, !w.hidden)}>
                    {w.hidden ? "Show" : "Hide"}
                  </button>
                </div>
              ))}
              <div className="btn-row">
                <button className="btn" onClick={() => doneReview(p)}>
                  Done
                </button>
              </div>
            </div>
          )}
          {opening && nameField(p)}
          {standIn(p)}
          {nestRows(others.map((x) => x.w), nest, shutKids, (ws) => ws).map((r) => row({ p, w: r.w }, r.depth, r.kids))}
        </div>
      );
  };
  const groupForm = (g: Group, count: number) => (
    <div className="sb-form" data-group-settings={g.id}>
      <label>Group name</label>
      <input aria-label="group name" className="field" value={groupName} onChange={(e) => setGroupName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveGroup(g)} autoFocus />
      <label>Inside</label>
      <select aria-label="group inside" className="field" value={groupParent} onChange={(e) => setGroupParent(e.target.value)}>
        <option value="">Nothing: top level</option>
        {groupChoices(groups, g.id).map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
      <label>Header colour</label>
      <HeaderColourPicker settings={settings} kind="g" id={g.id} onSetting={onSetting} />
      {dropGroup ? (
        <>
          <div className="sb-hint">
            Delete {g.name}? {count === 0 ? "It holds no projects." : `It holds ${count} project${count === 1 ? "" : "s"}.`}
          </div>
          <label className="check">
            <input type="checkbox" aria-label="also remove the projects" checked={dropGroup.remove} onChange={(e) => setDropGroup({ remove: e.target.checked })} />
            Also remove its projects from Kolux (their folders stay on disk)
          </label>
          <div className="btn-row">
            <button className="btn danger" onClick={() => deleteGroup(g, dropGroup.remove)}>
              Delete group
            </button>
            <button className="btn" onClick={() => setDropGroup(null)}>
              Keep it
            </button>
          </div>
        </>
      ) : (
        <div className="btn-row">
          <button className="btn" onClick={() => saveGroup(g)}>
            Save
          </button>
          <button className="btn" onClick={() => setDropGroup({ remove: false })}>
            Delete…
          </button>
          <button className="btn" onClick={() => setGroupFor(null)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
  // PROJ-014: groups fold like the other headers; sub-groups and their projects sit inside.
  const drawNode = (n: Node): ReactNode =>
    n.kind === "project" ? (
      projectBlock(n.project)
    ) : (
      <div key={n.group.id} className="proj-group" data-project-group={n.group.id}>
        <div className="sb-group-row" {...headerDrag(n.group.id)}>
          <button className="sb-group" aria-expanded={!folded.has(n.group.id)} onClick={() => toggleFold(n.group.id)}>
            <HeaderBadge colour={headerColourOf(settings, "g", n.group.id)} />
            {n.group.name}
            <span className="count">{n.count}</span>
            <span className="chev">
              <ChevronDown size={12} />
            </span>
          </button>
          <button className={`ib${groupFor === n.group.id ? " on" : ""}`} title="Group settings: its name, where it sits, delete it" aria-pressed={groupFor === n.group.id} onClick={() => (groupFor === n.group.id ? setGroupFor(null) : openGroup(n.group))}>
            <Gear />
          </button>
        </div>
        {groupFor === n.group.id && groupForm(n.group, n.count)}
        {!folded.has(n.group.id) && <div className="proj-group-kids">{n.children.map(drawNode)}</div>}
      </div>
    );

  return (
    <div className="sidebar-wrap">
      <aside className="sidebar" aria-label="Sidebar">
        <nav className="sb-nav">
          {chromeShown(settings, "tasksButton") && (
            <button className={`row${page === "tasks" ? " on" : ""}`} aria-current={page === "tasks" ? "page" : undefined} onClick={() => onPage("tasks")}>
              <span className="ic">
                <List />
              </span>
              Tasks
            </button>
          )}
          <button className={`row${artifactsOn ? " on" : ""}`} aria-current={artifactsOn ? "page" : undefined} onClick={onArtifacts}>
            <span className="ic">
              <FileCode />
            </span>
            Artifacts
          </button>
          {chromeShown(settings, "automationsButton") && <AutomationsRow open={page === "automations"} onOpen={() => onPage("automations")} onHide={() => onSetting("automationsButton", false)} />}
          {chromeShown(settings, "skillsButton") && <SkillsRow open={skillsOn} onOpen={onSkills} onHide={() => onSetting("skillsButton", false)} />}
        </nav>

        <div className="sb-section">
          Projects
          <span className="icons">
            {NOT_BUILT && (
              <button className="ib" title="Notifications (not built yet)">
                <Bell size={13} />
              </button>
            )}
            <button className={`ib${filterOpen ? " on" : ""}`} title="Group and sort the list" aria-pressed={filterOpen} onClick={() => setFilterOpen((o) => !o)}>
              <Sliders size={13} />
            </button>
            <button className="ib" title="Add project: clone, open a folder or start a new one" aria-pressed={adding} onClick={() => setAdding(true)} disabled={busy !== ""}>
              <FolderPlus size={13} />
            </button>
            <button className="ib" title="New group: sort projects into folders of their own" onClick={newGroup} disabled={groupBy !== "project"}>
              <Box size={13} />
            </button>
            <button className="ib" title="New workspace: a branch in its own folder" aria-pressed={creating !== null} onClick={() => (creating === null ? openCreate() : setCreating(null))}>
              <Plus size={13} />
            </button>
            {NOT_BUILT && (
              <button className="ib" title="Launch (not built yet)">
                <Rocket size={13} />
              </button>
            )}
          </span>
        </div>

        <div className="sb-tabs" role="tablist">
          <button role="tab" aria-pressed="true">
            Workspaces
          </button>
          {NOT_BUILT && (
            <button role="tab" aria-pressed="false" title="Status (not built yet)">
              Status
            </button>
          )}
        </div>

        {behind && <BehindNote text={behind} refresh={refreshesOnCreate(settings)} onRefresh={(on) => onSetting(REFRESH_SETTING, on)} onDismiss={() => (onSetting(HINT_DISMISSED_SETTING, true), setBehind(null))} />}
        <PickedBar
          picked={picked}
          find={(path) => {
            const p = projects.find((x) => (worktrees[x.id] ?? []).some((y) => same(y.path, path)));
            const w = p && (worktrees[p.id] ?? []).find((y) => same(y.path, path));
            return p && w ? { projectId: p.id, name: worktreeLabel(w) } : undefined;
          }}
          onRemoved={onRemovedAll}
          onKept={(items) => setKept((old) => addKept(old, items))}
          onLeft={setPicked}
          onReload={reload}
          say={say}
        />
        <div
          className="sb-list"
          {...top.listProps}
          onDragOver={(e) => {
            if (dragged.current === null) return;
            const r = e.currentTarget.getBoundingClientRect();
            e.currentTarget.scrollTop += edgeScroll(e.clientY, r.top, r.bottom);
          }}
        >
          {showAdd && (
            <div className="sb-form">
              <label>Add project</label>
              <input aria-label="project folder" className="field" placeholder="path to a folder" value={pathDraft} onChange={(e) => setPathDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPath(pathDraft)} />
              <div className="btn-row">
                <button className="btn" onClick={() => addPath(pathDraft)} disabled={busy !== "" || !pathDraft.trim()}>
                  Add
                </button>
                <button className="btn" onClick={browse} disabled={busy !== ""}>
                  Browse…
                </button>
              </div>
              <label>Workspaces folder{place.fromEnv && rootDraft === place.dir ? " (from KOLUX_WORKSPACES_DIR)" : ""}</label>
              <input aria-label="workspaces folder" className="field" list="used-dirs" value={rootDraft} onChange={(e) => setRootDraft(e.target.value)} onKeyDown={rootKey} onBlur={() => rootDraft !== place.dir && saveRoot()} />
              <label>Layout</label>
              <select aria-label="workspaces layout" className="field" value={flatDraft ? "flat" : "nested"} onChange={(e) => setFlatDraft(e.target.value === "flat")}>
                <option value="nested">Nested: a folder per project</option>
                <option value="flat">Flat: all side by side</option>
              </select>
              <div className="btn-row">
                <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => saveRoot()} disabled={rootDraft === place.dir && flatDraft === place.flat}>
                  Save
                </button>
                <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={browseRoot}>
                  Browse…
                </button>
                <button className="btn" onClick={() => setRootDraft("")} title="Empty means the default folder">
                  Use default
                </button>
              </div>
              <button type="button" className="link" data-git-settings onClick={() => {
                setShowAdd(false);
                openSettingsPage("git");
              }}>
                Branch prefix and compare base: the Git page in Settings
              </button>
              <label className="check">
                <input type="checkbox" checked={nest} onChange={(e) => onNest(e.target.checked)} />
                Nest child workspaces under their parent
              </label>
              {globalVis()}
            </div>
          )}

          <datalist id="used-dirs">
            {place.used.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          {filterOpen && (
            <div className="sb-form" data-filter>
              <label>Group by</label>
              <select aria-label="group by" className="field" value={groupBy} onChange={(e) => onSetting(GROUP_SETTING, e.target.value)}>
                <option value="project">Project</option>
                <option value="none">None: one flat list</option>
                <option value="status">Status</option>
                <option value="pr">Pull request</option>
              </select>
              <label>Sort</label>
              <select aria-label="sort" className="field" value={sortBy} onChange={(e) => onSetting(SORT_SETTING, e.target.value)}>
                <option value="smart">Smart: what needs you first</option>
                <option value="name">Name</option>
                <option value="activity">Recent: latest activity first</option>
                <option value="manual">Manual: drag rows into your own order</option>
              </select>
              <label className="check">
                <input type="checkbox" checked={hideAuto} onChange={(e) => onSetting(HIDE_AUTOMATION_SETTING, e.target.checked)} /> Hide workspaces made by automations
              </label>
              <label className="check">
                <input type="checkbox" aria-label="pinned rows also in their group" checked={copies} onChange={(e) => onSetting(PIN_COPIES_SETTING, e.target.checked)} />
                Pinned rows also show in their usual place
              </label>
              <label className="check">
                <input type="checkbox" aria-label="show sleeping workspaces" checked={showSleeping} onChange={(e) => onSetting(SHOW_SLEEPING_SETTING, e.target.checked)} />
                Show sleeping workspaces
              </label>
              <label className="check">
                <input type="checkbox" aria-label="hide the default-branch rows" checked={filters.hideDefault} onChange={(e) => onSetting(FILTER_DEFAULT_SETTING, e.target.checked)} />
                Hide the default-branch row
              </label>
              {projects.length > 1 && (
                <div data-filter-projects>
                  <label>Show only these projects</label>
                  {projects.map((p) => (
                    <label className="check" key={p.id}>
                      <input
                        type="checkbox"
                        aria-label={`show ${p.name}`}
                        checked={filters.projects.length === 0 || filters.projects.includes(p.id)}
                        onChange={() => setFilter(FILTER_PROJECTS_SETTING, toggleProject(filtersFrom(pend.current.latest(settings)), projects.map((x) => x.id), p.id))}
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              )}
              <button className="btn" aria-label="clear filters" disabled={filtersOn(filters) === 0} onClick={() => CLEAR_FILTERS.forEach(([k, v]) => setFilter(k, v))}>
                Clear filters{filtersOn(filters) > 0 ? ` (${filtersOn(filters)})` : ""}
              </button>
              <CardDetailsChooser settings={settings} onSetting={onSetting} />
            </div>
          )}
          {creating === "" && nameField(null)}
          {projects.length === 0 && !showAdd && <div className="sb-hint">No projects yet. Use the folder button above to add a project folder; one without Git can start it here.</div>}

          {everyEntry.some((x) => pinned.has(pathKey(x.w.path)) && !hidden(x.w)) && (
            <div data-group="Pinned" className="pinned">
              <button className="sb-group" aria-expanded={!folded.has("pinned-section")} onClick={() => toggleFold("pinned-section")}>
                Pinned
                <span className="count">{everyEntry.filter((x) => pinned.has(pathKey(x.w.path)) && !hidden(x.w)).length}</span>
                <span className="chev">
                  <ChevronDown size={12} />
                </span>
              </button>
              {!folded.has("pinned-section") &&
                nestRows(order(everyEntry.filter((x) => pinned.has(pathKey(x.w.path)) && !hidden(x.w))).map((x) => x.w), nest, shutKids, (ws) => ws).map((r) => row({ p: everyEntry.find((x) => x.w === r.w)?.p as Project, w: r.w }, r.depth, r.kids))}
            </div>
          )}
          {groupBy === "project" && headerTree.map(drawNode)}

          {/* PROJ-045: one list across projects, flat or under Status / Pull request headers that fold. */}
          {groupBy !== "project" && creating && nameField(projects.find((p) => p.id === creating) ?? null)}
          {groupBy !== "project" && projects.map(standIn)}
          {groupBy !== "project" &&
            groupRows(
              order(everyEntry.filter((x) => inList(x.w))),
              groupBy,
              (x) => infoOf(x.w),
              (x) => x.p.name,
            ).map((g) => (
              <div key={g.title} data-group={g.title}>
                {g.title && (
                  <button className="sb-group" aria-expanded={!folded.has(g.title)} onClick={() => toggleFold(g.title)}>
                    {g.title}
                    <span className="count">{g.rows.length}</span>
                    <span className="chev">
                      <ChevronDown size={12} />
                    </span>
                  </button>
                )}
                {!folded.has(g.title) && g.rows.map((x) => row(x))}
              </div>
            ))}

          {card && cardProject && card.id === cardProject.id && (
            <SetupCard
              project={cardProject.name}
              suggestion={card.s}
              busy={cardBusy}
              onSave={() => {
                const v = cardView(card.s, cardProject.name);
                const a = v && saveArgs(cardProject.path, v);
                if (a) void cardDo("setup_suggestion_save", a);
              }}
              onDismiss={() => cardDo("setup_suggestion_dismiss", { projectId: cardProject.id })}
              onRetry={() => void askCard()}
            />
          )}
          <KeptBranches items={kept} onChange={setKept} onSay={say} onDeleted={() => void reload()} />
          {message && <MessageNote kind={message.kind} text={message.text} />}
          {menu && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 49 }} onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
              <div role="menu" aria-label="Workspace" data-menu-for={menu.path} style={{ position: "fixed", left: menu.x, top: menu.y, zIndex: 50, minWidth: 180, padding: 4, display: "flex", flexDirection: "column", background: "var(--app-bg)", border: "1px solid var(--line-focus)", borderRadius: 8 }} onKeyDown={(e) => e.key === "Escape" && setMenu(null)}>
                {menu.items.map((it) =>
                  it.children ? (
                    <div key={it.id} role="group" aria-label={it.label} style={{ display: "flex", flexDirection: "column" }}>
                      <div style={{ padding: "4px 8px", color: "var(--fg-muted)", fontSize: 11 }}>{it.label}</div>
                      {it.children.map((c) => (
                        <button key={c.id} role="menuitem" disabled={it.disabled || c.disabled} style={{ textAlign: "left", padding: "4px 8px 4px 20px" }} onClick={() => void runMenu(c.id)}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <button key={it.id} role="menuitem" disabled={it.disabled} style={{ textAlign: "left", padding: "4px 8px", color: it.danger ? "#f0a07a" : undefined }} onClick={() => void runMenu(it.id)}>
                      {it.label}
                    </button>
                  ),
                )}
              </div>
            </>
          )}
        </div>
        <ListButtons topShown={top.shown} onTop={top.toTop} canJump={activeDir !== null} onJump={() => void jumpHere()} />

        <div className="sb-divider" />
        <div className="sb-next">
          Next that needs you
          <span className="hint"><KeyText id="terminals.focusNextNeedsYou" /></span>
        </div>
        <button className="sb-new" title="New session: start an agent in a new pane inside a fresh workspace" aria-haspopup="menu" aria-expanded={plusOpen} onClick={() => setPlusOpen((o) => !o)} disabled={launching}>
          <Plus size={13} />
          {launching ? "Starting…" : "New session"}
        </button>
        {plusOpen && (
          <PlusMenu
            agents={agents}
            defaultId={defaultId}
            onSetDefault={onSetDefault}
            allOff={allOff}
            pass={pass}
            onRefresh={onRefresh}
            onChoose={() => {
              setPlusOpen(false);
              onChoose();
            }}
            busy={launching}
            style={{ left: 16, bottom: 56 }}
            onClose={() => setPlusOpen(false)}
            onTerminal={
              onTerminal &&
              (() => {
                setPlusOpen(false);
                onTerminal();
              })
            }
            onManage={() => {
              setPlusOpen(false);
              openSettingsPage("agents");
            }}
            onPick={(a) => {
              setPlusOpen(false);
              onLaunch(a, projects.length === 1 ? projects[0].id : null);
            }}
          />
        )}
        {adding && <AddProject onBrowse={browse} onClose={() => setAdding(false)} onAdded={(p) => { setAdding(false); void added(p, false); }} />}
        <div className="sb-foot">
          <button
            className="ib"
            title={`Add a project by path, or change the workspaces folder${gitVersion ? ` · ${gitVersion}` : ""}`}
            aria-pressed={showAdd}
            onClick={() => {
              if (!showAdd) loadVis(null);
              setShowAdd((s) => !s);
            }}
          >
            <Gear />
          </button>
          {/* SET-028: until Settings > Agents exists (T-036, T-054), model routing opens from here. */}
          <button className="ib" title="Model routing: the model and effort for each worker tier" aria-pressed={page === "routing"} onClick={() => onPage("routing")}>
            <Sliders size={14} />
          </button>
          <HelpMenu />
          <button className="upd" title="Check for a newer version of Kolux RS" aria-label="Check for updates" onClick={requestUpdateCheck}>
            <Refresh size={13} />
            <span className="label">Check for updates</span>
          </button>
          {NOT_BUILT && (
            <button className="ib" title="Focus (not built yet)">
              <Target />
            </button>
          )}
          {NOT_BUILT && (
            <button className="ib" title="Right rail (not built yet)">
              <Rail />
            </button>
          )}
        </div>
      </aside>
      {importing && <ImportSetup {...importing} busy={busy !== ""} onImport={importSetup} onClose={() => setImporting(null)} />}
      {startGit && <StartGit {...startGit} busy={busy !== ""} onStart={startGitAndAdd} onFolder={openAsFolder} onScan={() => (setScanRoot(startGit.folder), setStartGit(null))} onCancel={() => setStartGit(null)} />}
      {scanRoot !== null && (
        <ScanRepos
          root={scanRoot}
          onClose={() => setScanRoot(null)}
          onProblem={fail}
          onDone={async (message, project) => {
            setScanRoot(null);
            setShowAdd(false);
            say("ok", message);
            await reload();
            if (project) {
              const open = openedWorktree(await invoke<Worktree[]>("workspace_list", { projectId: project.id }), project.path);
              if (open) (onSelect(open.path, open.branch), onAdded(open.path, open.branch));
            }
          }}
        />
      )}
    </div>
  );
}
