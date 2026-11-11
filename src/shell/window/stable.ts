// PKG-2 (narrow the redraw): the window renders as one piece, so every state change used to redraw every
// pane. These helpers let a heavy child (a terminal pane, the project list) skip a render when nothing it
// shows has changed: callers with a fixed identity that always run the newest render's function, and
// comparators that name every prop and how it is compared, so a prop nobody listed always redraws.
//
// The rule that keeps this honest: a function the child CALLS WHILE IT RENDERS (a selector) must not get a
// fixed identity unless everything it reads is a compared prop too, or the child would draw old data. The
// callers made here are only for functions a child runs from an event handler or an effect.
import { useRef } from "react";

type Fn = (...args: never[]) => unknown;

/** The speed harness's render count: one property read unless `window.__kxRenders` is set to an object. */
export function tally(name: string): void {
  const t = (globalThis as { __kxRenders?: Record<string, number> }).__kxRenders;
  if (t && typeof t === "object") t[name] = (t[name] ?? 0) + 1;
}

/** One caller per name, made on first use and kept: it runs `latest()[name]` at call time. */
export function callers<T extends object>(latest: () => T): Callers<T> {
  const made = new Map<PropertyKey, Fn>();
  return new Proxy({} as Callers<T>, {
    get(_, name) {
      let f = made.get(name);
      if (!f) {
        f = (...args: never[]) => (latest()[name as keyof T] as Fn)(...args);
        made.set(name, f);
      }
      return f;
    },
  });
}

/** The function fields of T, as callers with a fixed identity. */
export type Callers<T> = { readonly [K in keyof T as T[K] extends Fn ? K : never]: T[K] };

/** This render's functions behind callers that keep one identity for the component's life. The object handed
 *  in must have the same keys every render. The ref is written during render: the same keys and the same
 *  closures over this render's values, so a StrictMode second render writes an equal set. */
export function useStableFns<T extends Record<string, Fn>>(fns: T): T {
  const latest = useRef(fns);
  latest.current = fns;
  const made = useRef<Callers<T> | null>(null);
  if (made.current === null) made.current = callers(() => latest.current);
  const out = {} as Record<string, Fn>;
  for (const k of Object.keys(fns)) out[k] = (made.current as Record<string, Fn>)[k];
  return out as T;
}

/** Plain data compared by value: arrays and plain objects field by field, anything else (functions, class
 *  instances, Sets, Maps) by identity. For the small readings a pane shows (a chip, a meter, a tab list). */
export function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameData(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b) || !plain(a) || !plain(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!sameData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

const plain = (o: object) => {
  const p = Object.getPrototypeOf(o);
  return p === Object.prototype || p === null;
};

/** How one prop is compared: `same` by identity (Object.is), `data` by value (sameData), or a function. */
export type Rule<V> = "same" | "data" | ((a: NonNullable<V>, b: NonNullable<V>) => boolean);

/** A memo comparator that names every prop. A prop the rules do not list counts as changed, so a prop added
 *  later redraws until someone decides how to compare it. Functions are compared by identity like any other
 *  value: the saving comes from the caller handing over callers with a fixed identity, never from ignoring them. */
export function sameProps<P extends object>(rules: { readonly [K in keyof P]-?: Rule<P[K]> }): (a: Readonly<P>, b: Readonly<P>) => boolean {
  const table = rules as Record<string, Rule<unknown>>;
  return (a, b) => {
    const pa = a as Record<string, unknown>;
    const pb = b as Record<string, unknown>;
    for (const k of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
      const rule = table[k];
      if (rule === undefined) return false;
      const x = pa[k];
      const y = pb[k];
      if (rule === "same" ? !Object.is(x, y) : rule === "data" ? !sameData(x, y) : !(Object.is(x, y) || (x != null && y != null && rule(x, y)))) return false;
    }
    return true;
  };
}
