# Files and web pages

Kolux runs agents and shells; it no longer opens files or web pages inside its own window. Open a project in your own editor or file manager, and web links go to your own browser.

## Open a project in your own apps

Right-click a project or workspace row in the sidebar and choose **Open in**. The submenu lists Explorer (Windows' file manager), the editors in your Open in list, and **Terminal**. Until you change the list it holds File Explorer and Visual Studio Code. Change it in Settings, General, Open in (see [Settings](settings.md#open-in)).

A file path printed in a terminal is a link too: Ctrl+click opens it with the program Windows uses for that kind of file (see [Links in output](terminals.md#links-in-output)). A program file is shown in its folder instead of being run, and a path on another computer is refused (see [Safety](safety.md)).

## Web pages

Kolux no longer shows web pages inside its own window (Txais, 2026-11-12: this frees memory so the PC can run more agents). A web address opens in your own browser, Chrome or whatever Windows uses by default: a link in a terminal, a review link in Checks and a link in a chat all go there. Agents use that browser for the web too.

## What went

The built-in code editor, the Markdown notes, the file Explorer panel, the diff and All Changes tabs, the browser tabs and the Artifacts library were taken out on 2026-11-19. Review and commit changes in your own editor or with Git; the Checks panel on the right still follows a pull request's checks.

<!-- verified against: src/chrome/LayoutStrip.tsx, src/keys/actions.ts, src/App.tsx, src/open/openExternal.ts, src-tauri/src/scm.rs at bf88bbb3 -->
