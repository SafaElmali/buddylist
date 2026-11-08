import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answeringParticipants, requestRecipients } from '../src/shared/send-targets.js';
import { dispatchRequest } from '../src/renderer/chat/request-send.js';
import { Checks } from '../src/renderer/chat/checks.js';
import { page } from './fixtures/dom.js';

const owner = { id: 'owner', name: 'Owner', paused: true };
const guest = { id: 'guest', name: 'Guest' };
const other = { id: 'other', name: 'Other' };
const participants = [owner, guest, other];

test('implicit button requests skip a paused owner and follow the ordinary answer order', () => {
  assert.deepEqual(requestRecipients('Fix this', participants).ids, [guest.id]);
  assert.deepEqual(requestRecipients('Fix this', participants, {}, ['other', 'owner']).ids, [other.id]);
  assert.deepEqual(
    answeringParticipants(participants).map(({ id }) => id),
    [guest.id, other.id]
  );
  assert.deepEqual(requestRecipients('Fix this', [{ ...guest, afterChanges: true }, other]).ids, [other.id]);
});

test('explicit active recipients and mentions keep their targets; paused selections require a choice', () => {
  assert.deepEqual(requestRecipients('Fix this', participants, { id: other.id }).ids, [other.id]);
  assert.match(requestRecipients('Fix this', participants, { id: owner.id }).blocked, /Owner is paused/);
  assert.deepEqual(requestRecipients('Fix this', participants, { id: owner.id, allowPaused: true }).ids, [owner.id]);
  assert.match(requestRecipients('Fix this', participants, { id: 'gone' }).blocked, /left this conversation/);
  assert.deepEqual(requestRecipients('@Owner @Guest @Owner help', participants, { mentions: true }).ids, [
    owner.id,
    guest.id,
  ]);
  assert.deepEqual(requestRecipients('A failed check:\n@Owner failed here', participants).ids, [guest.id]);
  assert.equal(owner.paused, true);
  assert.match(requestRecipients('Fix this', [owner]).blocked, /Resume an agent/);
});

test('a blocked request resumes only the chosen agent, then submits once; dismissal sends nothing more', async () => {
  const sent = [];
  const resumed = [];
  const blocked = { blocked: 'Everyone is paused', participants: [owner] };
  const accepted = { id: 'message' };
  const handlers = {
    send: async (message) => {
      sent.push(message);
      return sent.length === 1 ? blocked : accepted;
    },
    choose: async () => owner,
    resume: async (id) => resumed.push(id),
  };
  assert.equal(await dispatchRequest({ text: 'Fix this', recipient: {} }, handlers), accepted);
  assert.deepEqual(resumed, [owner.id]);
  assert.deepEqual(
    sent.map(({ recipient }) => recipient),
    [{}, { id: owner.id }]
  );
  sent.length = 0;
  resumed.length = 0;
  assert.equal(
    await dispatchRequest({ text: 'Fix this', recipient: {} }, { ...handlers, choose: async () => null }),
    null
  );
  assert.equal(sent.length, 1);
  assert.deepEqual(resumed, []);
});

test('an uncertain dispatch failure is never retried', async () => {
  let sends = 0;
  await assert.rejects(
    dispatchRequest(
      { text: 'Fix this', recipient: {} },
      {
        send: async () => {
          sends += 1;
          throw new Error('Connection lost');
        },
        choose: () => assert.fail('must not offer a retry after an uncertain result'),
        resume: () => assert.fail('must not resume'),
      }
    ),
    /Connection lost/
  );
  assert.equal(sends, 1);
});

test('Checks waits for acceptance, blocks overlapping sends, and leaves cancelled requests unsent', async (t) => {
  page(t);
  const failures = [
    { name: 'lint', standing: 'fail', reason: ['Failed'] },
    { name: 'tests', standing: 'fail' },
  ];
  const messages = [];
  let finish;
  const checks = new Checks(
    {},
    { contactId: 'owner' },
    {
      list: async () => ({ pullRequest: true, checks: failures.map((check) => ({ ...check })) }),
      send: (text) => {
        messages.push(text);
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    }
  );
  await checks.refresh();
  const sending = checks.send([failures[0]]);
  await checks.send(failures);
  assert.equal(messages.length, 1);
  assert.doesNotMatch(messages[0], /^@/);
  assert.equal(checks.body.querySelector('.check-sent'), null);
  assert.equal(checks.body.querySelector('[data-do="send-all"]').disabled, true);
  finish(false);
  await sending;
  assert.equal(checks.body.querySelector('.check-sent'), null);
  assert.equal(checks.body.querySelector('[data-do="send-all"]').disabled, false);
  const accepted = checks.send(failures);
  await checks.refresh();
  assert.equal(checks.body.querySelector('[data-do="send-all"]').hasAttribute('disabled'), true);
  finish(true);
  await accepted;
  assert.equal(checks.body.querySelectorAll('.check-sent').length, 2);
});
