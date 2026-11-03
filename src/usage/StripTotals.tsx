// Total tokens and estimated cost across the tracked providers, drawn in the layout strip beside
// Preview. It reads the saved scan (`token_usage`), so showing it never reads a log by itself; a
// rescan on the Usage page updates it within a minute.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { locale } from "../language";
import { overview, PROVIDERS, type Provider, type Row, type Usage } from "./tokens";

const REFRESH_MS = 60_000;
const compact = (n: number) => new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }).format(n);
const money = (usd: number) => new Intl.NumberFormat(locale(), { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(usd);

export default function StripTotals() {
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      invoke<Usage>("token_usage").then(
        (u) => {
          if (alive) setUsage(u);
        },
        () => {},
      );
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return usage ? <TotalsView usage={usage} /> : null;
}

/** The totals for a saved scan, or nothing when no provider is tracked or nothing was counted. */
export function TotalsView({ usage }: { usage: Usage }) {
  const sets: Partial<Record<Provider, Row[]>> = {};
  for (const p of PROVIDERS) {
    const saved = usage[p];
    if (usage.tracking[p] && saved) sets[p] = saved.rows;
  }
  const o = overview(sets);
  if (o.providers === 0 || o.tokens === 0) return null;
  const title = `${o.tokens.toLocaleString(locale())} tokens across ${o.providers} provider${o.providers === 1 ? "" : "s"}${
    o.partial ? "; some models have no published price, so the cost is a floor" : ""
  }`;
  return (
    <span className="strip-totals" role="group" title={title} aria-label={title}>
      <b>{compact(o.tokens)}</b> tok <span className="sep">/</span> <b>{o.partial ? "at least " : ""}{money(o.usd)}</b>
    </span>
  );
}
