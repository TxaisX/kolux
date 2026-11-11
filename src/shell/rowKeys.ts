// DT-C268: the identity of a row in a list that is filtered as you type (Go to / Run a command, tab search).
// A row's key used to end in its position, so whenever the list changed (results arriving just after the
// picker opened, every letter typed) every row from the first change down had a new key, and React took
// each of them out of the page and built it again: some forty rows out and forty in, per change. A key made
// only of what the row is stays the same while the row is in the list, so only rows that come or go are touched.

/** One key per name, in order: the name itself, and for a name already taken, the name and a count (so two
 *  rows that read the same still have different keys, and the first keeps the plain one). Never two alike. */
export function rowKeys(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    let key = name;
    for (let n = 1; taken.has(key); n++) key = `${name}\u0000${n}`;
    taken.add(key);
    return key;
  });
}
