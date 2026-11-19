// Where code outside the window's components (the automatic pull request flow) says a sentence in the notice line.
// The window hands its notice setter over once, on mount (App.tsx); until then a sentence is dropped.
let sink: ((text: string) => void) | null = null;
export const setNoticeSink = (fn: ((text: string) => void) | null): void => {
  sink = fn;
};
export const sayNotice = (text: string): void => sink?.(text);
