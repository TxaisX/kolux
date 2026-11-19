// The pane bodies that are only needed once a page is opened (cycle 3, first load). A terminal pane, a tab and the
// pane's frame are drawn by the shell at once; the body arrives on first use. Every name here is the module's own
// default export, so a caller swaps its import line and nothing else changes.
import { deferred } from "./deferred";

/** The CI check tab: one pull request check with its log excerpt and Fix with AI. */
export const CheckPane = deferred(() => import("../scm/CheckPane"));
