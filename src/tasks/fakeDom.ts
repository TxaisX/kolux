// FIX-1 (stand-in review FIX-SOON 4): a just-enough DOM so a real React component can be mounted,
// clicked and typed into from a vitest test. The repo has no jsdom (no DOM test environment), and
// package.json is not this lane's to change, so this stands in: it keeps a node tree, attributes and
// listeners, and hands React the click/input events a browser would. Only what react-dom/client
// asks of the DOM is here; it is test support, never loaded by the app.
import { act, type ReactElement } from "react";

type Listener = { fn: (e: unknown) => void; capture: boolean };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const HTML = "http://www.w3.org/1999/xhtml";

export class FakeNode {
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  attrs: Record<string, string> = {};
  listeners: Record<string, Listener[]> = {};
  style: Record<string, unknown> = { setProperty() {}, removeProperty() {} };
  nodeValue: string | null = null;
  namespaceURI = HTML;
  tagName: string;
  localName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [extra: string]: any;
  /** T-695: a non-textarea's defaultValue (a textarea keeps it as its text). */
  declare plainDefault?: string;
  constructor(
    public nodeType: number,
    public nodeName: string,
    public ownerDocument: FakeDocument | null,
  ) {
    this.tagName = nodeName;
    this.localName = nodeName.toLowerCase();
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get nextSibling(): FakeNode | null {
    const at = this.parentNode?.childNodes.indexOf(this) ?? -1;
    return at >= 0 ? (this.parentNode?.childNodes[at + 1] ?? null) : null;
  }
  get previousSibling(): FakeNode | null {
    const at = this.parentNode?.childNodes.indexOf(this) ?? -1;
    return at > 0 ? (this.parentNode?.childNodes[at - 1] ?? null) : null;
  }
  appendChild(c: FakeNode) {
    return this.insertBefore(c, null);
  }
  insertBefore(c: FakeNode, ref: FakeNode | null) {
    c.parentNode?.removeChild(c);
    const at = ref ? this.childNodes.indexOf(ref) : -1;
    if (at < 0) this.childNodes.push(c);
    else this.childNodes.splice(at, 0, c);
    c.parentNode = this;
    return c;
  }
  removeChild(c: FakeNode) {
    const at = this.childNodes.indexOf(c);
    if (at >= 0) this.childNodes.splice(at, 1);
    c.parentNode = null;
    return c;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  contains(n: FakeNode | null): boolean {
    return !!n && (n === this || this.childNodes.some((c) => c.contains(n)));
  }
  getRootNode(): FakeNode {
    return this.parentNode ? this.parentNode.getRootNode() : this;
  }
  setAttribute(k: string, v: unknown) {
    this.attrs[k] = String(v);
  }
  setAttributeNS(_ns: string | null, k: string, v: unknown) {
    this.attrs[k] = String(v);
  }
  getAttribute(k: string) {
    return k in this.attrs ? this.attrs[k] : null;
  }
  hasAttribute(k: string) {
    return k in this.attrs;
  }
  removeAttribute(k: string) {
    delete this.attrs[k];
  }
  removeAttributeNS(_ns: string | null, k: string) {
    delete this.attrs[k];
  }
  addEventListener(type: string, fn: (e: unknown) => void, opts?: boolean | { capture?: boolean }) {
    (this.listeners[type] ??= []).push({ fn, capture: typeof opts === "object" ? !!opts?.capture : !!opts });
  }
  removeEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l.fn !== fn);
  }
  focus() {}
  blur() {}
  get textContent(): string {
    return this.nodeType === 3 ? (this.nodeValue ?? "") : this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    if (this.nodeType === 3) {
      this.nodeValue = v;
      return;
    }
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (v) this.appendChild(this.ownerDocument!.createTextNode(v));
  }
  get data() {
    return this.nodeValue ?? "";
  }
  /** What a form control or option holds: what was typed or set, else an option's own value. */
  get value(): string {
    if (this.typed !== undefined) return this.typed;
    // T-695: as in a browser, an untouched textarea holds its text (React renders a textarea's first value as its text)
    if (this.localName === "textarea") return this.textContent;
    return this.localName === "option" ? (this.attrs.value ?? this.textContent) : "";
  }
  set value(v: string) {
    this.typed = String(v);
  }
  /** T-695: as in a browser, a textarea's default value is its text, which its value shows until typed in
   *  (React sets defaultValue to render a textarea's first value). Other elements keep a plain field. */
  get defaultValue(): string {
    return this.localName === "textarea" ? this.textContent : (this.plainDefault ?? "");
  }
  set defaultValue(v: string) {
    if (this.localName === "textarea") this.textContent = String(v);
    else this.plainDefault = String(v);
  }
  /** What a <select> offers: its option elements, at any depth. */
  get options(): FakeNode[] {
    return find(this, (n) => n.localName === "option");
  }
}

export class FakeDocument extends FakeNode {
  body: FakeNode;
  documentElement: FakeNode;
  defaultView: Any = null;
  activeElement: FakeNode;
  constructor() {
    super(9, "#document", null);
    this.ownerDocument = null;
    this.documentElement = new FakeNode(1, "HTML", this);
    this.body = new FakeNode(1, "BODY", this);
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
  }
  createElement(name: string) {
    const n = new FakeNode(1, name.toUpperCase(), this);
    if (name === "input") n.type = "text";
    return n;
  }
  createElementNS(ns: string, name: string) {
    const n = new FakeNode(1, ns === HTML ? name.toUpperCase() : name, this);
    n.namespaceURI = ns;
    return n;
  }
  createTextNode(text: string) {
    const n = new FakeNode(3, "#text", this);
    n.nodeValue = text;
    return n;
  }
}

/** Every node under `root` (root included) that `pred` accepts, in document order. */
export function find(root: FakeNode, pred: (n: FakeNode) => boolean): FakeNode[] {
  const out: FakeNode[] = [];
  const walk = (n: FakeNode) => {
    if (n.nodeType === 1 && pred(n)) out.push(n);
    n.childNodes.forEach(walk);
  };
  walk(root);
  return out;
}

/** Elements of `tag` whose whole text is exactly `text`. */
export const byText = (root: FakeNode, tag: string, text: string) => find(root, (n) => n.localName === tag && n.textContent.trim() === text);
/** Elements of `tag` whose text contains `text`. */
export const withText = (root: FakeNode, tag: string, text: string) => find(root, (n) => n.localName === tag && n.textContent.includes(text));
export const byLabel = (root: FakeNode, tag: string, label: string) => find(root, (n) => n.localName === tag && n.attrs["aria-label"] === label);

/** The page a browser would have: a document, a window with storage, set up once for the test file. */
export function installDom() {
  const doc = new FakeDocument();
  const store = new Map<string, string>();
  const win: Any = {
    document: doc,
    event: undefined,
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    addEventListener() {},
    removeEventListener() {},
    HTMLIFrameElement: class {},
  };
  win.window = win;
  win.self = win;
  win.top = win;
  doc.defaultView = win;
  doc.oninput = null; // React asks the document whether it knows the "input" event
  const g = globalThis as Any;
  g.window = win;
  g.document = doc;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  return { doc, win, store };
}

/** Send `type` to `target` the way the browser does: capture listeners on the container first, then bubble. */
export async function fire(container: FakeNode, type: string, target: FakeNode, extra: Record<string, unknown> = {}) {
  const ev: Any = {
    type,
    target,
    srcElement: target,
    currentTarget: container,
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    isTrusted: true,
    timeStamp: Date.now(),
    button: 0,
    buttons: 0,
    detail: 0,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {},
    stopImmediatePropagation() {},
    ...extra,
  };
  await act(async () => {
    for (const capture of [true, false]) for (const l of container.listeners[type] ?? []) if (l.capture === capture) l.fn(ev);
  });
}

export const click = (container: FakeNode, target: FakeNode) => fire(container, "click", target);
export async function typeInto(container: FakeNode, target: FakeNode, value: string) {
  // The class's own setter, as the browser-testing libraries do: React wraps the node's `value` to
  // spot changes made by the page, and a typed change must not look like one.
  Object.getOwnPropertyDescriptor(FakeNode.prototype, "value")!.set!.call(target, value);
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

/** Mount a React element into a fresh container; react-dom is loaded after the DOM exists. */
export async function mount(el: ReactElement, doc: FakeDocument) {
  const { createRoot } = await import("react-dom/client");
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await act(async () => {
    root.render(el);
  });
  return {
    container,
    unmount: () => act(async () => root.unmount()),
  };
}
