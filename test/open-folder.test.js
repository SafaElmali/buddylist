import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from './fixtures/dom.js';

// Open folder, from a contact's menus and a project's: what the app is asked, and a dialog when it says why the
// folder wasn't opened, such as that it is gone. Before, a contact's said nothing at all.
const asked = [];
let refusal = null;
const answer = async (...args) => {
  asked.push(args);
  if (refusal) throw new Error(refusal);
};
globalThis.window = { messenger: { chat: { openFolder: answer }, projects: { reveal: answer } } };
const { openFolder, projectFolder } = await import('../src/renderer/lib/copy-folder.js');

const turn = () => new Promise((resolve) => setImmediate(resolve));
const said = (document) => [...document.body.querySelectorAll('.dialog-message')].map((p) => p.textContent.trim());
/** The dialog's OK, which puts it away: what was asked is done then. */
const ok = (document) => document.body.querySelector('.dialog .btn.default').click();

test('a contact’s Open folder asks for its folder, and says so when it is gone', async (t) => {
  const document = page(t);
  asked.length = 0;
  refusal = null;
  await openFolder('c1');
  assert.deepEqual(asked, [['c1']]);
  assert.deepEqual(said(document), [], 'nothing to say when it opens');

  refusal = 'The folder ~/.buddylist/worktrees/shop/cart isn’t there.';
  const done = openFolder('c1');
  await turn();
  assert.deepEqual(said(document), ['The folder ~/.buddylist/worktrees/shop/cart isn’t there.']);
  ok(document);
  await assert.doesNotReject(done);
  assert.deepEqual(said(document), []);
});

test('a project’s Open folder asks for its main checkout, and says so when it is gone', async (t) => {
  const document = page(t);
  asked.length = 0;
  refusal = 'The folder ~/code/shop isn’t there.';
  const done = projectFolder.openFolder({ key: 'git:/w/shop/.git', root: '/w/shop' });
  await turn();
  assert.deepEqual(asked, [['git:/w/shop/.git', 'root']]);
  assert.deepEqual(said(document), ['The folder ~/code/shop isn’t there.']);
  ok(document);
  await assert.doesNotReject(done);
});
