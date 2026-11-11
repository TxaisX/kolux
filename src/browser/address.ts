// BROW-003: the address bar's reading of typed text. A full web address is taken as is; a local
// host opens over HTTP; something shaped like a domain opens over HTTPS; anything else is a web
// search. A file path or address (T-500) and any other scheme (javascript:, mailto:, ...) are
// refused, so a pasted script can never run as a page and no local file carries the IPC script.
export const BLANK = "about:blank";

export const ENGINES = {
  google: "https://www.google.com/search?q=",
  duckduckgo: "https://duckduckgo.com/?q=",
  bing: "https://www.bing.com/search?q=",
  kagi: "https://kagi.com/search?q=",
} as const;
export type Engine = keyof typeof ENGINES;
/** OD-18: with the browser settings page cut, the engine is a fixed standard web search. */
export const DEFAULT_ENGINE: Engine = "google";

export type Resolved = { url: string } | { error: string };

function parse(u: string): Resolved {
  try {
    return { url: new URL(u).href };
  } catch {
    return { error: `invalid address: ${u}` };
  }
}

export function resolveAddress(text: string, engine: Engine = DEFAULT_ENGINE): Resolved {
  const t = text.trim();
  if (!t || t === BLANK) return { url: BLANK };
  if (/^https?:/i.test(t)) return parse(t);
  // T-500: no local files in a tab; its page carries Tauri's IPC script (evidence/T-500-isolation.txt).
  if (/^(file:|[a-z]:[\\/]|\/)/i.test(t)) return { error: "invalid address: a browser tab opens web pages only (http or https)" };
  // A scheme is letters then a colon; "localhost:3000" has digits after its colon, so it is a host.
  const scheme = /^([a-z][a-z0-9+.-]*):(?![0-9])/i.exec(t);
  if (scheme) return { error: `invalid address: ${scheme[1]}: is not a web or blank address` };
  // An IP address or a *.localhost name is a dev server on this machine or the network; such a server rarely has https.
  if (/^(localhost|[\w-]+(\.[\w-]+)*\.localhost|\d{1,3}(\.\d{1,3}){3}|\[::1\])(:\d+)?([/?#]|$)/i.test(t)) return parse("http://" + t);
  if (!/\s/.test(t) && /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]|$)/.test(t)) return parse("https://" + t);
  return { url: ENGINES[engine] + encodeURIComponent(t) };
}
