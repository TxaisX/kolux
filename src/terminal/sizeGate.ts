// FT-4 (review 0.2.0): the pane remembers the last size it sent its terminal so a resize to the same size is not
// sent again (no IPC call, no ConPTY repaint). A send that fails is forgotten, so the next resize to that size
// goes out again instead of being held back for good.
export function sizeGate() {
  let sent = "";
  const keyOf = (id: number, cols: number, rows: number) => `${id}:${cols}x${rows}`;
  return {
    /** True when this size is new for this terminal and should be sent; it is remembered as sent. */
    send(id: number, cols: number, rows: number): boolean {
      const size = keyOf(id, cols, rows);
      if (size === sent) return false;
      sent = size;
      return true;
    },
    /** A newly bound terminal hears its size again. */
    reset(): void {
      sent = "";
    },
    /** The send for this size failed: forget it (only if it is still the last one sent), so a retry is not suppressed. */
    failed(id: number, cols: number, rows: number): void {
      if (sent === keyOf(id, cols, rows)) sent = "";
    },
  };
}
