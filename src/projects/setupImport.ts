// The shape of an imported setup file and the line that names the refused ones. Apart from ImportSetup.tsx so the
// sidebar can use them without loading the dialog.
export type SetupImport = { file: string; setup: string | null; teardown: string | null; refused: string | null };

/** The files that were refused, with why, or null when none was. */
export function refusedLine(list: SetupImport[]): string | null {
  const out = list.filter((i) => i.refused).map((i) => `${i.file} was not read: ${i.refused}.`);
  return out.length ? out.join(" ") : null;
}
