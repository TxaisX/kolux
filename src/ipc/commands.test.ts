import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn(async (..._a: unknown[]) => "answer");
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { invokeNamed, NAMED_COMMANDS } from "./commands";

describe("T-811 named commands", () => {
  beforeEach(() => invoke.mockClear());

  it("invokeNamed hands the name and arguments to invoke unchanged", async () => {
    expect(await invokeNamed<string>("claude_usage")).toBe("answer");
    await invokeNamed("repo_setup_remove", { path: "C:/r" });
    expect(invoke.mock.calls).toEqual([["claude_usage", undefined], ["repo_setup_remove", { path: "C:/r" }]]);
  });

  it("lists each name once", () => {
    expect(new Set(NAMED_COMMANDS).size).toBe(NAMED_COMMANDS.length);
  });
});
