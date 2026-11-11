// PKG-2 (narrow the redraw): the terminal pane as the window draws it. It draws again only when what it shows
// changed (terminalProps.ts names every prop and how it is compared); the tally counts the draws that got past
// the comparison, for the speed harness (stable.ts).
import { memo } from "react";
import TerminalPane from "../../terminal/TerminalPane";
import { tally } from "./stable";
import { sameTerminal, type TerminalProps } from "./terminalProps";

export default memo(function Terminal(props: TerminalProps) {
  tally("terminal");
  return <TerminalPane {...props} />;
}, sameTerminal);
