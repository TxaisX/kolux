// CLI-008 (T-250-c): Settings > CLI. Shows whether the kolux command is registered for the whole
// system, registers or removes it, and offers the matching skill for agents once it is registered.
import { invoke } from "@tauri-apps/api/core";
import { invokeNamed } from "../ipc/commands";
import { useEffect, useState } from "react";
import { failureText, osOf, SKILL_NAME, viewOf, whereText, type Registration } from "./cliRegister";

export default function CliCard() {
  const [reg, setReg] = useState<Registration | null>(null);
  const [note, setNote] = useState("");
  const [offer, setOffer] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    invoke<Registration>("cli_register_state").then(setReg, (e: unknown) => setNote(`Could not read the state: ${String(e)}`));
  }, []);
  const change = async (what: "register" | "remove") => {
    setBusy(true);
    setNote("");
    setOffer("");
    try {
      const r = await invokeNamed<Registration>(what === "register" ? "cli_register" : "cli_unregister");
      setReg(r);
      if (what === "register") setOffer(await invoke<string>("skills_install_command", { names: [SKILL_NAME] }).catch(() => ""));
    } catch (e) {
      setNote(failureText(what, e));
      invoke<Registration>("cli_register_state").then(setReg, () => undefined);
    } finally {
      setBusy(false);
    }
  };
  const copy = () => {
    const done = () => setNote("Copied. Paste it into a terminal to install the Kolux skill for your agents.");
    void invoke("clip_copy_text", { text: offer }).then(done, () => navigator.clipboard.writeText(offer).then(done, () => setNote(offer)));
  };
  const v = reg ? viewOf(reg) : null;
  const command = reg?.command ?? "kolux";
  return (
    <section className="conn-card" data-section="cli">
      <h2 className="conn-name">CLI</h2>
      <p className="conn-detail">{whereText(osOf(navigator.userAgent), command)}</p>
      {v && <p className={v.warn ? "conn-detail warn" : "conn-detail"}>{v.headline}</p>}
      {reg?.note && <p className="conn-detail warn">{reg.note}</p>}
      <div className="btn-row">
        <button className="btn" disabled={busy || !v?.canRegister} onClick={() => void change("register")}>
          Register {command}
        </button>
        <button className="btn" disabled={busy || !v?.canRemove} onClick={() => void change("remove")}>
          Remove {command}
        </button>
      </div>
      {offer && (
        <p className="conn-detail">
          Agents work better with the matching skill. <button className="btn" onClick={copy}>Copy the skill install command</button>
        </p>
      )}
      {note && <p className="conn-detail">{note}</p>}
    </section>
  );
}
