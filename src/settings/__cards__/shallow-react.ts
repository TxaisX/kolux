// A stand-in for React's hooks so a real component function can be called with no browser: the
// state lives in numbered slots that survive between calls, exactly like one mounted component.
// Used with vi.mock("react", ...) in the card tests; it renders nothing, it returns the element tree.
import type { ReactElement, ReactNode } from "react";

export type El = { type: unknown; props: Record<string, any> };

const slots: unknown[] = [];
let cursor = 0;

function useState<S>(init: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void] {
  const i = cursor++;
  if (!(i in slots)) slots[i] = typeof init === "function" ? (init as () => S)() : init;
  return [slots[i] as S, (next) => void (slots[i] = typeof next === "function" ? (next as (p: S) => S)(slots[i] as S) : next)];
}
function useRef<T>(init: T) {
  const i = cursor++;
  if (!(i in slots)) slots[i] = { current: init };
  return slots[i] as { current: T };
}

/** The react module with its state hooks swapped in; effects never run. */
export function patchReact<T extends object>(actual: T): T {
  const hooks = { useState, useRef, useEffect: () => {}, useCallback: <F>(f: F) => f };
  const base = actual as { default?: object };
  return { ...actual, ...hooks, default: { ...base.default, ...hooks } } as T;
}

/** One mounted component: `render()` calls it again with the state it kept; `seeds` pre-fill state slots by hook order, standing in for what an effect would have loaded. */
export function mount<P>(component: (props: P) => ReactElement | null, first: P, seeds: Record<number, unknown> = {}) {
  slots.length = 0;
  for (const [i, v] of Object.entries(seeds)) slots[Number(i)] = v;
  return {
    render: (props: P = first): El => ((cursor = 0), component(props) as unknown as El),
    /** Replace a state slot, as the app would when new data arrives. */
    set: (slot: number, value: unknown) => void (slots[slot] = value),
  };
}

const kids = (node: ReactNode | El): ReactNode[] => {
  const c = (node as El)?.props?.children;
  return c === undefined ? [] : Array.isArray(c) ? c.flat(Infinity) : [c];
};
const isEl = (n: unknown): n is El => typeof n === "object" && n !== null && "props" in n;

export function findAll(node: unknown, pred: (e: El) => boolean, out: El[] = []): El[] {
  if (Array.isArray(node)) node.forEach((n) => findAll(n, pred, out));
  else if (isEl(node)) {
    if (pred(node)) out.push(node);
    kids(node).forEach((n) => findAll(n, pred, out));
  }
  return out;
}
/** A src/ui Select, found by its label: its choices are its `options` prop and a pick is `onChange(value)`. */
export const isSelect = (label: string) => (e: El) => Array.isArray(e.props.options) && e.props.label === label && typeof e.props.onChange === "function";

export const find = (node: unknown, pred: (e: El) => boolean): El => {
  const hit = findAll(node, pred)[0];
  if (!hit) throw new Error("no such element in the rendered tree");
  return hit;
};

/** The text a viewer would read inside an element. */
export function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return isEl(node) ? kids(node).map(textOf).join("") : "";
}

/** Every string anywhere in the tree: text, attributes and field values. */
export function everyString(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(everyString);
  if (!isEl(node)) return [];
  return [...Object.values(node.props).flatMap((v) => (typeof v === "function" ? [] : everyString(v)))];
}
