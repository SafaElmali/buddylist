// The app's icon in its windows: a title bar, the toast, Help > About and the welcome wizard show the picture
// `npm run icon` draws (scripts/make-icon.js), at the size each shows it and at twice it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setImmediate as tick } from 'node:timers/promises';
import { Element, page } from './fixtures/dom.js';

const RENDERER = new URL('../src/renderer/', import.meta.url);
globalThis.window = { messenger: { on: { windowState() {} } }, addEventListener() {}, removeEventListener() {} };
globalThis.Element = Element;
// What frame.js reads of the page as it loads: a window whose menus are in it, as in a browser.
globalThis.document = { documentElement: { classList: { toggle() {} } } };
globalThis.location = { protocol: 'http:' };
const { APP_ICON_SIZES, appIcon, appIconFiles } = await import('../src/renderer/lib/icons.js');
const { mountFrame } = await import('../src/renderer/lib/frame.js');
const { aboutItem } = await import('../src/renderer/lib/help.js');

/** A PNG's width and height, from its header. */
const pngSize = (file) => {
  const png = fs.readFileSync(new URL(file, RENDERER));
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
};

/** A page whose elements take markup as a browser's do, which mountFrame gives a title bar. */
function framePage(t) {
  const document = page(t);
  document.querySelector = (selector) => document.body.querySelector(selector);
  Object.defineProperty(Element.prototype, 'innerHTML', {
    configurable: true,
    set(markup) {
      const template = document.createElement('template');
      template.innerHTML = `<div>${markup}</div>`;
      this.replaceChildren(...template.content.firstElementChild.childNodes);
    },
  });
  t.after(() => delete Element.prototype.innerHTML);
  return document;
}

/** What an <img> shows: its picture, the one for a screen of twice the pixels, and its size. */
const shows = (img) => ({
  src: img.getAttribute('src'),
  srcset: img.getAttribute('srcset'),
  size: [Number(img.getAttribute('width')), Number(img.getAttribute('height'))],
  alt: img.getAttribute('alt'),
});
/** The app icon at `size`, as a window shows it. */
const appIconAt = (size) => {
  const [picture, twice] = appIconFiles(size);
  return { src: picture, srcset: `${twice} 2x`, size: [size, size], alt: '' };
};

test('each size the windows show the app icon at is drawn at that size, and at twice it', () => {
  assert.deepEqual(APP_ICON_SIZES, [16, 48]);
  for (const size of APP_ICON_SIZES) {
    const [picture, twice] = appIconFiles(size);
    assert.deepEqual(pngSize(picture), [size, size], picture);
    assert.deepEqual(pngSize(twice), [size * 2, size * 2], twice);
  }
});

test('the windows have no picture of the app icon that none of them shows', () => {
  const drawn = APP_ICON_SIZES.flatMap(appIconFiles).map((file) => file.replace('pictures/', ''));
  assert.deepEqual(fs.readdirSync(new URL('pictures/', RENDERER)).sort(), drawn.sort());
});

test('appIcon is the picture at its size, with the sharper one for a screen of twice the pixels', (t) => {
  const document = page(t);
  const template = document.createElement('template');
  template.innerHTML = appIcon(48);
  assert.deepEqual(shows(template.content.firstElementChild), appIconAt(48));
});

test('a window’s title bar shows the app icon at 16, not the old mark', (t) => {
  const document = framePage(t);
  document.body.replaceChildren(document.createElement('div'));
  document.body.firstElementChild.className = 'window';
  const titlebar = document.createElement('header');
  titlebar.className = 'titlebar';
  document.body.firstElementChild.append(titlebar);
  mountFrame({ title: 'buddylist' });
  const icon = titlebar.querySelector('.titlebar-icon');
  assert.equal(icon.children.length, 1);
  assert.deepEqual(shows(icon.querySelector('img')), appIconAt(16));
  assert.equal(titlebar.querySelector('.titlebar-text').textContent, 'buddylist');
});

test('Help > About shows the app icon at 48 beside the version', async (t) => {
  const document = page(t);
  const closed = aboutItem(async () => '1.2.3').action();
  await tick();
  const about = document.body.querySelector('.about');
  const mark = about.querySelector('.about-mark');
  assert.equal(mark.children.length, 1);
  assert.deepEqual(shows(mark.querySelector('img')), appIconAt(48));
  assert.match(about.querySelector('p').textContent, /buddylist 1\.2\.3/);
  document.body.querySelector('.modal .buttons .btn').click();
  assert.equal(await closed, true);
});

test('the toast shows the app icon at 16 beside the app’s name, from its page', () => {
  const toast = fs.readFileSync(new URL('toast.html', RENDERER), 'utf8');
  const [, attrs] = toast.match(/<span class="toast-mark">\s*<img([^>]*)>\s*<\/span>\s*<span class="toast-app">/);
  const says = (name) => attrs.match(new RegExp(`\\s${name}="([^"]*)"`))[1];
  assert.deepEqual(
    {
      src: says('src'),
      srcset: says('srcset'),
      size: [Number(says('width')), Number(says('height'))],
      alt: says('alt'),
    },
    appIconAt(16)
  );
});
