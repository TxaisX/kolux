// A click-through for tests, with no browser: the project has no DOM test environment, so this walks
// the element tree a component returns (calling function components down to plain elements) and fires
// the handlers the user's click or edit would reach. It is a test helper only (T-266 FIX-1).
// LIMITS (FIX-2): it calls function components directly, so it breaks on any component that uses a hook;
// click and change do not bubble (only the control hit runs its handler); the event it passes is just
// { target, currentTarget } with no preventDefault or stopPropagation, so a handler that calls them throws.
// "Fires the handlers a click would reach" therefore holds for leaf controls only, and a panel with state
// (ProjectsPanel) is still proven live, not here.
import { isValidElement, type ReactElement, type ReactNode } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Host = { type: string; props: Record<string, any> };

/** Every plain element a node draws, in document order. Components must not use hooks. */
export function hosts(node: ReactNode, out: Host[] = []): Host[] {
  if (Array.isArray(node)) {
    node.forEach((n) => hosts(n, out));
    return out;
  }
  if (!isValidElement(node)) return out;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = node as ReactElement<any>;
  if (typeof el.type === "function") return hosts((el.type as (p: unknown) => ReactNode)(el.props), out);
  if (typeof el.type === "string") out.push({ type: el.type, props: el.props });
  hosts(el.props?.children, out);
  return out;
}

/** The text a node draws, tags dropped. */
export function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (!isValidElement(node)) return "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = node as ReactElement<any>;
  if (typeof el.type === "function") return textOf((el.type as (p: unknown) => ReactNode)(el.props));
  return textOf(el.props?.children);
}

export const byLabel = (nodes: Host[], label: string): Host => {
  const hit = nodes.find((h) => h.props["aria-label"] === label);
  if (!hit) throw new Error(`no control labelled "${label}"; there are: ${nodes.map((h) => h.props["aria-label"]).filter(Boolean).join(", ")}`);
  return hit;
};

export const byTag = (nodes: Host[], type: string): Host[] => nodes.filter((h) => h.type === type);

export const click = (h: Host) => {
  if (h.props.disabled) return;
  h.props.onClick?.({ target: h, currentTarget: h });
};

/** A tick-box change (or any input change): the handler sees the new checked state or value. */
export const change = (h: Host, v: { checked?: boolean; value?: string }) => {
  if (h.props.disabled) return;
  h.props.onChange?.({ target: v, currentTarget: v });
};
