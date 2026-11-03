// T-692 (palette.md:7): the sidebar's Add project, New group and Scan for repos as palette Quick actions,
// each run through the same event the sidebar's own buttons answer (projects/commands.ts).
import { PROJECT_COMMANDS, runProjectCommand } from "../projects/commands";

export const projectRows = (run = runProjectCommand) => PROJECT_COMMANDS.map((c) => ({ section: "Quick actions", label: c.label, hint: c.hint, run: () => run(c.id) }));
