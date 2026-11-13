// ACCT-008 acceptance, the window half. The dialog component is called for real (its state kept
// between calls by shallow-react.ts); the sealed storage half is in src-tauri/tests/cards_07.rs
// (acct008_the_xai_key_is_kept_sealed_once_never_shown_and_a_cli_sign_in_wins). The key below is not a key.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { GrokCardView, GrokKeyDialog, type GrokView } from "../GrokCard";
import { everyString, find, mount, textOf } from "./shallow-react";

vi.mock("react", async (orig) => (await import("./shallow-react")).patchReact(await orig<object>()));

const KEY = "xai-FAKE-NOT-A-REAL-KEY-1111111111111111";
const press = (el: { props: Record<string, any> }, ...args: unknown[]) => el.props.onClick?.(...args);
const dialog = (open: boolean, onSubmit = vi.fn(), onClose = vi.fn()) => ({ open, onSubmit, onClose });

test("box 1: Connect is disabled until something is typed, then enabled; submit sends the key once and the field and page hold no key text", () => {
  const props = dialog(true);
  const page = mount(GrokKeyDialog, props);
  let tree = page.render();
  const connect = () => find(tree, (e) => e.type === "button" && e.props.type === "submit");
  const field = () => find(tree, (e) => e.type === "input");
  expect(textOf(connect())).toBe("Connect");
  expect(connect().props.disabled).toBe(true);
  expect(field().props.type).toBe("password");
  expect(field().props.value).toBe("");
  // Spaces alone are not a key.
  field().props.onChange({ target: { value: "   " } });
  tree = page.render();
  expect(connect().props.disabled).toBe(true);
  field().props.onChange({ target: { value: KEY } });
  tree = page.render();
  expect(connect().props.disabled).toBe(false);
  // Submit: the key goes out once, and nothing shown holds it any more.
  const submit = vi.fn();
  find(tree, (e) => e.type === "form").props.onSubmit({ preventDefault: submit });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(props.onSubmit).toHaveBeenCalledTimes(1);
  expect(props.onSubmit).toHaveBeenCalledWith(KEY);
  tree = page.render({ ...props, open: false });
  expect(everyString(tree).some((s) => s.includes(KEY))).toBe(false);
  expect(find(tree, (e) => e.type === "input").props.value).toBe("");
  // The card, told the key is saved, reads connected and shows no key text; the page never receives the key.
  const view: GrokView = { connection: "key", keySaved: true, signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: null };
  const html = renderToString(createElement(GrokCardView, { view, pending: null, onAction: () => {} }));
  expect(html).toContain('data-state="connected"');
  expect(html).toContain("Connected · xAI API key (pay-per-use)");
  expect(html).not.toContain(KEY);
  expect(Object.keys(view)).not.toContain("key");
});

test("box 2: typing a key, pressing Cancel and reopening the same dialog shows a blank field", () => {
  const props = dialog(true);
  const page = mount(GrokKeyDialog, props);
  let tree = page.render();
  find(tree, (e) => e.type === "input").props.onChange({ target: { value: KEY } });
  tree = page.render();
  expect(find(tree, (e) => e.type === "input").props.value).toBe(KEY);
  const cancel = find(tree, (e) => e.type === "button" && textOf(e) === "Cancel");
  press(cancel);
  expect(props.onClose).toHaveBeenCalledTimes(1);
  // Closed, then opened again without being rebuilt: the same component, the same kept state.
  tree = page.render({ ...props, open: false });
  tree = page.render({ ...props, open: true });
  expect(find(tree, (e) => e.type === "input").props.value).toBe("");
  expect(find(tree, (e) => e.type === "button" && e.props.type === "submit").props.disabled).toBe(true);
  expect(everyString(tree).some((s) => s.includes(KEY))).toBe(false);
  // Escape cancels the same way: the dialog is a src/ui Dialog, whose layer catches Escape on the window and stops it
  // there, so Settings under the dialog stays open (T-565; proved on a real DOM in SettingsPage.escape.test.ts). Keys
  // typed in it stop at its box.
  find(tree, (e) => e.type === "input").props.onChange({ target: { value: KEY } });
  tree = page.render();
  const box = find(tree, (e) => e.props.label === "Use an xAI API key");
  const stop = vi.fn();
  box.props.onKeyDown({ key: "a", stopPropagation: stop });
  expect(stop).toHaveBeenCalledTimes(1);
  box.props.onClose("escape");
  tree = page.render({ ...props, open: true });
  expect(find(tree, (e) => e.type === "input").props.value).toBe("");
});

test("the key route is labelled advanced and pay-per-use, unlike the subscription sign-in", () => {
  const off: GrokView = { connection: "none", keySaved: false, signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: null };
  const html = renderToString(createElement(GrokCardView, { view: off, pending: null, onAction: () => {} }));
  expect(html).toContain("Use an xAI API key (advanced, pay-per-use)");
  const dlg = textOf(mount(GrokKeyDialog, dialog(true)).render());
  expect(dlg).toContain("Advanced. xAI bills an API key per use, unlike the Grok sign-in.");
});
