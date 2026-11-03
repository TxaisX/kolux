// SAFE-025 / STAT-056: the trust prompt's dialog and its host. The line of waiting prompts and the
// rules live in TrustPrompt.tsx, which the launch and project code load at start; this part is drawn
// only when a prompt waits, so lazy/pages loads it on demand (49-ux2: keeps it out of the first load).
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Ask from "../chrome/Ask";
import { answerFirst, follow, hostMounted, KIND_WORDS, otherDialog, shown, trustWords, waiting, type TrustAsk } from "./TrustPrompt";
import "./trust.css";

/** 49-ux2: what each answer remembers, said on the prompt. Run hooks stores this exact text (a changed script
 *  asks again); Don't run stores nothing (it asks next time); Always trusts the whole kolux.yaml. */
export const TRUST_MEMORY = "Run hooks remembers this exact script and asks again only if it changes. Don't run remembers nothing, so you are asked next time.";

/** The prompt host: mount once near the app's root. Draws the first waiting prompt. */
export default function TrustPrompt() {
  const count = useSyncExternalStore(follow, waiting, waiting);
  useEffect(() => {
    hostMounted(true);
    return () => hostMounted(false);
  }, []);
  const first = count > 0 ? shown() : undefined;
  return first ? <TrustDialog key={first.id} ask={first.ask} /> : null;
}

function TrustDialog({ ask }: { ask: TrustAsk }) {
  const [always, setAlways] = useState(false);
  const mine = useRef<HTMLDivElement>(null);
  const { title, lead } = trustWords(ask);
  // SAFE-025: another dialog replacing this one counts as Don't run; the next prompt still shows.
  useEffect(() => {
    const seen = new MutationObserver((records) => {
      if (records.some((r) => otherDialog(r.addedNodes, mine.current))) answerFirst("skip");
    });
    seen.observe(document.body, { childList: true, subtree: true });
    return () => seen.disconnect();
  }, []);
  return (
    <div ref={mine} className="trust-prompt">
      <Ask
        title={title}
        confirm="Run hooks"
        cancel="Don't run"
        body={
          <>
            <p className="trust-lead">{lead}</p>
            <pre className="trust-script" aria-label={`The ${KIND_WORDS[ask.kind] ?? "script"} that would run`}>
              {ask.script}
            </pre>
            <p className="trust-lead" role="note">
              {TRUST_MEMORY}
            </p>
            <label className="check trust-always">
              <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} /> Always trust this repository&apos;s kolux.yaml
            </label>
          </>
        }
        onConfirm={() => answerFirst(always ? "always" : "once")}
        onCancel={() => answerFirst("skip")}
      />
    </div>
  );
}
