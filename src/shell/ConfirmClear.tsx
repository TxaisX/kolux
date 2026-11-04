// VIEW-072: a clear button for review notes that asks before it removes two or more of them.
import { useState, type ReactNode } from "react";
import Ask from "../chrome/Ask";
import { clearQuestion, needsConfirm } from "./clearNotes";

type Props = { count: number; where?: string; className?: string; title?: string; ariaLabel?: string; children: ReactNode; onConfirm: () => void };

export default function ConfirmClear({ count, where, className = "btn", title, ariaLabel, children, onConfirm }: Props) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <button className={className} title={title} aria-label={ariaLabel} onClick={() => (needsConfirm(count) ? setAsking(true) : onConfirm())}>
        {children}
      </button>
      {asking && <Ask title={clearQuestion(count, where)} body={null} confirm="Clear" cancel="Keep" onConfirm={() => (setAsking(false), onConfirm())} onCancel={() => setAsking(false)} />}
    </>
  );
}
