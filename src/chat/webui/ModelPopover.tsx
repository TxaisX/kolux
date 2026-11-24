// The model picker at the top left of a chat (2026-11-24, as Open WebUI has it): the current model's name
// and a chevron; opened, a search box, "Your models" (starred) and then every model under its maker.
// `ModelList` is the open list, drawn from what it is given; `ModelPopover` holds the open state, the
// keyboard and the starred list, and keeps the stars in the browser (models.ts, STARRED_KEY).
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "../../chrome/icons";
import type { ChatModel } from "../opencode";
import { buildSections, flatRows, loadStarred, nameOfId, popKey, saveStarred, seedStarred, toggleStar, type Row } from "./models";

type ListProps = {
  models: readonly ChatModel[];
  starred: readonly string[];
  query: string;
  /** The highlighted row, as an index into `flatRows`. */
  active: number;
  /** The model the chat is on now. */
  value: string;
  listId: string;
  onPick: (id: string) => void;
  onStar: (id: string) => void;
  onQuery: (q: string) => void;
  onHover: (index: number) => void;
};

export function ModelList({ models, starred, query, active, value, listId, onPick, onStar, onQuery, onHover }: ListProps) {
  const sections = buildSections(models, starred, query);
  const count = sections.starred.length + sections.groups.reduce((n, g) => n + g.models.length, 0);
  let index = 0;
  const row = (m: ChatModel, section: string) => {
    const i = index++;
    const mine = starred.includes(m.id);
    return (
      <li key={`${section}:${m.id}`} role="presentation" className={`wui-mrow${i === active ? " active" : ""}`}>
        <div id={`${listId}-${i}`} role="option" aria-selected={m.id === value} className="wui-mopt" title={m.id} onClick={() => onPick(m.id)} onMouseMove={() => onHover(i)}>
          <span className="wui-mname">{m.label}</span>
        </div>
        <button type="button" tabIndex={-1} className={`wui-star${mine ? " on" : ""}`} aria-pressed={mine} aria-label={mine ? `Remove ${m.label} from your models` : `Add ${m.label} to your models`} onClick={() => onStar(m.id)}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M8 1.8l1.9 4 4.3.5-3.2 3 .9 4.3L8 11.4 4.1 13.6 5 9.3l-3.2-3 4.3-.5z" fill={mine ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </button>
      </li>
    );
  };
  return (
    <div className="wui-pop-body">
      <input
        type="text"
        className="wui-msearch"
        role="combobox"
        aria-label="Search models"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={count > 0 ? `${listId}-${Math.min(active, count - 1)}` : undefined}
        placeholder="Search models"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => onQuery(e.currentTarget.value)}
      />
      <ul id={listId} role="listbox" aria-label="Models" className="wui-mlist">
        {count === 0 && <li role="presentation" className="wui-mnone">No models match.</li>}
        {sections.starred.length > 0 && (
          <>
            <li role="presentation" className="wui-mhead">Your models</li>
            {sections.starred.map((m) => row(m, "starred"))}
          </>
        )}
        {sections.groups.map((g) => (
          <li key={g.provider} role="presentation" className="wui-mgroup">
            <ul role="presentation">
              <li role="presentation" className="wui-mhead">{g.provider}</li>
              {g.models.map((m) => row(m, g.provider))}
            </ul>
          </li>
        ))}
      </ul>
      <p className="wui-pop-hint">Enter picks. Shift+Enter stars. Esc closes.</p>
    </div>
  );
}

type Props = {
  models: readonly ChatModel[];
  /** The model the chat is on now (an id), whether or not the list holds it. */
  value: string;
  disabled?: boolean;
  onPick: (id: string) => void;
};

/** The starred ids: the saved list, or on the very first run the seed (once the model list has loaded). */
function useStarred(models: readonly ChatModel[]): [string[], (id: string) => void] {
  const [starred, setStarred] = useState<string[]>(() => loadStarred() ?? []);
  useEffect(() => {
    if (models.length === 0 || loadStarred() !== null) return;
    const seeded = seedStarred(models);
    saveStarred(seeded);
    setStarred(seeded);
  }, [models]);
  const star = (id: string) =>
    setStarred((xs) => {
      const next = toggleStar(xs, id);
      saveStarred(next);
      return next;
    });
  return [starred, star];
}

export function ModelPopover({ models, value, disabled = false, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [starred, star] = useStarred(models);
  const listId = useId().replace(/:/g, "");
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const rows = useMemo<Row[]>(() => flatRows(buildSections(models, starred, query)), [models, starred, query]);
  const label = models.find((m) => m.id === value)?.label ?? nameOfId(value);

  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (refocus) trigger.current?.focus();
  };
  const choose = (id: string) => {
    close(true);
    if (id !== value) onPick(id);
  };

  // Open: the highlight starts on the current model and the search takes focus.
  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, rows.findIndex((r) => r.model.id === value)));
    wrap.current?.querySelector<HTMLInputElement>(".wui-msearch")?.focus();
    // Only the opening resets the highlight; typing a search does it below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => setActive(0), [query]);
  // A click anywhere outside closes it, and the highlighted row is kept in view.
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, listId]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Tab") return close(false);
    const step = popKey(active, rows.length, e.key, e.shiftKey);
    if (step.then === null && step.active === active && !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    setActive(step.active);
    const hit = rows[step.active]?.model;
    if (step.then === "close") close(true);
    else if (step.then === "pick" && hit) choose(hit.id);
    else if (step.then === "star" && hit) star(hit.id);
  };

  return (
    <div className="wui-model-wrap" ref={wrap} onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={trigger}
        type="button"
        className="wui-model"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Model: ${label}. Change model`}
        disabled={disabled}
        title={disabled ? "The model can be changed when the reply is done." : value}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <span className="wui-model-name">{label}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="wui-pop" role="dialog" aria-label="Choose a model">
          <ModelList models={models} starred={starred} query={query} active={active} value={value} listId={listId} onPick={choose} onStar={star} onQuery={setQuery} onHover={setActive} />
        </div>
      )}
    </div>
  );
}
