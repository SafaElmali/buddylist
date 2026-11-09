import { test } from 'node:test';
import assert from 'node:assert/strict';

// Delete on a drafted conversation on the phone: asked first, and asked again for a worktree with changes.
const messenger = {};
globalThis.window = { messenger };
const { deleteDraft } = await import('../src/renderer/phone/draft-bar.js');

const CONTACT = { id: 'cart', name: 'Claude (cart-total)' };

/** What was asked of the user and the computer, with each sheet answered as `answers` says. */
function asking(answers, replies) {
  const asked = [];
  const confirm = async (what) => {
    asked.push(['sheet', what.title, what.ok]);
    return answers.shift();
  };
  messenger.chat = {
    deleteDraft: async (id, opts) => {
      asked.push(['delete', id, opts ?? null]);
      return replies.shift();
    },
  };
  return { asked, confirm };
}

test('Delete asks first, and deletes it with its worktree', async () => {
  const { asked, confirm } = asking([true], [{ deleted: true }]);
  assert.equal(await deleteDraft(CONTACT, { confirm }), true);
  assert.deepEqual(asked, [
    ['sheet', 'Delete Claude (cart-total)?', 'Delete'],
    ['delete', 'cart', null],
  ]);
});

test('Delete called off deletes nothing', async () => {
  const { asked, confirm } = asking([false], []);
  assert.equal(await deleteDraft(CONTACT, { confirm }), false);
  assert.deepEqual(asked, [['sheet', 'Delete Claude (cart-total)?', 'Delete']]);
});

test('a worktree with uncommitted changes is asked about again, and they go only when the user says so', async () => {
  const yes = asking([true, true], [{ changes: 2 }, { deleted: true }]);
  assert.equal(await deleteDraft(CONTACT, { confirm: yes.confirm }), true);
  assert.deepEqual(yes.asked, [
    ['sheet', 'Delete Claude (cart-total)?', 'Delete'],
    ['delete', 'cart', null],
    ['sheet', 'Its worktree has 2 uncommitted changes', 'Delete them too'],
    ['delete', 'cart', { discardChanges: true }],
  ]);
  const no = asking([true, false], [{ changes: 1 }]);
  assert.equal(await deleteDraft(CONTACT, { confirm: no.confirm }), false);
  assert.deepEqual(no.asked.at(-1), ['sheet', 'Its worktree has 1 uncommitted change', 'Delete them too']);
  // Changes git could not count are asked about too.
  const unknown = asking([true, false], [{ changes: null }]);
  await deleteDraft(CONTACT, { confirm: unknown.confirm });
  assert.deepEqual(unknown.asked.at(-1), ['sheet', 'Its worktree may have uncommitted changes', 'Delete them too']);
});
