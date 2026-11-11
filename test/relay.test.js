import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GO_AHEAD, RECAP_MAX, Relay, effortCheck } from '../src/main/relay.js';
import { levels } from '../src/shared/mentions.js';

const claude = { id: 'claude', name: 'Claude' };
const codex = { id: 'codex', name: 'Codex' };
const gemini = { id: 'gemini', name: 'Gemini' };
const CWD = '/Users/safa/projects/api';

/** A conversation hosted by Claude, written the way Conversations writes its history. */
function conversation(agents = [claude, codex]) {
  const entries = [];
  let n = 0;
  const add = (entry) => {
    entries.push({ id: `e${++n}`, time: n, ...entry });
    return entries.at(-1);
  };
  // The host's entries carry no name; a guest's say who wrote them.
  const by = (who) => (who.id === agents[0].id ? {} : { speaker: who.id, speakerName: who.name });
  const relay = new Relay();
  return {
    entries,
    relay,
    add,
    user: (text, images = 0) => add({ kind: 'user', text, images }),
    says: (who, text) => add({ kind: 'assistant', text, ...by(who) }),
    does: (who, activity, more = {}) =>
      add({ kind: 'tool', toolId: `t${n}`, activity, sub: false, ...by(who), ...more }),
    done: (who) => add({ kind: 'result', isError: false, stopped: false, ...by(who) }),
    joins: (who) => add({ kind: 'notice', text: `${who.name} has been added to the conversation.`, joined: who.id }),
    /** What `to` is sent now. */
    compose: (to, more = {}) => relay.compose({ entries, to, agents, me: 'Safa', cwd: CWD, ...more }),
  };
}

/** The text without the introduction, which has a test of its own. */
const body = (text) => text.replace(/^\[Group conversation\]\n[\s\S]*?\n\n/, '');
const INTRODUCED = /^\[Group conversation\]\n/;

test('an agent is told who is here, once, and then what was said', () => {
  const c = conversation();
  c.user('hello both');
  const first = c.compose(claude).text;
  assert.equal(
    first,
    [
      '[Group conversation]',
      'You are Claude. With you in this conversation: Safa, who is the user, and Codex (another AI agent).',
      `Everyone works in the same folder: ${CWD}`,
      'Stay in it: the user sees only what changes there. Make no clone, worktree or other checkout of it, and ask nobody else to, also for work that goes in another branch or pull request: do all of it here, and split it into branches when it is committed.',
      'Each message below starts with the name of who said it. A line in [brackets] is something another agent did in the folder.',
      'Answer as you normally would, without your own name in front.',
      'To hand over to another agent, mention it with @ and its name, like @Codex. It then gets a turn, so only mention it when it should act.',
      'Before you start, look at what the others already did, and do not do it again.',
      '',
      'Safa: hello both',
    ].join('\n')
  );
  c.says(claude, 'Hi!');
  c.done(claude);
  c.user('and again');
  assert.equal(c.compose(claude).text, 'Safa: and again', 'the second time there is nothing to explain');
});

test('each agent is introduced as itself, to everyone else', () => {
  const c = conversation([claude, codex, gemini]);
  c.user('hello');
  const toCodex = c.compose(codex).text;
  assert.match(
    toCodex,
    /^\[Group conversation\]\nYou are Codex\. .*Safa, who is the user, and Claude, Gemini \(other AI agents\)\.\n/
  );
  assert.match(toCodex, /\n\nSafa: hello$/);
  const toGemini = c.compose(gemini).text;
  assert.match(toGemini, /\nYou are Gemini\. .* and Claude, Codex \(other AI agents\)\.\n/);
  assert.match(toGemini, /like @Claude\. /);
});

test('an agent is sent what was said and done since its own last turn', () => {
  const c = conversation();
  c.user('fix the login page');
  assert.equal(body(c.compose(claude).text), 'Safa: fix the login page');
  c.does(claude, { kind: 'read', path: '/p/auth.js' });
  c.does(claude, { kind: 'edit', path: '/p/auth.js' });
  c.says(claude, 'The cookie was never set.\nFixed in `auth.js`.');
  c.does(claude, { kind: 'command', command: 'npm test' });
  c.says(claude, 'Tests pass. @Codex please review.');
  c.done(claude);

  assert.equal(
    body(c.compose(codex).text),
    [
      'Safa: fix the login page',
      '',
      '[Claude: Reading auth.js]',
      '[Claude: Editing auth.js]',
      '',
      'Claude: The cookie was never set.\nFixed in `auth.js`.',
      '',
      '[Claude: Running npm test]',
      '',
      'Claude: Tests pass. @Codex please review.',
    ].join('\n')
  );

  c.says(codex, 'Looks good.');
  c.done(codex);
  c.user('thanks both');
  assert.equal(c.compose(claude).text, 'Codex: Looks good.\n\nSafa: thanks both', 'Claude hears what Codex said');
  assert.equal(c.compose(codex).text, 'Safa: thanks both', 'Codex does not hear itself');
});

test('only what the others went through with is passed on, and not how it turned out', () => {
  const c = conversation();
  c.user('go');
  c.compose(codex);
  c.does(claude, { kind: 'command', command: 'rm -rf build' }, { declined: true, output: 'Declined.' });
  c.does(claude, { kind: 'search', query: 'TODO' }, { sub: true });
  c.does(claude, { kind: 'command', command: 'npm run build' }, { isError: true, output: 'a very long log' });
  c.add({ kind: 'permission', promptKind: 'tool', activity: { kind: 'command', command: 'x' }, decision: 'allow' });
  c.add({ kind: 'error', text: 'Not logged in' });
  c.add({ kind: 'notice', text: 'Claude tidied up the conversation.' });
  c.add({ kind: 'nudge', from: 'me' });
  c.add({ kind: 'wink', from: 'me', file: 'knock.gif' });
  c.done(claude);
  c.user('/compact');
  c.user('@Codex anything to add?', 2);
  assert.equal(
    c.compose(codex).text,
    '[Claude: Running npm run build]\n\nSafa: @Codex anything to add? (with 2 pictures)',
    'no declined or helper actions, no slash commands, none of the lines in between'
  );
});

test('a picture the user sent is mentioned', () => {
  const c = conversation();
  c.user('what is wrong here?', 1);
  assert.equal(body(c.compose(claude).text), 'Safa: what is wrong here? (with a picture)');
});

test('a message sent while the agent was answering is not lost', () => {
  const c = conversation();
  c.user('first');
  c.compose(claude);
  c.says(claude, 'On it…');
  c.user('and one more thing');
  c.says(claude, 'Done with the first.');
  c.done(claude);
  assert.equal(c.compose(claude).text, 'Safa: and one more thing', 'though it came before the end of the turn');
});

test('after a change of who is here, everyone is told again', () => {
  const c = conversation([claude, codex]);
  c.user('hello');
  c.compose(claude);
  c.compose(codex);
  c.user('again');
  assert.doesNotMatch(c.compose(claude).text, INTRODUCED);

  c.relay.rosterChanged();
  c.user('once more');
  assert.match(c.compose(claude).text, INTRODUCED);
  assert.match(c.compose(codex).text, INTRODUCED);
  c.user('and now');
  assert.doesNotMatch(c.compose(claude).text, INTRODUCED);
  assert.doesNotMatch(c.compose(codex).text, INTRODUCED);
});

test('the last agent left is told the others have gone', () => {
  const c = conversation([claude]);
  c.user('just us now');
  assert.equal(
    c.compose(claude).text,
    [
      '[Group conversation]',
      'The other agents have left: it is you, Claude, and Safa (the user) again.',
      'Each message below starts with the name of who said it.',
      '',
      'Safa: just us now',
    ].join('\n')
  );
});

test("a guest's first turn starts with what was said before it joined", () => {
  const c = conversation();
  c.user('fix the login page');
  c.does(claude, { kind: 'edit', path: '/p/auth.js' });
  c.says(claude, 'Fixed.');
  c.done(claude);
  c.user('/compact');
  c.joins(codex);
  c.user('@Codex please review');

  assert.equal(
    body(c.compose(codex, { newcomer: true }).text),
    [
      '[Said before you joined]',
      'Safa: fix the login page',
      'Claude: Fixed.',
      '[Since then]',
      'Safa: @Codex please review',
    ].join('\n\n'),
    'messages only: no actions, no slash commands'
  );

  c.says(codex, 'Looks right.');
  c.done(codex);
  c.user('@Codex sure?');
  assert.equal(c.compose(codex).text, 'Safa: @Codex sure?', 'once is enough');
});

test('what happened between joining and the first turn is told in full', () => {
  const c = conversation();
  c.user('before');
  c.says(claude, 'Before.');
  c.done(claude);
  c.joins(codex);
  c.user('@Claude add a test');
  c.does(claude, { kind: 'write', path: '/p/auth.test.js' });
  c.says(claude, 'Added.');
  c.done(claude);
  c.user('@Codex run it');
  assert.equal(
    body(c.compose(codex, { newcomer: true }).text),
    [
      '[Said before you joined]',
      'Safa: before',
      'Claude: Before.',
      '[Since then]',
      'Safa: @Claude add a test',
      '[Claude: Editing auth.test.js]',
      'Claude: Added.',
      'Safa: @Codex run it',
    ].join('\n\n')
  );
});

test('the recap keeps the newest messages that fit', () => {
  const c = conversation();
  const long = (label) => `${label} ${'x'.repeat(RECAP_MAX / 2 - 100)}`;
  c.user(long('first'));
  c.says(claude, long('second'));
  c.user(long('third'));
  c.joins(codex);
  c.user('@Codex hello');
  const text = body(c.compose(codex, { newcomer: true }).text);
  const [label, note, ...kept] = text.split('\n\n');
  assert.deepEqual([label, note], ['[Said before you joined]', '(Earlier messages are left out.)']);
  assert.deepEqual(
    kept.map((block) => block.slice(0, 14)),
    ['Claude: second', 'Safa: third xx', '[Since then]', 'Safa: @Codex h']
  );
  assert.ok(text.length < RECAP_MAX + 200, `${text.length} characters`);
});

test('a single message longer than the recap is cut, not dropped', () => {
  const c = conversation();
  c.user(`start ${'y'.repeat(RECAP_MAX * 2)}`);
  c.joins(codex);
  c.user('@Codex hello');
  const [, note, cut] = body(c.compose(codex, { newcomer: true }).text).split('\n\n');
  assert.equal(note, '(Earlier messages are left out.)');
  assert.ok(cut.startsWith('Safa: start yyy') && cut.endsWith('y…'));
  assert.equal(cut.length, RECAP_MAX + 1);
});

test('a guest that joins a conversation with nothing said yet gets no recap', () => {
  const c = conversation();
  c.joins(codex);
  c.user('hello');
  assert.equal(body(c.compose(codex, { newcomer: true }).text), 'Safa: hello');
});

test('the host is not told again what it was sent before anyone joined', () => {
  const c = conversation();
  c.user('fix the login page');
  c.says(claude, 'On it…');
  // Codex is invited while Claude is still answering.
  c.relay.caughtUp(claude.id, c.entries);
  c.joins(codex);
  c.user('what do you both think?');
  c.says(claude, 'Fixed.');
  c.done(claude);
  assert.equal(body(c.compose(claude).text), 'Safa: what do you both think?');
});

test('a message that goes down to where it was read is told once: to whoever had not been told it yet', () => {
  const c = conversation([claude, codex, gemini]);
  c.user('fix the login page');
  c.says(claude, 'On it…');
  c.compose(codex);
  // Sent while Claude works, it waits: Gemini was told up to it, and Claude everything after it too.
  const waited = c.user('and the docs');
  c.relay.caughtUp(gemini.id, c.entries);
  c.does(claude, { kind: 'command', command: 'ls' });
  c.relay.caughtUp(claude.id, c.entries);
  c.says(codex, 'I can help.');

  // Claude reads it now: it goes to the end, as History.moveToEnd has it.
  c.relay.moving(c.entries, [waited.id]);
  c.entries.push(...c.entries.splice(c.entries.indexOf(waited), 1));
  c.says(claude, 'Docs done.');
  c.done(claude);

  assert.equal(body(c.compose(claude).text), 'Codex: I can help.', 'Claude is not told it again');
  const toGemini = body(c.compose(gemini).text);
  assert.doesNotMatch(toGemini, /and the docs/, 'nor is Gemini');
  assert.match(toGemini, /Codex: I can help\.\n\nClaude: Docs done\.$/, 'which hears all that came after it');
  assert.match(body(c.compose(codex).text), /Safa: and the docs\n\nClaude: Docs done\.$/, 'Codex is told it');
  // Told everything once, nobody is told it again.
  c.user('thanks');
  for (const agent of [claude, codex, gemini]) assert.equal(body(c.compose(agent).text), 'Safa: thanks');
});

test('a message that waits for a turn of its own is not told, and is told once it is read', () => {
  const c = conversation([claude, codex]);
  c.user('fix the login page');
  c.compose(claude);
  const waited = c.user('and the docs');
  c.says(claude, 'Login fixed.');
  c.done(claude);

  // Codex's turn is for the first message: what waits is left out, and what came after it is not.
  const first = c.compose(codex, { waiting: [waited.id] });
  assert.equal(body(first.text), 'Safa: fix the login page\n\nClaude: Login fixed.');
  assert.equal(first.asked, 'fix the login page');
  c.says(codex, 'Looks good.');
  c.done(codex);

  // Claude reads it now: it goes to the end, as History.moveToEnd has it.
  assert.equal(c.compose(claude).text, 'Safa: and the docs\n\nCodex: Looks good.');
  c.relay.moving(c.entries, [waited.id]);
  c.entries.push(...c.entries.splice(c.entries.indexOf(waited), 1));
  c.says(claude, 'Docs done.');
  c.done(claude);

  assert.equal(body(c.compose(codex).text), 'Safa: and the docs\n\nClaude: Docs done.', 'Codex hears it on its turn');
  c.user('thanks');
  for (const agent of [claude, codex]) assert.equal(body(c.compose(agent).text), 'Safa: thanks');
});

test('after a restart an agent picks up after the last thing it did itself', () => {
  const c = conversation();
  c.user('one');
  c.says(claude, 'One.');
  c.done(claude);
  c.joins(codex);
  c.user('two');
  c.says(claude, 'Two.');
  c.done(claude);
  c.says(codex, 'Two as well.');
  c.done(codex);
  c.user('three');

  // Nothing is remembered of who was told what: only the history is left.
  const restarted = new Relay();
  const compose = (to, more) =>
    restarted.compose({ entries: c.entries, to, agents: [claude, codex], me: 'Safa', cwd: CWD, ...more });
  assert.equal(body(compose(claude).text), 'Codex: Two as well.\n\nSafa: three');
  assert.equal(body(compose(codex).text), 'Safa: three');
});

test('after a restart a guest that never spoke picks up from where it was added', () => {
  const c = conversation();
  c.user('one');
  c.says(claude, 'One.');
  c.done(claude);
  c.joins(codex);
  c.user('@Claude two');
  c.says(claude, 'Two.');
  c.done(claude);
  c.user('@Codex three');
  const restarted = new Relay();
  const { text } = restarted.compose({
    entries: c.entries,
    to: codex,
    agents: [claude, codex],
    me: 'Safa',
    cwd: CWD,
    newcomer: true,
  });
  assert.equal(
    body(text),
    [
      '[Said before you joined]',
      'Safa: one',
      'Claude: One.',
      '[Since then]',
      'Safa: @Claude two',
      'Claude: Two.',
      'Safa: @Codex three',
    ].join('\n\n')
  );
});

test('a guest that left and comes back starts from where it joins again', () => {
  const c = conversation();
  c.joins(codex);
  c.user('hello');
  c.compose(codex, { newcomer: true });
  c.says(codex, 'Hi.');
  c.done(codex);
  c.relay.forget(codex.id);
  c.add({ kind: 'notice', text: 'Codex has left the conversation.' });
  c.user('just Claude');
  c.says(claude, 'Yes?');
  c.done(claude);
  c.joins(codex);
  c.user('@Codex welcome back');
  const text = c.compose(codex, { newcomer: true }).text;
  assert.match(text, INTRODUCED);
  assert.equal(
    body(text),
    [
      '[Said before you joined]',
      'Safa: hello',
      'Codex: Hi.',
      'Safa: just Claude',
      'Claude: Yes?',
      '[Since then]',
      'Safa: @Codex welcome back',
    ].join('\n\n')
  );
});

test('a renamed guest keeps the name its lines were written under', () => {
  const c = conversation();
  c.user('hello');
  c.says(codex, 'Hi, Codex here.');
  c.done(codex);
  c.user('and now?');
  const renamed = { id: 'codex', name: 'Reviewer' };
  const { text } = c.relay.compose({ entries: c.entries, to: claude, agents: [claude, renamed], me: 'Safa', cwd: CWD });
  assert.match(text, /and Reviewer \(another AI agent\)/);
  assert.match(text, /\nCodex: Hi, Codex here\.\n/);
});

test('the user’s newest message comes along on its own', () => {
  const c = conversation();
  assert.equal(c.compose(claude).asked, '', 'nothing said yet');
  c.user('make a plan');
  c.says(claude, 'Here is the plan. @Codex ask me anything.');
  c.done(claude);
  c.user('/compact');
  assert.equal(c.compose(codex).asked, 'make a plan', 'not a slash command, and not what an agent said');
  c.user('thanks');
  assert.equal(c.compose(codex).asked, 'thanks');
});

test('the others are told who is paused, and a hand-over is shown with someone who answers', () => {
  const c = conversation([claude, { ...codex, paused: true }, gemini]);
  c.user('hello');
  const toClaude = c.compose(claude).text;
  assert.match(toClaude, /like @Gemini\. /);
  assert.match(toClaude, /\nCodex is paused by Safa: mentioning it gives no turn\. Only Safa can ask it to answer\.\n/);
  assert.doesNotMatch(c.compose(codex).text, /paused/, 'the paused one is not told of itself');

  const both = conversation([claude, { ...codex, paused: true }, { ...gemini, paused: true }]);
  both.user('hello');
  assert.match(both.compose(claude).text, /\nCodex, Gemini are paused by Safa: mentioning them gives no turn\./);
});

// ---- the agents picking their effort ------------------------------------------------------------

test('with the agents picking their effort, the introduction says how a hand-over gives a level', () => {
  const c = conversation();
  c.user('hello both');
  assert.equal(
    c.compose(claude, { picking: true }).text,
    [
      '[Group conversation]',
      'You are Claude. With you in this conversation: Safa, who is the user, and Codex (another AI agent).',
      `Everyone works in the same folder: ${CWD}`,
      'Stay in it: the user sees only what changes there. Make no clone, worktree or other checkout of it, and ask nobody else to, also for work that goes in another branch or pull request: do all of it here, and split it into branches when it is committed.',
      'Each message below starts with the name of who said it. A line in [brackets] is something another agent did in the folder.',
      'Answer as you normally would, without your own name in front.',
      'To hand over to another agent, mention it with @ and its name, like @Codex. It then gets a turn, so only mention it when it should act.',
      'You pick your effort levels among yourselves. A hand-over can give one, right behind the name, like @Codex(high): from least to most effort there are low, medium, high, xhigh, max, and an agent that does not take a level gets the nearest one it does. Give the lowest level that will do that part well.',
      'Before you start, look at what the others already did, and do not do it again.',
      '',
      'Safa: hello both',
    ].join('\n')
  );
  assert.doesNotMatch(c.compose(codex).text, /effort/, 'and nothing of it while the levels are yours');
});

test('an agent that is told so once is not told again, until who is here is told again', () => {
  const c = conversation();
  c.user('hello both');
  c.compose(claude, { picking: true });
  c.user('again');
  assert.equal(c.compose(claude, { picking: true }).text, 'Safa: again');
  c.relay.rosterChanged();
  c.user('once more');
  assert.match(c.compose(claude, { picking: true }).text, /like @Codex\(high\)/);
  c.relay.rosterChanged();
  c.user('and now it is off');
  assert.doesNotMatch(c.compose(claude).text, /effort/);
});

test('the last agent left has nobody to give a level', () => {
  const c = conversation([claude]);
  c.user('just us now');
  assert.doesNotMatch(c.compose(claude, { picking: true }).text, /effort/);
});

test('an effort check asks for a level for each agent in line, and says which ones each takes', () => {
  const asked = effortCheck([
    { name: 'Claude', levels: ['low', 'medium', 'high', 'xhigh', 'max'], effort: 'high' },
    { name: 'Codex', levels: ['low', 'medium', 'high'], effort: null },
  ]);
  assert.equal(
    asked,
    [
      '[Effort check]',
      'Do not start on this yet. First pick an effort level for each agent about to answer (Claude, Codex): the level it works at when its turn comes.',
      'The levels they take, from least to most effort:',
      '- Claude: low, medium, high, xhigh, max (now high)',
      '- Codex: low, medium, high',
      'Give each the lowest level that will do its part well. Reply with only this, a level in each pair of brackets, and a few words on why:',
      '@Claude(level) @Codex(level)',
    ].join('\n')
  );
});

test('the reply an effort check asks for is one a level can be read from', () => {
  const [, , , , , , example] = effortCheck([
    { name: 'Claude', levels: ['low', 'high'], effort: null },
    { name: 'Codex', levels: ['low'], effort: null },
  ]).split('\n');
  assert.deepEqual(levels(`${example.replaceAll('level', 'low')} A small job.`, [claude, codex]), [
    { id: 'claude', effort: 'low' },
    { id: 'codex', effort: 'low' },
  ]);
  // Sent back as it is, the example names agents and gives no level anyone takes.
  assert.deepEqual(
    levels(example, [claude, codex]).map(({ effort }) => effort),
    ['level', 'level']
  );
});

test('for one agent an effort check asks about that one alone', () => {
  const asked = effortCheck([{ name: 'Codex', levels: ['low', 'medium', 'high'], effort: 'medium' }]).split('\n');
  assert.match(asked[1], /each agent about to answer \(Codex\)/);
  assert.equal(asked[3], '- Codex: low, medium, high (now medium)');
  assert.equal(asked.at(-1), '@Codex(level)');
  assert.equal(GO_AHEAD, 'The effort levels are set. Go ahead and answer now.');
});

// ---- a contact on its own that picks its effort -------------------------------------------------

test('a contact on its own is sent what you said, as you said it', () => {
  const c = conversation([claude]);
  c.user('rework the billing export');
  assert.deepEqual(c.compose(claude, { alone: true }), {
    text: 'rework the billing export',
    asked: 'rework the billing export',
  });
  assert.equal(c.compose(claude, { alone: true }).text, '', 'and once: there is nothing new to tell it');

  c.says(claude, 'Reworked.');
  c.done(claude);
  c.user('and the tests', 1);
  c.user('/compact');
  c.user('with the edge cases');
  assert.deepEqual(
    c.compose(claude, { alone: true }),
    { text: 'and the tests\n\nwith the edge cases', asked: 'with the edge cases' },
    'everything you said since it last spoke, without its own lines or a command'
  );
});

test('on its own it is told nothing of a group, also with the agents picking their effort', () => {
  const c = conversation([claude]);
  c.user('hello');
  assert.equal(c.compose(claude, { alone: true, picking: true }).text, 'hello');
  // Once someone joined, it is told who is here, and from where it left off.
  const joined = conversation([claude, codex]);
  joined.user('hello');
  joined.compose(claude, { alone: true });
  joined.user('hello both');
  assert.equal(body(joined.compose(claude).text), 'Safa: hello both');
});

test('an effort check for a contact on its own asks for its own level, in the same words to answer in', () => {
  const asked = effortCheck([{ name: 'Claude', levels: ['low', 'medium', 'high'], effort: 'high' }], true);
  assert.equal(
    asked,
    [
      '[Effort check]',
      'Do not start on this yet. First pick the effort level you will work on it at.',
      'The levels you take, from least to most effort: low, medium, high (now high)',
      'Pick the lowest level that will do the job well. Reply with only this, a level in the brackets, and a few words on why:',
      '@Claude(level)',
    ].join('\n')
  );
  assert.doesNotMatch(asked, /agent/, 'it was never told of any');
  const unknown = effortCheck([{ name: 'Claude', levels: ['low'], effort: null }], true);
  assert.equal(unknown.split('\n')[2], 'The levels you take, from least to most effort: low');
  assert.deepEqual(levels(asked.split('\n').at(-1).replace('level', 'medium'), [claude]), [
    { id: 'claude', effort: 'medium' },
  ]);
});

test('answering all at once, the introduction says the others are at work meanwhile', () => {
  const c = conversation();
  c.user('hello both');
  const lines = c.compose(claude, { atOnce: true }).text.split('\n');
  assert.deepEqual(lines.slice(2, 5), [
    `Everyone works in the same folder: ${CWD}`,
    'Stay in it: the user sees only what changes there. Make no clone, worktree or other checkout of it, and ask nobody else to, also for work that goes in another branch or pull request: do all of it here, and split it into branches when it is committed.',
    'You all answer at the same time, so what the others say and do reaches you on your next turn. Keep to your own part, and leave alone the files another agent may be changing.',
  ]);
  assert.doesNotMatch(c.compose(codex).text, /at the same time/, 'and nothing of it while they take turns');
});

test('an agent knows whether another one changed files since it was last told what went on', () => {
  const c = conversation();
  const changed = () => c.relay.changedFor(c.entries, codex.id, claude.id);
  c.joins(codex);
  c.user('fix the login');
  c.does(claude, { kind: 'read', path: 'src/login.js' });
  c.does(claude, { kind: 'command', command: 'npm test' });
  assert.equal(changed(), false, 'reading and running change nothing it looks at');

  c.does(claude, { kind: 'edit', path: 'src/login.js', changes: [] });
  assert.equal(changed(), true);
  // Told about it, it is news no more.
  c.compose(codex);
  assert.equal(changed(), false);

  // A file written counts too, and so does one by a guest; one that was declined does not.
  c.does(gemini, { kind: 'write', path: 'src/new.js', changes: [] }, { declined: true });
  assert.equal(changed(), false);
  c.does(gemini, { kind: 'write', path: 'src/new.js', changes: [] });
  assert.equal(changed(), true);
});

test('what an agent changed itself is no news to it, and changes before it joined are not either', () => {
  const c = conversation();
  c.does(claude, { kind: 'edit', path: 'src/old.js', changes: [] });
  c.joins(codex);
  assert.equal(c.relay.changedFor(c.entries, codex.id, claude.id), false);
  c.does(codex, { kind: 'edit', path: 'src/mine.js', changes: [] });
  assert.equal(c.relay.changedFor(c.entries, codex.id, claude.id), false);
  // Without a note of what it was told, as after a restart, it goes from the last thing it did itself.
  c.done(codex);
  c.does(claude, { kind: 'edit', path: 'src/login.js', changes: [] });
  assert.equal(new Relay().changedFor(c.entries, codex.id, claude.id), true);
});

// ---- a worker's manager tagged in its conversation ---------------------------------------------------------------

const MANAGER = { id: 'boss', name: 'shop manager' };

test('the manager’s answer here is told as the manager’s, from its own conversation, asking nothing of anyone', () => {
  const c = conversation();
  c.user('hello both');
  c.compose(codex, { me: 'Alex' });
  c.add({ kind: 'user', text: '@shop manager subtotal?', toManager: MANAGER, onlyManager: true });
  c.add({
    kind: 'assistant',
    text: 'Subtotal. @Codex can check it.',
    speaker: MANAGER.id,
    speakerName: MANAGER.name,
    managerAnswer: true,
  });
  assert.equal(
    body(c.compose(codex, { me: 'Alex' }).text),
    [
      'Alex (to shop manager alone: nobody here was asked): @shop manager subtotal?',
      '[shop manager, who oversees this project, answered Alex here from its own conversation. What follows is shop ' +
        'manager’s, not Alex’s, and asks nothing of anyone here by itself.]\nshop manager: Subtotal. @Codex can check it.',
    ].join('\n\n')
  );
});

test('on its own, a contact isn’t sent the user’s message to the manager as its own, nor asked it', () => {
  const c = conversation([claude]);
  c.user('first');
  c.compose(claude, { alone: true });
  c.add({ kind: 'user', text: '@shop manager subtotal?', toManager: MANAGER, onlyManager: true });
  c.add({ kind: 'assistant', text: 'Subtotal.', speaker: MANAGER.id, speakerName: MANAGER.name, managerAnswer: true });
  c.user('do that');
  const { text, asked } = c.compose(claude, { alone: true });
  assert.equal(text, 'do that', 'the exchange is told apart, marked whose it is (see Conversations#exchange)');
  assert.equal(asked, 'do that');
  c.add({ kind: 'user', text: '@shop manager and tax?', toManager: MANAGER, onlyManager: true });
  assert.equal(c.compose(claude, { alone: true }).asked, 'do that', 'what it was asked is still the user’s last to it');
});
