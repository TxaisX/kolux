// LAG-10: with twelve panes open, every output chunk used to be handed to every pane's reader, and each
// reader then asked whether the chunk was its own: twelve callbacks to draw one. A pane now routes its
// reader to the terminal it is bound to, and the page bus asks this router which readers a chunk for a
// terminal id belongs to, so a chunk for terminal 5 reaches the one reader bound to 5.
//
// Two groups: readers not routed yet (they may hold chunks tagged with their pane number, which can come
// from any terminal id, so they see every chunk), and, per terminal id, the readers routed to it.
// Pure: no @tauri-apps import, no React.

export type OutputRouter<R> = {
  add(reader: R, id: number | null): void;
  remove(reader: R): void;
  targets(id: number): R[];
  size(): number;
};

export function createOutputRouter<R>(): OutputRouter<R> {
  // One group per terminal id, plus the null group of readers not routed yet. A reader sits in exactly
  // one group, so looking up one id's readers never walks another id's.
  const groups = new Map<number | null, R[]>();
  // Where each reader is, so add / remove find its group without scanning them all.
  const groupOf = new Map<R, number | null>();

  const group = (id: number | null): R[] => {
    let readers = groups.get(id);
    if (!readers) {
      readers = [];
      groups.set(id, readers);
    }
    return readers;
  };

  const add = (reader: R, id: number | null): void => {
    if (groupOf.has(reader)) {
      const from = groupOf.get(reader) ?? null;
      const readers = groups.get(from);
      if (readers) {
        const at = readers.indexOf(reader);
        if (at !== -1) readers.splice(at, 1);
        if (readers.length === 0) groups.delete(from);
      }
    }
    group(id).push(reader);
    groupOf.set(reader, id);
  };

  const remove = (reader: R): void => {
    if (!groupOf.has(reader)) return;
    const from = groupOf.get(reader) ?? null;
    const readers = groups.get(from);
    if (readers) {
      const at = readers.indexOf(reader);
      if (at !== -1) readers.splice(at, 1);
      if (readers.length === 0) groups.delete(from);
    }
    groupOf.delete(reader);
  };

  const targets = (id: number): R[] => [
    ...(groups.get(null) ?? []),
    ...(groups.get(id) ?? []),
  ];

  const size = (): number => groupOf.size;

  return { add, remove, targets, size };
}
