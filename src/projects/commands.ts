// PALETTE-007: the sidebar's own actions as palette rows. The palette (terminal/paneActions.ts) lists PROJECT_COMMANDS
// and calls runProjectCommand(id); the mounted ProjectsPanel hears the event and does what its footer buttons do.
export type ProjectCommandId = "project.add" | "project.newGroup" | "project.scan";

export const PROJECT_COMMANDS: { id: ProjectCommandId; label: string; hint: string }[] = [
  { id: "project.add", label: "Add project", hint: "Pick a folder or clone a repository" },
  { id: "project.newGroup", label: "New group", hint: "Make a group to sort projects into" },
  { id: "project.scan", label: "Scan for repos", hint: "Look through a folder for git repositories" },
];

export const PROJECT_COMMAND_EVENT = "kolux:project-command";

export const isProjectCommand = (id: unknown): id is ProjectCommandId => PROJECT_COMMANDS.some((c) => c.id === id);

export function runProjectCommand(id: ProjectCommandId, target: Pick<Window, "dispatchEvent"> = window): void {
  target.dispatchEvent(new CustomEvent(PROJECT_COMMAND_EVENT, { detail: id }));
}
