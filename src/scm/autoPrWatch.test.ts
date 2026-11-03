// T-653: the automatic flow only runs if the window loads its listener. Every other test calls
// onAgentIdle directly, so this one fails if App.tsx stops loading autoPrWatch, or loads it eagerly.
import { describe, expect, it } from "vitest";
import app from "../App.tsx?raw";

describe("autoPrWatch wiring", () => {
  it("App.tsx loads the listener on demand", () => {
    expect(app).toMatch(/^\s*useEffect\(.*import\("\.\/scm\/autoPrWatch"\)/m);
  });
  it("App.tsx never imports it statically (it stays out of the first load)", () => {
    expect(app).not.toMatch(/^import\s+["']\.\/scm\/autoPrWatch["']/m);
  });
});
