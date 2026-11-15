import { groupChoices, type Groups } from "./groups";

/** The projects that go with a group when it is deleted with its projects: the ones in the group and in every
 *  sub-group under it (the back end removes those too). Both the delete and its question read this one list. */
export function projectsInGroup(groups: Groups, id: string): string[] {
  const outside = new Set(groupChoices(groups, id).map((x) => x.id)); // every group but this one and its sub-groups
  const inside = new Set(groups.groups.filter((x) => !outside.has(x.id)).map((x) => x.id));
  return Object.entries(groups.members).filter(([, gid]) => inside.has(gid)).map(([pid]) => pid);
}
