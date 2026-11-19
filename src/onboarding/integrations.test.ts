import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSeenReader, integrationSteps, readSeen, SEEN_FRESH_MS, taskSourceOf, type Row, type Seen } from "./integrations";

const seen = (o: Partial<Seen>): Seen => ({ account: "octo", token: "ok", tracker: "ok", ...o });
const UNSEEN: Seen = { account: null, token: "pending", tracker: "pending" };

describe("Connect integrations (ONB-018)", () => {
  it("nothing connected: review active, tasks waiting", () => {
    const s = integrationSteps(UNSEEN);
    expect([s.review, s.tasks, s.source]).toEqual(["active", "waiting", null]);
    expect(s.reviewNote).toMatch(/not connected/);
    expect(integrationSteps({ account: null, token: "ok", tracker: "ok" }).review).toBe("active");
  });
  it("connect GitHub: both steps done and GitHub named as the source", () => {
    const s = integrationSteps(seen({}));
    expect([s.review, s.tasks, s.source]).toEqual(["done", "done", "GitHub"]);
  });
  it("a cached sign-in is not connected while its check is stale, pending or failed", () => {
    for (const token of ["stale", "pending", "failed"] as const) {
      const s = integrationSteps(seen({ token }));
      expect([s.review, s.tasks]).toEqual(["active", "waiting"]);
    }
    expect(integrationSteps(seen({ token: "failed" })).reviewNote).toMatch(/did not accept/);
  });
  it("the task step completes only once review is connected and the tracker check has finished", () => {
    expect(integrationSteps(seen({ tracker: "pending" })).tasks).toBe("active");
    expect(integrationSteps(seen({ tracker: "stale" })).tasks).toBe("active");
    const failed = integrationSteps(seen({ tracker: "failed" }));
    expect([failed.review, failed.tasks]).toEqual(["done", "active"]);
    expect(failed.tasksNote).toMatch(/did not answer/);
    expect(integrationSteps(seen({ token: "failed", tracker: "ok" })).tasks).toBe("waiting");
  });
});

// A stand-in gh: a small script run as a real process, answering the two calls Kolux makes the way gh does
// (`gh config get -h github.com user`, `gh api rate_limit`). No real gh, no network, no real sign-in.
// The project has no Node type definitions, so the Node modules are loaded untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (m: string): Promise<any> => import(/* @vite-ignore */ m);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const proc = (globalThis as any).process;
const SCRIPT = [
  'const [mode, ...args] = process.argv.slice(2);',
  'if (args[0] === "config") {',
  '  if (mode === "out") { process.stderr.write("key not found"); process.exit(1); }',
  '  console.log("octo");',
  '} else if (args[0] === "api") {',
  '  if (mode === "badtoken") { process.stderr.write("HTTP 401: Bad credentials"); process.exit(1); }',
  '  if (mode === "offline") { process.stderr.write("error connecting to api.github.com"); process.exit(1); }',
  '  if (mode === "empty") { console.log(JSON.stringify({ resources: { core: {}, search: {}, graphql: {} } })); process.exit(0); }',
  // The shape gh prints for `gh api rate_limit`: a numeric limit, remaining and reset per budget.
  '  const b = (limit, remaining) => ({ limit, remaining, used: limit - remaining, reset: 1900000000 });',
  '  console.log(JSON.stringify({ resources: { core: b(5000, 4990), graphql: b(5000, 5000), search: b(30, 30) }, rate: b(5000, 4990) }));',
  '} else process.exit(2);',
  "",
].join("\n");
let dir = "";
let script = "";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cp: any;
beforeAll(async () => {
  const [fs, os, path] = await Promise.all([load("node:fs"), load("node:os"), load("node:path")]);
  cp = await load("node:child_process");
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "onb018-"));
  script = path.join(dir, "gh.mjs");
  fs.writeFileSync(script, SCRIPT);
});
afterAll(async () => (await load("node:fs")).rmSync(dir, { recursive: true, force: true }));

const standIn = (mode: "in" | "out" | "badtoken" | "offline" | "empty") => {
  const run = (args: string[]) => {
    try {
      return { ok: true as const, out: cp.execFileSync(proc.execPath, [script, mode, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(), err: "" };
    } catch (e) {
      return { ok: false as const, out: "", err: String((e as { stderr?: unknown }).stderr ?? "") };
    }
  };
  // The commands answer as Kolux's Rust side does (scm.rs gh_budget): scm_gh_account = the config user when gh
  // exits 0, else null; scm_gh_budget = a row ("REST", "Search", "GraphQL") for each budget that has a numeric
  // limit, remaining and reset, a budget missing any of them dropped, or gh's own words as the error.
  return async <T>(cmd: string): Promise<T> => {
    if (cmd === "scm_gh_account") {
      const r = run(["config", "get", "-h", "github.com", "user"]);
      return (r.ok && r.out ? r.out : null) as T;
    }
    const r = run(["api", "rate_limit"]);
    if (!r.ok) throw new Error(r.err);
    const res = JSON.parse(r.out).resources as Record<string, Record<string, unknown>>;
    const rows = ([["core", "REST"], ["search", "Search"], ["graphql", "GraphQL"]] as const).flatMap(([key, name]) => {
      const b = res[key] ?? {};
      return ["limit", "remaining", "reset"].every((f) => Number.isInteger(b[f])) ? [{ name, limit: b.limit, remaining: b.remaining, reset: b.reset }] : [];
    });
    return rows as T;
  };
};

describe("Connect integrations against a stand-in gh (ONB-018)", () => {
  it("signed in with a good token: GitHub is connected and both steps resolve", async () => {
    const s = await readSeen(standIn("in"));
    expect(s).toEqual({ account: "octo", token: "ok", tracker: "ok" });
    expect(integrationSteps(s).tasks).toBe("done");
  });
  it("signed out: nothing is connected, review is active and tasks wait", async () => {
    const s = await readSeen(standIn("out"));
    expect(s.account).toBeNull();
    const st = integrationSteps(s);
    expect([st.review, st.tasks]).toEqual(["active", "waiting"]);
  });
  it("a cached sign-in whose token gh rejects does not count as ready for review", async () => {
    const s = await readSeen(standIn("badtoken"));
    expect(s).toEqual({ account: "octo", token: "failed", tracker: "failed" });
    expect(integrationSteps(s).review).toBe("active");
  });
  it("a gh whose answer carries no numeric budgets reads as failed, as the real Rust side would drop them (FIX-1)", async () => {
    const s = await readSeen(standIn("empty"));
    expect(s).toEqual({ account: "octo", token: "failed", tracker: "failed" });
  });
  it("the Explore tasks and PR stops follow the same rule: a revoked token is not connected, an unread answer is null (FIX-1)", async () => {
    expect(taskSourceOf(await readSeen(standIn("badtoken")))).toBe(false);
    expect(taskSourceOf(await readSeen(standIn("out")))).toBe(false);
    expect(taskSourceOf(await readSeen(standIn("in")))).toBe(true);
    expect(taskSourceOf(null)).toBeNull();
    // a cached sign-in alone, or an answer from before a Re-check, is not connected
    expect(taskSourceOf({ account: "octo", token: "pending", tracker: "pending" })).toBe(false);
    expect(taskSourceOf(seen({ token: "stale", tracker: "stale" }))).toBe(false);
  });
});

describe("the sign-in check is remembered for about a minute (FIX-1)", () => {
  const rows: Row[] = [{ name: "REST" }, { name: "Search" }, { name: "GraphQL" }];
  // A counting stand-in for the two commands; `budget` decides each budget call's answer.
  const host = (budget: () => Row[] | string) => {
    const n = { account: 0, budget: 0 };
    const call = async <T>(cmd: string): Promise<T> => {
      if (cmd === "scm_gh_account") return (n.account++, "octo") as T;
      n.budget++;
      const a = budget();
      if (typeof a === "string") throw new Error(a);
      return a as T;
    };
    return { n, call };
  };
  const clock = (t = 1_000_000) => ({ now: () => t, tick: (ms: number) => void (t += ms) });
  const good: Seen = { account: "octo", token: "ok", tracker: "ok" };

  it("reads within the minute answer from memory and do not run gh again", async () => {
    const t = clock();
    const read = createSeenReader(t.now);
    const gh = host(() => rows);
    expect(await read(gh.call)).toEqual(good);
    t.tick(SEEN_FRESH_MS - 1);
    expect(await read(gh.call)).toEqual(good);
    expect(gh.n).toEqual({ account: 1, budget: 1 });
    t.tick(2);
    expect(await read(gh.call)).toEqual(good);
    expect(gh.n).toEqual({ account: 2, budget: 2 });
  });
  it("Re-check (force) always asks again", async () => {
    const read = createSeenReader(clock().now);
    const gh = host(() => rows);
    await read(gh.call);
    await read(gh.call, { force: true });
    expect(gh.n.budget).toBe(2);
  });
  it("a re-read that fails on the network keeps the last good answer", async () => {
    const t = clock();
    const read = createSeenReader(t.now);
    let said: Row[] | string = rows;
    const gh = host(() => said);
    expect(await read(gh.call)).toEqual(good);
    said = "error connecting to api.github.com";
    t.tick(SEEN_FRESH_MS + 1);
    expect(await read(gh.call)).toEqual(good);
    // with no good answer to fall back on, a network failure reads as not connected and is not remembered
    const cold = createSeenReader(t.now);
    expect(await cold(gh.call)).toEqual({ account: "octo", token: "failed", tracker: "failed" });
    said = rows;
    expect(await cold(gh.call)).toEqual(good);
  });
  it("a token gh rejects is not kept: the sign-in reads as failed at once, and signing out is seen on the next read", async () => {
    const t = clock();
    const read = createSeenReader(t.now);
    let said: Row[] | string = rows;
    const gh = host(() => said);
    await read(gh.call);
    said = "HTTP 401: Bad credentials";
    t.tick(SEEN_FRESH_MS + 1);
    expect(await read(gh.call)).toEqual({ account: "octo", token: "failed", tracker: "failed" });
    const out = async <T>(cmd: string): Promise<T> => (cmd === "scm_gh_account" ? (null as T) : Promise.reject(new Error("never asked")));
    t.tick(SEEN_FRESH_MS + 1);
    expect(await read(out)).toEqual({ account: null, token: "pending", tracker: "pending" });
  });
  it("a Re-check that fails on the network says so rather than hiding it behind the last good answer", async () => {
    const t = clock();
    const read = createSeenReader(t.now);
    let said: Row[] | string = rows;
    const gh = host(() => said);
    await read(gh.call);
    said = "error connecting to api.github.com";
    expect(await read(gh.call, { force: true })).toEqual({ account: "octo", token: "failed", tracker: "failed" });
  });

  // FIX-2 (review FIX-SOON 1): the memory holds only a good answer, so the focus, guide-close and project-add
  // re-reads see a new sign-in at once instead of waiting out the minute.
  it("a not-connected answer is not held: signing in and coming back inside the minute reads as connected", async () => {
    const t = clock();
    const read = createSeenReader(t.now);
    const gh = host(() => rows);
    let signedIn = false;
    const call = async <T>(cmd: string): Promise<T> => (cmd === "scm_gh_account" && !signedIn ? (null as T) : gh.call<T>(cmd));
    expect(await read(call)).toEqual({ account: null, token: "pending", tracker: "pending" });
    signedIn = true;
    t.tick(20_000);
    expect(await read(call)).toEqual(good);
  });
  it("a failed answer (a token gh turns down) is not held", async () => {
    const t = clock();
    const read = createSeenReader(t.now);
    let said: Row[] | string = "HTTP 401: Bad credentials";
    const gh = host(() => said);
    expect(await read(gh.call)).toEqual({ account: "octo", token: "failed", tracker: "failed" });
    said = rows;
    t.tick(10_000);
    expect(await read(gh.call)).toEqual(good);
    expect(gh.n.budget).toBe(2);
  });
  it("a token with no task search is not held either, so a later read looks again", async () => {
    const t = clock();
    const read = createSeenReader(t.now);
    let said: Row[] = [{ name: "REST" }, { name: "GraphQL" }];
    const gh = host(() => said);
    expect(await read(gh.call)).toEqual({ account: "octo", token: "ok", tracker: "failed" });
    said = rows;
    t.tick(10_000);
    expect(await read(gh.call)).toEqual(good);
  });
  it("a good answer is still held inside the minute (the saving the memory exists for)", async () => {
    const t = clock();
    const read = createSeenReader(t.now);
    const gh = host(() => rows);
    await read(gh.call);
    t.tick(20_000);
    await read(gh.call);
    expect(gh.n).toEqual({ account: 1, budget: 1 });
  });

  // FIX-2 (review FIX-SOON 2): the offline cover is for the same account only.
  it("a re-read that fails on the network after the account changed does not borrow the old account's answer", async () => {
    const t = clock();
    const read = createSeenReader(t.now);
    let account = "octo";
    let said: Row[] | string = rows;
    const call = async <T>(cmd: string): Promise<T> => {
      if (cmd === "scm_gh_account") return account as T;
      if (typeof said === "string") throw new Error(said);
      return said as T;
    };
    expect(await read(call)).toEqual(good);
    account = "hubot";
    said = "error connecting to api.github.com";
    t.tick(SEEN_FRESH_MS + 1);
    expect(await read(call)).toEqual({ account: "hubot", token: "failed", tracker: "failed" });
    // and the old account's answer is gone: coming back to it while offline has nothing to cover with
    account = "octo";
    t.tick(SEEN_FRESH_MS + 1);
    expect(await read(call)).toEqual({ account: "octo", token: "failed", tracker: "failed" });
  });

  // FIX-2 (review FIX-SOON 3): callers that ask while a read is already running share it.
  it("two reads asked together share one run of gh", async () => {
    const read = createSeenReader(clock().now);
    const n = { account: 0, budget: 0 };
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const call = async <T>(cmd: string): Promise<T> => {
      if (cmd === "scm_gh_account") return (n.account++, "octo") as T;
      n.budget++;
      await gate;
      return rows as T;
    };
    const a = read(call);
    const b = read(call);
    release();
    expect(await a).toEqual(good);
    expect(await b).toEqual(good);
    expect(n).toEqual({ account: 1, budget: 1 });
  });
  it("Re-check never joins an older read: it asks again, and the older read does not overwrite the newer answer", async () => {
    const read = createSeenReader(clock().now);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let budgets = 0;
    const call = async <T>(cmd: string): Promise<T> => {
      if (cmd === "scm_gh_account") return "octo" as T;
      // the first budget call is the older read: it waits, then finds the token turned down
      if (++budgets === 1) {
        await gate;
        throw new Error("HTTP 401: Bad credentials");
      }
      return rows as T;
    };
    const old = read(call);
    expect(await read(call, { force: true })).toEqual(good);
    release();
    // FIX-3: the older caller is answered with the newest answer too, so a screen that shows what it gets (the guide)
    // cannot flip back to "not connected" next to the Integrations panel that says connected.
    expect(await old).toEqual(good);
    expect(budgets).toBe(2);
    // the late, older answer did not replace the newer good one in memory
    expect(await read(call)).toEqual(good);
    expect(budgets).toBe(2);
  });

  // FIX-3 (review FIX-SOON 1): the guide's own read (Guides.tsx, opening and the Explore tour) is a non-forced read; Re-check
  // in the Integrations panel is forced. Whatever order the two land in, the guide shows the Re-check's answer.
  it("a non-forced read in flight, a forced Re-check lands connected, then the older one lands failed: the older caller still gets connected", async () => {
    const read = createSeenReader(clock().now);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let budgets = 0;
    const call = async <T>(cmd: string): Promise<T> => {
      if (cmd === "scm_gh_account") return "octo" as T;
      if (++budgets === 1) {
        await gate;
        throw new Error("HTTP 401: Bad credentials");
      }
      return rows as T;
    };
    const guide = read(call); // what the guide shows is whatever this resolves to
    expect(await read(call, { force: true })).toEqual(good); // the panel's Re-check lands connected
    release(); // the older read now lands, failed
    expect(await guide).toEqual(good);
  });
  it("an older read that lands before the newer Re-check has finished waits for it and takes its answer", async () => {
    const read = createSeenReader(clock().now);
    let releaseOld: () => void = () => {};
    let releaseNew: () => void = () => {};
    const gateOld = new Promise<void>((r) => (releaseOld = r));
    const gateNew = new Promise<void>((r) => (releaseNew = r));
    let budgets = 0;
    const call = async <T>(cmd: string): Promise<T> => {
      if (cmd === "scm_gh_account") return "octo" as T;
      if (++budgets === 1) {
        await gateOld;
        throw new Error("HTTP 401: Bad credentials");
      }
      await gateNew;
      return rows as T;
    };
    const guide = read(call);
    const recheck = read(call, { force: true });
    let settled = false;
    void guide.then(() => (settled = true));
    releaseOld(); // the older read lands first, failed, while the Re-check is still running
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(false);
    releaseNew();
    expect(await recheck).toEqual(good);
    expect(await guide).toEqual(good);
  });
  it("the newest read decides, however many are in flight (three reads, the last forced)", async () => {
    const read = createSeenReader(clock().now);
    const gates: (() => void)[] = [];
    let budgets = 0;
    const call = async <T>(cmd: string): Promise<T> => {
      if (cmd === "scm_gh_account") return "octo" as T;
      const mine = ++budgets;
      await new Promise<void>((r) => gates.push(r));
      if (mine < 3) throw new Error("HTTP 401: Bad credentials");
      return rows as T;
    };
    const a = read(call);
    const b = read(call, { force: true });
    const c = read(call, { force: true });
    await new Promise((r) => setTimeout(r, 0));
    gates.forEach((g) => g()); // all three land together; two are failed, the newest is good
    expect(await a).toEqual(good);
    expect(await b).toEqual(good);
    expect(await c).toEqual(good);
  });
  it("a read asked after the shared one has finished starts a new run when the answer was not good", async () => {
    const read = createSeenReader(clock().now);
    const gh = host(() => "HTTP 401: Bad credentials");
    await read(gh.call);
    await read(gh.call);
    expect(gh.n.budget).toBe(2);
  });
});
