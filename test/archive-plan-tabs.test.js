import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Plans } from '../src/renderer/chat/plans.js';

function fixture() {
  const closed = [];
  const plans = new Plans(
    {
      close: (id, options) => {
        assert.deepEqual(options, { unavailable: true }, 'cleared pinned plans must lose their old content');
        closed.push(id);
      },
    },
    { participants: [{ id: 'fixture-agent', name: 'Fixture agent' }] },
    () => assert.fail('clearing a plan must not answer it'),
    () => assert.fail('clearing a plan must not read its file')
  );
  const file = plans.addFile('docs/plans/archive.md');
  const otherFile = plans.addFile('implementation-plan.md');
  const pending = plans.addHistory({ id: 'pending', plan: '# Awaiting approval', decision: null });
  const answered = plans.addHistory({ id: 'answered', plan: '# Approved plan', decision: 'approve-plan' });
  // No DOM is needed: keeping the same body is what preserves an open tab's scroll and selection.
  file.body = { fixture: 'existing plan pane' };
  return { plans, closed, file, otherFile, pending, answered };
}

test('archive redraw retains saved file plan panes while removing plans that asked for an answer', () => {
  const { plans, closed, file, otherFile, pending, answered } = fixture();
  const body = file.body;

  plans.clear({ keepFiles: true });

  assert.deepEqual(closed, [pending.id, answered.id]);
  assert.deepEqual([...plans.plans.values()], [file, otherFile]);
  assert.equal(plans.size, 2);
  assert.equal(plans.addFile(file.file), file, 'replaying saved history reuses the retained plan');
  assert.equal(file.body, body, 'the existing pane contents stay intact');

  plans.clear({ keepFiles: true });
  assert.deepEqual(closed, [pending.id, answered.id], 'repeated archive redraw does not close retained files');
});

for (const options of [undefined, { keepFiles: false }]) {
  test(`ordinary clear removes all plan panes with ${options ? 'keepFiles false' : 'default options'}`, () => {
    const { plans, closed, file, otherFile, pending, answered } = fixture();

    plans.clear(options);

    assert.deepEqual(closed, [file.id, otherFile.id, pending.id, answered.id]);
    assert.equal(plans.size, 0);
  });
}

test('starting over after an archive redraw still removes its retained file plan panes', () => {
  const { plans, closed, file, otherFile, pending, answered } = fixture();
  plans.clear({ keepFiles: true });

  plans.clear();

  assert.deepEqual(closed, [pending.id, answered.id, file.id, otherFile.id]);
  assert.equal(plans.size, 0);
});
