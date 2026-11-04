// T-294-c / PROJ-035 / C20-R1-01: the global setup choice, the value a repository's "Same as everywhere" names.
// It is the store key the runner reads (setup.rs POLICY_KEY), so it is read and saved through its own
// commands, never through settings.json: one value, written where every reader already looks.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { globalChoice, globalOptions } from "./setupChoice";

export function SetupPolicyView({ stored, notice, onChoose }: { stored: string | null; notice?: string | null; onChoose: (value: string) => void }) {
  const now = globalChoice(stored);
  return (
    <section className="conn-card" data-section="setup-policy">
      <h2 className="conn-name">Workspace setup</h2>
      <div className="look-select">
        <span>Which setup runs</span>
        <select aria-label="which setup runs" className="field" value={now} onChange={(e) => onChoose(e.target.value)}>
          {globalOptions().map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {notice && (
        <p className="conn-detail warn" role="alert">
          {notice}
        </p>
      )}
      <p className="conn-detail">For every repository that has not chosen its own, on its page under Settings. A script from kolux.yaml still asks before it first runs.</p>
    </section>
  );
}

export default function SetupPolicyRow() {
  const [stored, setStored] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    invoke<string | null>("setup_policy_get")
      .then((p) => setStored(p ?? ""))
      .catch((e) => setNotice(String(e)));
  }, []);
  const choose = (value: string) => {
    setStored(value);
    setNotice(null);
    invoke("setup_policy_set", { policy: value }).catch((e) => setNotice(String(e)));
  };
  return <SetupPolicyView stored={stored} notice={notice} onChoose={choose} />;
}
