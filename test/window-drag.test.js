// Where a window moves from when it is grabbed: its title bar, less the buttons in it (see styles/frame.css).
// scripts/check-title-bar-drag-ui.js maps it in the real app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const RENDERER = new URL('../src/renderer/', import.meta.url);
const STYLES = new URL('styles/', RENDERER);
const read = (url) => fs.readFileSync(url, 'utf8');
const sheets = fs
  .readdirSync(STYLES)
  .filter((file) => file.endsWith('.css'))
  .map((file) => ({ file, css: read(new URL(file, STYLES)) }));

/** Every app-region a stylesheet gives, with the selector it gives it to. */
const regions = sheets.flatMap(({ file, css }) =>
  [...css.matchAll(/([^{};]*)\{[^{}]*?-webkit-app-region:\s*([\w-]+)/g)].map(([, selector, value]) => ({
    file,
    selector: selector.replace(/\/\*[\s\S]*?\*\//g, '').trim(),
    value,
  }))
);

test('no box moves the window, or keeps it still, unless a rule says so', () => {
  // app-region is passed down, and every box with one is sent as a rect as big as the box, scrolled out of sight
  // or not: without this, messages or contacts scrolled up would lay their no-drag over the title bar. On `*`, so
  // any rule that names a box wins over it.
  assert.deepEqual(
    regions.filter(({ value }) => value === 'initial'),
    [{ file: 'frame.css', selector: '*', value: 'initial' }]
  );
  // `none` would read as no-drag in Electron's Chromium, and `inherit` or `unset` would pass a region down again.
  assert.deepEqual(
    regions.filter(({ value, selector }) => !['drag', 'no-drag'].includes(value) && selector !== '*'),
    []
  );
});

test('every window with a title bar has that rule', () => {
  const pages = fs.readdirSync(RENDERER).filter((file) => file.endsWith('.html'));
  const framed = pages.filter((page) => /class="[^"]*\btitlebar\b/.test(read(new URL(page, RENDERER))));
  assert.ok(framed.includes('contacts.html') && framed.includes('chat.html'), framed.join(', '));
  for (const page of framed) {
    assert.match(read(new URL(page, RENDERER)), /href="styles\/frame\.css"/, page);
  }
});

test('menus, dialogs and a card with a link take a click where they cover the title bar', () => {
  // They float over the window from outside it, so nothing else keeps them from moving it.
  const noDrag = regions.filter(({ value }) => value === 'no-drag').map(({ selector }) => selector);
  for (const layer of ['.popup', '.dialog', '.contact-card.has-link']) assert.ok(noDrag.includes(layer), layer);
});
