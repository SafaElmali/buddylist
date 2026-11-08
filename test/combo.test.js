import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chosenOf, comboItems } from '../src/renderer/lib/combo.js';
import { avatarSvg, pictureArt, pictureHtml } from '../src/renderer/lib/pictures.js';
import { packUrl } from '../src/shared/pack.js';

const SERVICES = [
  { value: 'claude', label: 'Claude', icon: '<svg id="claude"></svg>' },
  { value: 'codex', label: 'Codex', icon: '<svg id="codex"></svg>' },
  { value: 'gemini', label: 'Gemini', icon: '<svg id="gemini"></svg>' },
];

test('what is chosen is the choice the field holds', () => {
  assert.equal(chosenOf(SERVICES, 'codex'), SERVICES[1]);
  assert.equal(chosenOf(SERVICES, 'gemini'), SERVICES[2]);
});

test('a field holding none of the choices shows the first, as a select does', () => {
  assert.equal(chosenOf(SERVICES, 'pack:deleted.png'), SERVICES[0]);
  assert.equal(chosenOf(SERVICES, ''), SERVICES[0]);
  assert.equal(chosenOf([], 'claude'), undefined, 'nothing to show without choices');
});

test('every choice is a row with its picture and name, and only the chosen one is ticked', () => {
  const items = comboItems(SERVICES, 'codex', () => {});
  assert.deepEqual(
    items.map(({ label, icon, hint }) => ({ label, icon, hint })),
    [
      { label: 'Claude', icon: '<svg id="claude"></svg>', hint: '' },
      { label: 'Codex', icon: '<svg id="codex"></svg>', hint: '✓' },
      { label: 'Gemini', icon: '<svg id="gemini"></svg>', hint: '' },
    ]
  );
  assert.ok(
    items.every((item) => !item.checked),
    'a tick in place of the picture would hide the chosen one’s picture'
  );
});

test('a choice’s hint is said when its row is pointed at, as an option’s title was', () => {
  const levels = [
    { value: '', label: 'Default', hint: 'The model’s own level' },
    { value: 'high', label: 'High' },
  ];
  assert.deepEqual(
    comboItems(levels, 'high', () => {}).map(({ label, title, hint }) => ({ label, title, hint })),
    [
      { label: 'Default', title: 'The model’s own level', hint: '' },
      { label: 'High', title: undefined, hint: '✓' },
    ]
  );
});

test('choosing another row picks its value', () => {
  const picked = [];
  const items = comboItems(SERVICES, 'claude', (value) => picked.push(value));
  items[2].action();
  items[1].action();
  assert.deepEqual(picked, ['gemini', 'codex']);
});

test('choosing the chosen row again changes nothing, so the form does not start that service over', () => {
  const picked = [];
  comboItems(SERVICES, 'codex', (value) => picked.push(value))[1].action();
  assert.deepEqual(picked, []);
});

test('a built-in display picture is drawn as its art, without the frame', () => {
  assert.equal(pictureArt('claude-code').replace(/p\d+/g, ''), avatarSvg('claude-code').replace(/p\d+/g, ''));
  assert.match(pictureArt('claude'), /^<svg /);
  assert.doesNotMatch(pictureArt('claude'), /class="dp/);
});

test('a picture from the pack is drawn as the image from the pack', () => {
  assert.equal(pictureArt('pack:Cat & Dog.png'), `<img src="${packUrl('pictures', 'Cat & Dog.png')}" alt="">`);
});

test('a framed picture still holds the same art, or the picture it is given', () => {
  assert.ok(pictureHtml({ avatar: 'pack:cat.png', size: 'small' }).includes(pictureArt('pack:cat.png')));
  assert.ok(pictureHtml({ avatar: 'codex' }).includes(avatarSvg('codex')));
  assert.ok(pictureHtml({ src: 'file:///me.png', avatar: 'codex' }).includes('<img src="file:///me.png" alt="">'));
});
