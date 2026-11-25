// The model picker at the top left of a chat (2026-11-24, as Open WebUI has it): the current model's name
// and a chevron; opened, a search box, "Your models" (starred) and then every model under its maker.
// `ModelList` is the open list, drawn from what it is given; `ModelPopover` holds the open state, the
// keyboard and the starred list, and keeps the stars in the browser (models.ts, STARRED_KEY).
import { memo, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { ChevronDown } from "../../chrome/icons";
import type { ChatModel } from "../opencode";
import { buildSections, flatRows, nameOfId, popKey, seedShared, starredNow, subscribeStarred, toggleShared, type Row, type Sections } from "./models";
import { useStable } from "./useStable";

type ListProps = {
  /** Built once by the popover (and reused for the keyboard rows), not rebuilt per draw. */
  sections: Sections;
  starred: ReadonlySet<string>;
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

type RowProps = {
  model: ChatModel;
  index: number;
  listId: string;
  /** The highlighted row. */
  active: boolean;
  /** The model the chat is on. */
  current: boolean;
  starred: boolean;
  onPick: (id: string) => void;
  onStar: (id: string) => void;
  onHover: (index: number) => void;
};

/** One model row. Memoised: moving the highlight redraws the two rows that change, not all of them. */
const ModelRow = memo(function ModelRow({ model: m, index: i, listId, active, current, starred: mine, onPick, onStar, onHover }: RowProps) {
  return (
    <li role="presentation" className={`wui-mrow${active ? " active" : ""}`}>
      {/* The mouse only moves the highlight onto a row that does not hold it yet. */}
      <div id={`${listId}-${i}`} role="option" aria-selected={current} className="wui-mopt" title={m.id} onClick={() => onPick(m.id)} onMouseMove={() => (active ? undefined : onHover(i))}>
        <span className="wui-mname">{m.label}</span>
      </div>
      <button type="button" tabIndex={-1} className={`wui-star${mine ? " on" : ""}`} aria-pressed={mine} aria-label={mine ? `Remove ${m.label} from your models` : `Add ${m.label} to your models`} onClick={() => onStar(m.id)}>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M8 1.8l1.9 4 4.3.5-3.2 3 .9 4.3L8 11.4 4.1 13.6 5 9.3l-3.2-3 4.3-.5z" fill={mine ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      </button>
    </li>
  );
});

export function ModelList({ sections, starred, query, active, value, listId, onPick, onStar, onQuery, onHover }: ListProps) {
  const count = sections.starred.length + sections.groups.reduce((n, g) => n + g.models.length, 0);
  let index = 0;
  const row = (m: ChatModel, section: string) => {
    const i = index++;
    return <ModelRow key={`${section}:${m.id}`} model={m} index={i} listId={listId} active={i === active} current={m.id === value} starred={starred.has(m.id)} onPick={onPick} onStar={onStar} onHover={onHover} />;
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

/** The starred ids, shared by every pane (models.ts): a star set in one picker shows in the others, and the
 *  first run seeds the list once the model list has loaded. */
function useStarred(models: readonly ChatModel[]): [ReadonlySet<string>, (id: string) => void] {
  const list = useSyncExternalStore(subscribeStarred, starredNow, starredNow);
  useEffect(() => seedShared(models), [models]);
  const set = useMemo(() => new Set(list), [list]);
  return [set, toggleShared];
}

export const ModelPopover = memo(function ModelPopover({ models, value, disabled = false, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [starred, toggleStarred] = useStarred(models);
  const listId = useId().replace(/:/g, "");
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Built once per change of list, stars or search, and handed to both the open list and the keyboard rows.
  const sections = useMemo(() => buildSections(models, starred, query), [models, starred, query]);
  const rows = useMemo<Row[]>(() => flatRows(sections), [sections]);
  const label = useMemo(() => models.find((m) => m.id === value)?.label ?? nameOfId(value), [models, value]);
  const star = useStable((id: string) => void toggleStarred(id));
  const hover = useStable((i: number) => setActive(i));

  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (refocus) trigger.current?.focus();
  };
  const choose = (id: string) => {
    close(true);
    if (id !== value) onPick(id);
  };
  const pick = useStable(choose);

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
          <ModelList sections={sections} starred={starred} query={query} active={active} value={value} listId={listId} onPick={pick} onStar={star} onQuery={setQuery} onHover={hover} />
        </div>
      )}
    </div>
  );
});
