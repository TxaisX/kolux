// ONB-013: the newcomer checklist panel: first-success items in a fixed order, the next one
// highlighted with its action, and one all-done toast per profile. The sidebar mount is VIEW-114's
// (T-295); this component only needs a place to sit.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openSettings } from "../settings/pages";
import { ALL_DONE_TEXT, allDoneToast, checklistOf, ITEMS, type ItemId } from "./newcomer";
import { CHECKLIST_CHANGED } from "./firstRun";
import type { GuideRecord } from "./guide";
import "./onboarding.css";

/** What each item's button does; the checklist never ticks an item itself. Exported for its test.
 *  C16-R4-01 / C17-R5-01: Connect opens Accounts & keys (the Claude / Codex / Grok sign-in cards);
 *  Settings > Agents only installs the coding agents and cannot sign in. */
export const ACT: Record<ItemId, { label: string; run: () => void }> = {
  connect: { label: "Connect", run: () => openSettings("accounts", "connections") },
};

/** Reads the record on mount, when the window gets focus and when a milestone is written. */
export function useChecklistRecord() {
  const [rec, setRec] = useState<GuideRecord | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const read = () =>
      void invoke<GuideRecord>("guide_get").then(
        (g) => live && setRec(g),
        () => live && setRec((r) => r ?? null),
      );
    read();
    window.addEventListener("focus", read);
    window.addEventListener(CHECKLIST_CHANGED, read);
    return () => {
      live = false;
      window.removeEventListener("focus", read);
      window.removeEventListener(CHECKLIST_CHANGED, read);
    };
  }, []);
  return rec;
}

type Props = {
  /** The window's toast; without one the checklist shows the all-done line itself for a while. */
  onToast?: (text: string) => void;
  /** Compact for the sidebar (VIEW-114): the next item only, with the count. */
  compact?: boolean;
  /** The record a parent already read (the sidebar slot), used until this list's own read answers. */
  record?: GuideRecord | null;
};

/** An item's name; a ticked one also says "(done)" to screen readers, since the tick itself is
 *  hidden from them (FIX-1). */
export function ItemName({ label, ticked }: { label: string; ticked: boolean }) {
  return (
    <span className="name">
      {label}
      {ticked && <span className="onb-sr"> (done)</span>}
    </span>
  );
}

export default function Checklist({ onToast, compact = false, record }: Props) {
  const mine = useChecklistRecord();
  const rec = mine !== undefined ? mine : record;
  const tried = rec?.tried ?? [];
  const c = checklistOf(rec === undefined ? undefined : (rec?.firstRun ?? null), tried);
  const toast = useRef(allDoneToast()).current;
  const [own, setOwn] = useState<string | null>(null);
  const doneNow = c.done && !tried.includes("checklist-done");
  useEffect(() => {
    if (!toast(c, tried)) return;
    if (onToast) return onToast(ALL_DONE_TEXT);
    setOwn(ALL_DONE_TEXT);
    const t = window.setTimeout(() => setOwn(null), 5000);
    return () => window.clearTimeout(t);
  }, [doneNow]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c.show) return null;
  const count = `${c.ticked.size} of ${ITEMS.length} done`;
  const items = compact ? ITEMS.filter((i) => i.id === c.next) : ITEMS;
  return (
    <section className={`onb-checklist${compact ? " compact" : ""}`} aria-label="First steps checklist">
      <header>
        <h3>First steps</h3>
        <span className="count">{count}</span>
      </header>
      <ol>
        {items.map((i) => {
          const ticked = c.ticked.has(i.id);
          const next = i.id === c.next;
          return (
            <li key={i.id} className={`${ticked ? "done" : ""}${next ? " next" : ""}`} aria-current={next ? "step" : undefined}>
              <span className="tick" aria-hidden>
                {ticked ? "✓" : ""}
              </span>
              <span className="text">
                <ItemName label={i.label} ticked={ticked} />
                {next && <span className="about">{i.about}</span>}
              </span>
              {next && (
                <button className="btn" onClick={ACT[i.id].run}>
                  {ACT[i.id].label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {c.done && <p className="all-done">All done.</p>}
      {own && (
        <p className="toast" role="status">
          {own}
        </p>
      )}
    </section>
  );
}
