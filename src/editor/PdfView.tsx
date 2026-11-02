// EDIT-029 (T-235-b): the tab a PDF file opens in. The bytes come through the app's bounded file-bytes read (the
// same fence as a text read) and go to pdf.js as data, so nothing is fetched (pdfFiles.ts LOCKED_OPTIONS). Pages are
// drawn on canvases only when they are near the view. A new tab first fills the width; the zoom and the place in the
// file are kept while the tab is open and dropped when it closes (pdfFiles.ts remember / forget).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Close } from "../chrome/icons";
import FileIcon from "./FileIcon";
import { baseName } from "./buffers";
import { whyNotLoaded, wheelFactor } from "./imageFiles";
import { readPicture } from "./pictureBytes";
import { clampZoom, fitWidthScale, forget, pageAt, readPos, recall, remember, scrollFor, START, viewerOptions, whyNotOpened, ZOOM_STEP, type PdfPos } from "./pdfFiles";
import { destinationSpot, drawPageLayers, makeLinkService, spotOffset, webLink } from "./pdfPageLayers";
import type { LinkHandler } from "./linkClicks";

type Props = { id: number; path: string; root?: string | null; hidden?: boolean; focused?: boolean; onFocus?: () => void; onClose?: () => void; onToast?: (text: string) => void; /** A web link in the file goes here, as a note's link does (Shift: the system browser). */ onLink?: LinkHandler };
type LinkService = ReturnType<typeof makeLinkService>;
type Size = { w: number; h: number };

const GAP = 8; // pixels between pages
const MARGIN = 12; // pixels either side of a page when it fills the width

let loading: ReturnType<typeof start> | null = null;
const pdfLib = () => (loading ??= start());
/** pdf.js and its worker, loaded the first time a PDF opens (the worker is a file of the app, so the window's own policy covers it). */
function start() {
  return Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?worker")]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerPort = new worker.default();
    return lib;
  });
}

/** One page, drawn when it is within reach of the view and let go when it is far from it. */
function PageCanvas({ doc, n, scale, root, size, onSize, links }: { doc: PDFDocumentProxy; n: number; scale: number; root: HTMLElement | null; size: Size; onSize: (n: number, s: Size) => void; links: LinkService }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const words = useRef<HTMLDivElement>(null);
  const notes = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = holder.current;
    if (!el || !root) return;
    const watch = new IntersectionObserver((rows) => setNear(rows.some((r) => r.isIntersecting)), { root, rootMargin: "800px 0px" });
    watch.observe(el);
    return () => watch.disconnect();
  }, [root]);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    if (!near) {
      c.width = 0; // let the pixels go
      c.height = 0;
      words.current?.replaceChildren();
      notes.current?.replaceChildren();
      return;
    }
    let live = true;
    let task: { cancel(): void; promise: Promise<unknown> } | null = null;
    let stopLayers: (() => void) | null = null;
    void doc.getPage(n).then(async (page) => {
      if (!live) return;
      const natural = page.getViewport({ scale: 1 });
      onSize(n, { w: natural.width, h: natural.height });
      const view = page.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.floor(view.width * ratio);
      c.height = Math.floor(view.height * ratio);
      const ctx = c.getContext("2d");
      if (!ctx) return;
      task = page.render({ canvas: c, canvasContext: ctx, viewport: view, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      task.promise.catch(() => undefined); // a cancelled draw rejects; nothing to say
      // EDIT-029: the words (select and copy) and the links and notes go over the picture
      const lib = await pdfLib();
      if (live && words.current && notes.current) stopLayers = drawPageLayers(lib, page, view, words.current, notes.current, links);
    });
    return () => {
      live = false;
      task?.cancel();
      stopLayers?.();
    };
  }, [doc, n, scale, near]); // eslint-disable-line react-hooks/exhaustive-deps
  const look = { width: size.w * scale, height: size.h * scale, "--total-scale-factor": scale } as CSSProperties;
  return (
    <div ref={holder} className="pdf-page" data-page={n} style={look}>
      <canvas ref={canvas} style={{ width: size.w * scale, height: size.h * scale }} aria-label={`Page ${n}`} />
      <div ref={words} className="textLayer" />
      <div ref={notes} className="annotationLayer" onAuxClick={(e) => e.preventDefault()} />
    </div>
  );
}

export default function PdfView({ id, path, root = null, hidden = false, focused = false, onFocus, onClose, onToast, onLink }: Props) {
  const name = baseName(path);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [sizes, setSizes] = useState<Record<number, Size>>({});
  const [box, setBox] = useState(0);
  const [pos, setPos] = useState<PdfPos>(START);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [restored, setRestored] = useState(0);
  const ready = useRef(false); // the remembered place has been put back
  const anchor = useRef<Pick<PdfPos, "page" | "offset"> | null>(null);
  const pages = doc?.numPages ?? 0;

  // Open the file.
  useEffect(() => {
    let alive = true;
    let opened: PDFDocumentProxy | null = null;
    setDoc(null);
    setError(null);
    setSizes({});
    ready.current = false;
    (async () => {
      const bytes = await readPicture(path, invoke).catch((e) => {
        throw Object.assign(new Error(whyNotLoaded(e, name)), { said: true });
      });
      const lib = await pdfLib();
      const task = lib.getDocument({ ...viewerOptions(new URL(import.meta.env.BASE_URL, document.baseURI).href), data: bytes });
      opened = await task.promise;
      if (!alive) return void opened.destroy();
      setDoc(opened);
    })().catch((e) => alive && setError(e?.said ? e.message : whyNotOpened(e, name)));
    return () => {
      alive = false;
      void opened?.destroy();
    };
  }, [path, tries]); // eslint-disable-line react-hooks/exhaustive-deps
  // The tab closing (the pane going away) drops what it kept.
  useEffect(() => () => forget(path), [path]);

  // The width of the viewing area.
  useEffect(() => {
    if (!scroller) return;
    const watch = new ResizeObserver(() => setBox(scroller.clientWidth));
    watch.observe(scroller);
    setBox(scroller.clientWidth);
    return () => watch.disconnect();
  }, [scroller]);

  const first = sizes[1] ?? sizes[pages ? 1 : 0] ?? { w: 612, h: 792 };
  const scale = pos.fit ? fitWidthScale(first.w, box, MARGIN) : clampZoom(pos.zoom);
  const sizeOf = (n: number): Size => sizes[n] ?? first;
  const heights = Array.from({ length: pages }, (_, i) => sizeOf(i + 1).h * scale);
  const tops = heights.map((_, i) => heights.slice(0, i).reduce((a, h) => a + h + GAP, GAP));

  // Put the remembered place back once the document and the width are known; again whenever the tab is shown or the scale changes.
  useLayoutEffect(() => {
    if (!scroller || !doc || box <= 0 || hidden) return;
    if (!ready.current) {
      const kept = readPos(recall(path), pages) ?? START;
      ready.current = true;
      anchor.current = kept;
      setPos(kept);
      setRestored(1);
      return;
    }
    const at = anchor.current;
    if (at) scroller.scrollTop = scrollFor(tops, heights, at);
  }, [doc, box > 0, hidden, scale, pages, scroller, restored]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = useCallback(() => {
    if (!scroller || !ready.current || hidden || box <= 0 || !pages) return;
    const here = pageAt(tops, heights, scroller.scrollTop - GAP / 2);
    anchor.current = here;
    setPos((p) => {
      const next = { ...p, ...here };
      remember(path, next);
      return next;
    });
  }, [scroller, hidden, box, pages, path, scale, sizes]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomBy = (f: number) => {
    if (scroller) anchor.current = pageAt(tops, heights, scroller.scrollTop - GAP / 2);
    setPos((p) => {
      const next = { ...p, fit: false, zoom: clampZoom(scale * f) };
      remember(path, next);
      return next;
    });
  };
  const fitWidth = () => {
    if (scroller) anchor.current = pageAt(tops, heights, scroller.scrollTop - GAP / 2);
    setPos((p) => {
      const next = { ...p, fit: true };
      remember(path, next);
      return next;
    });
  };
  // Ctrl or Cmd with the wheel zooms; the page's own zoom is cancelled, which React's wheel prop cannot do.
  const zoomRef = useRef(zoomBy);
  zoomRef.current = zoomBy;
  useEffect(() => {
    if (!scroller) return;
    const on = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomRef.current(wheelFactor(e.deltaY, e.deltaMode));
    };
    scroller.addEventListener("wheel", on, { passive: false });
    return () => scroller.removeEventListener("wheel", on);
  }, [scroller]);

  // EDIT-029: a link in the file. A web address goes where a note's link goes; a place in the file scrolls here.
  const jumpTo = (page: number, offset: number) => {
    if (!scroller) return;
    anchor.current = { page: Math.min(Math.max(1, page), Math.max(1, pages)), offset };
    scroller.scrollTop = scrollFor(tops, heights, anchor.current);
  };
  const latest = useRef({ jumpTo, pages, page: pos.page, follow: (_url: string, _shift: boolean) => {}, goTo: async (_dest: unknown) => {} });
  latest.current = {
    jumpTo,
    pages,
    page: pos.page,
    follow: (url, shift) => {
      const web = webLink(url, path, root);
      if (web && onLink) onLink(web, shift);
      else onToast?.(web ? "This window cannot open links." : "Only web links in a PDF are opened.");
    },
    goTo: async (dest) => {
      if (!doc) return;
      const spot = await destinationSpot(doc, dest);
      if (!spot) return onToast?.("That link points to a place this file does not have.");
      const page = Math.min(spot.page, doc.numPages);
      const h = sizes[page]?.h ?? (await doc.getPage(page)).getViewport({ scale: 1 }).height;
      latest.current.jumpTo(page, spotOffset(spot.top, h));
    },
  };
  const links = useMemo(
    () => makeLinkService({ pages: () => latest.current.pages, current: () => latest.current.page, follow: (u, s) => latest.current.follow(u, s), goTo: (d) => latest.current.goTo(d), goToPage: (n) => latest.current.jumpTo(n, 0) }),
    [],
  );
  const onSize = useCallback((n: number, s: Size) => setSizes((all) => (all[n]?.w === s.w && all[n]?.h === s.h ? all : { ...all, [n]: s })), []);
  const pct = `${Math.round(scale * 100)}%`;
  return (
    <section className={`pane editor pdf${focused ? " focused" : ""}`} hidden={hidden} aria-label={`${name} pane`} onMouseDown={onFocus} data-kind="editor" data-key={id}>
      <header className="pane-head">
        <span className="agent-mark" title="PDF">
          <FileIcon name={name} size={13} />
        </span>
        <span className="title">{name}</span>
        <span className="path" title={path}>
          {path}
        </span>
        <button
          className="ib"
          title="Copy the full path"
          aria-label="Copy the full path"
          onClick={() =>
            void navigator.clipboard.writeText(path).then(
              () => onToast?.("Path copied"),
              () => onToast?.("The path could not be copied; select it in the header instead."),
            )
          }
        >
          Copy
        </button>
        {error && (
          <button className="ib" title="Try opening the file again" onClick={() => setTries((n) => n + 1)}>
            Retry
          </button>
        )}
        <span className="right">
          <button className="ib" onClick={() => onClose?.()} title="Close tab (Ctrl+W)">
            <Close size={12} />
          </button>
        </span>
      </header>
      <div className="image-view pane-body" role="region" aria-label={`${name}, PDF`}>
        {error ? (
          <p className="image-why" role="alert">
            {error}
          </p>
        ) : (
          <>
            <div className="image-bar">
              <button className="ib" title="Zoom out" aria-label="Zoom out" disabled={!doc} onClick={() => zoomBy(1 / ZOOM_STEP)}>
                -
              </button>
              <span className="image-zoom" aria-live="polite" title="Hold Ctrl or Cmd and use the wheel to zoom">
                {pct}
              </span>
              <button className="ib" title="Zoom in" aria-label="Zoom in" disabled={!doc} onClick={() => zoomBy(ZOOM_STEP)}>
                +
              </button>
              <button className={`ib${pos.fit ? " on" : ""}`} title="Fill the width" aria-pressed={pos.fit} disabled={!doc} onClick={fitWidth}>
                Fit width
              </button>
              {doc && <span className="image-facts">{`Page ${Math.min(pos.page, pages)} of ${pages}`}</span>}
            </div>
            <div ref={setScroller} className="pdf-scroll" onScroll={onScroll} tabIndex={0}>
              {!doc ? (
                <p className="image-wait">Loading {name}</p>
              ) : (
                Array.from({ length: pages }, (_, i) => <PageCanvas key={i} doc={doc} n={i + 1} scale={scale} root={scroller} size={sizeOf(i + 1)} onSize={onSize} links={links} />)
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
