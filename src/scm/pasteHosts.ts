// Row 350 (T-315-b): the GitHub hosts a link pasted into the palette may name. github.com always; a
// GitHub Enterprise host once one of this window's workspaces is linked to an item on it (those links
// came through the back end's host check), so a pasted Enterprise link finds its workspace too.
import { workItem } from "../projects/model";

export function pasteHosts(linked: Record<string, string>): string[] {
  const hosts = ["github.com"];
  for (const url of Object.values(linked)) {
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      continue;
    }
    // A link with a user, a password or a port never widens the list (scm/paste.ts refuses them too).
    if (parsed.username || parsed.password || parsed.port) continue;
    const host = workItem(url)?.host;
    if (host && !hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}
