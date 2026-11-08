import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RENDERER_DIR = path.join(SRC_DIR, 'renderer');
export const PRELOAD = path.join(SRC_DIR, 'preload', 'index.cjs');
export const APP_ICON = path.join(SRC_DIR, '..', 'build', 'icon.png');
// The menu-bar picture lives in src/ because build/ is not part of the packaged app.
// macOS gets the "Template" one: a black shape it tints to suit a light or dark menu bar.
export const TRAY_ICON = path.join(
  SRC_DIR,
  'main',
  'icons',
  process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'
);
