// link_pull_request: the app tool an agent links a pull request to its conversation with, and who is asked first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { LINK_ACTS, appTools } from '../src/main/app-tools.js';
import { APP_TOOLS, appActivity } from '../src/shared/app-tools.js';
import { activityRequest, activityStatus, appDone } from '../src/shared/activity-text.js';

const PR45 = {
  number: 45,
  url: 'https://github.com/example/shop/pull/45',
  title: 'Round the cart total before tax',
  state: 'open',
  checks: { failing: 1, pending: 0, passed: 8 },
  linked: true,
};

/** The tools of a worker, a project's manager and a contact on This computer, with links that note what they did. */
function setup({ saying = { decision: 'allow' }, linking = async () => PR45, shownAfterUnlink = null } = {}) {
  const done = [];
  const questions = [];
  const contacts = [{ id: 'worker' }, { id: 'manager', manages: 'git:/code/shop/.git' }, { id: 'computer' }];
  const links = {
    offered: (hostId) => hostId === 'worker',
    link: async (hostId, text) => {
      done.push(['link', hostId, text]);
      return linking(text);
    },
    unlink: (hostId) => {
      done.push(['unlink', hostId]);
      return shownAfterUnlink;
    },
  };
  const toolsFor = appTools({
    store: { getContact: (id) => contacts.find((c) => c.id === id), settings: {} },
    terminals: { wanted: () => true },
    startConversation: async () => ({ name: 'x', worktree: true }),
    instructions: { of: async () => ({ key: 'k', name: 'shop', instructions: {} }), save() {} },
    links,
  });
  const context = {
    ask: async (request) => {
      questions.push(request);
      return saying;
    },
  };
  const tool = (hostId, seat) => {
    const found = toolsFor(hostId, hostId, seat).find((t) => t.name === APP_TOOLS.link);
    return found && { ...found, run: (input) => found.run(input, context) };
  };
  return { tool, done, questions };
}

test('a worker is offered link_pull_request; a manager and a contact on This computer are not', () => {
  const { tool } = setup();
  assert.ok(tool('worker'));
  assert.equal(tool('manager'), undefined);
  assert.equal(tool('computer'), undefined);
  assert.equal(
    appTools({
      store: { getContact: () => ({ id: 'worker' }), settings: {} },
      terminals: { wanted: () => true },
      startConversation: async () => ({}),
      instructions: { of: async () => ({}), save() {} },
    })('worker').some((t) => t.name === APP_TOOLS.link),
    false,
    'without links nobody is offered it'
  );
});

test('it takes a number or link, or unlink, and nothing longer than a link', () => {
  const { tool } = setup();
  const takes = (input) => z.object(tool('worker').input).safeParse(input).success;
  assert.ok(takes({ pull_request: '#45' }));
  assert.ok(takes({ pull_request: 'https://github.com/example/shop/pull/45' }));
  assert.ok(takes({ unlink: true }));
  assert.equal(takes({ pull_request: 'x'.repeat(301) }), false);
});

test('an agent that changes files links unasked and is told how the pull request stands', async () => {
  const { tool, done, questions } = setup();
  const said = await tool('worker').run({ pull_request: '#45' });
  assert.deepEqual(done, [['link', 'worker', '#45']]);
  assert.deepEqual(questions, [], 'nothing on GitHub changes, and Unlink takes it back');
  assert.match(said, /^Linked pull request #45 \(Round the cart total before tax\) to this conversation: /);
  assert.match(said, /#45: 1 check failing/);
  assert.equal(tool('worker').ask({ pull_request: '#45' }), false);
});

test('a read-only agent is asked on a card every time, and nothing is linked without a yes', async () => {
  for (const [decision, linked] of [
    ['allow', true],
    ['deny', false],
    ['cancelled', false],
  ]) {
    const { tool, done, questions } = setup({ saying: { decision } });
    const run = tool('worker', { readOnly: true }).run({ pull_request: '45' });
    if (linked) await run;
    else await assert.rejects(run, /Nothing was linked/);
    assert.equal(done.length, linked ? 1 : 0, decision);
    assert.equal(questions.length, 1);
    assert.equal(questions[0].kind, 'tool');
    assert.equal(questions[0].canAlways, false);
    assert.equal(questions[0].reason, LINK_ACTS);
    assert.deepEqual(questions[0].activity, { kind: 'app', action: 'link-pr', label: '#45' });
  }
});

test('a read-only agent is asked before unlinking too', async () => {
  const { tool, done, questions } = setup({ saying: { decision: 'deny' } });
  await assert.rejects(tool('worker', { readOnly: true }).run({ unlink: true }), /Nothing was linked or unlinked/);
  assert.deepEqual(done, []);
  assert.deepEqual(questions[0].activity, { kind: 'app', action: 'link-pr', unlink: true });
});

test('unlinking says what is shown now', async () => {
  assert.equal(
    await setup({ shownAfterUnlink: { number: 48 } })
      .tool('worker')
      .run({ unlink: true }),
    'Unlinked. The title bar shows pull request #48 of this branch again.'
  );
  assert.equal(
    await setup().tool('worker').run({ unlink: true }),
    'Unlinked. This conversation shows no pull request now.'
  );
});

test('why a link can’t be made is passed on to the agent, and nothing is asked for an empty call', async () => {
  const { tool, questions } = setup({
    linking: async () => {
      throw new Error('#9 is a pull request of someone/else, but this conversation works on example/shop.');
    },
  });
  await assert.rejects(tool('worker').run({ pull_request: '#9' }), /someone\/else/);
  await assert.rejects(tool('worker', { readOnly: true }).run({}), /Say which pull request/);
  assert.deepEqual(questions, []);
});

test('the conversation words it by the pull request’s number, however it was named', () => {
  const linked = appActivity(APP_TOOLS.link, { pull_request: 'https://github.com/example/shop/pull/45/files' });
  assert.deepEqual(linked, { kind: 'app', action: 'link-pr', label: '#45' });
  assert.equal(appDone(linked), 'linked pull request #45');
  assert.equal(appDone(appActivity(APP_TOOLS.link, { unlink: true })), 'unlinked the pull request');
  assert.equal(activityStatus(linked), 'Linking a pull request');
  // What a read-only agent's card asks.
  assert.equal(activityRequest(linked), 'link pull request #45 to this conversation');
  assert.equal(
    activityRequest(appActivity(APP_TOOLS.link, { unlink: true })),
    'unlink the pull request of this conversation'
  );
});
