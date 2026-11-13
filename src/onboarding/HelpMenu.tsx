// ONB-014: the help menu in the sidebar footer. Getting Started opens the Setup Guide, Explore Kolux
// the tour, and Milestones (with its mini ring) stays only while a core step is unfinished.
// The menu itself is a sheet of its own (HelpSheet) that loads the first time it is opened: its ring
// reads the guide's live steps and it lists every tour by name, and none of that is needed to draw
// the first frame. This module is the button only.
import { useRef, useState } from "react";
import { Help } from "../chrome/icons";
import { HelpSheet } from "../lazy/pages";

export default function HelpMenu() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={button} className="ib" title="Help" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Help />
      </button>
      {open && <HelpSheet anchor={button} onClose={() => setOpen(false)} />}
    </>
  );
}
