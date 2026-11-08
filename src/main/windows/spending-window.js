import { createWindow, isAlive } from './common.js';

let win = null;

/** The Spending window: one per app, with what every contact cost. Shows it and gives it the focus, wherever it was. */
export function showSpendingWindow() {
  if (isAlive(win)) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return win;
  }
  win = createWindow(
    'spending.html',
    {},
    { width: 520, height: 460, minWidth: 420, minHeight: 320, title: 'Spending' }
  );
  win.on('closed', () => {
    win = null;
  });
  return win;
}
