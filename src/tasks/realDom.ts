// The fake DOM's helpers (fakeDom.ts) on a real one, for a test that opens a Base UI popup (src/ui): Base UI needs
// focus, querySelector, matches and layout calls the fake DOM does not have. The test starts with
// `// @vitest-environment happy-dom` (DT-C280) and imports from here instead of fakeDom.ts; the rest of it reads the same.
// Differences a converted test may meet: events are real (a click bubbles from its target, so the container argument
// only names the page), `mount` hands back document.body as the container (a popup is drawn in a portal on the body,
// outside the React root, and a search from the container must find it), and `attrs` is read from the element's
// attributes (a getter added for these tests, never present in the app).
import { act, type ReactElement } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** A real element or document, typed as loosely as the fake DOM's nodes (tests read their parents, children, listeners
 *  and `attrs` without casts). */
export type FakeNode = Any;
export type FakeDocument = Any;
/** The element class, where a fake-DOM test patches FakeNode.prototype (a layout stub) or reads it for instanceof. */
// eslint-disable-next-line @typescript-eslint/no-redeclare
export const FakeNode = HTMLElement as unknown as { new (): HTMLElement; prototype: Any };

let attrsAdded = false;
function addAttrs() {
  if (attrsAdded) return;
  attrsAdded = true;
  Object.defineProperty(Element.prototype, "attrs", {
    configurable: true,
    get(this: Element) {
      return Object.fromEntries([...this.attributes].map((a) => [a.name, a.value]));
    },
  });
}

/** Every element under `root` (root included) that `pred` accepts, in document order. */
export function find(root: Node, pred: (n: FakeNode) => boolean): FakeNode[] {
  const out: FakeNode[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 1 && pred(n as FakeNode)) out.push(n as FakeNode);
    n.childNodes.forEach(walk);
  };
  walk(root);
  return out;
}

const text = (n: Node) => n.textContent ?? "";
export const byText = (root: Node, tag: string, t: string) => find(root, (n) => n.localName === tag && text(n).trim() === t);
export const withText = (root: Node, tag: string, t: string) => find(root, (n) => n.localName === tag && text(n).includes(t));
export const byLabel = (root: Node, tag: string, label: string) => find(root, (n) => n.localName === tag && n.getAttribute("aria-label") === label);

/** A fake-DOM test stubs a page property now and then (`doc.visibilityState = "visible"`, `win.localStorage = ...`); on a
 *  real window most of those are getters. Writes through these handles become own properties of the real object. */
function writable<T extends object>(real: T): T {
  return new Proxy(real, {
    get: (t, k) => {
      const v = Reflect.get(t, k, t);
      return typeof v === "function" && !/^[A-Z]/.test(String(k)) ? v.bind(t) : v;
    },
    set: (t, k, v) => {
      try {
        if (Reflect.set(t, k, v, t)) return true;
      } catch {
        // a getter-only property: shadow it below
      }
      Object.defineProperty(t, k, { value: v, writable: true, configurable: true });
      return true;
    },
    defineProperty: (t, k, d) => Reflect.defineProperty(t, k, { ...d, configurable: true }),
  });
}

/** The fake DOM keeps each node's listeners in `listeners[type]`, and some tests read or call them straight; so does
 *  this, for every listener added after `installDom`. */
type Kept = Record<string, { fn: (e: unknown) => void; capture: boolean }[]>;
const kept = new WeakMap<object, Kept>();
const keptOf = (t: object): Kept => {
  let k = kept.get(t);
  if (!k) kept.set(t, (k = {}));
  return k;
};
let listenersKept = false;
function keepListeners() {
  if (listenersKept) return;
  listenersKept = true;
  // the prototype that owns addEventListener for the page's nodes and window (happy-dom's own EventTarget)
  const owner = (o: object): Any => (Object.prototype.hasOwnProperty.call(o, "addEventListener") ? o : owner(Object.getPrototypeOf(o)));
  for (const proto of new Set([owner(document), owner(window)])) keepOn(proto);
}
function keepOn(proto: Any) {
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;
  Object.defineProperty(proto, "listeners", { configurable: true, get(this: object) { return keptOf(this); } });
  proto.addEventListener = function (this: EventTarget, type: string, fn: Any, opts?: Any) {
    if (typeof fn === "function") (keptOf(this)[type] ??= []).push({ fn, capture: typeof opts === "object" ? !!opts?.capture : !!opts });
    return add.call(this, type, fn, opts);
  };
  proto.removeEventListener = function (this: EventTarget, type: string, fn: Any, opts?: Any) {
    const k = keptOf(this);
    if (k[type]) k[type] = k[type].filter((l) => l.fn !== fn);
    return remove.call(this, type, fn, opts);
  };
}

/** The page: happy-dom's own document and window (fresh body, cleared storage), set up for React's act(). The `doc`
 *  and `win` handed back take a test's stubs (see `writable`); `store` is the fake DOM's storage map, read by the
 *  window's localStorage. */
export function installDom() {
  addAttrs();
  keepListeners();
  document.body.innerHTML = "";
  (globalThis as Any).IS_REACT_ACT_ENVIRONMENT = true;
  const store = new Map<string, string>();
  const win = writable(window as Any);
  win.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k), clear: () => store.clear() };
  return { doc: writable(document) as unknown as FakeDocument, win, store };
}

const MOUSE = new Set(["click", "mousedown", "mouseup", "dblclick", "contextmenu", "mouseover", "mouseout", "mouseenter", "mouseleave"]);
const POINTER = new Set(["pointerdown", "pointerup", "pointermove", "pointerover", "pointerout", "pointerenter", "pointerleave"]);
const KEY = new Set(["keydown", "keyup", "keypress"]);

/** Sends `type` to `target` the way the browser does (it bubbles from the target). `container` is not used: on a real
 *  DOM an event reaches every listener on its path, a popup's portal included. */
export async function fire(_container: Node, type: string, target: Node, extra: Record<string, unknown> = {}) {
  const init = { bubbles: true, cancelable: true, composed: true, ...extra };
  const ev = KEY.has(type) ? new KeyboardEvent(type, init) : POINTER.has(type) ? new PointerEvent(type, init) : MOUSE.has(type) ? new MouseEvent(type, init) : new Event(type, init);
  for (const [k, v] of Object.entries(extra)) {
    const own = (ev as Any)[k];
    // a test's own stopPropagation or preventDefault (to see whether it was called) runs after the real one
    if (typeof own === "function" && typeof v === "function")
      Object.defineProperty(ev, k, {
        value: (...a: unknown[]) => {
          own.apply(ev, a);
          return v(...a);
        },
      });
    else if (!(k in ev)) Object.defineProperty(ev, k, { value: v });
  }
  await act(async () => {
    target.dispatchEvent(ev);
  });
}

export const click = (container: Node, target: Node) => fire(container, "click", target);

/** Types `value` into a field: the element's own value setter (so React sees a change it did not make), then input. */
export async function typeInto(container: Node, target: Node, value: string) {
  const proto = Object.getPrototypeOf(target);
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(target, value);
  await fire(container, "input", target);
}

/** Wait (running React's effects and the mocked commands' promises) until `ok()` holds. */
export async function until(ok: () => boolean, what = "the page to settle") {
  for (let i = 0; i < 80; i++) {
    if (ok()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
  throw new Error(`gave up waiting for ${what}`);
}

/** Let the mocked commands' promises and React's effects finish (for asserting something did NOT show). */
export async function settle(ms = 40) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

/** Mount a React element; the container handed back is the body, so a search from it finds a popup's portal too.
 *  Base UI (src/ui/part.ts) is read first, as the window's first idle moment would. */
export async function mount(el: ReactElement, doc: Document = document) {
  const { createRoot } = await import("react-dom/client");
  // Base UI read before the page draws, so a popup opens in the same step as the click that opens it.
  await (await import("../ui/part")).readBase();
  const host = doc.createElement("div");
  doc.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(el);
  });
  return {
    container: doc.body as unknown as FakeNode,
    host: host as unknown as FakeNode,
    unmount: () => act(async () => root.unmount()),
  };
}
