import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import AutoPrStatus, { runLine } from "./AutoPrStatus";
import { LOCAL_ONLY_TEXT } from "./LocalOnlyIcon";
import { forgetRemotes, remoteOf } from "./LocalOnlyCheck";
import { LocalOnlyBadge } from "./LocalOnlyBadge";
import { clearOneClick, putRun, type Run } from "./oneClick";

const run = (o: Partial<Run> = {}): Run => ({ dir: "C:/dev/alpha", step: "open", state: "done", message: null, pr: { number: 7, url: "https://github.com/o/r/pull/7", state: "OPEN", draft: true }, skipped: [], push: null, auto: { kind: "done", files: [], local: false }, ...o });

describe("T-655 AutoPrStatus", () => {
  beforeEach(() => clearOneClick());

  it("says nothing is there yet when no automatic run exists, and ignores manual runs", () => {
    putRun("C:/m", { ...run({ dir: "C:/m" }), auto: undefined });
    const html = renderToString(createElement(AutoPrStatus, {}));
    expect(html).toContain("No automatic pull request yet");
    expect(html).not.toContain("data-auto-pr=");
  });

  it("shows one row per workspace with the draft link, and the notes slot below", () => {
    putRun("C:/dev/alpha", run());
    putRun("C:/dev/beta", run({ dir: "C:/dev/beta", pr: null, state: "failed", message: "A likely secret.", auto: { kind: "blocked", files: [".env", "k.pem"], local: false } }));
    const html = renderToString(createElement(AutoPrStatus, { notes: createElement("p", { id: "notes" }, "review notes") }));
    expect(html).toContain(">alpha<");
    expect(html).toContain("#7");
    expect(html).toContain(">beta<");
    expect(html).toContain("A likely secret.");
    expect(html).toContain(".env");
    expect(html).toContain("k.pem");
    expect(html.indexOf("review notes")).toBeGreaterThan(html.indexOf("k.pem"));
  });

  it("shows only the last folder name of a Windows path", () => {
    const BS = String.fromCharCode(92);
    putRun("x", run({ dir: "C:" + BS + "Dev" + BS + "Work" + BS + "gamma" + BS }));
    const html = renderToString(createElement(AutoPrStatus, {}));
    expect(html).toContain(">gamma<");
    expect(html).not.toContain(">C:");
  });
  it("marks a local-only run and words every state", () => {
    putRun("C:/dev/alpha", run({ pr: null, auto: { kind: "local", files: [], local: true }, message: "Committed here." }));
    expect(renderToString(createElement(AutoPrStatus, {}))).toContain(LOCAL_ONLY_TEXT);
    expect(runLine(run({ state: "running", step: "push" }))).toBe("Pushing the branch…");
    expect(runLine(run())).toBe("Pushed; draft pull request is up to date");
    expect(runLine(run({ state: "failed", message: "Sync first" }))).toBe("Sync first");
  });
});

describe("T-654 LocalOnlyBadge", () => {
  beforeEach(() => forgetRemotes());

  it("asks once per folder and keeps the answer", async () => {
    let asked = 0;
    const ask = async () => (asked++, "none" as const);
    expect(await remoteOf("C:/a", ask)).toBe("none");
    expect(await remoteOf("C:/a", ask)).toBe("none");
    expect(asked).toBe(1);
  });

  it("forgets a failed ask so the next mount asks again", async () => {
    expect(await remoteOf("C:/b", async () => Promise.reject(new Error("no git")))).toBeNull();
    expect(await remoteOf("C:/b", async () => "github" as const)).toBe("github");
  });

  it("renders nothing until the answer is known (and the icon loads on demand)", () => {
    expect(renderToString(createElement(LocalOnlyBadge, { dir: "C:/a" }))).not.toContain("data-local-only");
  });
});
