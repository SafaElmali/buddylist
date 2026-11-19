import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Conversation } from '../src/renderer/chat/conversation.js';
import { limitSuggestion } from '../src/renderer/chat/limit-suggestion.js';
import { answeringBadge, modelName, pickedModelName, switchedFrom } from '../src/renderer/chat/models.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { modelCatalog } from '../src/shared/models.js';
import { page } from './fixtures/dom.js';

// Claude's models as Claude Code 2.1.328 lists them for a Pro login, cut down to what the window reads.
const CATALOG = modelCatalog(claude, [
  { id: 'opus', label: 'Opus 5.5', hint: 'Best for everyday, complex tasks', efforts: ['low', 'medium', 'high'] },
  { id: 'sonnet', label: 'Sonnet 5.5', hint: 'Efficient for routine tasks', efforts: ['low', 'medium', 'high'] },
]);
/** Someone here, as the window has them: on Opus 5.5 unless said otherwise. */
const who = (more = {}) => ({
  id: 'm',
  name: 'shop manager',
  provider: claude,
  model: 'opus',
  defaultModel: null,
  models: [],
  effort: null,
  fastMode: false,
  fastModeStatus: null,
  ...more,
});
const SWITCHED = { switched: { model: 'sonnet', by: 'Claude Code' } };

// ---- what its badges say ------------------------------------------------------------------------------------------

test('a session switched to another model is named by that one, and the one it was given stays known', () => {
  const switched = who(SWITCHED);
  assert.equal(modelName(switched, CATALOG), 'Sonnet 5.5');
  assert.equal(pickedModelName(switched, CATALOG), 'Opus 5.5');
  assert.deepEqual(switchedFrom(switched, CATALOG), {
    note: 'Claude Code switched from Opus 5.5',
    back: 'Use Opus 5.5 again',
  });
  assert.equal(switchedFrom(who(), CATALOG), null, 'nothing to say while it answers with its own');
  assert.equal(modelName(who(), CATALOG), 'Opus 5.5');
});

test('the badge under the message box says the model that answers, and pointed at, that it was switched', () => {
  const badge = answeringBadge(who({ ...SWITCHED, effort: 'high' }), CATALOG, { service: true });
  assert.equal(badge.label, 'Sonnet 5.5 · High');
  assert.deepEqual([badge.model, badge.effort], ['Sonnet 5.5', 'High'], 'apart, so the level gives way first');
  assert.match(badge.title, /^Service: Claude\nModel: Sonnet 5\.5 \(Claude Code switched from Opus 5\.5\)/);
  assert.equal(answeringBadge(who(), CATALOG).effort, '', 'a level left to the model goes unsaid');
});

// ---- the conversation ----------------------------------------------------------------------------------------------

/** A conversation window's lines, with the way back to a model for whoever is switched. */
function window(t, participants, { asked = [] } = {}) {
  const document = page(t);
  const root = document.createElement('div');
  document.body.append(root);
  const ctx = { contactId: 'm', participants, profile: {}, myColor: '', contact: { cwd: '/repo', manages: 'git:/r' } };
  const conversation = new Conversation(/** @type {any} */ (root), ctx, {
    invite: async () => asked.push('invite'),
    switchManager: async () => asked.push('switch service'),
    switchedBack: (speaker) => {
      const one = ctx.participants.find((p) => p.id === speaker);
      const switched = one && switchedFrom(one, CATALOG);
      return switched && { ...switched, go: () => asked.push(`use ${one.model} again`) };
    },
    modelOf: (speaker, model) => ({
      label: pickedModelName(who({ model }), CATALOG),
      use: () => asked.push(`use ${model}`),
    }),
  });
  const said = (node) => node.textContent.replace(/\s+/g, ' ').trim();
  return { root, ctx, conversation, said, asked };
}

test('the line Claude Code wrote of a switch is shown as it wrote it, with the way back while it holds', (t) => {
  const { root, ctx, conversation, said, asked } = window(t, [who(SWITCHED)]);
  conversation.addNotice('Opus 5.5’s safeguards flagged this session. Sonnet 5.5 is answering instead.', {
    modelSwitch: { model: 'sonnet', from: 'opus', session: true },
  });
  const line = root.querySelector('.event.notice');
  assert.equal(
    said(line),
    'Opus 5.5’s safeguards flagged this session. Sonnet 5.5 is answering instead. Use Opus 5.5 again'
  );
  const back = line.querySelector('.model-back');
  back.click();
  assert.deepEqual(asked, ['use opus again']);
  // Back on Opus 5.5: the line stays, the way back goes.
  ctx.participants = [who()];
  conversation.refreshSwitches();
  assert.equal(back.hidden, true);
});

test('in a conversation with several agents, the line is under its name, and only its newest offers the way back', (t) => {
  const codex = who({ id: 'x', name: 'Codex', provider: { ...claude, id: 'codex', name: 'Codex' } });
  const { root, conversation, said } = window(t, [who(SWITCHED), codex]);
  const switchedOnce = () =>
    conversation.addNotice('Sonnet 5.5 is answering instead.', { modelSwitch: { model: 'sonnet', session: true } });
  switchedOnce();
  switchedOnce();
  const lines = root.querySelectorAll('.event.notice');
  assert.equal(said(lines[1]), 'shop manager: Sonnet 5.5 is answering instead. Use Opus 5.5 again');
  assert.deepEqual(
    [...root.querySelectorAll('.model-back')].map((back) => back.hidden),
    [true, false]
  );
});

test('one reply another model wrote has no way back: the session never left its own', (t) => {
  const { root, conversation } = window(t, [who()]);
  conversation.addNotice('This response was generated by Sonnet 5.5 instead.', {
    modelSwitch: { model: 'sonnet', session: false },
  });
  assert.equal(root.querySelector('.model-back'), null);
});

const LIMITED = {
  isError: true,
  stopped: false,
  errorText: 'You’ve hit your limit · resets Nov 23',
  usageLimited: true,
  limitKind: 'weekly',
  limitModel: 'opus',
  otherModel: 'sonnet',
  // Two hours on: when within a day, the line counts it down.
  limitResetsAt: Date.now() + 2 * 3600e3 + 30e3,
  durationMs: 10,
  costUsd: 0,
};

test('a model’s own limit names the model, and offers the one that still answers before another service', (t) => {
  const { root, conversation, said, asked } = window(t, [who()]);
  conversation.addResult(LIMITED);
  const line = root.querySelector('.event.result');
  assert.match(said(line), /^Opus 5\.5’s weekly limit is reached\. Resets in 2 hr\. Sonnet 5\.5 isn’t limited\./);
  const [use, elsewhere] = line.querySelectorAll('.limit-suggestion button');
  assert.equal(said(use), 'Use Sonnet 5.5', 'no “until”: nothing switches it back by itself');
  assert.equal(said(elsewhere), 'Switch manager service...');
  use.click();
  elsewhere.click();
  assert.deepEqual(asked, ['use sonnet', 'switch service']);
});

test('with a guest here, the limit is said under the name of whoever ran into it', (t) => {
  const codex = who({ id: 'x', name: 'Codex' });
  const { root, conversation, said } = window(t, [who(), codex]);
  conversation.addResult({ ...LIMITED, speaker: 'm' });
  assert.match(said(root.querySelector('.event.result')), /^shop manager: Opus 5\.5’s weekly limit is reached\./);
});

test('a limit that is no model’s own says what the service said, and offers another service or agent', (t) => {
  const { root, conversation, said } = window(t, [who()]);
  conversation.addResult({ ...LIMITED, limitModel: undefined, otherModel: undefined, limitResetsAt: undefined });
  const line = root.querySelector('.event.result');
  assert.match(said(line), /^You’ve hit your limit · resets Nov 23 Switch this manager to another service/);
  assert.equal(line.querySelectorAll('.limit-suggestion button').length, 1);
});

test('outside a manager, a model’s own limit offers the other model, then another agent', (t) => {
  page(t);
  const asked = [];
  const node = limitSuggestion(async () => asked.push('invite'), null, {
    label: 'Sonnet 5.5',
    use: () => asked.push('use sonnet'),
  });
  assert.equal(
    node.textContent.replace(/\s+/g, ' ').trim(),
    'Sonnet 5.5 isn’t limited. Use Sonnet 5.5 or Invite another agent'
  );
  const [use, invite] = node.querySelectorAll('button');
  use.click();
  invite.click();
  assert.deepEqual(asked, ['use sonnet', 'invite']);
});
