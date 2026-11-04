// VIEW-107 (P0): the floating panel keeps its own notes, and only it hears when one of them holds
// unsaved text; the window did not, so quitting or Force Reloading dropped that text with no
// question. The layer fills this latch as its notes change and the window reads it when it asks
// before closing. Kept in its own module, like ./keys, so the window's close path does not carry
// the editors the layer can open (cycle 3, first load).

/** The names the window's close question shows for the floating panel's unsaved notes. */
export const floatingUnsaved = { titles: [] as string[] };
