// LAG-09: one backend listener per event name for the whole page. Every pane used to call `listen()` itself for
// each event kind it read (terminal output, terminal exit, pane-agent, workspace-land), and each `listen()` is one
// IPC round trip: ten restored panes paid 30 to 40 before their terminals were live. A hub made here makes the
// backend call once per event name, hands every registration its own `off`, and removes the backend listener when
// the last registration leaves, so a later one listens again.
// Pure: the backend `listen` is handed in, so a test can count its calls without Tauri or React.

export type HubEvent<T> = { payload: T };
export type BackendListen = (event: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>;
export type ListenHub = {
  on<T>(event: string, handler: (e: HubEvent<T>) => void): Promise<() => void>;
  handlers(event: string): number;
};

type Registration = { handler: (e: HubEvent<unknown>) => void; live: boolean };

type Slot = {
  /** Every live registration of this event, in the order they were made. */
  registrations: Registration[];
  /** The backend's unlisten, once it answered; null while pending or after the last registration left. */
  off: (() => void) | null;
  /** The one backend call of this event, shared by every registration while it is pending or granted. */
  started: Promise<void> | null;
};

export function createListenHub(listen: BackendListen): ListenHub {
  const slots = new Map<string, Slot>();

  /** Hands one backend event to the registrations live when delivery starts, in registration order. */
  const deliver = (slot: Slot, e: { payload: unknown }): void => {
    // A snapshot: a registration added during the delivery gets the next event, not this one.
    for (const registration of slot.registrations.slice()) {
      if (!registration.live) continue; // removed during this delivery, before its turn
      try {
        registration.handler({ payload: e.payload });
      } catch (err) {
        // One bad handler loses its own event only; the rest of the event's handlers still get it.
        console.error("listen hub: a handler failed; the event still goes to the others", err);
      }
    }
  };

  const slotOf = (event: string): Slot => {
    let slot = slots.get(event);
    if (!slot) {
      slot = { registrations: [], off: null, started: null };
      slots.set(event, slot);
    }
    return slot;
  };

  /** Makes the one backend call for this event when none is pending or granted; resolves once it is granted. */
  const begin = (event: string, slot: Slot): Promise<void> => {
    if (slot.started) return slot.started;
    let answer: Promise<() => void>;
    try {
      answer = listen(event, (e) => deliver(slot, e));
    } catch (err) {
      answer = Promise.reject(err); // a backend that throws instead of rejecting is still a refusal
    }
    const started = answer.then(
      (off) => {
        slot.off = off;
      },
      (err) => {
        // Refused: every registration waiting on this call is dropped, and a later on() calls listen again.
        slot.registrations = [];
        slot.off = null;
        slot.started = null;
        if (slots.get(event) === slot) slots.delete(event);
        throw err;
      },
    );
    slot.started = started;
    return started;
  };

  return {
    on<T>(event: string, handler: (e: HubEvent<T>) => void): Promise<() => void> {
      const slot = slotOf(event);
      const registration: Registration = { handler: handler as (e: HubEvent<unknown>) => void, live: true };
      slot.registrations.push(registration);
      return begin(event, slot).then(() => {
        let gone = false;
        return () => {
          if (gone) return; // off() twice does nothing
          gone = true;
          registration.live = false;
          slot.registrations = slot.registrations.filter((r) => r !== registration);
          if (slot.registrations.length > 0) return;
          // The last one left: remove the backend listener once and forget it, so the next on() listens again.
          if (slots.get(event) === slot) slots.delete(event);
          const off = slot.off;
          slot.off = null;
          slot.started = null;
          if (off) off();
        };
      });
    },
    handlers(event: string): number {
      return slots.get(event)?.registrations.length ?? 0;
    },
  };
}
