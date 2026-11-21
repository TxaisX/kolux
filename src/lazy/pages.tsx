// The screens, panels, sheets and dialogs the window draws on top of a terminal: each one loads the first
// time it is opened, so a Terminals screen does not carry the settings pages, the note renderer, the plan
// sheet or the editor into the window's first frame (cycle 3, first load). Every name here is the module's
// own export, so a caller swaps its import line and nothing else changes: `deferred` keeps the place the
// element sits in. DT-C230 (amended): `prefetch()` reads the help sheet and the chooser pane
// at the first idle moment (stage 1), the Board, Agents, Inbox, Explorer and settings page 2 s later
// (stage 2), the plan sheet (it carries the Markdown renderer) at 8 s (stage 3); every other surface here loads the first time it is opened. The top bar warms the one a
// control is about to open (`warm()`) on hover and focus.
import { type ComponentProps, type ComponentType } from "react";
import { ahead, deferred } from "./deferred";

/** ORCH-020 / SESS-025: the plan sheet a finished agent's plan is reviewed in. */
export const PlanSheet = deferred(() => import("../terminal/PlanSheet"), undefined, { warm: 3 }); // DT-C230: no placeholder; it imports the Markdown preview, so it rides with the editor stack in stage 3

// Settings, and the two notices that sit on it.
export const SettingsPage = deferred(() => import("../settings/SettingsPage"), undefined, { warm: 2 }); // DT-C230: no placeholder, 68 kB, so stage 2
// DT-C252: the Settings pages' own code follows in the last stage, one page per idle moment, so the first
// visit to a page is as quick as the second.
ahead(3, () => import("../settings/SettingsPage").then((m) => m.warmPages()));
export const SignInNotice = deferred(() => import("../settings/SignInNotice"));
export const KeyLostNotice = deferred(() => import("../settings/KeyLostNotice"));

// The Inbox, the Board and the Agents list.
export const AgentsPanel = deferred(() => import("../sessions/AgentsPanel"), undefined, { warm: 2 });

/** chat/ChatView exports its head, its row and its hand-off menu too, so the chat body is named out of it. */
type ChatProps = ComponentProps<(typeof import("../chat/ChatView"))["AgentsChat"]>;
export const AgentsChat = deferred<ChatProps>(() => import("../chat/ChatView").then((m) => ({ default: m.AgentsChat as unknown as ComponentType<ChatProps> })));

/** Slice 1 of chat panes: the pane marked `chat` draws the engine's own conversation, through the same
 *  fold and ViewRow as AgentsChat. It loads on the pane's first draw, never with the first frame. */
export const ChatPane = deferred(() => import("../chat/live/ChatPane"));

// The first-run guide and its wizard, and the help menu's sheet.
export const Guides = deferred(() => import("../onboarding/Guides"));
export const Wizard = deferred(() => import("../onboarding/Wizard"));
export const HelpSheet = deferred(() => import("../onboarding/HelpSheet"), undefined, { warm: 1 }); // DT-C230: no placeholder, and small

// The project surfaces: the rename ask and the cleanup dialog.
export const FolderRenameAsk = deferred(() => import("../projects/FolderRenameAsk"));
export const CleanupDialog = deferred(() => import("../projects/CleanupDialog"));

// The right sidebar's panels: the pull request checks, and Insights (tokens / cost / live sessions, app-wide).
export const ChecksPanel = deferred(() => import("../scm/ChecksPanel"));

// Dialogs and hosts that open on their own: updates, about, feedback, a link ask, trust, recovery.
export const UpdateCenter = deferred(() => import("../update/UpdateCenter"));
export const AboutPanel = deferred(() => import("../shell/AboutPanel"));
export const FeedbackDialog = deferred(() => import("../feedback/FeedbackDialog"));
export const LinkAskHost = deferred(() => import("../shell/LinkAskDialog"));
export const RecoveryMount = deferred(() => import("../recovery/RecoveryMount"));
export const ToolNotices = deferred(() => import("../launch/ToolNotices"));

// A chooser pane (SESS-007) and the Tower's own drawing.
export const ChooserPane = deferred(() => import("../launch/ChooserPane"), undefined, { warm: 1 }); // DT-C230: a new pane; keys typed before it loads would reach the old one
