// Hands an error nothing caught in this window to the main process, which reports it with its
// own (src/main/error-reports.js). A window reaches nothing but the main process.
import { api } from './api.js';
import { describeError, WINDOW_REPORTS_MAX } from '../../shared/error-reports.js';

let left = WINDOW_REPORTS_MAX;

function report(thrown) {
  if (left <= 0) return;
  left -= 1;
  // A built script says which source map reads its stacks (see cleanErrorReport).
  const handed = api.errors.report({ ...describeError(thrown), debugIds: globalThis._sentryDebugIds });
  // A report that didn't get there is not worth another one.
  handed.catch(() => {});
}

// An error from a script the page may not look into comes without the error itself.
window.addEventListener('error', (event) => report(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => report(event.reason));
