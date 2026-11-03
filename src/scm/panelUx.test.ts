// UX audit D (ux7): the rules the Checks tab pieces share, and the small changes to each piece that can be seen without a screen.
import { describe, expect, it, vi } from "vitest";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import prStartSrc from "./PrStart.tsx?raw";
import checksSrc from "./ChecksPanel.tsx?raw";

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null }));

import CheckPane, { CheckCard } from "./CheckPane";
import { Composer } from "./CommentsPanel";
import StackMap from "./StackMap";
import { OneClickView } from "./OneClickNotice";
import { AutoPrRow, retryBlock, rowButtons } from "./AutoPrStatus";
import type { Run } from "./oneClick";
import type { CheckRef } from "./checkCard";
import { copyText, emptyBook, hideDraft, keepDraft, escapeClosesForm, openLinkFailed, replyBlock, rowBusy, rowDone, rowStart, shownDraft, stackKey, startDraft, stillCurrent, writeMayTouchDraft, type DraftBook, type PrDraft } from "./panelUx";

type Click = { onClick?: () => void; [k: string]: unknown };
function find(node: ReactNode, attr: string): ReactElement<Click> | null {
  if (Array.isArray(node)) return node.map((n) => find(n, attr)).find((n) => n !== null) ?? null;
  if (!isValidElement(node)) return null;
  const props = node.props as Click & { children?: ReactNode };
  if (attr in props) return node as ReactElement<Click>;
  return find(props.children, attr);
}

const check: CheckRef = { id: 9, name: "build", link: "https://github.com/acme/app/actions/runs/42/job/9", outcome: "failed", workflow: "CI", pr: null };
const card = (extra: Record<string, unknown> = {}) => ({ check, cwd: "C:/w", detail: null, error: null, loading: false, fixBlocker: null, busy: false, note: null, onCopy: () => {}, onFix: () => {}, onOpenFile: () => {}, ...extra });

describe("row 3: a thread with no GitHub id says why Reply is off", () => {
  it("names the reason, and says nothing for a thread that can take a reply", () => {
    expect(replyBlock({ comments: [{ db_id: null }] })).toMatch(/cannot be replied to/);
    expect(replyBlock({ comments: [] })).not.toBeNull();
    expect(replyBlock({ comments: [{ db_id: 12 }] })).toBeNull();
  });
});

describe("row 4: each card keeps its own pending state and error", () => {
  it("one card's action neither blocks nor shows its error on another", () => {
    let b = rowStart(emptyBook, "t1");
    expect(rowBusy(b, "t1")).toBe(true);
    expect(rowBusy(b, "t2")).toBe(false);
    b = rowDone(b, "t1", "403 Forbidden");
    expect(rowBusy(b, "t1")).toBe(false);
    expect(b.errors).toEqual({ t1: "403 Forbidden" });
    expect(rowStart(b, "t1").errors).toEqual({}); // trying again clears the old error
    expect(rowDone(rowStart(emptyBook, "t2"), "t2").errors).toEqual({});
  });
});

describe("row 6 and 8: the pull request draft is kept per folder, and Escape hides it without losing it", () => {
  const d = (title: string): PrDraft => ({ title, body: "", base: "main", draft: false });
  it("keeps one draft per folder", () => {
    const book: DraftBook = new Map();
    keepDraft(book, "C:/a", d("alpha"));
    keepDraft(book, "C:/b", d("beta"));
    expect(shownDraft(book, "C:/a")?.title).toBe("alpha");
    expect(shownDraft(book, "C:/b")?.title).toBe("beta");
    expect(shownDraft(book, "C:/c")).toBeNull();
    keepDraft(book, "C:/a", null);
    expect(shownDraft(book, "C:/a")).toBeNull();
    expect(shownDraft(book, "C:/b")?.title).toBe("beta");
  });
  it("Escape hides the form but a reopened one starts with the typed text", () => {
    const book: DraftBook = new Map();
    keepDraft(book, "C:/a", d("half written"));
    hideDraft(book, "C:/a");
    expect(shownDraft(book, "C:/a")).toBeNull();
    expect(startDraft(book, "C:/a", d("")).title).toBe("half written");
    expect(startDraft(book, "C:/z", d("fresh")).title).toBe("fresh");
  });
});

describe("row 9: a clipboard that fails says so", () => {
  it("answers false for no clipboard or a refused write, true for a written one", async () => {
    expect(await copyText("x", undefined)).toBe(false);
    expect(await copyText("x", { writeText: async () => Promise.reject(new Error("denied")) })).toBe(false);
    const writeText = vi.fn(async () => {});
    expect(await copyText("hello", { writeText })).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });
});

describe("row 2 and 14: the check tab can be refreshed, retried and closed by name", () => {
  it("offers Refresh when it can read again, and Retry beside a read error", () => {
    const html = renderToString(createElement(CheckCard, card({ onRefresh: () => {} })));
    expect(html).toContain("data-refresh");
    expect(html).not.toContain("data-retry");
    const bad = renderToString(createElement(CheckCard, card({ error: "gh failed", onRefresh: () => {} })));
    expect(bad).toContain("data-retry");
    expect(bad).toContain("gh failed");
  });
  it("Refresh and Retry call the reader again; a card with no reader has neither", () => {
    const onRefresh = vi.fn();
    find(CheckCard(card({ onRefresh }) as never), "data-refresh")?.props.onClick?.();
    find(CheckCard(card({ onRefresh, error: "x" }) as never), "data-retry")?.props.onClick?.();
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(renderToString(createElement(CheckCard, card({ error: "x" })))).not.toContain("data-retry");
  });
  it("Refresh waits while the card is reading", () => {
    expect(renderToString(createElement(CheckCard, card({ loading: true, onRefresh: () => {} })))).toMatch(/<button[^>]*data-refresh[^>]*disabled=""/);
  });
  it("the close button carries the check's name for a screen reader", () => {
    const html = renderToString(createElement(CheckPane, { id: 1, check, cwd: "C:/w", hidden: false, focused: true, onFocus: () => {}, onClose: () => {}, onOpenFile: () => {}, onToast: () => {} }));
    expect(html).toContain('aria-label="Close the build check tab"');
  });
});

describe("row 13: the check card and the one-click notice use classes, not inline pixel styles", () => {
  it("the card has no style attribute", () => {
    const detail = { steps: [{ number: 1, name: "Set up", status: "completed", conclusion: "success" }], annotations: [{ path: "a.rs", startLine: 1, endLine: 1, level: "failure", title: "t", message: "m" }] };
    const html = renderToString(createElement(CheckCard, card({ detail })));
    expect(html).not.toContain("style=");
    expect(html).toContain("check-card-head");
  });
  it("the notice has no style attribute and keeps its cut-to-one-line class", () => {
    const run: Run = { dir: "d", step: "text", state: "running", message: "x", pr: null, skipped: [], push: null };
    const html = renderToString(createElement(OneClickView, { run }));
    expect(html).not.toContain("style=");
    expect(html).toContain("oc-cut");
  });
});

describe("row 11: the comment box says what Enter does", () => {
  it("tells Enter from Shift+Enter", () => {
    const html = renderToString(createElement(Composer, { label: "Reply", send: async () => {}, cancel: () => {} }));
    expect(html).toContain("Enter sends");
    expect(html).toContain("Shift+Enter");
  });
});

describe("row 10: an automatic pull request line can be dismissed or tried again", () => {
  const run = (o: Partial<Run> = {}): Run => ({ dir: "C:/dev/alpha", step: "open", state: "failed", message: "Push was refused", pr: null, skipped: [], push: null, auto: { kind: "failed", files: [], local: false }, ...o });
  it("decides the buttons from the state", () => {
    expect(rowButtons(run())).toEqual({ dismiss: true, retry: true });
    expect(rowButtons(run({ state: "done" }))).toEqual({ dismiss: true, retry: false });
    expect(rowButtons(run({ state: "running" }))).toEqual({ dismiss: false, retry: false });
    expect(rowButtons(run({ neutral: true }))).toEqual({ dismiss: true, retry: false });
  });
  it("draws them", () => {
    const stopped = renderToString(createElement("ul", null, createElement(AutoPrRow, { run: run() })));
    expect(stopped).toContain("data-apr-retry");
    expect(stopped).toContain("data-apr-dismiss");
    const going = renderToString(createElement("ul", null, createElement(AutoPrRow, { run: run({ state: "running" }) })));
    expect(going).not.toContain("data-apr-dismiss");
  });
});

describe("row 5 and 15: the stack map draws, and a link that will not open has words", () => {
  it("StackMap renders its collapsed Stack section", () => {
    const html = renderToString(createElement(StackMap, { dir: "C:/w", pr: { number: 3, url: "u", title: "t", state: "OPEN", head: "feat" } as never }));
    expect(html).toContain("data-stack-map");
  });
  it("names the reason", () => {
    expect(openLinkFailed("no browser")).toBe("The page could not be opened: no browser");
  });
});

describe("review fixes: Escape, folder switches and late answers", () => {
  it("Escape closes the PR form only when it is the Escape key and no list inside is open", () => {
    expect(escapeClosesForm({ key: "Escape" }, false)).toBe(true);
    expect(escapeClosesForm({ key: "Escape" }, true)).toBe(false); // the Base list takes the key first
    expect(escapeClosesForm({ key: "Escape", defaultPrevented: true }, false)).toBe(false);
    expect(escapeClosesForm({ key: "a" }, false)).toBe(false);
  });
  it("PrStart no longer listens on the window for Escape", () => {
    const src = prStartSrc;
    expect(src).not.toContain("watchEscape");
    expect(src).toContain("onKeyDown={formKey}");
  });
  it("the stack map is keyed by folder and pull request, and a late answer for another one is dropped", () => {
    expect(stackKey("C:/a", 3)).not.toBe(stackKey("C:/b", 3));
    expect(stackKey("C:/a", 3)).not.toBe(stackKey("C:/a", 4));
    expect(stillCurrent(stackKey("C:/b", 3), stackKey("C:/a", 3))).toBe(false);
    expect(stillCurrent(stackKey("C:/a", 3), stackKey("C:/a", 3))).toBe(true);
    expect(stillCurrent(null, null)).toBe(false);
  });
  it("ChecksPanel keys StackMap and drops a rerun answer from another folder", () => {
    const src = checksSrc;
    expect(src).toContain("<StackMap key={stackKey(dir, pr.number)}");
    expect(src).toContain("stillCurrent(asking.current, at)");
  });
  it("a finished AI write touches the kept draft only in the composer session it began in", () => {
    expect(writeMayTouchDraft(4, 4)).toBe(true);
    expect(writeMayTouchDraft(4, 5)).toBe(false); // Escape closed it, or it was reopened
    const book: DraftBook = new Map();
    const d: PrDraft = { title: "t", body: "b", base: "main", draft: false };
    keepDraft(book, "C:/w", d);
    hideDraft(book, "C:/w"); // Escape
    if (writeMayTouchDraft(4, 5)) keepDraft(book, "C:/w", null);
    expect(startDraft(book, "C:/w", { ...d, title: "" }).title).toBe("t");
  });
  it("Retry on an auto-PR line follows the automatic switch", () => {
    expect(retryBlock(null, "C:/w", "github")).toMatch(/could not be read/);
    expect(retryBlock({ autoPr: { default: "off" } }, "C:/w", "github")).toMatch(/switched off/);
    expect(retryBlock({}, "C:/w", "github")).toBeNull();
    expect(retryBlock({ autoPr: { default: "off", workspaces: { "C:/w": true } } }, "C:/w", "none")).toBeNull();
  });
});
