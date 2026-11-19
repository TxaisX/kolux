// Row 350 (T-315-b): the palette accepts a pasted link from the GitHub hosts this window already works with.
import { describe, expect, it } from "vitest";
import { pasteHosts } from "./pasteHosts";
import { githubItem } from "./paste";

describe("paste hosts", () => {
  it("github.com plus the Enterprise hosts the workspaces are linked to, each once", () => {
    const linked = { "C:/w/a": "https://GHE.corp.example/team/app/pull/4", "C:/w/b": "https://github.com/me/app/pull/2", "C:/w/c": "https://ghe.corp.example/team/lib/issues/9" };
    expect(pasteHosts(linked)).toEqual(["github.com", "ghe.corp.example"]);
    expect(githubItem("https://ghe.corp.example/team/app/pull/7", pasteHosts(linked))).not.toBeNull();
  });

  it("a link that is not an item, or carries a user or a port, adds no host", () => {
    const linked = { a: "not a link", b: "https://x@evil.example/o/r/pull/1", c: "https://ghe.example:8443/o/r/pull/1" };
    expect(pasteHosts(linked)).toEqual(["github.com"]);
    expect(pasteHosts({})).toEqual(["github.com"]);
  });
});
