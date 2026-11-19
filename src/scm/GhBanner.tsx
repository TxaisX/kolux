// T-176-d (GIT-028): the banner for "GitHub is unavailable" and the sign-in help. For a rate limit it reads
// the budgets (reading them costs none) to learn when GitHub resets, then asks again by itself at that time.
import "./ghBanner.css";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { bannerOf, type BudgetRow, classify, resetOf, type Trouble, waitMs } from "./ghHealth";

export { classify };

export default function GhBanner({ error, signedIn, host, onRetry, now = Date.now }: { error: string; signedIn?: boolean; host?: string; onRetry?: () => void; now?: () => number }) {
  const kind: Trouble = classify(error, signedIn);
  const [reset, setReset] = useState<number | undefined>(undefined);
  const retry = useRef(onRetry);
  retry.current = onRetry;
  useEffect(() => {
    setReset(undefined);
    if (kind !== "rate-limit") return;
    let live = true;
    invoke<BudgetRow[]>("scm_gh_budget").then(
      (rows) => live && setReset(resetOf(rows)),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [kind, error]);
  const banner = bannerOf(kind, now(), reset, host);
  const wait = waitMs(banner, now());
  useEffect(() => {
    if (wait === null || !retry.current) return;
    const id = window.setTimeout(() => retry.current?.(), wait);
    return () => window.clearTimeout(id);
  }, [wait, reset]);
  if (!banner) return null;
  return (
    <div className="note warn gh-banner" role="status" data-gh-banner={banner.kind}>
      <strong>{banner.title}</strong>
      <p>{banner.body}</p>
      {banner.steps.length > 0 && (
        <ol>
          {banner.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
