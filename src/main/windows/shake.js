// The MSN "nudge": jiggle a window around for half a second.
import { SHAKE_MS, shakenTo } from '../../shared/nudge.js';
import { isAlive } from './common.js';

const shaking = new WeakSet();

export function shake(win) {
  if (!isAlive(win) || shaking.has(win) || win.isMaximized() || win.isFullScreen()) return;
  shaking.add(win);
  const from = win.getPosition();
  const started = Date.now();
  const timer = setInterval(() => {
    const t = (Date.now() - started) / SHAKE_MS;
    if (!isAlive(win) || t >= 1) {
      clearInterval(timer);
      shaking.delete(win);
      if (isAlive(win)) win.setPosition(...from);
      return;
    }
    win.setPosition(...shakenTo(from, t));
  }, 16);
}
