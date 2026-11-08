// Loaded into the app's main process before anything else when a feature video films it (see film.js), with
// electron -r. Its windows go on drawing themselves, for the film, where nobody sees them: see-through, deaf to
// the mouse, and never in front of what you are doing. The pages are told that they have the focus over the
// DevTools protocol instead (see film.js), and every page's Math.random starts the same way on every take,
// so the app shows the same tips and pictures each time.
const { app, BrowserWindow } = require('electron');

// Shown without taking the focus, and never given it.
BrowserWindow.prototype.show = function show() {
  this.showInactive();
};
BrowserWindow.prototype.focus = function focus() {};

const SEEDED = `(() => {
  let a = 7;
  Math.random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();`;

app.on('browser-window-created', (_event, win) => {
  win.setOpacity(0);
  win.setIgnoreMouseEvents(true);
});

app.on('web-contents-created', (_event, contents) => {
  try {
    contents.debugger.attach('1.3');
    contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: SEEDED }).catch(() => {});
  } catch {
    // Already attached to: it starts unseeded.
  }
});

// No icon in the Dock, and no turn at the front.
app.whenReady().then(() => app.setActivationPolicy('accessory'));
