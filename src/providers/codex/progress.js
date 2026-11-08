// Some Codex tools (including code-mode exec) have no item/started event.
// Report silence independently of those events, without guessing what is running
// or interrupting a call that might already have performed an app action.
import { activityStatus } from '../../shared/activity-text.js';

export const QUIET_AFTER_MS = 60_000;

/** Wrap a session's events with one notice per quiet stretch of a running turn. */
export function progressEvents(emit) {
  let state = 'offline';
  let timer = null;
  const pending = new Map();
  const clear = () => {
    clearTimeout(timer);
    timer = null;
  };
  const arm = () => {
    clear();
    if (state !== 'working') return;
    timer = setTimeout(() => {
      timer = null;
      const activity = [...pending.values()].at(-1);
      const last = activity ? ` Last reported activity: ${activityStatus(activity)}.` : '';
      emit({
        type: 'notice',
        text:
          `No progress update from Codex for a minute.${last} ` +
          'It may still be working or waiting for a tool. You can Stop it, or send a follow-up with Send now.',
      });
    }, QUIET_AFTER_MS);
    timer.unref?.();
  };
  return (event) => {
    if (event.type === 'state') {
      state = event.state;
      if (state === 'idle' || state === 'offline') pending.clear();
      arm();
    } else if (event.type === 'result' || event.type === 'error') {
      clear();
      pending.clear();
    } else if (event.type === 'tool' && !event.sub) {
      pending.set(event.toolId, event.activity);
      arm();
    } else if (event.type === 'tool-result') {
      if (pending.delete(event.toolId)) arm();
    } else if ((event.type === 'text-delta' || event.type === 'text-end') && event.text?.trim()) {
      arm();
    }
    emit(event);
  };
}
