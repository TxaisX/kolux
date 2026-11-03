// The screens, panels, sheets and dialogs the window draws on top of a terminal: each one loads the first
// time it is opened, so a Terminals screen does not carry the settings pages, the note renderer, the plan
// sheet or the editor into the window's first frame (cycle 3, first load). Every name here is the module's
// own export, so a caller swaps its import line and nothing else changes: `deferred` keeps the place the
// element sits in, and `prefetch()` reads the code in the background once the window is up, so opening one
// stays instant.
import { createElement, type ComponentProps, type ComponentType } from "react";
import { deferred } from "./deferred";

// T-706: what a full-page screen shows while its code is read the first time; everything else draws nothing.
const loading = createElement("div", { className: "empty", role: "status" }, "Loading…");

/** ORCH-020 / SESS-025: the plan sheet a finished agent's plan is reviewed in. */
export const PlanSheet = deferred(() => import("../terminal/PlanSheet"));

// Settings, and the two notices that sit on it.
export const SettingsPage = deferred(() => import("../settings/SettingsPage"));
export const RoutingPage = deferred(() => import("../settings/RoutingPage"), loading);
export const SignInNotice = deferred(() => import("../settings/SignInNotice"));
export const KeyLostNotice = deferred(() => import("../settings/KeyLostNotice"));

// The full-page screens: Tasks, Automations, Skills, Artifacts, Space and Floor.
export const TasksPage = deferred(() => import("../tasks/TasksPage"), loading);
export const AutomationsPage = deferred(() => import("../automations/AutomationsPage"), loading);
export const SkillsPage = deferred(() => import("../skills/SkillsPage"), loading);
export const SkillUpdateNotice = deferred(() => import("../skills/SkillUpdateNotice"));
export const ArtifactsPage = deferred(() => import("../artifacts/ArtifactsPage"), loading);
export const SpaceView = deferred(() => import("../space/SpaceView"), loading);
export const FloorView = deferred(() => import("../floor/FloorView"), loading);

// The Inbox, the Board and the Agents list.
export const InboxView = deferred(() => import("../inbox/InboxView"), loading);
export const WorkspaceBoard = deferred(() => import("../board/WorkspaceBoard"));
export const AgentsPanel = deferred(() => import("../sessions/AgentsPanel"));

/** chat/ChatView exports its head, its row and its hand-off menu too, so the chat body is named out of it. */
type ChatProps = ComponentProps<(typeof import("../chat/ChatView"))["AgentsChat"]>;
export const AgentsChat = deferred<ChatProps>(() => import("../chat/ChatView").then((m) => ({ default: m.AgentsChat as unknown as ComponentType<ChatProps> })), loading);

// The first-run guide and its wizard, and the help menu's sheet.
export const Guides = deferred(() => import("../onboarding/Guides"));
export const Wizard = deferred(() => import("../onboarding/Wizard"));
export const HelpSheet = deferred(() => import("../onboarding/HelpSheet"));

// The file surfaces: the explorer, the template picker, a project row, the palette, review notes.
export const Explorer = deferred(() => import("../editor/Explorer"));
export const TemplatePicker = deferred(() => import("../editor/TemplatePicker"));
export const AddProjectRow = deferred(() => import("../editor/AddProjectRow"));
export const ReviewNotes = deferred(() => import("../editor/ReviewNotes"));
export const FolderRenameAsk = deferred(() => import("../projects/FolderRenameAsk"));

// The right sidebar's panels: the pull request checks, and Insights (tokens / cost / live sessions, app-wide).
export const ChecksPanel = deferred(() => import("../scm/ChecksPanel"));
export const InsightsPanel = deferred(() => import("../insights/InsightsPanel")); // T-646

// Dialogs and hosts that open on their own: updates, about, feedback, a link ask, trust, recovery.
export const UpdateCenter = deferred(() => import("../update/UpdateCenter"));
export const AboutPanel = deferred(() => import("../shell/AboutPanel"));
export const FeedbackDialog = deferred(() => import("../feedback/FeedbackDialog"));
export const LinkAskHost = deferred(() => import("../shell/LinkAskDialog"));
export const TrustPrompt = deferred(() => import("../setup/TrustDialog"));
export const RecoveryMount = deferred(() => import("../recovery/RecoveryMount"));
export const ToolNotices = deferred(() => import("../launch/ToolNotices"));
export const AgentStartHost = deferred(() => import("../agentstart/AgentStartHost"));

// A chooser pane (SESS-007), a page's Preview button and the Tower's own drawing.
export const ChooserPane = deferred(() => import("../launch/ChooserPane"));
export const PreviewButton = deferred(() => import("../browser/PreviewButton"));
export const TowerView = deferred(() => import("../tower/TowerView"), loading);
