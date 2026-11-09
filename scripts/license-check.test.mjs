// T-589 (X-proc.14, L4-web-js-toolchain.4): a package whose package.json names no licence is read from
// the licence file it ships, so the gate gives the same answer whichever pnpm lists the packages.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EXCEPTIONS, failures, licenceFromFile } from "./license-check.mjs";

const MIT = "The MIT License (MIT)\n\nCopyright (c) 2019-present Someone\n\nPermission is hereby granted, free of charge, to any person obtaining a copy";
const pkg = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "krs-licence-"));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
};

describe("JS licence gate", () => {
  it("reads the licence from a lowercase `license` file when package.json has none (khroma)", () => {
    expect(licenceFromFile(pkg({ "package.json": '{"name":"khroma"}', license: MIT }))).toBe("MIT");
    expect(licenceFromFile(pkg({ "LICENSE.md": "Apache License\nVersion 2.0, January 2004" }))).toBe("Apache-2.0");
    expect(licenceFromFile(pkg({ "readme.md": "no licence here" }))).toBeNull();
  });

  it("lets an Unknown package through only when its own licence file is an allowed licence", () => {
    const listed = (dir) => ({ MIT: [{ name: "fine", versions: ["1.0.0"], paths: [] }], Unknown: [{ name: "khroma", versions: ["2.1.0"], paths: [dir] }] });
    expect(failures(listed(pkg({ license: MIT })))).toEqual([]);
    expect(failures(listed(pkg({ LICENSE: "All rights reserved." })))).toEqual(["khroma@2.1.0 · Unknown"]);
    expect(failures({ "GPL-3.0": [{ name: "copyleft", versions: ["1.0.0"], paths: [pkg({ license: MIT })] }] })).toEqual(["copyleft@1.0.0 · GPL-3.0"]);
  });

  it("takes elkjs under its elected EPL-2.0 and nothing else under the same expression", () => {
    const both = "EPL-2.0 OR GPL-3.0-or-later";
    expect(EXCEPTIONS.elkjs.elected).toBe("EPL-2.0");
    expect(failures({ [both]: [{ name: "elkjs", versions: ["0.12.1"], paths: [] }] })).toEqual([]);
    expect(failures({ [both]: [{ name: "other-lib", versions: ["1.0.0"], paths: [] }] })).toEqual(["other-lib@1.0.0 · " + both]);
    expect(failures({ "GPL-3.0-or-later": [{ name: "elkjs", versions: ["0.13.0"], paths: [] }] })).toEqual(["elkjs@0.13.0 · GPL-3.0-or-later"]);
  });
});
