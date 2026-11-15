/**
 * Tiny pub/sub so any page can ask the floating ChatDock to open and
 * (optionally) send a prompt.
 *
 *    // From HomeView journey cards + starter chips, OperationsView banner:
 *    dockController.open();                      // expand the dock
 *    dockController.openAndSend("Why…");         // expand + auto-send
 *                                                // in the persistent dock
 *                                                // conversation
 *    dockController.newAndSend("Why…");          // create a fresh
 *                                                // conversation + send
 *
 * `openAndSend` continues the user's ongoing dock conversation (good for
 * "follow up"). `newAndSend` starts a new one (good for home-page entry
 * points where every click should be a clean demo).
 *
 * The dock subscribes on mount, drives its own `open` + `pending` state.
 */
type Request =
  | { action: 'open' }
  | { action: 'send'; prompt: string }
  | { action: 'new'; prompt: string };

type Listener = (req: Request) => void;

class DockController {
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  open() {
    this.listeners.forEach((fn) => fn({ action: 'open' }));
  }

  /** Open the dock's persistent conversation and send a prompt into it. */
  openAndSend(prompt: string) {
    this.listeners.forEach((fn) => fn({ action: 'send', prompt }));
  }

  /** Start a fresh conversation in the dock and send a prompt into it. */
  newAndSend(prompt: string) {
    this.listeners.forEach((fn) => fn({ action: 'new', prompt }));
  }
}

export const dockController = new DockController();
