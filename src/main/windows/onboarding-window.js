import { createWindow, isAlive } from './common.js';

let win = null;

/**
 * The welcome wizard: one per app. Shows it and gives it the focus, wherever it was.
 * @param {{ onClosed?: () => void }} [opts]  `onClosed`: told when the window it opens is gone again
 */
export function showOnboardingWindow({ onClosed = () => {} } = {}) {
  if (isAlive(win)) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return win;
  }
  // As tall as "Add a Contact" is in a repository with a main line to start from: the wizard ends in that dialog.
  win = createWindow('onboarding.html', undefined, {
    width: 680,
    height: 610,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Welcome to buddylist',
  });
  win.on('closed', () => {
    win = null;
    onClosed();
  });
  return win;
}
