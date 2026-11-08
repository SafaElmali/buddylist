import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LOOKS, THEMES } from '../src/shared/theme.js';

// Settings > General's pictures of each look and each theme, as scripts/make-theme-pictures.js takes them.
const PICTURES = new URL('../src/renderer/settings/pictures/', import.meta.url);
const shown = [
  ...LOOKS.map(({ id }) => `look-${id}.webp`),
  ...LOOKS.flatMap((look) => THEMES.map((theme) => `${look.id}-${theme.id}.webp`)),
];

/** How big a WebP picture is, from its header: a simple lossy one, or one with a VP8X chunk first. */
function sizeOf(file) {
  const bytes = fs.readFileSync(new URL(file, PICTURES));
  assert.equal(bytes.toString('latin1', 8, 12), 'WEBP', file);
  const chunk = bytes.toString('latin1', 12, 16);
  if (chunk === 'VP8X') return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  assert.equal(chunk, 'VP8 ', file);
  return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
}

const markup = (value) => Object.getOwnPropertySymbols(value).map((key) => value[key])[0];
const sources = (value) =>
  [
    ...[value]
      .flat()
      .map(markup)
      .join('')
      .matchAll(/<img [^>]*>/g),
  ].map(([img]) => img);

async function loadPictures() {
  globalThis.window ??= { messenger: {} };
  globalThis.document ??= { addEventListener() {} };
  return import('../src/renderer/settings/app-pages.js');
}

test('every look has a picture, and every theme one in each look, with none that Settings doesn’t show', () => {
  for (const file of shown) assert.ok(fs.existsSync(new URL(file, PICTURES)), file);
  assert.deepEqual(fs.readdirSync(PICTURES).sort(), [...shown].sort());
});

test('each picture is a close-up the size of a card, twice over for a Retina screen', () => {
  for (const file of shown) assert.deepEqual(sizeOf(file), { width: 240, height: 150 }, file);
});

test('a look’s card shows its close-up, not the welcome wizard’s whole conversation', async () => {
  const { lookPicture } = await loadPictures();
  for (const { id } of LOOKS) {
    assert.deepEqual(
      sources(lookPicture(id)).map((img) => img.match(/src="([^"]+)"/)[1]),
      [`settings/pictures/look-${id}.webp`]
    );
  }
});

test('a theme’s card has its picture in each look, marked with the look so the one in use is shown', async () => {
  const { themePicture } = await loadPictures();
  for (const { id: theme } of THEMES) {
    const imgs = sources(themePicture(theme));
    assert.deepEqual(
      imgs.map((img) => [img.match(/data-look="([^"]+)"/)[1], img.match(/src="([^"]+)"/)[1]]),
      LOOKS.map(({ id: look }) => [look, `settings/pictures/${look}-${theme}.webp`]),
      theme
    );
    for (const img of imgs) assert.match(img, /alt=""/, 'the card’s name says what it is');
  }
});
