// PKG-2 (narrow the redraw): the sidebar's project list as the window draws it. It draws again only when what it
// shows changed (projectsProps.ts names every prop and how it is compared); the tally counts the draws that got
// past the comparison, for the speed harness (stable.ts).
import { memo } from "react";
import ProjectsPanel from "../../projects/ProjectsPanel";
import { tally } from "./stable";
import { sameProjects, type ProjectsProps } from "./projectsProps";

export default memo(function Projects(props: ProjectsProps) {
  tally("projects");
  return <ProjectsPanel {...props} />;
}, sameProjects);
