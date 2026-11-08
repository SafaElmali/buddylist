import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Turns } from '../src/main/turns.js';
import { mentions } from '../src/shared/mentions.js';

globalThis.window = { messenger: { app: { openExternal: (url) => opened.push(url) } } };
const { PullRequestButton } = await import('../src/renderer/chat/pull-request.js');
const opened = [];

function setup({ solo = false, pullRequest = null } = {}) {
  const ctx = {
    contact: { status: 'online', pullRequest },
    participants: [
      { id: 'claude', name: 'Claude (add-missing-analytics)', state: 'idle' },
      ...(!solo ? [{ id: 'codex', name: 'Codex', state: 'idle' }] : []),
    ],
  };
  const sent = [];
  const recipients = [];
  const errors = [];
  const button = new PullRequestButton(ctx, {
    send: (text, recipient) => {
      sent.push(text);
      recipients.push(recipient);
    },
    error: (text) => errors.push(text),
  });
  return { ctx, sent, recipients, errors, button };
}

test('after Claude hits its session limit, Create PR can ask only Codex', () => {
  const { ctx, sent, button } = setup();
  const turns = new Turns();
  turns.userSaid('@Claude (add-missing-analytics) finish this', ctx.participants);
  assert.equal(turns.next().id, 'claude');
  turns.turnEnded('claude', {
    type: 'result',
    isError: true,
    stopped: false,
    errorText: "You've hit your session limit",
  });

  const create = button.menuItems()[0];
  assert.deepEqual(sent, []);
  create.submenu[1].action();
  assert.equal(sent.length, 1);
  assert.match(sent[0], /^@Codex Create a pull request/);
  assert.deepEqual(turns.userSaid(sent[0], ctx.participants), ['codex']);
  assert.equal(turns.next().id, 'codex');
  turns.turnEnded('codex', { type: 'result', isError: false, stopped: false });
  assert.equal(turns.next(), null, 'Claude is not sent a second PR request');
});

test('a draft can also be addressed to a guest, including one paused in the chat', () => {
  const { ctx, sent, recipients, button } = setup();
  ctx.participants[1].paused = true;
  button.menuItems()[1].submenu[1].action();
  assert.match(sent[0], /^@Codex Create a draft pull request/);
  assert.match(sent[0], /gh pr create --draft/);
  assert.deepEqual(new Turns().userSaid(sent[0], ctx.participants), ['codex']);
  assert.deepEqual(recipients, [{ id: 'codex', allowPaused: true }]);
});

test('the host is still a choice, and a solo chat still sends immediately', () => {
  const group = setup();
  group.button.menuItems()[0].submenu[0].action();
  assert.deepEqual(mentions(group.sent[0], group.ctx.participants), ['claude']);
  const solo = setup({ solo: true });
  solo.button.press();
  assert.equal(solo.sent.length, 1);
  assert.match(solo.sent[0], /^Create a pull request/);
});

test('a selection follows a rename but does not fall back to the host if the guest left', () => {
  const { ctx, sent, recipients, errors, button } = setup();
  const choose = button.menuItems()[0].submenu[1].action;
  ctx.participants[1].name = 'Codex (reviewer)';
  choose();
  assert.deepEqual(mentions(sent[0], ctx.participants), ['codex']);
  assert.deepEqual(recipients, [{ id: 'codex', allowPaused: false }]);
  ctx.participants.pop();
  choose();
  assert.equal(sent.length, 1);
  assert.deepEqual(errors, ['That agent has left this conversation. Choose another agent.']);
});

test('an existing PR still opens directly in a group, without asking an agent', () => {
  const url = 'https://github.com/acme/shop/pull/12';
  const { sent, button } = setup({ pullRequest: { number: 12, state: 'open', url } });
  button.press();
  assert.equal(opened.at(-1), url);
  assert.deepEqual(sent, []);
});

test('creation stays disabled for a missing folder, including a menu opened before it disappeared', () => {
  const { ctx, sent, button } = setup();
  const choose = button.menuItems()[0].submenu[1].action;
  ctx.contact.status = 'offline';
  choose();
  button.press();
  assert.ok(button.menuItems().every(({ disabled }) => disabled));
  assert.deepEqual(sent, []);
});
