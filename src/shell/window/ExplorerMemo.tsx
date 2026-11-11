// PKG-2 (narrow the redraw): the right sidebar's file tree as the window draws it, loaded on demand as before
// (lazy/pages.tsx). It draws again only when what it shows changed (explorerProps.ts); the tally counts the draws
// that got past the comparison, for the speed harness (stable.ts).
import { memo } from "react";
import { Explorer } from "../../lazy/pages";
import { tally } from "./stable";
import { sameExplorer, type ExplorerProps } from "./explorerProps";

export default memo(function Files(props: ExplorerProps) {
  tally("explorer");
  return <Explorer {...props} />;
}, sameExplorer);
