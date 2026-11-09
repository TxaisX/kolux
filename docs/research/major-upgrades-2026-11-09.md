# Major dependency upgrades, 2026-11-09

The goal was to move every dependency with a new major version up to it, keep CI green, and record what was held back and why.

## What moved

| Dependency | From | To | App changes |
|---|---|---|---|
| TypeScript | 6.0.3 | 7.0.2 | None. TS 7 has no JavaScript compiler API, so the plain-words scan (`src/plainWords.test.ts`) imports the 6.x API from `typescript6` (`@typescript/typescript6`). |
| Vitest | 4.1.12 | 5.1.0 | None. `.vitest/` cache folder ignored. |
| pdfjs-dist | 5.4.624 | 6.5.438 (exact pin) | `doc.destroy()` became `doc.loadingTask.destroy()` in `PdfView.tsx`, `pdfJpxProbe.ts` and `pdfPageLayers.test.ts`. `public/pdfjs/openjpeg_nowasm_fallback.js` re-copied byte-exact. No CSP change. |
| Mermaid | 11.17.2 | 12.3.0 | Owner-approved 2026-11-09 after first being held back for the elkjs licence. Kolux elects EPL-2.0 for `elkjs@0.12.1` (`EPL-2.0 OR GPL-3.0-or-later`) through a scoped exception in `scripts/license-check.mjs`, notice in `THIRD-PARTY-NOTICES.md`, decision DT-C228. Mermaid 12 defaults to the ELK layout and the neo look, so `mermaidConfig` in `src/editor/diagrams.ts` pins `layout: "dagre"` and `look: "classic"` to keep the Mermaid 11 appearance. Still lazy-loaded from `diagramLibs.ts`. |
| sha2 (Rust) | 0.10 | 0.11 | None |
| base64 (Rust) | 0.22 | 0.23 | None |
| actions/checkout | v4 | v7.0.1 (SHA-pinned) | `ci.yml`, `release.yml` |
| pnpm/action-setup | v4 | v6.1.1 (SHA-pinned) | same |
| actions/setup-node | v4 | v7.1.0 (SHA-pinned) | same |
| actions/upload-artifact | v4 | v7.0.2 (SHA-pinned) | same |

## Held back

Nothing. Mermaid was the one item held back (elkjs licence); Txais approved it and it moved, see the table above.

## Verification (run alone on merged `main`, after all lanes)

| Gate | Result |
|---|---|
| `pnpm check` (tsc, licences, plan, glossary, guide, workflows, invoke contract) | exit 0; 248 packages, 9 licences, OK |
| Full Vitest | 870 files, 6,422 tests, all pass (184 s) |
| `vite build` + bundle budget | 1,468,349 bytes first load, ceiling 1,490,000, OK |
| `cargo clippy --all-targets -- -D warnings` | clean |
| `cargo deny check` | advisories, bans, licences, sources ok |
| Full `cargo test` (test-env.ps1) | 3,197 tests in 23 groups, 0 failed. An earlier run had one load-timing failure (`after696`, terminal service stop on update) that passed 3 of 3 alone and in the full re-run. |
| CI on GitHub | green: types and licences, Rust tests and lints, all 4 front-end shards |

## Not done

- Runtime check of the PDF viewer in the running app (open, scroll, select text, follow a link, close the tab, open the JPX fixture `src/editor/testdata/jpx.pdf`). The unit and layer tests pass on pdfjs 6; a by-eye check is still worth doing before the next release.
