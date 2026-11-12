// USAGE-015: estimated cost from each model's published prices, in dollars per million tokens.
// Sources, read 2026-10-12: Anthropic's public pricing page (platform.claude.com/docs/en/about-claude/pricing)
// and OpenAI's (developers.openai.com/api/docs/pricing, Standard tier). Claude cache writes are
// priced from the base input price: 5-minute writes at 1.25x, 1-hour writes at 2x. A model Kolux
// has no price for gets no cost and is listed, so the sum reads as partial instead of guessed.
// ponytail: one dated entry per model today; a price change adds a second entry with its `from` day.
import type { Provider, Row } from "./tokens";

/** Base input, cache hit and output prices; `long` applies from prompt-size band `over` up. */
export type Rates = { input: number; hit: number; output: number };
export type Entry = { provider: Provider; id: string; from: string; rates: Rates; long?: { over: number; rates: Rates } };

const r = (input: number, hit: number, output: number): Rates => ({ input, hit, output });
const claude = (id: string, rates: Rates, long?: Entry["long"]): Entry => ({ provider: "claude", id, from: "", rates, long });
const openai = (id: string, rates: Rates, long?: Rates): Entry => ({ provider: "codex", id, from: "", rates, long: long && { over: 3, rates: long } });

// Prompt-size bands from the log scan: 0 up to 100k, 1 up to 200k, 2 up to 272k, 3 over 272k.
export const TABLE: Entry[] = [
  claude("claude-fable-5-1", r(10, 0.25, 50)),
  claude("claude-mythos-5-1", r(10, 0.25, 50)),
  claude("claude-fable-5", r(10, 1, 50)),
  claude("claude-mythos-5", r(10, 1, 50)),
  claude("claude-opus-5-5", r(4, 0.2, 20)),
  claude("claude-opus-5", r(5, 0.5, 25)),
  claude("claude-opus-4-8", r(5, 0.5, 25)),
  claude("claude-opus-4-7", r(5, 0.5, 25)),
  claude("claude-opus-4-6", r(5, 0.5, 25)),
  claude("claude-opus-4-5", r(5, 0.5, 25)),
  claude("claude-opus-4-1", r(15, 1.5, 75)),
  claude("claude-opus-4", r(15, 1.5, 75)),
  claude("claude-sonnet-5-5", r(2, 0.1, 10)),
  claude("claude-sonnet-5", r(2, 0.2, 10)),
  claude("claude-sonnet-4-6", r(3, 0.3, 15)),
  claude("claude-sonnet-4-5", r(3, 0.3, 15)),
  claude("claude-sonnet-4", r(3, 0.3, 15)),
  claude("claude-haiku-5-5", r(0.1, 0.01, 0.5), { over: 1, rates: r(0.5, 0.05, 2.5) }),
  claude("claude-haiku-4-5", r(1, 0.1, 5)),
  claude("claude-3-5-haiku", r(0.8, 0.08, 4)),
  openai("gpt-6-astra", r(10, 1, 50), r(20, 2, 75)),
  openai("gpt-6.1-sol", r(2, 0.1, 10), r(4, 0.2, 15)),
  openai("gpt-6-sol", r(2, 0.2, 10), r(4, 0.4, 15)),
  openai("gpt-6-luna", r(0.1, 0.01, 0.5), r(0.2, 0.02, 0.75)),
  openai("gpt-5.6-sol", r(4, 0.4, 20), r(8, 0.8, 30)),
  openai("gpt-5.6-terra", r(2, 0.2, 12), r(4, 0.4, 18)),
  openai("gpt-5.6-luna", r(0.2, 0.02, 1.2), r(0.4, 0.04, 1.8)),
  openai("gpt-5.5", r(5, 0.5, 30), r(10, 1, 45)),
  openai("gpt-5.5-pro", r(30, 30, 180), r(60, 60, 270)),
  openai("gpt-5.4", r(2.5, 0.25, 15), r(5, 0.5, 22.5)),
  openai("gpt-5.4-pro", r(30, 30, 180), r(60, 60, 270)),
  openai("gpt-5.4-mini", r(0.75, 0.075, 4.5)),
  openai("gpt-5.4-nano", r(0.2, 0.02, 1.25)),
  openai("gpt-5.3-codex", r(1.75, 0.175, 14)),
  openai("gpt-5.2", r(1.75, 0.175, 14)),
  openai("gpt-5.1", r(1.25, 0.125, 10)),
  openai("gpt-5", r(1.25, 0.125, 10)),
  openai("gpt-5-mini", r(0.25, 0.025, 2)),
  openai("gpt-5-nano", r(0.05, 0.005, 0.4)),
  openai("o3", r(2, 0.5, 8)),
  openai("o4-mini", r(1.1, 0.275, 4.4)),
  openai("o3-mini", r(1.1, 0.55, 4.4)),
  openai("gpt-4.1", r(2, 0.5, 8)),
];

const CLAUDE_TIERS = "opus|sonnet|haiku|fable|mythos";
const CLAUDE_VER_RE = new RegExp(`^claude-(${CLAUDE_TIERS})-(\\d+)(?:-(\\d{1,2}))?$`);
const CLAUDE_REV_RE = new RegExp(`^claude-(\\d+)(?:-(\\d))?-(${CLAUDE_TIERS})$`);
const GPT_RE = /^gpt-(\d+)(?:\.(\d+))?(?:-([a-z]+))?$/;
const O_RE = /^o(\d+)(?:-([a-z]+))?$/;
const CLAUDE_ALIAS_RE = new RegExp(`^(?:claude-)?(${CLAUDE_TIERS})$`);

/** Drops what never changes the price: a provider prefix, a context tag, a release date, an effort ending. */
function base(model: string): string {
  return model
    .toLowerCase()
    .trim()
    .replace(/^.*\//, "")
    .replace(/\[[^\]]*\]$/, "")
    .replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, "")
    .replace(/-(minimal|none|low|medium|high|xhigh|max)$/, "");
}

/** A model's family and version, for releases the table does not list. */
function family(id: string): { family: string; ver: number[] } | null {
  let m = id.match(CLAUDE_VER_RE);
  if (m) return { family: m[1], ver: [+m[2], +(m[3] ?? 0)] };
  m = id.match(CLAUDE_REV_RE);
  if (m) return { family: m[3], ver: [+m[1], +(m[2] ?? 0)] };
  m = id.match(GPT_RE);
  if (m) return { family: `gpt-${m[3] ?? ""}`, ver: [+m[1], +(m[2] ?? 0)] };
  m = id.match(O_RE);
  if (m) return { family: `o-${m[2] ?? ""}`, ver: [+m[1], 0] };
  return null;
}

const cmp = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1];

type Hit = { id: string; inferred: boolean };
type ProviderIndex = {
  byId: Map<string, Entry[]>;
  byFamily: Map<string, Array<{ id: string; ver: number[] }>>;
  cache: Map<string, Hit | null>;
};

const tableIndex = new WeakMap<Entry[], Map<Provider, ProviderIndex>>();

function indexOf(table: Entry[], provider: Provider): ProviderIndex {
  let byProvider = tableIndex.get(table);
  if (!byProvider) {
    byProvider = new Map();
    tableIndex.set(table, byProvider);
  }
  let idx = byProvider.get(provider);
  if (idx) return idx;

  const byId = new Map<string, Entry[]>();
  const byFamily = new Map<string, Array<{ id: string; ver: number[] }>>();
  for (const e of table) {
    if (e.provider !== provider) continue;
    let entries = byId.get(e.id);
    if (!entries) {
      entries = [];
      byId.set(e.id, entries);
      const f = family(e.id);
      if (f) {
        let list = byFamily.get(f.family);
        if (!list) {
          list = [];
          byFamily.set(f.family, list);
        }
        list.push({ id: e.id, ver: f.ver });
      }
    }
    entries.push(e);
  }
  for (const entries of byId.values()) {
    if (entries.length > 1) entries.sort((a, b) => b.from.localeCompare(a.from));
  }
  for (const list of byFamily.values()) {
    if (list.length > 1) list.sort((a, b) => cmp(b.ver, a.ver));
  }

  idx = { byId, byFamily, cache: new Map() };
  byProvider.set(provider, idx);
  return idx;
}

/** The table id a model is priced as, and whether that was a guess. */
function resolve(idx: ProviderIndex, model: string): Hit | null {
  const cached = idx.cache.get(model);
  if (cached !== undefined) return cached;

  let hit: Hit | null = null;
  const exact = base(model);
  if (idx.byId.has(exact)) {
    hit = { id: exact, inferred: false };
  } else {
    // Variants (codex, max) are reduced to the base model; a bare alias takes its tier's newest price.
    const s = exact.replace(/-codex(?=-|$)/, "").replace(/-max(?=-|$)/, "");
    if (idx.byId.has(s)) {
      hit = { id: s, inferred: true };
    } else {
      const alias = s.match(CLAUDE_ALIAS_RE);
      const want = alias ? { family: alias[1], ver: [Infinity, Infinity] } : family(s);
      if (want) {
        // The nearest known release at or below this one: a newer point release takes its family's
        // current price, an unknown older one never borrows a newer price.
        const list = idx.byFamily.get(want.family);
        const found = list?.find((k) => cmp(k.ver, want.ver) <= 0);
        if (found) hit = { id: found.id, inferred: true };
      }
    }
  }

  idx.cache.set(model, hit);
  return hit;
}

/** The price for a model on a local day, or null when Kolux has none. */
export function priceOf(provider: Provider, model: string, day: string, table: Entry[] = TABLE): (Entry & { inferred: boolean }) | null {
  const idx = indexOf(table, provider);
  const hit = resolve(idx, model);
  if (!hit) return null;
  const entry = idx.byId.get(hit.id)?.find((e) => e.from <= day);
  return entry ? { ...entry, inferred: hit.inferred } : null;
}

export type Cost = { usd: number; priced: boolean; inferred: boolean };

/** One row's cost at the price of its own day and prompt size. */
export function costOf(provider: Provider, row: Row, table: Entry[] = TABLE): Cost {
  const p = priceOf(provider, row.model, row.day, table);
  if (!p) return { usd: 0, priced: false, inferred: false };
  const k = p.long && row.band >= p.long.over ? p.long.rates : p.rates;
  let usd = row.input * k.input + row.cacheRead * k.hit + row.output * k.output;
  if (provider === "claude") {
    const h = Math.min(row.cacheWrite1h, row.cacheWrite);
    usd += (row.cacheWrite - h) * k.input * 1.25 + h * k.input * 2;
  }
  return { usd: usd / 1_000_000, priced: true, inferred: p.inferred };
}

export type Estimate = { usd: number; unpriced: string[] };

/** The dollar estimate for one provider's rows; models with no known price are left out and listed. */
export function estimate(provider: Provider, rows: Row[], table: Entry[] = TABLE): Estimate {
  let usd = 0;
  const unpriced = new Set<string>();
  for (const row of rows) {
    const c = costOf(provider, row, table);
    if (c.priced) usd += c.usd;
    else if (row.input + row.cacheRead + row.cacheWrite + row.output > 0) unpriced.add(row.model);
  }
  return { usd, unpriced: [...unpriced].sort() };
}
