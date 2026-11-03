// SET-036 (T-181): the React side of a draft text field (see draft.ts). `useDraft(value, save)`
// returns the props to spread on an input or textarea. The text saves after a short pause, on leaving
// the field, when the page is left (unmount) and when the window closes.
import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent, type CompositionEvent, type KeyboardEvent } from "react";
import { createDraft } from "./draft";

/** `ready` (see draft.ts): the texts the pause saves; any other text saves on leaving, page change or close. */
export function useDraft(value: string, save: (text: string) => Promise<unknown>, ready?: (text: string) => boolean) {
  const latest = useRef(save);
  latest.current = save;
  // T-598: a settings save that failed settles false (useSettings shows why on the page); the draft
  // takes that as the failure it is, so the typed text stays in the field for another try.
  const [draft] = useState(() =>
    createDraft(value, {
      ready,
      save: (t) =>
        latest.current(t).then((ok) => {
          if (ok === false) throw new Error("not saved");
          return ok; // a string is the text that was really stored (a clamped number), see draft.ts
        }),
    }),
  );
  const state = useSyncExternalStore(draft.subscribe, draft.state, draft.state);
  useEffect(() => void draft.outside(value), [draft, value]);
  useEffect(() => {
    const now = () => void draft.flush();
    window.addEventListener("beforeunload", now);
    window.addEventListener("pagehide", now);
    return () => {
      window.removeEventListener("beforeunload", now);
      window.removeEventListener("pagehide", now);
      void draft.leave(); // changing page unmounts the field: what was typed is saved
      draft.dispose();
    };
  }, [draft]);
  return {
    state,
    /** The controller itself: `draft.discard()` puts the box back to the stored text. */
    draft,
    props: {
      value: state.text,
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => draft.type(e.target.value),
      onBlur: () => void draft.leave(),
      onCompositionStart: () => draft.compositionStart(),
      onCompositionEnd: (e: CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => draft.compositionEnd(e.currentTarget.value),
      onKeyDown: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (e.key === "Enter" && e.currentTarget instanceof HTMLInputElement && !e.nativeEvent.isComposing && e.keyCode !== 229) e.currentTarget.blur();
      },
    },
  };
}
