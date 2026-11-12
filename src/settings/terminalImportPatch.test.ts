// TERM-099 (T-307): what saving a Ghostty import writes, and which theme files the page asks for.
import { describe, expect, it } from "vitest";
import { ghosttyThemeNames, importGhostty, MAX_CUSTOM, type GhosttyFileIn } from "./importSchemes";
import { ghosttyPatch, pickedSchemes, previewLines, saveChecked, warpRows } from "./terminalImportRead";

const file = (text: string): GhosttyFileIn => ({ label: "config", text });
const THEMES: Record<string, string> = { Day: "background = ffffff\nforeground = 000000\n", Night: "background = 000000\nforeground = ffffff\n" };
const read = (n: string) => THEMES[n] ?? null;
const scheme = (name: string) => ({ name, background: "#000000", foreground: "#ffffff" });

describe("ghosttyThemeNames", () => {
  it("asks for the last theme line's dark and light names only, across files", () => {
    expect(ghosttyThemeNames([file("theme = Old\n"), file("theme = light:Day,dark:Night\n")])).toEqual(["Night", "Day"]);
    expect(ghosttyThemeNames([file("theme = Night\nfont-size = 12\n")])).toEqual(["Night"]);
    expect(ghosttyThemeNames([file("font-size = 12\n"), { label: "x", skipped: "could not be read" }])).toEqual([]);
  });
});

describe("ghosttyPatch", () => {
  it("writes the settings, joins the schemes, and picks the dark one for the terminal and the light one for light mode", () => {
    const r = importGhostty([file("font-size = 14\ntheme = light:Day,dark:Night\n")], read);
    const { patch, plan } = ghosttyPatch([scheme("Mine") as never], r);
    expect(plan.added).toEqual(["Night", "Day"]);
    expect(patch).toMatchObject({ terminalFontSize: 14, terminalScheme: "custom:Night", terminalSchemeLight: "custom:Day" });
    expect((patch.terminalCustomSchemes as Array<{ name: string }>).map((s) => s.name)).toEqual(["Mine", "Night", "Day"]);
  });

  it("a scheme refused at the cap is not chosen, and settings alone leave the schemes untouched", () => {
    const full = Array.from({ length: MAX_CUSTOM }, (_, i) => scheme(`S${i}`) as never);
    const r = importGhostty([file("theme = Night\ncursor-style = bar\n")], read);
    const { patch, plan } = ghosttyPatch(full, r);
    expect(plan.refused).toEqual(["Night"]);
    expect(patch).toEqual({ terminalCursorStyle: "bar" });
    const plain = ghosttyPatch(full, importGhostty([file("font-size = 12\n")], read));
    expect(plain.patch).toEqual({ terminalFontSize: 12 });
  });
});

describe("ghosttyPatch with room for one of two schemes (FIX-2 red check found this gap)", () => {
  it("chooses the dark scheme that fit and leaves the light one that was refused unchosen", () => {
    const almost = Array.from({ length: MAX_CUSTOM - 1 }, (_, i) => scheme(`S${i}`) as never);
    const r = importGhostty([file("theme = light:Day,dark:Night\n")], read);
    const { patch, plan } = ghosttyPatch(almost, r);
    expect(plan.added).toEqual(["Night"]);
    expect(plan.refused).toEqual(["Day"]);
    expect(patch.terminalScheme).toBe("custom:Night");
    expect(patch).not.toHaveProperty("terminalSchemeLight");
    expect(previewLines(plan).join(" ")).toContain("Will not add Day");
  });
});

describe("previewLines (FIX-2: the preview is the plan that Bring in saves)", () => {
  it("says Will add for what fits, Will replace for a name already saved, and Will not add for what the cap refuses", () => {
    const r = importGhostty([file("theme = light:Day,dark:Night\n")], read);
    const roomy = ghosttyPatch([scheme("Mine") as never], r);
    expect(previewLines(roomy.plan)).toEqual(["Will add the colour schemes Night and Day."]);
    const again = ghosttyPatch([scheme("Night") as never], r);
    expect(previewLines(again.plan)).toEqual(["Will add the colour scheme Day.", "Will replace your colour scheme Night."]);
    const full = ghosttyPatch(Array.from({ length: MAX_CUSTOM }, (_, i) => scheme(`S${i}`) as never), importGhostty([file("theme = Night\n")], read));
    const lines = previewLines(full.plan);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Will not add Night");
    expect(lines[0]).toContain(String(MAX_CUSTOM));
    expect(lines.join(" ")).not.toContain("Will add");
  });
});

describe("saveChecked (FIX-2: a failed save is reported, not dropped)", () => {
  const patch = { terminalFontSize: 14, terminalCustomSchemes: [{ name: "Night", background: "#000000", foreground: "#ffffff" }] };
  it("is true when the save settles and the settings on disk hold the patch, whatever the key order inside a scheme", async () => {
    const disk = { other: 1, terminalFontSize: 14, terminalCustomSchemes: [{ foreground: "#ffffff", background: "#000000", name: "Night" }] };
    expect(await saveChecked(async () => undefined, patch, async () => disk)).toBe(true);
  });
  it("is false when the save throws, when the save quietly did nothing, and when the read-back fails", async () => {
    expect(await saveChecked(async () => Promise.reject(new Error("disk full")), patch, async () => patch)).toBe(false);
    expect(await saveChecked(async () => undefined, patch, async () => ({ terminalFontSize: 12 }))).toBe(false);
    expect(await saveChecked(async () => undefined, patch, async () => Promise.reject(new Error("gone")))).toBe(false);
  });
});

describe("Warp rows (FIX-2: the same file name in two Warp folders)", () => {
  const twin = (name: string, bg: string) => ({ file: "night.yaml", scheme: { name, background: bg, foreground: "#ffffff" } as never, left: [] as string[] });
  const scan = { themes: [twin("Night A", "#000001"), twin("Night B", "#000002")], skipped: [] };
  it("gives each row its own key and ticks only that row", () => {
    const rows = warpRows(scan);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
    expect(pickedSchemes(rows, new Set([rows[1].key])).map((s) => s.name)).toEqual(["Night B"]);
    expect(pickedSchemes(rows, new Set()).length).toBe(0);
    expect(pickedSchemes(rows, new Set(rows.map((r) => r.key))).map((s) => s.name)).toEqual(["Night A", "Night B"]);
  });
});
