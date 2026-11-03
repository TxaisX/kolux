// T-692 (palette.md:7): the sidebar's Add project, New group and Scan for repos as palette Quick actions,
// each run through the same event the sidebar's own buttons answer (projects/commands.ts).
import { PROJECT_COMMANDS, runProjectCommand } from "../projects/commands";

// Only a mounted ProjectsPanel hears the event, so `show` brings the sidebar up first and the event goes on the next tick,
// once the panel's listener is in. ponytail: one tick is enough while the panel loads with the app; a lazy panel needs a queued request.
export const projectRows = (show: () => void, run = runProjectCommand) =>
  PROJECT_COMMANDS.map((c) => ({ section: "Quick actions", label: c.label, hint: c.hint, run: () => (show(), setTimeout(() => run(c.id))) }));
