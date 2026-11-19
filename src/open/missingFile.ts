// EDIT-014: the toast for a link to a file that is not there. Kept out of linkClicks.ts, which reads a
// note's own outlines (and marked with them), so the window's link handling can ask this question on the
// first frame without loading the note renderer (cycle 3, first load).

/** The toast for a link to a file that is not there (null when it exists). `stamps` is file_stamps: null = gone. */
export async function missingFileToast(path: string, stamps: (paths: string[]) => Promise<unknown[]>): Promise<string | null> {
  try {
    const [stamp] = await stamps([path]);
    return stamp === null || stamp === undefined ? `Cannot open ${path.split(/[/\\]/).pop() ?? path}: the file is not there (or is outside this project).` : null;
  } catch {
    return null; // a failed check never blocks the open; the open itself reports its own error
  }
}
