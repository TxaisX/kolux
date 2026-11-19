// Row 76: a repository whose remote is not GitHub reaches the composer's neutral note, never the gh sign-in banner.
import { describe, expect, it, vi } from "vitest";

const replies: Record<string, unknown> = {};
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (cmd: string) => replies[cmd] ?? null }));

import GhBanner, { classify } from "./GhBanner";
import { panelBody, reusableNoPr, type PrChecks } from "./checks";
import type { Status } from "./model";
import { readReview, reviewLines } from "./prFind";

const status = { branch: "feat", base: "origin/main" } as unknown as Status;
const noPr = (extra: Partial<PrChecks> = {}): PrChecks => ({ pr: null, conflict: false, checks: [], ...extra });
const gitlab = noPr({ provider: "gitlab", host: "gitlab.com" });

describe("row 76: the Checks panel on a non-GitHub remote", () => {
  it("a gitlab no-pull-request answer draws the composer, not the error or banner body", () => {
    expect(panelBody({ dir: "C:/w", error: null, data: gitlab, view: null })).toBe("start");
    expect(panelBody({ dir: "C:/w", error: null, data: noPr(), view: null })).toBe("start");
  });

  it("the composer then says the lookup is not available for that host", async () => {
    replies.scm_pr_find = { provider: "gitlab", host: "gitlab.com", pr: null };
    const text = reviewLines(await readReview("C:/w", status)).join("\n");
    expect(text).toContain("not available for gitlab.com");
    expect(text).not.toMatch(/gh auth|sign in|could not be read/i);
  });

  it("only an error answer reaches the gh banner path; a loading or unlinked state does not", () => {
    const err = "To authenticate, run gh auth login";
    expect(classify(err)).not.toBe("other"); // what the old gitlab answer (gh run on gitlab) came to
    expect(panelBody({ dir: "C:/w", error: err, data: null, view: null })).toBe("error");
    expect(panelBody({ dir: "C:/w", error: null, data: null, view: null })).toBe("looking");
    expect(panelBody({ dir: "C:/w", error: null, data: noPr(), view: "unlinked" })).toBe("unlinked");
    expect(panelBody({ dir: null, error: null, data: null, view: null })).toBe("workspace");
    expect(typeof GhBanner).toBe("function");
  });
});

describe("row 76: the provider answer reaches the composer", () => {
  it("only a GitHub no-pull-request answer may stand in for the next ask; a provider answer is asked again", () => {
    expect(reusableNoPr(noPr())).toBe(true);
    expect(reusableNoPr(gitlab)).toBe(false);
    expect(reusableNoPr(noPr({ provider: "none", host: null }))).toBe(false);
    expect(reusableNoPr({ ...noPr(), pr: { number: 1, url: "u", state: "OPEN", title: "t", head: "h", draft: false } as PrChecks["pr"] })).toBe(false);
  });
});
