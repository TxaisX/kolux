// T-242 (BROW-067): the globe "Preview" button in the layout strip, beside "New tab". It names the
// workspace's running dev server (ranked by `browser_dev_ports`: printed address, then a web
// protocol, then the smallest port), opens it as a tab called "Preview host:port", focuses the
// tab already showing that origin instead of opening a second one, and greys out with a hint when
// no server is found. Two or more servers: the arrow opens a menu of them.
// ponytail: the candidates are re-asked every 3 s while the strip shows; an event from the
// terminal lane (server started) would replace the poll.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, Globe } from "../chrome/icons";
import { watchEscape } from "../switcher/accounts";
import { menuStep } from "../terminal/LinkActionMenu";
import { openInBrowser } from "./openIn";
import { livePages } from "./pages";
import { previewHint, previewTitle, printedFor, sameOriginPage, type Candidate } from "./preview";

type Props = { dir: string | null; onFocus?: (id: number) => void };

export default function PreviewButton({ dir, onFocus }: Props) {
  const [list, setList] = useState<Candidate[]>([]);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // UX audit: the server menu is for the keyboard too: it takes focus when it opens, arrows move between its rows,
  // Escape closes it (and stops there) and the focus goes back to the Preview button.
  useEffect(() => {
    if (!at) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return watchEscape(window, () => {
      setAt(null);
      trigger.current?.focus();
    });
  }, [at]);
  useEffect(() => {
    let gone = false;
    const ask = async () => {
      try {
        const got = await invoke<Candidate[]>("browser_dev_ports", { printed: printedFor(dir) });
        if (!gone) setList(got);
      } catch {
        if (!gone) setList([]);
      }
    };
    void ask();
    const timer = setInterval(() => void ask(), 3000);
    return () => {
      gone = true;
      clearInterval(timer);
    };
  }, [dir]);
  const open = (c: Candidate) => {
    setAt(null);
    const url = c.url || `http://${c.host}:${c.port}/`;
    const shown = sameOriginPage(url, dir, livePages());
    if (shown !== null && onFocus) onFocus(shown);
    else openInBrowser(url, previewTitle(url));
  };
  return (
    <>
      <button
        ref={trigger}
        className="btn preview"
        disabled={!list.length}
        aria-haspopup={list.length > 1 ? "menu" : undefined}
        aria-expanded={list.length > 1 ? at !== null : undefined}
        title={previewHint(list)}
        style={{ height: 28 }}
        onClick={(e) => {
          if (list.length === 1) return open(list[0]);
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
        }}
      >
        <Globe size={12} /> Preview
        {list.length > 1 && <ChevronDown size={10} aria-hidden="true" />}
      </button>
      {at && (
        <>
          <div className="menu-backdrop" onClick={() => setAt(null)} aria-hidden="true" />
          <div
            ref={menu}
            className="menu"
            role="menu"
            aria-label="Preview"
            style={at}
            onKeyDown={(e) => {
              const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
              const to = menuStep(rows.length, rows.indexOf(document.activeElement as HTMLElement), e.key);
              if (to === null) return;
              e.preventDefault();
              rows[to]?.focus();
            }}
          >
            <div className="menu-title">Preview</div>
            {list.map((c) => (
              <button key={c.port} role="menuitem" className="menu-item" onClick={() => open(c)} title={c.url || `http://${c.host}:${c.port}/`}>
                {c.host}:{c.port}
                {c.printed ? "" : c.web ? "  (web)" : "  (port)"}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
