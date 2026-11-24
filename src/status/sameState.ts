// LAG-02: "did this event change anything", as a pure function, so a repeated, unchanged agent-status,
// usage, quiet or unverified event gives back the state object the window already holds and React
// skips the commit. No React and no Tauri here: the board's measuring test counts the objects itself.

/** Own enumerable keys whose value is not undefined. A key an object holds as undefined counts as
 *  absent, so a fresh payload's `{ ask: undefined }` equals the object stored without it. */
function presentKeys(v: Record<string, unknown>): string[] {
  return Object.keys(v).filter((k) => v[k] !== undefined);
}

/** A JSON-like plain object: not an array, not null, not a class instance. */
function isPlain(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false;
  const proto = Object.getPrototypeOf(v) as object | null;
  return proto === Object.prototype || proto === null;
}

/** LAG-02: structural equality for the JSON-like values event payloads hold (every event is a fresh
 *  object from JSON, so identity says nothing). Primitives compare by value through Object.is (NaN
 *  equals NaN, null does not equal undefined); arrays element by element, and an array never equals
 *  an object; plain objects by their present keys, order aside. Anything else is a change. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true; // primitives by value, and one object (or function) with itself
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false;
    return true;
  }
  if (!isPlain(a) || !isPlain(b)) return false;
  const mine = presentKeys(a);
  const theirs = presentKeys(b);
  if (mine.length !== theirs.length) return false;
  const other = new Set(theirs);
  return mine.every((k) => other.has(k) && sameValue(a[k], b[k]));
}

/** LAG-02: `byPane` ITSELF when `key` already holds an equal value (React stores the same object and
 *  commits nothing), otherwise a new record with the value in it. A missing key always gets one, so
 *  a first `false` or `[]` is stored. The record it is given is never changed. */
export function putIfChanged<T>(byPane: Record<number, T>, key: number, value: T): Record<number, T> {
  if (key in byPane && sameValue(byPane[key], value)) return byPane;
  return { ...byPane, [key]: value };
}
