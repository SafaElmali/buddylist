import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FILE_FIND_LIMIT, fileMatches, fileFindCount, nextFileMatch } from '../src/shared/in-file-find.js';
import { FileFindFocus } from '../src/renderer/chat/file-find-focus.js';
import { isFindKey } from '../src/shared/terminal.js';
import { el } from '../src/renderer/lib/dom.js';
import { page } from './fixtures/dom.js';

test('file search is literal, including every regular expression metacharacter', () => {
  const query = '.*+?^${}()|[]\\';
  assert.deepEqual(fileMatches(`before ${query} after`, query), {
    matches: [{ start: 7, end: 7 + query.length }],
    capped: false,
  });
  assert.deepEqual(fileMatches('anything', ''), { matches: [], capped: false });
  assert.deepEqual(fileMatches('', 'anything'), { matches: [], capped: false });
});

test('case folding keeps offsets in the original text, with optional exact case', () => {
  const text = 'İx Cat cat CAT 🐈 cat';
  assert.deepEqual(
    fileMatches(text, 'cat').matches.map(({ start }) => start),
    [3, 7, 11, 18]
  );
  assert.deepEqual(fileMatches(text, 'Cat', { matchCase: true }).matches, [{ start: 3, end: 6 }]);
  assert.equal(fileMatches('K kelvin', 'k').matches.length, 2);
});

test('file matches cross lines and retain whitespace without overlapping results', () => {
  assert.deepEqual(fileMatches('one\ntwo\none\ntwo', 'one\ntwo').matches, [
    { start: 0, end: 7 },
    { start: 8, end: 15 },
  ]);
  assert.deepEqual(fileMatches('aaaaa', 'aa').matches, [
    { start: 0, end: 2 },
    { start: 2, end: 4 },
  ]);
  assert.deepEqual(fileMatches('a  b', '  ').matches, [{ start: 1, end: 3 }]);
});

test('large files stop at the match limit and distinguish exactly full from capped', () => {
  const full = fileMatches('x '.repeat(FILE_FIND_LIMIT), 'x');
  assert.equal(full.matches.length, FILE_FIND_LIMIT);
  assert.equal(full.capped, false);
  const capped = fileMatches('x '.repeat(500000), 'x');
  assert.equal(capped.matches.length, FILE_FIND_LIMIT);
  assert.equal(capped.capped, true);
  assert.deepEqual(capped.matches.at(-1), { start: 3998, end: 3999 });
  assert.equal(fileFindCount('x', 2, capped), '3 of 2,000+');
  assert.equal(fileFindCount('x', 2, full), '3 of 2,000');
  assert.equal(fileFindCount('', -1, fileMatches('', '')), '');
  assert.equal(fileFindCount('z', -1, fileMatches('a', 'z')), 'No matches');
});

test('navigation starts at either end and wraps in both directions', () => {
  assert.equal(nextFileMatch(-1, 3), 0);
  assert.equal(nextFileMatch(-1, 3, true), 2);
  assert.equal(nextFileMatch(0, 3), 1);
  assert.equal(nextFileMatch(2, 3), 0);
  assert.equal(nextFileMatch(0, 3, true), 2);
  assert.equal(nextFileMatch(2, 3, true), 1);
  assert.equal(nextFileMatch(0, 1, true), 0);
  assert.equal(nextFileMatch(0, 0), -1);
});

function routing(t) {
  page(t);
  const root = el(`<div><textarea></textarea><div class="menubar"><button>Edit</button></div>
    <div class="pane"><div class="pane-tab" data-id="file:a.js">a.js</div>
      <div class="file-tab"><div class="file-view"><span>code</span></div><input /></div>
      <div class="files-tab"><button>folder</button></div><div class="changes-tab"></div>
      <div class="terminal-tab"><textarea></textarea></div>
    </div><div class="popup"><input /></div></div>`);
  globalThis.document.body.append(root);
  const body = root.querySelector('.file-tab');
  const tabs = [{ id: 'file:a.js', body }];
  const focus = new FileFindFocus();
  const get = (selector) => root.querySelector(selector);
  return { focus, tabs, body, get, target: (node) => focus.target(node, tabs) };
}

test('Find follows file focus, its find field, and the last pointer interaction', (t) => {
  const { focus, body, get, target } = routing(t);
  assert.equal(target(get('.file-view span')), body);
  assert.equal(target(get('.file-tab input')), body);
  focus.remember(get('.file-view span'));
  assert.equal(target(get('textarea')), body, 'pointer in the file wins over stale composer focus');
  focus.remember(get('textarea'));
  assert.equal(target(get('textarea')), null, 'returning to the composer restores conversation Find');
  focus.remember(get('.pane-tab'));
  assert.equal(target(get('textarea')), body, 'the file tab label counts too');
});

test('menus preserve scope; lists, terminals and other controls never claim file Find', (t) => {
  const { focus, body, get, target } = routing(t);
  focus.remember(get('.file-view'));
  focus.remember(get('.menubar button'));
  focus.remember(get('.popup input'));
  assert.equal(target(get('.popup input')), body);
  for (const selector of ['.files-tab button', '.changes-tab', '.terminal-tab textarea', 'textarea']) {
    focus.remember(get(selector));
    assert.equal(target(get(selector)), null, selector);
  }
});

test('hidden, closed and collapsed file tabs cannot take Find', (t) => {
  const { focus, body, get, tabs, target } = routing(t);
  focus.remember(get('.file-view'));
  body.hidden = true;
  assert.equal(target(get('textarea')), null);
  body.hidden = false;
  get('.pane').classList.add('collapsed');
  assert.equal(target(get('textarea')), null);
  get('.pane').classList.remove('collapsed');
  tabs.length = 0;
  assert.equal(target(get('textarea')), null);
});

test('explicit conversation Find keeps the shortcut when it was opened from a file', (t) => {
  const { focus, get, target } = routing(t);
  focus.remember(get('.file-view'));
  const box = el('<div class="find-box"><input /></div>');
  get('.popup').append(box);
  focus.remember(box.querySelector('input'));
  assert.equal(target(box.querySelector('input')), null);
});

test('file Find uses Command-F on Mac and Control-F on Windows/Linux, keeping terminal keys', () => {
  const mac = { key: 'f', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false };
  const pc = { ...mac, metaKey: false, ctrlKey: true };
  assert.equal(isFindKey(mac, true, false), true);
  assert.equal(isFindKey(pc, false, false), true);
  assert.equal(isFindKey(pc, false, true), false);
  assert.equal(isFindKey({ ...pc, shiftKey: true }, false, true), true);
});
