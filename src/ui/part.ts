// Reads src/ui/base.tsx (Base UI) once, on demand. The first idle moment after the window's first frame reads it
// ahead (lazy/deferred.ts stage 1, with the menus and sheets that have no placeholder), so a popup opened after that
// draws at once; one opened sooner is drawn the moment the code arrives, by a state change and not by suspending
// (React holds suspended content back for about 300 ms, see deferred.tsx).
import { useEffect, useState } from "react";
import { ahead } from "../lazy/deferred";

type Base = typeof import("./base");
let base: Base | undefined;
let reading: Promise<Base> | undefined;

/** Reads the Base UI module (once; a failed read is tried again by the next ask). */
export function readBase(): Promise<Base> {
  if (base) return Promise.resolve(base);
  reading ??= import("./base").then(
    (m) => ((reading = undefined), (base = m)),
    (e) => {
      reading = undefined;
      throw e;
    },
  );
  return reading;
}

ahead(1, readBase);

/** The Base UI module once it is read, else null. While `want` holds, it is read and the caller drawn again when it
 *  arrives. A failed read is reported on the console and the popup stays closed: the window must keep working. */
export function useBase(want: boolean): Base | null {
  const [, arrived] = useState(0);
  useEffect(() => {
    if (!want || base) return;
    let live = true;
    readBase().then(
      () => live && arrived((n) => n + 1),
      (e: unknown) => console.error("src/ui: Base UI did not load", e),
    );
    return () => {
      live = false;
    };
  }, [want]);
  return want ? (base ?? null) : null;
}

/** Whether the module has been read (a wrapper mounted after that draws Base UI from its first frame). */
export const baseReady = (): boolean => base !== undefined;
