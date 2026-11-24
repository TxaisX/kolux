// The one way the chat screen reaches the browser's small store: a read or write that can throw (a blocked
// store, a private window) is never allowed to break the screen. Kolux has no shared settings store for chat
// choices other than controls.ts (the last model and effort per agent, which this screen still uses), so the
// two new pieces of state, the starred models and the collapsed history column, keep their own keys here.

export type Store = Pick<Storage, "getItem" | "setItem">;

export function defaultStore(): Store | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readKey(key: string, store: Store | undefined = defaultStore()): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeKey(key: string, value: string, store: Store | undefined = defaultStore()): void {
  try {
    store?.setItem(key, value);
  } catch {
    // A store that refuses a write keeps the choice for this session only.
  }
}
