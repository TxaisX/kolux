// PROJ-019: the project's icon chooser, shown in the project's settings. An emoji typed or pasted,
// one of the built-in icons, or a small picture from disk; Reset brings the automatic icon back.
import { useRef, useState } from "react";
import { BUILT_IN_GLYPHS, ProjectIcon } from "./IconView";
import { builtInIcon, emojiIcon, ICON_NAMES, pictureIcon, pictureProblem } from "./projectIcon";

export function IconPicker({ value, name, onSet, onProblem }: { value: string | undefined; name: string; onSet: (icon: string) => void; onProblem: (text: string) => void }) {
  const [emoji, setEmoji] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const pick = (file: File | undefined) => {
    if (!file) return;
    const problem = pictureProblem(file.type, file.size);
    if (problem) return onProblem(problem);
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" && onSet(pictureIcon(reader.result));
    reader.onerror = () => onProblem("That picture could not be read.");
    reader.readAsDataURL(file);
  };
  return (
    <div data-icon-picker>
      <label>
        Icon <ProjectIcon value={value} name={name} />
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "4px 0" }}>
        {ICON_NAMES.map((n) => {
          const Glyph = BUILT_IN_GLYPHS[n];
          return (
            <button key={n} className={`ib${value === builtInIcon(n) ? " on" : ""}`} title={n} aria-label={`icon ${n}`} aria-pressed={value === builtInIcon(n)} onClick={() => onSet(builtInIcon(n))}>
              <Glyph size={14} />
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <input aria-label="project emoji" className="field" placeholder="Or an emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} onKeyDown={(e) => e.key === "Enter" && emoji.trim() && onSet(emojiIcon(emoji))} />
        <button className="btn" disabled={!emoji.trim()} onClick={() => onSet(emojiIcon(emoji))}>
          Use
        </button>
      </div>
      <div className="btn-row">
        {/* A real button, so the keyboard can reach the picture chooser; the file input stays hidden. */}
        <button className="btn" type="button" data-icon-picture onClick={() => file.current?.click()}>
          Picture...
        </button>
        <input ref={file} type="file" aria-label="project icon picture" tabIndex={-1} accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        <button className="btn" disabled={!value} onClick={() => onSet("")}>
          Reset
        </button>
      </div>
    </div>
  );
}
