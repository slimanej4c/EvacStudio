export const DEFAULT_AUTO_SAVE_INTERVAL = 20;

export function normalizeAutoSaveInterval(value: unknown): number {
  const parsed = Number(value);
  return value === null || value === "" || !Number.isFinite(parsed)
    ? DEFAULT_AUTO_SAVE_INTERVAL
    : Math.max(5, Math.min(600, Math.round(parsed)));
}

export interface AutoSaveState {
  dirty: boolean;
  blocked: boolean;
}

/** One clock per editor: edits update the state read by tick, never the timer. */
export function createAutoSaveController({
  intervalSeconds,
  readState,
  save,
  onCountdown,
  now = Date.now,
}: {
  intervalSeconds: number;
  readState: () => AutoSaveState;
  save: () => Promise<unknown>;
  onCountdown: (seconds: number) => void;
  now?: () => number;
}) {
  const interval = normalizeAutoSaveInterval(intervalSeconds);
  let deadline: number | null = null;
  let pending = false;
  let disposed = false;

  return {
    async tick() {
      if (disposed || pending) return;
      const state = readState();
      if (!state.dirty || state.blocked) {
        deadline = null;
        onCountdown(interval);
        return;
      }
      deadline ??= now() + interval * 1000;
      const remaining = Math.max(0, Math.ceil((deadline - now()) / 1000));
      onCountdown(remaining);
      if (remaining > 0) return;

      pending = true;
      try {
        await save();
      } finally {
        // An unsuccessful save remains dirty and is retried after a full interval.
        // Edits made during a request also get their own next save.
        deadline = null;
        pending = false;
        if (!disposed) onCountdown(interval);
      }
    },
    dispose() {
      disposed = true;
    },
  };
}
