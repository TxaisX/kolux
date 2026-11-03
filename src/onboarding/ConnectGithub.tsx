// 49-ux2: the one "Connect GitHub" button. It opens the small terminal and types `gh auth login` WITHOUT
// pressing Enter (InlineTerminal's rule), so the user does the sign-in. `onExit` runs when that shell ends,
// so the caller can look again.
import { useState } from "react";
import InlineTerminal from "./InlineTerminal";
import { GH_LOGIN } from "./integrations";
import { ONBOARDING_TERMINAL_HEIGHT } from "./stopCards";

export default function ConnectGithub({ onExit }: { onExit: () => void }) {
  const [typing, setTyping] = useState(false);
  return (
    <>
      {typing && <InlineTerminal command={GH_LOGIN} height={ONBOARDING_TERMINAL_HEIGHT} onExit={() => (setTyping(false), onExit())} />}
      {!typing && (
        <button className="btn" onClick={() => setTyping(true)}>
          Connect GitHub
        </button>
      )}
    </>
  );
}
