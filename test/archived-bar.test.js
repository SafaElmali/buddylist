import { test } from 'node:test';
import assert from 'node:assert/strict';
import { READING_ACTIONS, archiveChangedSince } from '../src/renderer/chat/archived-bar.js';
import { archivedBecause, stuckBecause } from '../src/renderer/history/held.js';

test('the line over an archived contact’s conversation says what its message history says', () => {
  const contact = { id: 'c1', name: 'Codex', cwd: '/p', archived: true };
  assert.equal(archivedBecause(contact), 'Codex is archived. Restore it to continue a conversation');
  assert.equal(stuckBecause({ cwd: '/p', current: true }, contact), archivedBecause(contact));
});

test('a window is drawn again when archived or restored, keeping other contact updates in place', () => {
  assert.equal(archiveChangedSince({ archived: true }, { archived: false }), true);
  assert.equal(archiveChangedSince({ archived: true }, {}), true, 'a restored contact has no archived flag at all');
  assert.equal(archiveChangedSince({ archived: true }, { archived: true }), false, 'still archived: renamed, say');
  assert.equal(archiveChangedSince({}, {}), false, 'a live conversation goes on as it is');
  assert.equal(archiveChangedSince({ archived: false }, { archived: true }), true, 'archive becomes read-only');
  assert.equal(archiveChangedSince({}, { archived: true }), true, 'active contacts usually have no archived flag');
  assert.equal(archiveChangedSince(null, {}), false, 'before the window knows its contact');
  assert.equal(archiveChangedSince(null, { archived: true }), false, 'initial load already draws its archive state');
});

test('what another window asks an archived contact’s conversation to do: only what reads what is beside it', () => {
  assert.deepEqual([...READING_ACTIONS].sort(), ['changes', 'checks']);
  for (const asking of ['fixConflicts', 'invite', 'terminal', 'pullRequest'])
    assert.equal(READING_ACTIONS.has(asking), false);
});
