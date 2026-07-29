export class WorkflowEventBus<TEvents extends Record<string, unknown>> {
  private listeners = new Map<keyof TEvents, Set<(payload: TEvents[keyof TEvents]) => void>>();

  on<TKey extends keyof TEvents>(event: TKey, listener: (payload: TEvents[TKey]) => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener as (payload: TEvents[keyof TEvents]) => void);
    this.listeners.set(event, listeners);

    return () => {
      listeners.delete(listener as (payload: TEvents[keyof TEvents]) => void);
      if (listeners.size === 0) this.listeners.delete(event);
    };
  }

  emit<TKey extends keyof TEvents>(event: TKey, payload: TEvents[TKey]) {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    for (const listener of listeners) listener(payload);
  }
}
