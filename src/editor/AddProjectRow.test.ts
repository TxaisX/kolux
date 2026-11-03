import { describe, expect, it } from "vitest";
import { addDirect } from "./AddProjectRow";

describe("adding a project from the empty Explorer", () => {
  it("adds each folder as a Git project", async () => {
    const calls: string[] = [];
    const names = await addDirect(["/a", "/b"], async (cmd, { path }) => (calls.push(`${cmd} ${path}`), { name: path.slice(1).toUpperCase() }));
    expect(names).toEqual(["A", "B"]);
    expect(calls).toEqual(["project_add /a", "project_add /b"]);
  });
  it("falls back to a plain folder project outside a Git repository", async () => {
    const calls: string[] = [];
    const names = await addDirect(["/plain"], async (cmd) => {
      calls.push(cmd);
      if (cmd === "project_add") throw "/plain is not inside a Git repository";
      return { name: "plain" };
    });
    expect(names).toEqual(["plain"]);
    expect(calls).toEqual(["project_add", "project_add_folder"]);
  });
  it("lets any other failure through to be shown", async () => {
    await expect(addDirect(["/x"], async () => Promise.reject("disk full"))).rejects.toBe("disk full");
  });
});
