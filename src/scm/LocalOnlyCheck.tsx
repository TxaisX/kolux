// T-654 (DT-C89): what sits behind the local-only badge (LocalOnlyBadge.tsx): the one-time question
// to the back end and the icon. It loads the first time a workspace row is drawn, not with the
// sidebar's first frame.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AutoRemote } from "./autoPr";
import LocalOnlyIcon from "./LocalOnlyIcon";

const asked = new Map<string, Promise<AutoRemote | null>>();

/** What auto_pr_remote says about `dir`, asked once; a failed ask is forgotten (the next mount asks again) and answers null. */
export function remoteOf(dir: string, ask: (dir: string) => Promise<AutoRemote> = (worktree) => invoke<AutoRemote>("auto_pr_remote", { worktree })): Promise<AutoRemote | null> {
  let p = asked.get(dir);
  if (!p) asked.set(dir, (p = ask(dir).catch(() => (asked.delete(dir), null))));
  return p;
}

/** For tests, and after a remote is added. */
export const forgetRemotes = () => asked.clear();

export default function LocalOnlyCheck({ dir }: { dir: string }) {
  const [remote, setRemote] = useState<AutoRemote | null>(null);
  useEffect(() => {
    let live = true;
    setRemote(null);
    void remoteOf(dir).then((r) => live && setRemote(r));
    return () => void (live = false);
  }, [dir]);
  return remote === "none" ? <LocalOnlyIcon /> : null;
}
