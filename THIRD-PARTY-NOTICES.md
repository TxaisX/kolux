# Third-party notices

Kolux is source-available and all rights reserved (see [LICENSE](LICENSE)). It ships many open-source
libraries, each under its own licence. `pnpm check` runs `scripts/license-check.mjs`, which accepts only
the permissive licences on its allow-list. The one library that needs a note is below.

## elkjs 0.12.1 (Eclipse Layout Kernel for JavaScript)

- **Used by:** Mermaid 12 (the diagram renderer in the editor's preview and draw panel), which loads it
  only when a diagram asks for the ELK layout. Kolux does not modify it.
- **Licence offered:** `EPL-2.0 OR GPL-3.0-or-later`. **Kolux elects the Eclipse Public License 2.0**
  (EPL-2.0). It does not take the GPL alternative.
- **What EPL-2.0 asks of Kolux:** the licence is file-level (weak) copyleft. Shipping the unmodified
  library inside a larger work is allowed when the library's source is made available, and that is the
  case here. The rest of Kolux stays under its own licence. If Kolux ever changes an elkjs file, that
  changed file must be published under EPL-2.0.
- **Licence text:** <https://www.eclipse.org/legal/epl-2.0/>
- **Source code of elkjs:** <https://github.com/kieler/elkjs> (the exact release is the `0.12.1` tag; the
  same files are in the npm package `elkjs@0.12.1`).
- **Decision record:** DT-C228 in `DECISIONS.md` (approved by Txais, 2026-11-09). The scoped exception is
  the `EXCEPTIONS` map in `scripts/license-check.mjs`; it names elkjs only and does not add EPL-2.0 to the
  allow-list.
