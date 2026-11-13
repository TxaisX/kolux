// GIT-014 (T-313-b): the Open in apps in a changed file's menu, and the list's editor behind
// "Edit the app list". The edits use the settings page's rules and write the same saved list.
import { useState } from "react";
import { useSettings } from "../settings/useSettings";
import { addApp, addCustom, draftReady, moveApp, presetsLeft, readOpenIn, removeApp } from "../settings/openIn";
import { fileApps, listPatch, openFileWith } from "./openWith";
import { Select } from "../ui/Select";

type Props = { dir: string | null; path: string; done: () => void; onError: (message: string) => void };

export default function FileOpenWith({ dir, path, done, onError }: Props) {
  const { settings, save } = useSettings();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: "", command: "" });
  const list = readOpenIn(settings ?? {});
  const put = (next: typeof list) => void save(listPatch(next));
  const left = presetsLeft(list);
  return (
    <>
      {dir !== null &&
        fileApps(settings).map((a) => (
          <button key={a.id} role="menuitem" className="menu-item" data-file-action={`open-${a.id}`} onClick={() => (done(), void openFileWith(dir, path, a.command).catch((e) => onError(String(e))))}>
            <span className="name">{a.label}</span>
          </button>
        ))}
      <button role="menuitem" className="menu-item" data-file-action="edit-apps" aria-expanded={editing} onClick={() => setEditing(!editing)}>
        <span className="name">{editing ? "Done editing the app list" : "Edit the app list"}</span>
      </button>
      {editing && (
        <div className="open-in-edit" data-open-in-edit>
          <ul className="conn-list open-in-list" aria-label="Open in apps">
            {list.map((a, i) => (
              <li key={a.id}>
                <span className="name">{a.name}</span> <code>{a.command}</code>
                <button type="button" className="btn" aria-label={`Move ${a.name} up`} disabled={i === 0} onClick={() => put(moveApp(list, a.id, -1))}>
                  Up
                </button>
                <button type="button" className="btn" aria-label={`Move ${a.name} down`} disabled={i === list.length - 1} onClick={() => put(moveApp(list, a.id, 1))}>
                  Down
                </button>
                <button type="button" className="btn" aria-label={`Remove ${a.name}`} onClick={() => put(removeApp(list, a.id))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {left.length > 0 && (
            <Select label="Add an Open in app" value="" onChange={(v) => put(addApp(list, left.find((p) => p.id === v)!))} options={[{ value: "", label: "Add an app" }, ...left.map((p) => ({ value: p.id, label: p.name }))]} className="field" />
          )}
          <input className="field" aria-label="New app name" placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className="field" aria-label="New app command" placeholder="Command, e.g. code" value={draft.command} onChange={(e) => setDraft({ ...draft, command: e.target.value })} />
          <button type="button" className="btn" disabled={!draftReady(draft)} onClick={() => (put(addCustom(list, draft)), setDraft({ name: "", command: "" }))}>
            Add
          </button>
        </div>
      )}
    </>
  );
}
