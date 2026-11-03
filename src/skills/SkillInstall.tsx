// SKILL-028: the Install panel. Choose Kolux skills, see the community skills installer's command,
// copy it. The command stays interactive: the installer asks its own questions, so it is run by hand
// in a terminal (the old "Type in terminal" button had no terminal to type into and is gone).
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { COPIED, COPY_FAILED } from "./skills";
import { noteUse } from "../onboarding/features";

type Props = { names: string[] };

export default function SkillInstall({ names }: Props) {
  const [picked, setPicked] = useState<string[]>(names);
  const [line, setLine] = useState("");
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => setPicked(names), [names.join("|")]);
  useEffect(() => {
    if (!picked.length) return setLine("");
    invoke<string>("skills_install_command", { names: picked }).then(setLine, (e) => (setLine(""), setNote(String(e))));
  }, [picked.join("|")]);
  const copy = () => navigator.clipboard.writeText(line).then(() => (noteUse("skill-setup"), setNote(COPIED)), () => setNote(COPY_FAILED));
  return (
    <div className="skills-install" role="group" aria-label="Install Kolux skills">
      <p>Install or reinstall Kolux skills with the community skills installer.</p>
      {names.map((n) => (
        <label key={n} className="check">
          <input type="checkbox" checked={picked.includes(n)} onChange={(e) => setPicked(e.target.checked ? [...picked, n] : picked.filter((x) => x !== n))} /> {n}
        </label>
      ))}
      {line && <code className="skills-cmd">{line}</code>}
      <div className="btn-row">
        <button className="btn" disabled={!line} onClick={copy}>
          Copy command
        </button>
      </div>
      {note && <div role="status">{note}</div>}
    </div>
  );
}
