import { expect, test } from "vitest";
import { fixDoes, fixFor, type Fix } from "./Attention";

// ACCT-014: "Check again" detects afresh and clears the stale note; it never starts a sign-in.
test("Check again re-detects and never connects; the other fixes keep their own job", () => {
  const plan = { reason: "plan", message: "", resetsAt: null } as const;
  const missing = { reason: "not-found", message: "", resetsAt: null } as const;
  for (const route of ["claude-key", "claude-account", "codex"] as const) {
    expect(fixFor(plan, route)).toBe("Check again");
    expect(fixDoes(fixFor(missing, route)!)).toBe("check");
  }
  const does: Record<Fix, string> = { "Check again": "check", "Open install page": "install-page", "Use a 1-year key instead": "key", Renew: "connect", "Try again": "connect", "Try installing again": "connect" };
  for (const [f, d] of Object.entries(does)) expect(fixDoes(f as Fix)).toBe(d);
});
