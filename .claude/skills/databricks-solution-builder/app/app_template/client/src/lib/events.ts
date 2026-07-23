/**
 * Tiny client-side pub/sub so feature pages can refresh when the agent
 * mutates data (chat turn completes → Operations KPIs should refetch).
 *
 * Kept intentionally dumb — no WebSocket, no server push. One turn = one
 * "data-mutated" event; subscribers decide what to reload.
 */
type Listener = () => void;

class Bus {
  private listeners = new Set<Listener>();
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  emit() {
    this.listeners.forEach((l) => l());
  }
}

export const dataMutated = new Bus();
