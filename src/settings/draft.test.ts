import { expect, test } from "vitest";
import { createDraft } from "./draft";
import { delayFromText } from "./editorPrefs";

/** A timer the test steps by hand. */
function clock() {
  let n = 0;
  const jobs = new Map<number, () => void>();
  return {
    timer: { set: (fn: () => void) => (jobs.set(++n, fn), n), clear: (t: unknown) => void jobs.delete(t as number) },
    pending: () => jobs.size,
    fire() {
      const all = [...jobs.values()];
      jobs.clear();
      all.forEach((f) => f());
    },
  };
}
const gate = () => {
  let open!: () => void;
  let fail!: (e: Error) => void;
  const p = new Promise<void>((res, rej) => ((open = res), (fail = rej)));
  return { p, open, fail };
};
const flushMicro = () => new Promise((r) => setTimeout(r, 0));

test("SET-036: the text saves after a short pause, and typing again restarts the pause", async () => {
  const c = clock();
  const saved: string[] = [];
  const d = createDraft("", { save: async (t) => void saved.push(t), timer: c.timer });
  d.type("1");
  d.type("10");
  expect(c.pending()).toBe(1);
  expect(saved).toEqual([]);
  c.fire();
  await flushMicro();
  expect(saved).toEqual(["10"]);
  expect(d.state().dirty).toBe(false);
});

test("SET-036: leaving the field saves at once, no waiting for the pause", async () => {
  const c = clock();
  const saved: string[] = [];
  const d = createDraft("", { save: async (t) => void saved.push(t), timer: c.timer });
  d.type("proxy.example:8080");
  await d.leave();
  expect(saved).toEqual(["proxy.example:8080"]);
  expect(c.pending()).toBe(0);
});

test("SET-036: a keystroke made while the previous save runs is kept, and saves queue in order", async () => {
  const c = clock();
  const saved: string[] = [];
  const g = gate();
  let first = true;
  const d = createDraft("", {
    save: async (t) => {
      saved.push(t);
      if (first) {
        first = false;
        await g.p;
      }
    },
    timer: c.timer,
  });
  d.type("a");
  const leaving = d.leave();
  await flushMicro();
  expect(d.state().saving).toBe(true);
  d.type("ab"); // typed during the save
  d.type("abc");
  g.open();
  await leaving;
  expect(saved).toEqual(["a", "abc"]);
  expect(d.state()).toMatchObject({ text: "abc", saved: "abc", dirty: false, saving: false });
});

test("SET-036: a failed save keeps the typed text for another try", async () => {
  const c = clock();
  let fail = true;
  const saved: string[] = [];
  const d = createDraft("old", {
    save: async (t) => {
      if (fail) throw new Error("disk full");
      saved.push(t);
    },
    timer: c.timer,
  });
  d.type("new text");
  await d.leave();
  expect(d.state()).toMatchObject({ text: "new text", saved: "old", dirty: true, error: "disk full" });
  fail = false;
  await d.leave();
  expect(saved).toEqual(["new text"]);
  expect(d.state()).toMatchObject({ saved: "new text", error: null });
});

test("SET-036: input-method composition is never saved half-way", async () => {
  const c = clock();
  const saved: string[] = [];
  const d = createDraft("", { save: async (t) => void saved.push(t), timer: c.timer });
  d.compositionStart();
  d.type("に");
  d.type("にほ");
  expect(c.pending()).toBe(0); // no save is even scheduled while composing
  c.fire();
  await flushMicro();
  expect(saved).toEqual([]);
  d.compositionEnd("日本");
  expect(c.pending()).toBe(1);
  c.fire();
  await flushMicro();
  expect(saved).toEqual(["日本"]);
});

test("SET-036: leaving the field mid-composition saves what the field then holds", async () => {
  const saved: string[] = [];
  const d = createDraft("", { save: async (t) => void saved.push(t), timer: clock().timer });
  d.compositionStart();
  d.type("かな");
  await d.leave(); // focus loss ends the composition in the browser
  expect(saved).toEqual(["かな"]);
});

test("SET-036: an update from outside does not overwrite what is being typed, but does reach an idle field", async () => {
  const c = clock();
  const d = createDraft("one", { save: async () => {}, timer: c.timer });
  expect(d.outside("two")).toBe(true);
  expect(d.state().text).toBe("two");
  d.type("two and typing");
  expect(d.outside("three")).toBe(false);
  expect(d.state().text).toBe("two and typing");
  await d.leave();
  expect(d.outside("three")).toBe(true); // saved and idle again: the outside value is taken
  expect(d.state().text).toBe("three");
});

test("SET-036: an outside update during a save is ignored too, then the saved text stands", async () => {
  const c = clock();
  const g = gate();
  const d = createDraft("", { save: () => g.p, timer: c.timer });
  d.type("mine");
  const leaving = d.leave();
  await flushMicro();
  expect(d.outside("theirs")).toBe(false);
  g.open();
  await leaving;
  expect(d.state().text).toBe("mine");
});

test("SET-036: closing the window flushes the pending text; Escape puts the stored text back", async () => {
  const c = clock();
  const saved: string[] = [];
  const d = createDraft("kept", { save: async (t) => void saved.push(t), timer: c.timer });
  d.type("typed just now");
  await d.flush();
  expect(saved).toEqual(["typed just now"]);
  d.type("oops");
  d.discard();
  expect(d.state()).toMatchObject({ text: "typed just now", dirty: false });
  expect(c.pending()).toBe(0);
});
test("SET-036: a save that resolves to the stored text puts that text in the box (typed 5, stored 200)", async () => {
  const d = createDraft("1000", { save: async (t) => String(Math.max(200, Number(t))), timer: clock().timer });
  d.type("5");
  await d.leave();
  expect(d.state()).toMatchObject({ text: "200", saved: "200", dirty: false, error: null });
});

test("SET-036: a keystroke made while a clamped save runs is kept, not overwritten by the stored text", async () => {
  const g = gate();
  const seen: string[] = [];
  const d = createDraft("1000", {
    save: async (t) => {
      seen.push(t);
      if (seen.length === 1) await g.p;
      return String(Math.max(200, Number(t)));
    },
    timer: clock().timer,
  });
  d.type("5");
  const done = d.leave();
  await flushMicro();
  d.type("3000");
  g.open();
  await done;
  expect(seen).toEqual(["5", "3000"]);
  expect(d.state()).toMatchObject({ text: "3000", saved: "3000", dirty: false });
});

test("SET-036: an empty or unreadable delay fails to save and discard puts the saved delay back", async () => {
  const saved = 1000;
  const d = createDraft(String(saved), {
    save: async (t) => {
      const v = delayFromText(t);
      if (v === null) throw new Error("not saved");
      return String(v);
    },
    timer: clock().timer,
  });
  d.type("");
  await d.leave();
  expect(d.state()).toMatchObject({ text: "", dirty: true, error: "not saved" });
  expect(delayFromText(d.state().text)).toBeNull();
  d.discard();
  expect(d.state()).toMatchObject({ text: "1000", dirty: false, error: null });
});

// A number box like the auto-save delay: 200..10000, shown in normal form.
const delayDraft = (stored: string, c: ReturnType<typeof clock>, seen: string[], block?: () => Promise<void>) =>
  createDraft(stored, {
    save: async (t) => {
      seen.push(t);
      await block?.();
      return String(delayFromText(t));
    },
    ready: (t) => String(delayFromText(t)) === t && delayFromText(t) !== null,
    timer: c.timer,
  });

test("SET-036: a pause mid-typing leaves the box alone: 1, pause, then 500 gives 1500, and 5, pause, 00 gives 500", async () => {
  const c = clock();
  const seen: string[] = [];
  const d = delayDraft("1000", c, seen);
  d.type("1");
  expect(c.pending()).toBe(0); // "1" is below the range: no pause save is even scheduled
  c.fire();
  await flushMicro();
  expect(seen).toEqual([]);
  expect(d.state().text).toBe("1");
  d.type("1500");
  c.fire();
  await flushMicro();
  expect(seen).toEqual(["1500"]);
  expect(d.state()).toMatchObject({ text: "1500", saved: "1500", dirty: false });
  d.type("5"); // select all, type 5, pause
  c.fire();
  await flushMicro();
  expect(d.state().text).toBe("5");
  d.type("500");
  c.fire();
  await flushMicro();
  expect(seen).toEqual(["1500", "500"]);
  expect(d.state().text).toBe("500");
});

test("SET-036: only leaving clamps: 5 shows 200, 20000 shows 10000, and the same text left by closing the window is stored too", async () => {
  const c = clock();
  const seen: string[] = [];
  const d = delayDraft("1000", c, seen);
  d.type("5");
  c.fire();
  await flushMicro();
  expect(seen).toEqual([]);
  await d.leave();
  expect(seen).toEqual(["5"]);
  expect(d.state()).toMatchObject({ text: "200", saved: "200", dirty: false, error: null });
  d.type("20000");
  await d.flush(); // the window closes
  expect(seen).toEqual(["5", "20000"]);
  expect(d.state().text).toBe("10000");
});

test("SET-036: an emptied box is not saved by the pause, so retyping never passes through a stored value", async () => {
  const c = clock();
  const seen: string[] = [];
  const d = createDraft("10", {
    save: async (t) => void seen.push(t),
    ready: (t) => String(Math.max(0, Math.floor(Number(t)) || 0)) === t, // the quiet-alert minutes
    timer: c.timer,
  });
  d.type("");
  expect(c.pending()).toBe(0);
  d.type("3");
  c.fire();
  await flushMicro();
  expect(seen).toEqual(["3"]);
});

test("SET-036: leaving while a pause save runs still saves the text that is not ready (and clamps it)", async () => {
  const c = clock();
  const g = gate();
  const seen: string[] = [];
  const d = delayDraft("1000", c, seen, () => (seen.length === 1 ? g.p : Promise.resolve()));
  d.type("1500");
  c.fire();
  await flushMicro();
  expect(d.state().saving).toBe(true);
  d.type("5"); // typed during the save
  const leaving = d.leave();
  g.open();
  await leaving;
  expect(seen).toEqual(["1500", "5"]);
  expect(d.state()).toMatchObject({ text: "200", saved: "200", dirty: false, saving: false });
});

test("SET-036: a pause save that is running does not go on to save a text that is not ready", async () => {
  const c = clock();
  const g = gate();
  const seen: string[] = [];
  const d = delayDraft("1000", c, seen, () => (seen.length === 1 ? g.p : Promise.resolve()));
  d.type("1500");
  c.fire();
  await flushMicro();
  d.type("5"); // typed during the save, the box stays as typed
  g.open();
  await flushMicro();
  expect(seen).toEqual(["1500"]);
  expect(d.state()).toMatchObject({ text: "5", saved: "1500", dirty: true });
});

test("SET-036: typing again after a leave while its save runs goes back to pause rules", async () => {
  const c = clock();
  const g = gate();
  const seen: string[] = [];
  const d = delayDraft("1000", c, seen, () => (seen.length === 1 ? g.p : Promise.resolve()));
  d.type("1500");
  const leaving = d.leave(); // left the box, save in flight
  await flushMicro();
  d.type("30"); // clicked back in and typing, not ready yet
  g.open();
  await leaving;
  expect(seen).toEqual(["1500"]);
  expect(d.state()).toMatchObject({ text: "30", saved: "1500", dirty: true });
});
