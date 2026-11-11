// PKG-2 (narrow the redraw): when the right sidebar's file tree may skip a render. Every prop is named (stable.ts
// sameProps). The Explorer runs its function props from handlers, a menu and one key listener (EDIT-037's onWake,
// which an effect re-registers when it changes), never while it draws, so Right.tsx hands over callers with a fixed
// identity and the tree draws again only for a new folder, a hide or show, or a focus request.
import type { ComponentProps } from "react";
import type ExplorerPane from "../../editor/Explorer";
import { sameProps } from "./stable";

export type ExplorerProps = ComponentProps<typeof ExplorerPane>;

export const sameExplorer = sameProps<ExplorerProps>({
  root: "same",
  hidden: "same",
  focusAsk: "same",
  onOpen: "same",
  onClose: "same",
  onOpenTerminal: "same",
  onWake: "same",
}, "explorer");
