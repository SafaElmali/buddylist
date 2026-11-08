import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { appTools } from '../src/main/app-tools.js';
import { DemoSession, PLANS, terminalsAsked } from '../src/providers/demo/session.js';
import { demoAccounts, demoWho } from '../src/providers/demo/accounts.js';
import { reportNote } from '../src/shared/app-tools.js';
import { outputBlock } from '../src/shared/terminal-mentions.js';
import {
  cleanManager,
  handoverNote,
  managerMessage,
  startNote,
  takeoverNote,
  workerNote,
} from '../src/shared/managers.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';
import { createProviders } from '../src/providers/index.js';
import { MemoryStore } from '../preview/memory-storage.js';
import { tempDir } from './fixtures/temp-dir.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

// A scripted session for one provider, without the typing pauses.
function start(descriptor, contact = {}, sleep = async () => {}, tools = []) {
  const events = [];
  const c = { cwd: '/tmp/project', model: '', permissionMode: descriptor.defaultPermissionMode, sessionId: null };
  Object.assign(c, contact);
  const session = new DemoSession({ contact: c, emit: (e) => events.push(e), descriptor, sleep, tools });
  const of = (type) => events.filter((e) => e.type === type);
  const said = () =>
    of('text-end')
      .map((e) => e.text)
      .join('\n');
  return { session, events, of, said, contact: c };
}

// The same session, but its typing pauses only end when the test says so.
function startHeld(descriptor) {
  const pauses = [];
  const s = start(descriptor, {}, () => new Promise((resolve) => pauses.push(resolve)));
  /** End the pause the session is in and let it run to the next one. */
  const resume = async () => {
    pauses.shift()();
    await tick();
  };
  /** Let the session run until it asks something or has nothing left to do. */
  const settle = async () => {
    await tick();
    while (pauses.length) await resume();
  };
  return { ...s, pauses, resume, settle };
}

/**
 * A scripted session with the app's own tools, as a Claude contact has them. Its terminals only
 * note what was asked of them; `open` is whether the conversation's window is there to open any.
 */
function startWithTerminals(descriptor = claude, open = true, started = { name: 'Claude (cart)', worktree: true }) {
  const asked = [];
  const begun = [];
  const terminals = { wanted: (contactId, names, command) => asked.push({ contactId, names, command }) && open };
  const startConversation = async (hostId, opts) => {
    begun.push({ hostId, ...opts });
    if (started instanceof Error) throw started;
    return started;
  };
  const tools = appTools({
    store: { getContact: () => ({}), settings: {} },
    terminals,
    startConversation,
    agents: [claude, codex],
  })('host');
  return { ...start(descriptor, {}, undefined, tools), asked, begun };
}

/** Send a message and let the session run until it asks something. */
async function send(s, text) {
  const done = s.session.send({ text });
  await tick();
  return { done, prompt: s.of('permission').at(-1) };
}

test('a session offers its provider’s slash commands and keeps the contact’s mode', () => {
  for (const descriptor of [claude, codex]) {
    const s = start(descriptor);
    s.session.start();
    const [ready] = s.of('ready');
    assert.deepEqual(ready.commands, descriptor.commonCommands, descriptor.id);
    assert.equal(ready.permissionMode, descriptor.defaultPermissionMode);
    assert.equal(ready.sessionId, s.contact.sessionId);
    assert.equal(s.session.state, 'idle');
  }
});

test('a Claude contact offers Claude’s output styles; a Codex contact has none', () => {
  const s = start(claude);
  s.session.start();
  const [ready] = s.of('ready');
  assert.deepEqual(
    ready.outputStyles,
    claude.outputStyles.map((style) => style.id)
  );
  // Nobody is signed in, so the first built-in style plays the user's own default.
  assert.equal(ready.outputStyle, 'default');
  assert.equal(s.contact.outputStyle, undefined);

  const none = start(codex);
  none.session.start();
  assert.deepEqual(none.of('ready')[0].outputStyles, []);
  assert.equal(none.of('ready')[0].outputStyle, null);
});

test('a scripted session answers with the first of its provider’s built-in models, or the contact’s own', async () => {
  const s = start(claude);
  s.session.start();
  const [ready] = s.of('ready');
  assert.equal(ready.model, 'opus', 'what a contact given none answers with: not the default itself');
  // The models to pick from are the provider's built-in ones, which the window has: a session names none.
  assert.equal('models' in ready, false);

  const given = start(codex, { model: 'gpt-6-luna' });
  given.session.start();
  assert.equal(given.of('ready')[0].model, 'gpt-6-luna');
  await given.session.setModel('gpt-6-sol');
  await given.session.setEffort('high');
  assert.deepEqual([given.contact.model, given.session.effort], ['gpt-6-sol', 'high']);
  assert.equal('effort' in given.contact, false, 'the level is the session’s: the contact keeps its own');
});

test('a provider with no models but its default has a scripted session that still answers', () => {
  const bare = { ...codex, modelSuggestions: [{ id: '', label: 'Default' }] };
  const s = start(bare);
  s.session.start();
  assert.equal(s.of('ready')[0].model, 'demo');
});

test('a contact’s own output style is the one its scripted session answers in', async () => {
  const s = start(claude, { outputStyle: 'Learning' });
  s.session.start();
  assert.equal(s.of('ready')[0].outputStyle, 'Learning');
  await s.session.setOutputStyle('Concise');
  assert.equal(s.contact.outputStyle, 'Concise');

  // Chosen before the first message, it is there when the session starts.
  const later = start(claude);
  await later.session.setOutputStyle('Explanatory');
  assert.deepEqual(later.of('ready'), []);
  later.session.start();
  assert.equal(later.of('ready')[0].outputStyle, 'Explanatory');
});

test('a Claude contact answers "plan" with a plan, approved in one of Claude’s modes', async () => {
  for (const { mode } of claude.planApprovals) {
    const s = start(claude, { permissionMode: 'plan' });
    const { done, prompt } = await send(s, 'Plan a dark theme');
    assert.equal(prompt.kind, 'plan');
    assert.match(prompt.plan, /dark theme/);
    assert.equal(s.session.state, 'waiting');
    s.session.respond(prompt.requestId, { decision: 'approve-plan', mode });
    await done;
    assert.deepEqual(s.of('mode'), [{ type: 'mode', mode }]);
    assert.equal(s.contact.permissionMode, mode);
    assert.equal(s.session.state, 'idle');
  }
});

test('feedback on a plan is taken on board without changing the mode', async () => {
  const s = start(claude);
  const { done, prompt } = await send(s, 'plan it');
  s.session.respond(prompt.requestId, { decision: 'feedback', message: 'smaller steps' });
  await done;
  assert.match(s.said(), /smaller steps/);
  assert.equal(s.of('mode').length, 0);
  assert.equal(s.contact.permissionMode, 'default');
});

test('a Codex contact answers "plan" like any other message: Codex has no plan to approve', async () => {
  const s = start(codex);
  const { done, prompt } = await send(s, 'make a plan for dark mode');
  assert.equal(prompt.kind, 'tool');
  assert.equal(prompt.canAlways, true);
  assert.deepEqual(prompt.activity, { kind: 'command', command: 'ls -la', description: 'List project files' });
  s.session.respond(prompt.requestId, { decision: 'allow' });
  await done;
  assert.deepEqual(
    s.of('permission').map((p) => p.kind),
    ['tool']
  );
  assert.equal(s.of('mode').length, 0);
  assert.equal(s.contact.permissionMode, 'ask');
  assert.equal(s.of('result')[0].stopped, false);
});

test('the scripted reply names the contact’s own provider', async () => {
  for (const [descriptor, other] of [
    [claude, codex],
    [codex, claude],
  ]) {
    const s = start(descriptor);
    const { done, prompt } = await send(s, 'hi there');
    s.session.respond(prompt.requestId, { decision: 'always' });
    await done;
    assert.equal(s.of('tool-result')[0].declined, false);
    assert.ok(s.said().includes(`talk to the real ${descriptor.name}.`), s.said());
    assert.ok(!s.said().includes(other.name), `${descriptor.id} mentions ${other.name}`);
  }
});

test('a scripted contact made from one of your agents says which, as the real one answers in its words', async () => {
  const s = start(claude, { agent: 'code-reviewer' });
  const { done, prompt } = await send(s, 'hi there');
  s.session.respond(prompt.requestId, { decision: 'deny' });
  await done;
  assert.match(s.said(), /I’m your \*\*code-reviewer\*\* agent, from \.claude\/agents\./);
  const plain = start(claude);
  const answered = await send(plain, 'hi there');
  plain.session.respond(answered.prompt.requestId, { decision: 'deny' });
  await answered.done;
  assert.doesNotMatch(plain.said(), /agent/);
});

test('"ask me" asks a question, whatever the provider', async () => {
  for (const descriptor of [claude, codex]) {
    const s = start(descriptor);
    const { done, prompt } = await send(s, 'Ask me something');
    assert.equal(prompt.kind, 'question');
    const [{ question, options }] = prompt.questions;
    s.session.respond(prompt.requestId, { decision: 'answer', answers: { [question]: options[1].label } });
    await done;
    assert.match(s.said(), /Vitest/);
    assert.equal(s.contact.permissionMode, descriptor.defaultPermissionMode);
  }
});

test('a skipped question is no stop: it goes on with picks of its own, and says what they are', async () => {
  const s = start(claude);
  const { done, prompt } = await send(s, 'Ask me something');
  s.session.respond(prompt.requestId, { decision: 'skip' });
  await done;
  assert.match(s.said(), /node:test/);
  assert.match(s.said(), /the happy path and edge cases/);
  assert.equal(s.of('result')[0].stopped, false);
});

test('"fix" asks to edit a file, with the change to read first, then runs the tests without asking again', async () => {
  for (const descriptor of [claude, codex]) {
    const s = start(descriptor);
    const { done, prompt } = await send(s, 'Can you fix the cart total?');
    assert.deepEqual([prompt.kind, prompt.canAlways], ['tool', true], descriptor.id);
    const { activity } = prompt;
    assert.deepEqual([activity.kind, activity.path], ['edit', '/tmp/project/src/cart.js']);
    const [{ before, after }] = activity.changes;
    assert.notEqual(before, after);
    assert.match(after, /item\.count \?\? 1/);
    // Nothing is edited or run until the invitation is accepted.
    assert.deepEqual(s.of('tool-result'), []);

    s.session.respond(prompt.requestId, { decision: 'allow' });
    await done;
    assert.deepEqual(
      s.of('tool').map((e) => e.activity.command ?? e.activity.kind),
      ['edit', 'npm test']
    );
    assert.deepEqual(
      s.of('tool-result').map((e) => [e.toolId, e.isError, e.declined]),
      s.of('tool').map((e) => [e.toolId, false, false])
    );
    assert.match(s.of('tool-result')[1].output, /pass 2/);
    assert.equal(s.of('permission').length, 1, 'the tests change nothing, so they are not asked about');
    assert.match(s.said(), /Fixed: /);
    assert.ok(s.said().includes(`the real ${descriptor.name} at it`), s.said());
    assert.equal(s.of('result')[0].stopped, false);
    assert.equal(s.session.state, 'idle');
  }
});

test('declining the edit stops the turn before the tests; feedback keeps the conversation going', async () => {
  const declined = start(claude);
  const first = await send(declined, 'fix it');
  declined.session.respond(first.prompt.requestId, { decision: 'deny' });
  await first.done;
  assert.deepEqual(
    declined.of('tool').map((e) => e.activity.kind),
    ['edit']
  );
  assert.equal(declined.of('tool-result')[0].declined, true);
  assert.equal(declined.of('result')[0].stopped, true);

  const redirected = start(claude);
  const second = await send(redirected, 'fix it');
  redirected.session.respond(second.prompt.requestId, { decision: 'feedback', message: 'another file' });
  await second.done;
  assert.equal(redirected.of('tool').length, 1);
  assert.equal(redirected.of('result')[0].stopped, false);
  assert.match(redirected.said(), /What would you like to do instead\?/);
});

test('"fix" is read at the start of a word, after a plan and a question', async () => {
  const kinds = [];
  for (const text of ['Fixing this would be nice', 'the prefix is wrong', 'plan how to fix it', 'ask me what to fix']) {
    const s = start(claude);
    const { done, prompt } = await send(s, text);
    kinds.push(prompt.kind === 'tool' ? (prompt.activity.command ?? prompt.activity.kind) : prompt.kind);
    await s.session.interrupt();
    await done;
  }
  assert.deepEqual(kinds, ['edit', 'ls -la', 'plan', 'question']);
});

test('"diagram" answers with a diagram in Mermaid, closed, and asks nothing, whatever the provider', async () => {
  for (const descriptor of [claude, codex]) {
    const s = start(descriptor);
    const { done, prompt } = await send(s, 'Draw me a diagram of the total');
    assert.equal(prompt, undefined, descriptor.id);
    await done;
    const [reply] = s.of('text-end').map((e) => e.text);
    assert.match(reply, /\n```mermaid\nflowchart TD\n[\s\S]+\n```\n/);
    assert.ok(reply.includes(`the real ${descriptor.name} draw yours`), reply);
    assert.deepEqual(s.of('tool'), []);
    assert.equal(s.of('result')[0].stopped, false);
  }
});

test('"diagram" is a word of its own, and comes after a fix', async () => {
  const kinds = [];
  for (const text of ['fix the diagram', 'diagrams, please', 'a diagrammatic view']) {
    const s = start(claude);
    const { done, prompt } = await send(s, text);
    kinds.push(prompt ? (prompt.activity.command ?? prompt.activity.kind) : 'diagram');
    if (prompt) await s.session.interrupt();
    await done;
  }
  assert.deepEqual(kinds, ['edit', 'diagram', 'ls -la']);
});

test('what a message asks of the terminals: how many, what their tabs say and what is typed into them', () => {
  const cases = [
    ['open a terminal', { count: 1, names: [] }],
    ['Open three terminals.', { count: 3, names: [] }],
    ['2 new terminals please', { count: 2, names: [] }],
    ['can I get a terminal for me?', { count: 1, names: [] }],
    ['a terminal for the dev server and one for the tests', { count: 1, names: ['dev server', 'tests'] }],
    ['open two terminals running claude', { count: 2, names: [], command: 'claude' }],
    ['a terminal for the tests, running npm test', { count: 1, names: ['tests'], command: 'npm test' }],
    ['Open a terminal and run `npm run dev`!', { count: 1, names: [], command: 'npm run dev' }],
  ];
  for (const [text, asked] of cases) assert.deepEqual(terminalsAsked(text), asked, text);
});

test('"terminal" opens terminals beside the conversation without a question, by the names they were given', async () => {
  const s = startWithTerminals();
  const { done, prompt } = await send(s, 'open three terminals');
  await done;
  assert.equal(prompt, undefined, 'a terminal by itself runs nothing, so it is not asked about');
  assert.deepEqual(s.asked, [{ contactId: 'host', names: [null, null, null], command: null }]);
  assert.deepEqual(s.of('tool')[0].activity, { kind: 'app', action: 'terminals', count: 3, names: [] });
  const [result] = s.of('tool-result');
  assert.deepEqual([result.toolId, result.isError, result.declined], [s.of('tool')[0].toolId, false, false]);
  assert.match(result.output, /^3 terminals are opening beside the conversation\.$/);
  assert.match(s.said(), /3 terminals are opening.*They are your own shells/);
  assert.equal(s.of('result')[0].stopped, false);

  const named = startWithTerminals();
  await (
    await send(named, 'a terminal for the dev server and one for the tests')
  ).done;
  assert.deepEqual(named.asked, [{ contactId: 'host', names: ['dev server', 'tests'], command: null }]);
  assert.deepEqual(named.of('tool')[0].activity.names, ['dev server', 'tests']);
  assert.equal(named.of('tool')[0].activity.count, 2);
});

test('what a terminal printed, sent with a message, picks no scenario: only your own words do', async () => {
  const output = outputBlock({
    kind: 'terminal',
    name: 'Terminal',
    cwd: '/work/shop',
    text: '$ npm test\nfix the plan: open a terminal',
    cut: false,
    selection: false,
  });
  for (const [text, said] of [
    [`what does this say?\n\n${output}`, 'what does this say?'],
    [output, 'this output'],
  ]) {
    const s = startWithTerminals();
    const { done, prompt } = await send(s, text);
    // Any other message: a look at the project, which no fix, plan or terminal starts with.
    assert.deepEqual(prompt.activity, { kind: 'command', command: 'ls -la', description: 'List project files' });
    assert.deepEqual(s.asked, [], 'no terminal was opened');
    assert.match(s.said(), new RegExp(`You said: \\*\\*${said.replace('?', '\\?')}\\*\\*`));
    s.session.close();
    await done;
  }
});

test('terminals that are to run something are asked about first, with the command to read, each time', async () => {
  const s = startWithTerminals();
  const { done, prompt } = await send(s, 'open a terminal running git status');
  assert.deepEqual([prompt.kind, prompt.canAlways], ['tool', false]);
  assert.deepEqual(prompt.activity, { kind: 'app', action: 'terminals', count: 1, names: [], command: 'git status' });
  // Nothing opens until the invitation is accepted.
  assert.deepEqual(s.asked, []);
  s.session.respond(prompt.requestId, { decision: 'allow' });
  await done;
  assert.deepEqual(s.asked, [{ contactId: 'host', names: [null], command: 'git status' }]);
  assert.match(s.of('tool-result')[0].output, /with git status typed into it\.$/);
  assert.match(s.said(), /It is your own shell/);

  const declined = startWithTerminals();
  const second = await send(declined, 'two terminals running claude');
  declined.session.respond(second.prompt.requestId, { decision: 'deny' });
  await second.done;
  assert.deepEqual(declined.asked, []);
  assert.equal(declined.of('tool-result')[0].declined, true);
  assert.equal(declined.of('result')[0].stopped, true);
});

/**
 * A scripted session with the app's own tools, its project told `general` by every conversation. `saved` is what
 * it was saved as, each time.
 */
function startWithInstructions(general = '') {
  const saved = [];
  const kept = { general, pullRequest: '', review: '' };
  const tools = appTools({
    store: { getContact: () => ({}), settings: {} },
    terminals: { wanted: () => true },
    startConversation: async () => ({}),
    instructions: {
      of: async () => ({ key: 'shop', name: 'shop', instructions: { ...kept } }),
      save: (_key, instructions) => {
        saved.push(instructions.general);
        Object.assign(kept, instructions);
      },
    },
  })('host');
  return { ...start(claude, {}, undefined, tools), saved };
}

/** Send a message, and let the session run until it asks something or is done. */
async function sendUntilAsked(s, text) {
  const done = s.session.send({ text });
  for (let i = 0; i < 50 && !s.of('permission').length; i += 1) await tick();
  return { done, prompt: s.of('permission').at(-1) };
}

const WITH_SCOPE =
  'Use pnpm.\n\n## Scope\n- Open the pull request once the tests pass.\n' +
  '- Merge it when its checks are green, without asking first.';

test('"instructions" reads them, and asks on a card of its own, with what they are and what they would be', async () => {
  const s = startWithInstructions('Use pnpm.');
  const { done, prompt } = await sendUntilAsked(s, 'Save a scope to the project instructions');
  assert.equal(prompt.kind, 'instructions');
  assert.deepEqual(prompt.instructions, {
    project: 'shop',
    part: 'Every conversation',
    before: 'Use pnpm.',
    after: WITH_SCOPE,
  });
  assert.deepEqual(prompt.activity, {
    kind: 'app',
    action: 'save-instructions',
    label: 'Every conversation',
    prompt: WITH_SCOPE,
  });
  assert.equal(s.session.state, 'waiting');
  assert.deepEqual(s.saved, [], 'nothing is saved before the user says so');
  s.session.respond(prompt.requestId, { decision: 'allow' });
  await done;
  assert.deepEqual(s.saved, [WITH_SCOPE]);
  assert.deepEqual(
    s.of('permission-resolved').map((e) => e.decision),
    ['allow']
  );
  assert.match(s.of('tool-result').at(-1).output, /^Saved as you wrote them: the Every conversation instructions/);
  assert.match(s.said(), /Saved\. New conversations in this project start with them/);
  assert.equal(s.of('result')[0].stopped, false);
});

test('with nothing saved yet, the card has all of the scope to add', async () => {
  const s = startWithInstructions();
  const { done, prompt } = await sendUntilAsked(s, 'Save a scope to the project instructions');
  assert.equal(prompt.instructions.before, '');
  assert.equal(prompt.instructions.after, WITH_SCOPE.replace('Use pnpm.\n\n', ''));
  s.session.respond(prompt.requestId, { decision: 'deny' });
  await done;
});

test('what the user edited on the card is what is saved, and the agent hears it was edited', async () => {
  const s = startWithInstructions('Use pnpm.');
  const { done, prompt } = await sendUntilAsked(s, 'Save a scope to the project instructions');
  s.session.respond(prompt.requestId, { decision: 'edit', text: 'Use pnpm.\n\n## Scope\nLeave merging to me.' });
  await done;
  assert.deepEqual(s.saved, ['Use pnpm.\n\n## Scope\nLeave merging to me.']);
  assert.deepEqual(
    s.of('permission-resolved').map((e) => e.decision),
    ['edit']
  );
  assert.equal('text' in s.of('permission-resolved')[0], false, 'what was written stays with the card');
  assert.match(
    s.of('tool-result').at(-1).output,
    /^Saved with the user’s edits: [\s\S]*They are now:\n\n.*\n\n## Scope\nLeave merging to me\./
  );
  assert.match(s.said(), /Saved, with your edits/);
});

test('instructions the user doesn’t save stay as they were, and the turn goes on', async () => {
  const s = startWithInstructions('Use pnpm.');
  const { done, prompt } = await sendUntilAsked(s, 'Save a scope to the project instructions');
  s.session.respond(prompt.requestId, { decision: 'deny' });
  await done;
  assert.deepEqual(s.saved, []);
  assert.equal(s.of('tool-result').at(-1).isError, true);
  assert.match(s.said(), /Okay, I left them as they were\./);
  assert.equal(s.of('result')[0].stopped, false);
});

test('stopping the turn while the card waits answers it as not saved, and saves nothing', async () => {
  const s = startWithInstructions('Use pnpm.');
  const { done, prompt } = await sendUntilAsked(s, 'Save a scope to the project instructions');
  await s.session.interrupt();
  await done;
  assert.deepEqual(
    s.of('permission-resolved').map((e) => [e.requestId, e.decision]),
    [[prompt.requestId, 'cancelled']]
  );
  assert.deepEqual(s.saved, []);
  assert.match(s.of('tool-result').at(-1).output, /The turn ended before the user answered\. Nothing was changed\./);
  // An answer that comes after is to nothing.
  s.session.respond(prompt.requestId, { decision: 'allow' });
  await tick();
  assert.deepEqual(s.saved, []);
});

test('Send now cancels a pending instructions save and invalidates that turn’s tool context', async () => {
  const s = startWithInstructions('Use pnpm.');
  const { done, prompt } = await sendUntilAsked(s, 'Save a scope to the project instructions');
  const context = s.session.appToolContext();
  const next = s.session.send({ id: 'correction', text: 'ask me something' });
  assert.deepEqual(s.session.queuedIds, ['correction']);

  await s.session.sendNow('correction');
  for (let i = 0; i < 50 && s.of('permission').length < 2; i += 1) await tick();
  assert.deepEqual(s.of('permission-resolved')[0], {
    type: 'permission-resolved',
    requestId: prompt.requestId,
    decision: 'cancelled',
  });
  assert.equal(s.of('tool-result').at(-1).output, 'The turn ended before the user answered. Nothing was changed.');
  assert.equal(s.of('tool-result').at(-1).isError, true);
  assert.deepEqual(s.saved, []);
  // A delayed read from the interrupted turn cannot reopen its approval during the next turn.
  assert.deepEqual(await context.ask(prompt), { decision: 'cancelled' });
  assert.equal(s.of('permission').length, 2);
  const question = s.of('permission').at(-1);
  assert.equal(question.kind, 'question');
  s.session.respond(prompt.requestId, { decision: 'allow' });
  assert.deepEqual(s.saved, []);
  s.session.respond(question.requestId, { decision: 'skip' });
  await Promise.all([done, next]);
  assert.deepEqual(
    s.of('result').map((event) => event.stopped),
    [true, false]
  );
});

test('a session closed while the card waits saves nothing, and one started after asks nothing again', async () => {
  const s = startWithInstructions('Use pnpm.');
  const { done, prompt } = await sendUntilAsked(s, 'Save a scope to the project instructions');
  s.session.close();
  await done;
  assert.deepEqual(
    s.of('permission-resolved').map((e) => [e.requestId, e.decision]),
    [[prompt.requestId, 'cancelled']]
  );
  assert.deepEqual(s.saved, []);
  // The app started again: the same contact's new session has nothing waiting, and saves nothing by itself.
  const again = start(claude, s.contact, undefined, []);
  again.session.start();
  await tick();
  assert.deepEqual(again.of('permission'), []);
  assert.equal(again.session.prompts.size, 0);
  assert.deepEqual(s.saved, []);
});

test('asked for a terminal while the conversation’s window is closed, the contact says that none was opened', async () => {
  const s = startWithTerminals(claude, false);
  await (
    await send(s, 'open a terminal')
  ).done;
  assert.equal(s.of('tool-result')[0].isError, true);
  assert.match(s.said(), /^The conversation’s window is closed, so no terminal was opened\.$/);
});

test('"new conversation" starts one for the side task at once, as the user asked, and says where it is', async () => {
  const s = startWithTerminals();
  const { done, prompt } = await send(s, 'can you start a new conversation for the side task?');
  await done;
  assert.equal(prompt, undefined, 'starting a conversation is not asked about');
  assert.equal(s.begun.length, 1);
  assert.deepEqual([s.begun[0].hostId, s.begun[0].now, s.begun[0].fromHere], ['host', true, false]);
  // Its own scripted answer is the to-do list, which needs nobody to accept anything.
  assert.match(s.begun[0].prompt, /^Put the cart total right\.\n[\s\S]*to-do list/);
  assert.deepEqual(s.of('tool')[0].activity, {
    kind: 'app',
    action: 'conversation',
    started: true,
    prompt: s.begun[0].prompt,
  });
  assert.match(s.of('tool-result')[0].output, /^Claude \(cart\) has started, in a worktree of its own\./);
  assert.match(s.said(), /under this one in your contact list, and I hear from it each time it finishes a turn/);

  const refused = startWithTerminals(claude, true, new Error('Pick a folder that exists.'));
  await (
    await send(refused, 'a new conversation please')
  ).done;
  assert.equal(refused.of('tool-result')[0].isError, true);
  assert.match(refused.said(), /Pick a folder that exists\.$/);
});

test('"new conversation with Codex" starts one with Codex in it', async () => {
  const s = startWithTerminals(claude, true, { name: 'Claude (cart)', worktree: true, joined: ['Codex'] });
  await (
    await send(s, 'start a new conversation for the side task, with codex')
  ).done;
  assert.deepEqual(s.begun[0].invite, ['codex']);
  assert.match(
    s.of('tool-result')[0].output,
    /^Claude \(cart\) has started, in a worktree of its own, with Codex in it\./
  );
  assert.match(s.said(), /starting a conversation for it, with Codex in it\./);

  const alone = startWithTerminals();
  await (
    await send(alone, 'a new conversation please')
  ).done;
  assert.deepEqual(alone.begun[0].invite, []);
});

test('a note from a conversation it started is passed on, whatever words the reply has', async () => {
  const s = startWithTerminals();
  await (
    await send(s, reportNote('Claude (cart)', 'Fixed: the plan worked, open a terminal to see.\n\nMore here.'))
  ).done;
  assert.equal(s.of('permission').length, 0);
  assert.deepEqual(s.begun, []);
  assert.match(s.said(), /^\*\*Claude \(cart\)\*\* is done: “Fixed: the plan worked, open a terminal to see\.”/);
});

/** A scripted Claude that is a project's manager, with what its tools were asked. */
function startManager() {
  const calls = [];
  const managers = {
    oversees: () => true,
    say: async (...args) => (calls.push(['say', ...args]), 'Claude (cart) has your message.'),
    look: async (...args) => (calls.push(['look', ...args]), 'Claude (cart) (Claude, idle)'),
    brief: (...args) => (calls.push(['brief', ...args]), 'Saved the brief of shop.'),
    sources: (...args) => (calls.push(['sources', ...args]), 'Added to the sources of shop.'),
  };
  const tools = appTools({
    store: { getContact: () => ({}), settings: {} },
    terminals: { wanted: () => true },
    startConversation: async () => ({}),
    managers,
  })('manager');
  return { ...start(claude, {}, undefined, tools), calls };
}

const CHANGED = {
  name: 'Claude (cart)',
  provider: 'Claude',
  status: 'idle',
  branch: 'cart',
  folder: '/w/shop/cart',
  task: 'Fix the cart',
  reply: 'Fixed.',
  mainLine: 'origin/main',
  files: [{ path: 'src/cart.js', status: 'modified', added: 1, removed: 1 }],
  more: 0,
};

test('a manager that is turned on writes the brief, and says where to read it', async () => {
  const s = startManager();
  await (
    await send(s, startNote('shop', cleanManager({ sources: [{ name: 'SHOP-12', url: '' }] })))
  ).done;
  assert.deepEqual(
    s.calls.map(([tool]) => tool),
    ['brief']
  );
  assert.match(s.calls[0][2], /^Goal: /);
  assert.deepEqual(s.of('tool')[0].activity, { kind: 'app', action: 'save-brief', prompt: s.calls[0][2] });
  assert.match(s.said(), /on the project’s Manager page/);
});

test('a manager whose window is full writes where it stands in the brief, and the fresh session looks at everyone', async () => {
  const old = startManager();
  await (
    await send(old, handoverNote(72))
  ).done;
  assert.deepEqual(
    old.calls.map(([tool]) => tool),
    ['brief']
  );
  assert.match(old.calls[0][2], /^Goal: [\s\S]*\nWhere it stands: /);
  assert.match(old.said(), /^Handed over: /);

  const fresh = startManager();
  await (
    await send(fresh, takeoverNote('shop', { brief: old.calls[0][2] }))
  ).done;
  assert.deepEqual(fresh.calls, [['look', 'manager', undefined]], 'all of them, with no name');
  assert.match(fresh.said(), /Picked up where the last session left off\./);
});

test('a manager told of a change looks at it, and asks the user before it asks for what the ticket wants', async () => {
  const s = startManager();
  const { done, prompt } = await send(s, workerNote(CHANGED));
  assert.deepEqual([prompt.kind, prompt.canAlways], ['tool', false]);
  assert.deepEqual(prompt.activity, {
    kind: 'app',
    action: 'message',
    urgent: false,
    label: 'Claude (cart)',
    prompt: s.of('tool').at(-1).activity.prompt,
  });
  assert.match(prompt.activity.prompt, /^SHOP-12 asks for a test/);
  // Nothing is sent until the invitation is accepted.
  assert.deepEqual(
    s.calls.map(([tool]) => tool),
    ['look']
  );
  s.session.respond(prompt.requestId, { decision: 'allow' });
  await done;
  assert.equal(s.of('permission').length, 1, 'looking is not asked about');
  assert.deepEqual(
    s.calls.map(([tool, ...args]) => [tool, ...args.slice(0, 2)]),
    [
      ['look', 'manager', 'Claude (cart)'],
      ['say', 'manager', 'Claude (cart)'],
    ]
  );
  assert.match(s.said(), /I asked for it\.$/);
  await (
    await send(s, workerNote(CHANGED, { answered: true }))
  ).done;
  assert.match(s.said(), /^@Claude \(cart\) is adding the test\./m, 'named as a tag, which the window draws as one');
  assert.equal(s.calls.length, 2, 'an answer is only read');
});

test('a manager asked after a conversation it oversees, tagged, looks at it, and names it as a tag', async () => {
  const s = startManager();
  await (
    await send(s, 'how is @claude (cart) doing?')
  ).done;
  assert.equal(s.of('permission').length, 0, 'looking is not asked about, and nothing is sent');
  assert.deepEqual(s.calls, [
    ['look', 'manager', undefined],
    ['look', 'manager', 'Claude (cart)'],
  ]);
  assert.match(s.said(), /^@Claude \(cart\) is on SHOP-12\./);
});

test('a manager asked after everyone names each conversation it oversees as a tag', async () => {
  const s = startManager();
  await (
    await send(s, 'how is everyone doing?')
  ).done;
  assert.deepEqual(s.calls, [['look', 'manager', undefined]]);
  assert.match(s.said(), /^I oversee @Claude \(cart\)\. Tag one with @/);
  // Anyone else takes an @ for any other message: a command to run, here.
  const other = startWithTerminals();
  const { prompt } = await send(other, 'how is @Claude (cart) doing?');
  assert.equal(prompt.activity.kind, 'command');
  other.session.close();
});

test('a manager’s message the user declines is not sent, and the turn ends there', async () => {
  const declined = startManager();
  const first = await send(declined, workerNote(CHANGED));
  declined.session.respond(first.prompt.requestId, { decision: 'deny' });
  await first.done;
  assert.deepEqual(
    declined.calls.map(([tool]) => tool),
    ['look']
  );
  assert.equal(declined.of('tool-result').at(-1).declined, true);
  assert.equal(declined.of('result')[0].stopped, true);
  assert.doesNotMatch(declined.said(), /I asked for it/);

  const redirected = startManager();
  const second = await send(redirected, workerNote(CHANGED));
  redirected.session.respond(second.prompt.requestId, { decision: 'feedback', message: 'not yet' });
  await second.done;
  assert.deepEqual(
    redirected.calls.map(([tool]) => tool),
    ['look']
  );
  assert.equal(redirected.of('result')[0].stopped, false);
  assert.match(redirected.said(), /What would you like to do instead\?$/);
});

test('a link shared with a manager is added to its sources, named after its site', async () => {
  const s = startManager();
  await (
    await send(s, 'here is the PRD: https://www.notion.so/acme/cart-prd.')
  ).done;
  assert.deepEqual(s.calls, [
    [
      'sources',
      'manager',
      { add: [{ name: 'notion.so', url: 'https://www.notion.so/acme/cart-prd' }], remove: undefined },
    ],
  ]);
  assert.match(s.said(), /added it to the sources/);
  // Anyone else takes a link for any other message: a command to run, here.
  const other = startWithTerminals();
  const { prompt } = await send(other, 'look at https://example.com');
  assert.equal(prompt.activity.kind, 'command');
  other.session.close();
});

test('a manager’s message is answered, whatever words it has, and starts no fix', async () => {
  const s = startWithTerminals();
  await (
    await send(s, managerMessage('Manager', 'Please fix the test you left out.'))
  ).done;
  assert.equal(s.of('permission').length, 0);
  assert.match(s.said(), /^On it: I am adding the test \*\*Manager\*\* asked for\./);
});

test('"terminal" comes after a plan, a question and a fix, and is any other message without the app’s tools', async () => {
  const fix = startWithTerminals();
  const first = await send(fix, 'fix the colours of the terminal');
  assert.equal(first.prompt.activity.kind, 'edit');
  fix.session.close();
  await first.done;

  const plain = start(claude);
  const second = await send(plain, 'open a terminal');
  assert.deepEqual(second.prompt.activity, { kind: 'command', command: 'ls -la', description: 'List project files' });
  plain.session.close();
  await second.done;
});

test('a nudge while the tests run ends the turn before they report', async () => {
  const s = startHeld(codex);
  const done = s.session.send({ text: 'fix it' });
  await s.settle();
  s.session.respond(s.of('permission')[0].requestId, { decision: 'allow' });
  await tick();
  assert.deepEqual(
    s.of('tool').map((e) => e.activity.command ?? e.activity.kind),
    ['edit', 'npm test']
  );
  await s.session.interrupt();
  await s.settle();
  await done;
  assert.equal(s.of('tool-result').length, 1, 'the edit was made, the tests never reported');
  assert.doesNotMatch(s.said(), /Fixed/);
  assert.equal(s.of('result')[0].stopped, true);
  assert.equal(s.session.state, 'idle');
});

test('"/compact" tidies up the conversation, in the words of the provider’s own session', async () => {
  for (const descriptor of [claude, codex]) {
    const s = start(descriptor);
    await s.session.send({ text: '/compact' });
    assert.deepEqual(s.of('notice'), [
      { type: 'notice', text: `${descriptor.name} tidied up the conversation (compacted earlier messages).` },
    ]);
    assert.deepEqual(s.of('permission'), [], descriptor.id);
    assert.deepEqual(s.of('tool'), [], descriptor.id);
    assert.equal(s.said(), '', descriptor.id);
    assert.equal(s.of('result')[0].stopped, false);
    assert.equal(s.session.state, 'idle');
  }
});

test('"/review" looks at the changes without asking, then says what it found', async () => {
  for (const descriptor of [claude, codex]) {
    const s = start(descriptor);
    // What comes after the command says what to look at, and is not read as a script of its own.
    await s.session.send({ text: '/review the plan for the last commit' });
    assert.deepEqual(
      s.of('tool').map((e) => e.activity.command),
      ['git diff'],
      descriptor.id
    );
    const [found] = s.of('tool-result');
    assert.equal(found.toolId, s.of('tool')[0].toolId);
    assert.deepEqual([found.isError, found.declined], [false, false]);
    assert.match(found.output, /^diff --git /);
    assert.deepEqual(s.of('permission'), [], descriptor.id);
    assert.match(s.said(), /`src\/cart\.js`/);
    assert.ok(s.said().includes(`a real one from ${descriptor.name}.`), s.said());
    assert.equal(s.of('result')[0].stopped, false);
    assert.equal(s.session.state, 'idle');
  }
});

test('any other slash command is answered as one of the provider’s own', async () => {
  const s = start(claude);
  await s.session.send({ text: '/Cost' });
  assert.match(s.said(), /^`\/cost` is one of Claude’s own commands\./);
  assert.match(s.said(), /demo mode/);
  assert.deepEqual(s.of('tool'), []);
  assert.deepEqual(s.of('permission'), []);
  assert.equal(s.of('result')[0].stopped, false);

  // A skill is a command too, under the name its plugin gives it.
  const skill = start(codex);
  await skill.session.send({ text: '/docs:write-changelog for 2.0' });
  assert.match(skill.said(), /^`\/docs:write-changelog` is one of Codex’s own commands\./);
});

test('a path that starts a message is not a slash command', async () => {
  for (const text of ['/Users/you/notes.md what is this?', '/ no command', '/tmp/x']) {
    const s = start(codex);
    const { done, prompt } = await send(s, text);
    assert.equal(prompt.kind, 'tool', text);
    assert.deepEqual(prompt.activity.command, 'ls -la', text);
    await s.session.interrupt();
    await done;
  }
});

test('a nudge stops a review before it says what it found', async () => {
  const s = startHeld(codex);
  const done = s.session.send({ text: '/review' });
  // The opening pause, then the pause while it reads the changes.
  await s.resume();
  assert.equal(s.of('tool').length, 1);
  await s.session.interrupt();
  await s.settle();
  await done;
  assert.deepEqual(s.of('tool-result'), []);
  assert.deepEqual(s.of('text-start'), []);
  assert.equal(s.of('result')[0].stopped, true);
  assert.equal(s.session.state, 'idle');
});

test('declining the command stops the turn; feedback keeps the conversation going', async () => {
  const declined = start(codex);
  const first = await send(declined, 'hello');
  declined.session.respond(first.prompt.requestId, { decision: 'deny' });
  await first.done;
  assert.equal(declined.of('tool-result')[0].declined, true);
  assert.equal(declined.of('result')[0].stopped, true);
  assert.equal(declined.of('text-end').length, 1);

  const redirected = start(codex);
  const second = await send(redirected, 'hello');
  redirected.session.respond(second.prompt.requestId, { decision: 'feedback', message: 'not now' });
  await second.done;
  assert.equal(redirected.of('result')[0].stopped, false);
  assert.match(redirected.said(), /What would you like to do instead\?/);
});

test('a nudge withdraws the open prompt and ends the turn', async () => {
  const s = start(codex);
  const { done, prompt } = await send(s, 'hello');
  await s.session.interrupt();
  await done;
  assert.deepEqual(s.of('permission-resolved'), [
    { type: 'permission-resolved', requestId: prompt.requestId, decision: 'cancelled' },
  ]);
  assert.equal(s.of('result')[0].stopped, true);
  assert.equal(s.session.state, 'idle');
});

// What each scripted scenario asks for, once it gets that far.
const scenarios = [
  { name: 'command', descriptor: codex, text: 'hello', asks: 'tool' },
  { name: 'plan', descriptor: claude, text: 'plan it', asks: 'plan' },
  { name: 'question', descriptor: codex, text: 'ask me something', asks: 'question' },
];

function assertStoppedQuietly(s, name) {
  assert.deepEqual(s.of('tool'), [], `${name}: tool`);
  assert.deepEqual(s.of('permission'), [], `${name}: permission`);
  assert.equal(s.of('result').length, 1, `${name}: result`);
  assert.equal(s.of('result')[0].stopped, true, `${name}: stopped`);
  assert.ok(!s.of('state').some((e) => e.state === 'waiting'), `${name}: never waits`);
  assert.equal(s.of('state').at(-1).state, 'idle', `${name}: last state`);
  assert.equal(s.session.state, 'idle', name);
  assert.equal(s.pauses.length, 0, `${name}: still running`);
}

test('a nudge during the opening pause ends the turn before anything is said or asked', async () => {
  for (const { name, descriptor, text } of scenarios) {
    const s = startHeld(descriptor);
    const done = s.session.send({ text });
    assert.equal(s.session.state, 'working', name);
    await s.session.interrupt();
    await s.resume();
    assertStoppedQuietly(s, name);
    assert.deepEqual(s.of('text-start'), [], `${name}: text`);
    await done;
  }
});

test('a nudge while the first line is typed ends the turn before the tool or the prompt', async () => {
  for (const { name, descriptor, text } of scenarios.filter((scenario) => scenario.name !== 'question')) {
    const s = startHeld(descriptor);
    const done = s.session.send({ text });
    await s.resume();
    const typed = s.of('text-delta').map((e) => e.text);
    assert.equal(typed.length, 1, name);
    await s.session.interrupt();
    await s.resume();
    assertStoppedQuietly(s, name);
    // The line is closed with only what was typed before the nudge.
    assert.deepEqual(
      s.of('text-end').map((e) => e.text),
      typed,
      name
    );
    await done;
  }
});

test('the message after a nudge gets its full scripted turn', async () => {
  for (const { name, descriptor, text, asks } of scenarios) {
    const s = startHeld(descriptor);
    const stopped = s.session.send({ text });
    await s.session.interrupt();
    await s.resume();
    assertStoppedQuietly(s, name);
    await stopped;

    const done = s.session.send({ text });
    await s.settle();
    const [prompt] = s.of('permission');
    assert.equal(prompt.kind, asks, name);
    assert.equal(s.session.state, 'waiting', name);
    await s.session.interrupt();
    await done;
    assert.deepEqual(
      s.of('result').map((e) => e.stopped),
      [true, true],
      name
    );
  }
});

const kinds = (s) => s.of('permission').map((p) => p.kind);

test('a message sent while the contact is answering waits for its own turn', async () => {
  const s = startHeld(codex);
  const sent = [s.session.send({ text: 'hello' })];
  // Sent during the opening pause of the first turn.
  sent.push(s.session.send({ text: 'ask me something' }));
  await s.settle();
  assert.deepEqual(kinds(s), ['tool']);
  assert.equal(s.of('tool').length, 1);
  assert.equal(s.of('text-start').length, 1);

  // Sent while the first turn's prompt is open.
  sent.push(s.session.send({ text: 'one more' }));
  await s.settle();
  assert.deepEqual(kinds(s), ['tool']);
  assert.equal(s.session.state, 'waiting');
  assert.equal(s.of('result').length, 0);

  s.session.respond(s.of('permission')[0].requestId, { decision: 'allow' });
  await s.settle();
  assert.deepEqual(kinds(s), ['tool', 'question']);
  assert.equal(s.of('result').length, 1);
  assert.ok(s.events.indexOf(s.of('result')[0]) < s.events.indexOf(s.of('permission')[1]), 'first turn ends first');
  assert.equal(s.session.state, 'waiting');

  const [{ question, options }] = s.of('permission')[1].questions;
  s.session.respond(s.of('permission')[1].requestId, { decision: 'answer', answers: { [question]: options[0].label } });
  await s.settle();
  assert.deepEqual(kinds(s), ['tool', 'question', 'tool']);
  assert.equal(s.of('result').length, 2);
  assert.match(s.said(), /\*\*one more\*\*/);

  s.session.respond(s.of('permission')[2].requestId, { decision: 'allow' });
  await s.settle();
  await Promise.all(sent);
  assert.deepEqual(
    s.of('result').map((e) => e.stopped),
    [false, false, false]
  );
  assert.equal(s.of('tool').length, 2);
  assert.equal(s.session.state, 'idle');
});

test('a nudge also drops the messages still waiting for their turn', async () => {
  const s = startHeld(codex);
  const sent = [s.session.send({ text: 'hello' }), s.session.send({ text: 'ask me something' })];
  await s.settle();
  assert.deepEqual(kinds(s), ['tool']);
  await s.session.interrupt();
  await s.settle();
  await Promise.all(sent);
  assert.deepEqual(kinds(s), ['tool']);
  assert.deepEqual(
    s.of('result').map((e) => e.stopped),
    [true]
  );
  assert.equal(s.session.state, 'idle');

  // The contact still answers what is sent next.
  const next = s.session.send({ text: 'ask me something' });
  await s.settle();
  assert.deepEqual(kinds(s), ['tool', 'question']);
  await s.session.interrupt();
  await next;
});

test('Send now ends the turn going on, and the messages waiting are answered next', async () => {
  const s = startHeld(codex);
  const sent = [s.session.send({ text: 'hello' })];
  await s.settle();
  assert.deepEqual(kinds(s), ['tool']);
  await s.session.sendNow();
  await s.settle();
  assert.equal(s.of('result').length, 0, 'nothing waits, so nothing is stopped');

  sent.push(s.session.send({ text: 'ask me something' }));
  assert.equal(s.session.waiting, 1);
  await s.session.sendNow();
  await s.settle();
  assert.deepEqual(
    s.of('result').map((e) => e.stopped),
    [true]
  );
  assert.deepEqual(kinds(s), ['tool', 'question'], 'the next turn is the one that waited');
  assert.deepEqual(
    s.of('waiting').map((e) => e.count),
    [1, 0]
  );
  await s.session.interrupt();
  await s.settle();
  await Promise.all(sent);
});

test('a message waiting for its turn can be taken back: it is never answered, and the turn going on goes on', async () => {
  const s = startHeld(claude);
  const sent = [s.session.send({ text: 'hello', id: 'm-1' })];
  await s.settle();
  assert.deepEqual(kinds(s), ['tool']);
  sent.push(s.session.send({ text: 'ask me something', id: 'm-2' }));
  assert.equal(await s.session.cancel('m-1'), false, 'not the one being answered');
  assert.equal(await s.session.cancel('m-2'), true);
  assert.equal(await s.session.cancel('m-2'), false, 'once');
  assert.deepEqual(
    s.of('waiting').map((e) => e.count),
    [1, 0]
  );
  s.session.respond(s.of('permission')[0].requestId, { decision: 'allow' });
  await s.settle();
  await Promise.all(sent);
  assert.deepEqual(kinds(s), ['tool'], 'what was taken back asks nothing');
  assert.deepEqual(
    s.of('result').map((e) => e.stopped),
    [false]
  );
  assert.equal(s.session.state, 'idle');
});

test('a message sent right after a nudge is answered, and the stopped turn stays stopped', async () => {
  const s = startHeld(codex);
  const sent = [s.session.send({ text: 'first' })];
  await s.session.interrupt();
  // Sent before the stopped turn's opening pause is over.
  sent.push(s.session.send({ text: 'second' }));
  await s.settle();
  assert.deepEqual(
    s.of('result').map((e) => e.stopped),
    [true]
  );
  assert.deepEqual(kinds(s), ['tool']);
  assert.equal(s.of('tool').length, 1);
  assert.match(s.said(), /\*\*second\*\*/);
  assert.doesNotMatch(s.said(), /\*\*first\*\*/);

  s.session.respond(s.of('permission')[0].requestId, { decision: 'allow' });
  await s.settle();
  await Promise.all(sent);
  assert.deepEqual(
    s.of('result').map((e) => e.stopped),
    [true, false]
  );
  assert.equal(s.session.state, 'idle');
});

test('closing the session drops the messages still waiting for their turn', async () => {
  const s = startHeld(codex);
  const sent = [s.session.send({ text: 'hello' }), s.session.send({ text: 'ask me something' })];
  await s.settle();
  s.session.close();
  await s.settle();
  await Promise.all(sent);
  assert.deepEqual(kinds(s), ['tool']);
  assert.equal(s.of('text-start').length, 1);
  assert.equal(s.pauses.length, 0);
});

test('in a conversation with other agents the script goes by what the user asked', async () => {
  // What a session is sent there: who is here and what the others said, around what you said.
  const relayed = (asked) => ({
    text: `[Group conversation]\nYou are Codex.\n\nSafa: make a plan\n\nClaude: Here is the plan. Ask me anything.\n\nSafa: ${asked}`,
    asked,
  });
  const hello = start(claude);
  const first = hello.session.send(relayed('hello'));
  await tick();
  assert.equal(hello.of('permission').at(-1).kind, 'tool', 'neither a plan nor a question, whatever was said before');
  assert.match(hello.said(), /^Hey! 👋 You said: \*\*hello\*\*\. /);
  assert.doesNotMatch(hello.said(), /Group conversation|Safa:/);
  await hello.session.interrupt();
  await first;

  const plan = start(claude);
  const second = plan.session.send(relayed('plan it'));
  await tick();
  assert.equal(plan.of('permission').at(-1).kind, 'plan', 'what you just said still picks the script');
  await plan.session.interrupt();
  await second;

  const mention = start(codex);
  const third = mention.session.send(relayed('@Codex and @Claude, hi'));
  await tick();
  assert.match(
    mention.said(),
    /You said: \*\*Codex and Claude, hi\*\*/,
    'quoted without the @, so the turn is not handed on'
  );
  await mention.session.interrupt();
  await third;

  // On its own, a contact is sent your words only, and quotes them as they are.
  const alone = start(codex);
  const fourth = alone.session.send({ text: 'look at @README.md' });
  await tick();
  assert.match(alone.said(), /You said: \*\*look at @README\.md\*\*/);
  await alone.session.interrupt();
  await fourth;
});

test('demo mode scripts every provider, each as itself', () => {
  const providers = createProviders({ app: { isPackaged: false }, demo: true });
  for (const descriptor of providers.list()) {
    const events = [];
    const session = providers.createSession(
      {
        provider: descriptor.id,
        cwd: '/tmp',
        model: '',
        permissionMode: descriptor.defaultPermissionMode,
        sessionId: null,
      },
      (e) => events.push(e)
    );
    assert.ok(session instanceof DemoSession, descriptor.id);
    assert.equal(session.descriptor, descriptor);
    session.start();
    assert.deepEqual(events.find((e) => e.type === 'ready').commands, descriptor.commonCommands);
  }
});

test('every scripted service is given the app’s tools for the conversation it answers in', () => {
  const askedFor = [];
  const tool = { name: 'open_terminals' };
  const tools = (conversation) => askedFor.push(conversation) && [tool];
  const providers = createProviders({ app: { isPackaged: false }, demo: true, tools });
  const contact = (provider) => ({ provider, cwd: '/tmp', model: '', permissionMode: 'x', sessionId: null });
  for (const descriptor of providers.list()) {
    const session = providers.createSession(contact(descriptor.id), () => {}, { conversation: 'host' });
    assert.deepEqual(session.tools, [tool], descriptor.id);
  }
  assert.deepEqual(
    askedFor,
    providers.list().map(() => 'host')
  );
  // Outside a conversation there is no window to open anything in.
  assert.deepEqual(providers.createSession(contact('claude'), () => {}).tools, []);
});

test('only Claude has output styles, in demo mode as for real', () => {
  const providers = createProviders({ app: { isPackaged: false }, demo: true });
  assert.deepEqual(
    providers
      .list()
      .filter((descriptor) => descriptor.outputStyles)
      .map((descriptor) => descriptor.id),
    ['claude']
  );
  for (const descriptor of providers.list()) {
    const events = [];
    const contact = { provider: descriptor.id, cwd: '/tmp', model: '', permissionMode: 'x', sessionId: null };
    providers.createSession(contact, (e) => events.push(e)).start();
    assert.deepEqual(
      events.find((e) => e.type === 'ready').outputStyles,
      (descriptor.outputStyles || []).map((style) => style.id),
      descriptor.id
    );
  }
});

test('the web preview’s example contacts use providers and modes that exist', () => {
  const byId = new Map([claude, codex].map((d) => [d.id, d]));
  const { contacts } = new MemoryStore();
  assert.deepEqual([...new Set(contacts.map((c) => c.provider))].sort(), ['claude', 'codex']);
  for (const contact of contacts) {
    const provider = byId.get(contact.provider);
    assert.ok(
      provider.permissionModes.some((m) => m.id === contact.permissionMode),
      `${contact.name}: ${contact.permissionMode}`
    );
  }
});

test('an effort check is answered with a level behind each name: the lowest, or for a big job the highest', async () => {
  const check = [
    { name: 'Claude (api)', levels: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { name: 'Codex', levels: ['low', 'medium', 'high'] },
  ];
  const relayed = (asked) => ({ text: `Safa: ${asked}\n\n[Effort check]\n...`, asked, check });

  const small = start(claude);
  await small.session.send(relayed('rename the button'));
  assert.equal(small.said(), '@Claude (api)(low) @Codex(low) A small job, by the look of it.');
  assert.deepEqual(small.of('permission'), [], 'it does nothing else: no tool, no question');
  assert.equal(small.of('result').length, 1);
  assert.equal(small.session.state, 'idle');

  const big = start(codex);
  await big.session.send(relayed('refactor the importer and plan the rest'));
  assert.equal(big.said(), '@Claude (api)(max) @Codex(high) This one needs care.', 'not the plan the word asks for');

  // The turn after it is a turn like any other.
  const after = send(big, 'go ahead');
  assert.equal((await after).prompt.kind, 'tool');
  await big.session.interrupt();
});

test('a nudge during an effort check ends it before it says anything', async () => {
  const s = startHeld(claude);
  const done = s.session.send({ text: 'x', asked: 'rename it', check: [{ name: 'Claude', levels: ['low'] }] });
  await tick();
  await s.session.interrupt();
  await s.settle();
  await done;
  assert.equal(s.said(), '');
  assert.equal(s.of('result')[0].stopped, true);
});

// ---- helpers ------------------------------------------------------------------------------------

test('asked for helpers, a scripted Claude starts two that work side by side and report', async () => {
  const s = start(claude);
  await s.session.send({ text: 'ask two helpers to look at the cart' });
  const asked = s.of('tool').filter((e) => e.activity.kind === 'delegate');
  assert.deepEqual(
    asked.map((e) => [e.activity.label, e.activity.agent, e.sub]),
    [
      ['Look through the tests', 'Explore', false],
      ['Read how the total is worked out', 'Explore', false],
    ]
  );
  for (const { activity } of asked) assert.ok(activity.prompt, activity.label);

  // Every step says whose it is, and its paths are in the contact's folder.
  const steps = s.of('tool').filter((e) => e.sub);
  assert.equal(steps.length, 5);
  for (const step of steps) assert.ok(asked.some((e) => e.toolId === step.helper));
  assert.ok(steps.some((e) => e.activity.path === '/tmp/project/test/cart.test.js'));
  // Side by side: the second one starts before the first has taken all its steps.
  const order = s.of('tool').map((e) => (e.sub ? e.helper : e.toolId));
  assert.ok(order.indexOf(asked[1].toolId) < order.lastIndexOf(asked[0].toolId));

  const reports = asked.map((e) => s.of('tool-result').find((r) => r.toolId === e.toolId));
  for (const report of reports) {
    assert.equal(report.isError, false);
    assert.equal('stopped' in report, false);
    assert.equal(typeof report.durationMs, 'number');
  }
  assert.match(reports[0].output, /2 tests/);
  assert.match(s.said(), /Both are back/);
  assert.equal(s.of('result').at(-1).stopped, false);
});

test('a helper you stop ends where it is, and the other one finishes', async () => {
  const s = startHeld(claude);
  const done = s.session.send({ text: 'ask your helpers' });
  // Through the pause before the turn and what it says first, until both helpers have been asked.
  while (s.of('tool').length < 2) await s.resume();
  const [first, second] = s.of('tool');
  await s.session.stopHelper(first.toolId);
  await s.settle();
  await done;

  const result = (helper) => s.of('tool-result').find((r) => r.toolId === helper.toolId);
  assert.deepEqual(
    [result(first).stopped, result(first).output, result(first).isError],
    [true, '', false],
    'stopped, with nothing to report'
  );
  assert.equal(
    s.of('tool').some((e) => e.helper === first.toolId),
    false,
    'it takes no more steps'
  );
  assert.equal('stopped' in result(second), false);
  assert.match(result(second).output, /price × count/);
  assert.match(s.said(), /You stopped one of them/);
  assert.equal(s.of('result').at(-1).stopped, false, 'the turn was not stopped');
});

test('stopping a helper that is not there does nothing', async () => {
  const s = start(claude);
  await s.session.stopHelper('nobody');
  await s.session.send({ text: 'ask your helpers' });
  assert.match(s.said(), /Both are back/);
});

test('a nudge stops the helpers along with the turn', async () => {
  const s = startHeld(claude);
  const done = s.session.send({ text: 'ask your helpers' });
  while (s.of('tool').length < 2) await s.resume();
  await s.session.interrupt();
  await s.settle();
  await done;
  const asked = s.of('tool').filter((e) => e.activity.kind === 'delegate');
  for (const helper of asked) {
    assert.equal(s.of('tool-result').find((r) => r.toolId === helper.toolId).stopped, true);
  }
  assert.doesNotMatch(s.said(), /Both are back|You stopped/);
  assert.equal(s.of('result').at(-1).stopped, true);
});

test('a provider whose agents have no helpers is not scripted any', async () => {
  const s = start(codex);
  const { prompt } = await send(s, 'ask your helpers');
  // It runs its usual script instead: a command it asks about.
  assert.equal(prompt.activity.kind, 'command');
  assert.equal(
    s.of('tool').some((e) => e.activity.kind === 'delegate'),
    false
  );
  assert.equal(codex.helpers, undefined);
  assert.equal(claude.helpers, true);
});

// ---- MCP servers ------------------------------------------------------------------------------

test('a scripted Claude has an MCP server of every kind to see, and asking starts it without a turn', async () => {
  const s = start(claude);
  const servers = await s.session.mcpServers();
  assert.deepEqual(
    servers.map((server) => [server.name, server.status]),
    [
      ['github', 'connected'],
      ['figma', 'needs-auth'],
      ['figma-desktop', 'failed'],
      ['playwright', 'disabled'],
    ]
  );
  assert.match(servers[2].error, /ECONNREFUSED/);
  assert.equal(s.session.state, 'idle');
  assert.equal(s.of('ready').length, 1);
  assert.equal(s.of('result').length, 0);
  assert.equal(s.said(), '');
});

test('what is done about a scripted MCP server shows the next time they are listed', async () => {
  const s = start(claude);
  const status = async (name) => (await s.session.mcpServers()).find((server) => server.name === name);

  assert.equal(await s.session.mcpAct('figma', 'sign-in'), undefined, 'no browser is needed for it');
  assert.equal((await status('figma')).status, 'connected');
  await s.session.mcpAct('figma-desktop', 'reconnect');
  assert.deepEqual(await status('figma-desktop'), {
    name: 'figma-desktop',
    status: 'connected',
    address: 'http://127.0.0.1:3845/mcp',
    origin: 'This folder, for you only',
    tools: 12,
  });
  await s.session.mcpAct('github', 'disable');
  assert.equal((await status('github')).status, 'disabled');
  await s.session.mcpAct('playwright', 'enable');
  assert.equal((await status('playwright')).status, 'connected');
  await assert.rejects(s.session.mcpAct('nope', 'reconnect'), /Server not found: nope/);
});

test('the list a scripted session hands out is not the one it keeps, and each session has its own', async () => {
  const s = start(claude);
  const [first] = await s.session.mcpServers();
  first.status = 'failed';
  assert.equal((await s.session.mcpServers())[0].status, 'connected');

  await s.session.mcpAct('github', 'disable');
  assert.equal((await start(claude).session.mcpServers())[0].status, 'connected');
});

test('a scripted Codex has no MCP servers to list: its /mcp is its own to answer', async () => {
  const s = start(codex);
  assert.deepEqual(await s.session.mcpServers(), []);
  await s.session.send({ text: '/mcp' });
  assert.match(s.said(), /`\/mcp` is one of Codex’s own commands/);
});

// ---- how full it is -----------------------------------------------------------------------------

test('a scripted Claude says how full its window is after every turn, and it fills as they go', async () => {
  const s = start(claude);
  await s.session.send({ text: '/init' });
  assert.deepEqual(s.of('context'), [{ type: 'context', used: 247_000, size: 1_000_000 }]);
  // The turn is over first, and it is idle after.
  assert.deepEqual(
    s.events.slice(-3).map((e) => e.type),
    ['result', 'context', 'state']
  );
  await s.session.send({ text: '/init' });
  assert.equal(s.of('context').at(-1).used, 251_200);
});

test('a scripted Claude says how much of its plan’s limits is used during every turn, as a real one hears it', async () => {
  const s = start(claude);
  await s.session.send({ text: '/init' });
  const [{ limits }] = s.of('limits');
  assert.deepEqual(
    limits.map(({ kind, percent }) => [kind, percent]),
    [
      ['session', 43],
      ['weekly', 28],
      ['model', 2],
    ]
  );
  const types = s.events.map((e) => e.type);
  assert.ok(types.indexOf('limits') < types.indexOf('result'), 'before the turn is over');
  await s.session.send({ text: '/init' });
  assert.equal(s.of('limits').length, 2);
});

test('a scripted /compact leaves little of the messages in the window', async () => {
  const s = start(claude);
  await s.session.send({ text: '/compact' });
  assert.equal(s.of('context').at(-1).used, 45_500);
  const { context } = await s.session.usage();
  assert.equal(context.parts.find((part) => part.name === 'Messages').tokens, 16_200);
});

test('asked how full it is, a scripted Claude starts without a turn and says what fills its window', async (t) => {
  // Advance a deterministic clock: the event and answer must share the same snapshot.
  let now = 1_700_000_000_000;
  t.mock.method(Date, 'now', () => ++now);
  const s = start(claude);
  const before = Date.now();
  const usage = await s.session.usage();
  assert.equal(usage.context.used, 242_800);
  assert.equal(usage.context.size, 1_000_000);
  assert.equal(
    usage.context.parts.filter((part) => part.kind === 'used').reduce((sum, part) => sum + part.tokens, 0),
    usage.context.used,
    'what is in use adds up to what it says is used'
  );
  assert.deepEqual(
    usage.context.parts.filter((part) => part.kind === 'reserved').map((part) => part.name),
    ['Autocompact buffer']
  );
  assert.equal(usage.plan, 'max');
  assert.deepEqual(
    usage.limits.map(({ kind, model, percent }) => [kind, model, percent]),
    [
      ['session', undefined, 43],
      ['weekly', undefined, 28],
      ['model', 'Fable', 2],
    ]
  );
  assert.ok(usage.limits.every((limit) => limit.resetsAt > before));
  assert.deepEqual(usage.extra, { on: true, currency: 'USD', used: 12.4, limit: 50, percent: 24.8 });
  // The meter follows what it answered, and its bars for the limits.
  assert.deepEqual(s.of('context'), [{ type: 'context', used: 242_800, size: 1_000_000 }]);
  assert.deepEqual(s.of('limits'), [{ type: 'limits', limits: usage.limits }]);
  assert.equal(s.session.state, 'idle');
  assert.equal(s.of('ready').length, 1);
  assert.equal(s.of('result').length, 0);
  assert.equal(s.said(), '');

  // And what it hands out is not what it keeps.
  usage.context.parts[0].tokens = 1;
  assert.equal((await s.session.usage()).context.parts[0].tokens, 3_400);
});

test('a scripted Codex says how full it is as Codex does: all that is in its window as one, and the week’s limit', async () => {
  const s = start(codex);
  const usage = await s.session.usage();
  assert.deepEqual(usage.context, {
    used: 22_500,
    size: 258_400,
    parts: [{ name: 'Used', tokens: 22_500, kind: 'used' }],
  });
  assert.equal(usage.plan, 'pro');
  assert.deepEqual(
    usage.limits.map(({ kind, percent }) => [kind, percent]),
    [['weekly', 19]]
  );
  assert.deepEqual(usage.extra, { on: true, credits: 1250 }, 'and its credits');
  await s.session.send({ text: '/init' });
  assert.equal(s.of('context').at(-1).used, 26_700, 'what a turn adds is in the one part');
  await s.session.send({ text: '/compact' });
  assert.equal(s.of('context').at(-1).used, 16_200, 'what /compact left, and the turn it took');
});

test('a scripted agent whose provider can’t say how full it is: nobody is told, and asking starts nothing', async () => {
  const none = { ...codex, usage: undefined };
  const s = start(none);
  assert.equal(await s.session.usage(), null);
  assert.equal(s.session.state, 'offline');
  await s.session.send({ text: '/init' });
  assert.deepEqual(s.of('context'), []);
  assert.deepEqual(s.of('limits'), []);
});

// ---- the demo's accounts ------------------------------------------------------------------------

/** The demo's logins in a folder of their own, as the app keeps them, and the switch its sessions ask. */
async function demoLogins() {
  const root = tempDir('demo-accounts-');
  const ops = demoAccounts({ own: PLANS.claude, sleep: async () => {} });
  const dir = path.join(root, 'claude', 'acc-1');
  ops.prepare(dir);
  await ops.signIn(dir, { way: 'claudeai' });
  const all = [
    { id: '', dir: '', name: 'you@example.com (Max)' },
    { id: 'acc-1', dir, name: 'you@acme.example (Acme · Team)' },
  ];
  const state = { inUse: '' };
  const accounts = {
    current: () => all.find((account) => account.id === state.inUse),
    next: () => null,
    use: (id) => (state.inUse = id),
    automatic: () => false,
  };
  return { root, ops, dir, state, accounts, login: (folder) => demoWho(folder, PLANS.claude) };
}

test('the demo signs in made-up accounts without a browser, each with a plan of its own', async () => {
  const { root, ops, dir } = await demoLogins();
  assert.deepEqual(await ops.status(''), { signedIn: true, email: 'you@example.com', plan: 'max', eligible: true });
  assert.deepEqual(await ops.status(dir), {
    signedIn: true,
    email: 'you@acme.example',
    orgId: 'org-acme',
    orgName: 'Acme',
    plan: 'team',
    eligible: true,
  });
  // The next one is another, and then there are no more.
  const second = path.join(root, 'claude', 'acc-2');
  assert.deepEqual(await ops.signIn(second, { way: 'claudeai' }), { ok: true, message: '' });
  assert.equal((await ops.status(second)).email, 'side@example.com');
  assert.equal((await ops.signIn(path.join(root, 'claude', 'acc-3'), { way: 'claudeai' })).ok, false);
  assert.equal((await ops.status(path.join(root, 'claude', 'nobody'))).signedIn, false);

  assert.deepEqual(
    (await ops.limits(dir)).map(({ kind, percent }) => [kind, percent]),
    [
      ['session', 8],
      ['weekly', 61],
    ]
  );
  assert.deepEqual(
    (await ops.limits('')).map(({ kind, percent }) => [kind, percent]),
    [
      ['session', 43],
      ['weekly', 28],
      ['model', 2],
    ]
  );

  await ops.signOut(second);
  assert.equal((await ops.status(second)).signedIn, false);
  assert.equal(await ops.limits(second), null);
  await ops.signOut('');
  assert.equal((await ops.status('')).signedIn, false);
  assert.equal((await ops.status('')).eligible, false);
});

test('a scripted Claude answers in the account in use, and says whose limits it heard', async () => {
  const { state, accounts, login } = await demoLogins();
  const events = [];
  const contact = { cwd: '/tmp/project', model: '', permissionMode: 'default', sessionId: null };
  const session = new DemoSession({
    contact,
    emit: (e) => events.push(e),
    descriptor: claude,
    sleep: async () => {},
    accounts,
    login,
  });
  const limits = () => events.filter((e) => e.type === 'limits').at(-1);
  await session.send({ text: '/init' });
  assert.equal(limits().account, undefined, 'the user’s own');
  assert.equal(limits().limits[0].percent, 43);

  state.inUse = 'acc-1';
  const usage = await session.usage();
  assert.equal(usage.account, 'you@acme.example (Acme · Team)', 'named with its organization and plan');
  assert.equal(usage.plan, 'team');
  assert.deepEqual(usage.extra, { on: false, reason: 'org_level_disabled' });
  assert.equal(limits().account, 'acc-1');
  await session.send({ text: '/init' });
  assert.equal(limits().account, 'acc-1');
  assert.deepEqual(
    limits().limits.map(({ kind, percent }) => [kind, percent]),
    [
      ['session', 8],
      ['weekly', 61],
    ]
  );
  assert.deepEqual(
    events.filter((e) => e.type === 'notice'),
    [],
    'nothing was said between turns'
  );
});

test('a scripted Claude in the middle of a turn finishes it in the account before, and says so', async () => {
  const { state, accounts, login } = await demoLogins();
  const events = [];
  const pauses = [];
  const contact = { cwd: '/tmp/project', model: '', permissionMode: 'default', sessionId: null };
  const session = new DemoSession({
    contact,
    emit: (e) => events.push(e),
    descriptor: claude,
    sleep: () => new Promise((resolve) => pauses.push(resolve)),
    accounts,
    login,
  });
  const turn = session.send({ text: '/init' });
  await tick();
  assert.equal(session.state, 'working');

  state.inUse = 'acc-1';
  session.accountSwitched();
  assert.deepEqual(
    events.filter((e) => e.type === 'notice').map((e) => e.text),
    ['Switched to you@acme.example (Acme · Team) from the next turn. This one finishes in you@example.com (Max).']
  );
  while (session.state !== 'idle') {
    pauses.shift()?.();
    await tick();
  }
  await turn;
  // Its turn's limits are the account it was in.
  assert.equal(events.filter((e) => e.type === 'limits').at(-1).account, undefined);
});

test('the demo’s Claude has made-up accounts to switch between; a service with one login has none', () => {
  const providers = createProviders({ app: { isPackaged: false }, demo: true });
  assert.equal(typeof providers.accounts('claude')?.limits, 'function');
  assert.equal(providers.accounts('codex'), null);
});

// ---- check-ins ------------------------------------------------------------------------------

/** A Claude contact whose check-in is only due when the test says so. Its other pauses are none. */
function startWithCheckIn(descriptor = claude) {
  let due = () => {};
  const sleep = (ms) => (ms >= 1000 ? new Promise((resolve) => (due = resolve)) : Promise.resolve());
  const s = start(descriptor, {}, sleep);
  return { ...s, due: () => due() };
}

test('"check back" sets a check-in, which is due later and answered without anything sent', async () => {
  const s = startWithCheckIn();
  await s.session.send({ text: 'check back on CI in a bit' });
  const [set] = s.of('tool');
  assert.deepEqual(set.activity, {
    kind: 'schedule',
    action: 'set',
    schedule: '*/1 * * * *',
    recurring: false,
    prompt: 'Check how CI is doing and tell the user',
  });
  assert.deepEqual(
    s.of('check-ins').map((e) => e.checkIns.map((checkIn) => checkIn.id)),
    [['demo-check-in']]
  );
  assert.deepEqual(s.of('notice'), [], 'it is not due yet');
  assert.equal(s.session.state, 'idle');

  s.due();
  while (s.of('result').length < 2) await tick();
  assert.deepEqual(s.of('check-ins').at(-1).checkIns, [], 'it was due once');
  assert.deepEqual(
    s.of('notice').map((e) => e.text),
    ['Time to check back: “Check how CI is doing and tell the user”']
  );
  const notice = s.events.findIndex((e) => e.type === 'notice');
  const working = s.events.findLastIndex((e) => e.type === 'state' && e.state === 'working');
  assert.ok(notice < working, 'the conversation says so before the answer');
  assert.equal(s.of('tool').at(-1).activity.command, 'gh pr checks');
  assert.match(s.said(), /CI is green/);
  assert.equal(s.session.state, 'idle');
});

test('a check-in goes with its session', async () => {
  const s = startWithCheckIn();
  await s.session.send({ text: 'check in on the build later' });
  s.session.close();
  assert.deepEqual(s.of('check-ins').at(-1).checkIns, []);
  s.due();
  await tick();
  assert.deepEqual(s.of('notice'), [], 'nothing is due any more');
});

test('a Codex contact answers "check back" like any other message: its agent sets no check-ins', async () => {
  const s = start(codex);
  const { prompt } = await send(s, 'check back on CI in a bit');
  assert.equal(prompt.activity.command, 'ls -la');
  assert.deepEqual(s.of('check-ins'), []);
});

// ---- what is left running in the background ------------------------------------------------------

test('"background" starts a dev server and a watcher on CI, says what each prints, and stops either', async () => {
  // The watcher ends once CI is done, when the test says so.
  const s = startWithCheckIn();
  await s.session.send({ text: 'run the dev server in the background' });
  const calls = s.of('tool').map((e) => e.activity);
  assert.deepEqual(calls, [
    { kind: 'command', command: 'npm run dev', description: 'Start the dev server', background: true },
    { kind: 'command', command: 'gh run watch --exit-status', description: 'Watch the CI run', background: true },
  ]);
  const listed = s.of('background').at(-1).tasks;
  assert.deepEqual(
    listed.map(({ kind, label, command, status }) => [kind, label, command, status]),
    [
      ['command', 'Start the dev server', 'npm run dev', 'running'],
      ['watcher', 'Watch the CI run', 'gh run watch --exit-status', 'running'],
    ]
  );
  assert.deepEqual(
    listed.map((task) => task.toolId),
    s.of('tool').map((e) => e.toolId),
    'each says which call started it'
  );
  assert.match(s.said(), /Background\*\* tab/);
  assert.equal(s.session.state, 'idle', 'the turn is over, and they run on');

  const [server, watcher] = listed;
  assert.match((await s.session.backgroundOutput(server.id)).output, /^> shop@1\.0\.0 dev\n/);
  assert.equal(await s.session.backgroundOutput('nobody'), null);

  s.due();
  await tick();
  const ended = s
    .of('background')
    .at(-1)
    .tasks.find((task) => task.id === watcher.id);
  assert.deepEqual([ended.status, ended.summary], ['done', 'CI passed: build, lint and test.']);
  assert.equal(typeof ended.ended, 'number');
  // Once it ended, it printed all it had.
  assert.match((await s.session.backgroundOutput(watcher.id)).output, /✓ test in 2m10s\n$/);

  await s.session.stopBackground(server.id);
  assert.equal(
    s
      .of('background')
      .at(-1)
      .tasks.find((task) => task.id === server.id).status,
    'stopped'
  );
  const told = s.of('background').length;
  await s.session.stopBackground(server.id);
  assert.equal(s.of('background').length, told, 'one that ended is not ended again');
});

test('what is left running in the background goes with its session', async () => {
  const s = startWithCheckIn();
  await s.session.send({ text: 'start it in the background' });
  s.session.close();
  assert.deepEqual(
    s
      .of('background')
      .at(-1)
      .tasks.map((task) => task.status),
    ['stopped', 'stopped']
  );
  s.due();
  await tick();
  assert.deepEqual(
    s
      .of('background')
      .at(-1)
      .tasks.map((task) => task.status),
    ['stopped', 'stopped'],
    'the watcher does not end again'
  );
});

test('a Codex contact answers "background" like any other message: its agent leaves nothing running there', async () => {
  const s = start(codex);
  const { prompt } = await send(s, 'run it in the background');
  assert.equal(prompt.activity.command, 'ls -la');
  assert.deepEqual(s.of('background'), []);
  assert.equal(codex.background, undefined);
  assert.equal(claude.background, true);
});

test('"to-do" works through a job with a to-do list, telling the whole list as each item starts and is done', async () => {
  const s = start(claude);
  await s.session.send({ text: 'make a to-do list for the cart' });
  const lists = s.of('tool').filter((e) => e.activity.kind === 'todo');
  const statuses = lists.map((e) => e.activity.todos.map((t) => t.status[0]).join(''));
  // p: to do, i: in progress, c: done. Each item starts, and is done once its call is answered.
  assert.deepEqual(statuses, ['ppp', 'ipp', 'cip', 'cci', 'ccc']);
  assert.deepEqual(
    lists[0].activity.todos.map((t) => [t.text, t.activeForm]),
    [
      ['Read how the total is worked out', 'Reading the cart'],
      ['Count an item without a count once', 'Fixing the total'],
      ['Run the tests', 'Running the tests'],
    ]
  );
  const calls = s.of('tool').filter((e) => e.activity.kind !== 'todo');
  assert.deepEqual(
    calls.map((e) => e.activity.path ?? e.activity.command),
    ['/tmp/project/src/cart.js', '/tmp/project/src/cart.js', 'npm test']
  );
  assert.deepEqual(
    s.of('tool-result').map((e) => e.toolId),
    calls.map((e) => e.toolId)
  );
  assert.deepEqual(
    s.of('drafting'),
    [{ type: 'drafting', toolId: calls[1].toolId, activity: { kind: 'edit', path: '/tmp/project/src/cart.js' } }],
    'the change is written out before it is made'
  );
  assert.match(s.said(), /All three done/);
  assert.equal(s.session.state, 'idle');
});

test('a to-do job that is stopped half way leaves its list where it was', async () => {
  const s = startHeld(claude);
  const done = s.session.send({ text: 'todo please' });
  await tick();
  const lists = () => s.of('tool').filter((e) => e.activity.kind === 'todo');
  // On until the second item has started.
  while (!lists().some((e) => e.activity.todos[1].status === 'in_progress')) await s.resume();
  await s.session.interrupt();
  await s.settle();
  await done;
  assert.deepEqual(
    lists()
      .at(-1)
      .activity.todos.map((t) => t.status),
    ['completed', 'in_progress', 'pending']
  );
  assert.equal(s.of('result').at(-1).stopped, true);
});

test('going back to before a message stops the turn going on, which has had its say once it is done', async () => {
  const s = startHeld(claude);
  s.session.send({ text: 'run the tests' });
  s.session.send({ text: 'and then the linter' });
  await tick();
  assert.equal(s.session.state, 'working');
  assert.equal(s.session.waiting, 1, 'the second message waits for the first');
  let done = false;
  const rewound = s.session.rewind().then(() => (done = true));
  await tick();
  assert.equal(done, false, 'not while the turn is still winding down');
  await s.settle();
  await rewound;
  assert.deepEqual(
    s.of('result').map((r) => r.stopped),
    [true],
    'it stops, and the message waiting behind it gets no turn'
  );
  assert.equal(s.session.state, 'idle');
  assert.equal(s.session.waiting, 0);
  const told = s.events.length;
  await s.settle();
  assert.equal(s.events.length, told, 'nothing more is said of it');
});

test('a scripted Codex can’t go back to a message, as Codex can’t', async () => {
  const s = start(codex);
  await assert.rejects(s.session.rewind(), /^Error: Codex can’t go back to an earlier message\.$/);
});

test('a scripted Claude forks its chat into a session of its own, and a scripted Codex can’t, as Codex can’t', async () => {
  const s = start(claude, { sessionId: 'demo-1' });
  const fork = await s.session.fork({ text: 'Done.', later: 0 });
  assert.match(fork, /^[0-9a-f-]{36}$/);
  assert.notEqual(fork, 'demo-1');
  assert.deepEqual(s.events, [], 'its own conversation goes on as it was');
  await assert.rejects(
    start(codex).session.fork({ text: 'Done.', later: 0 }),
    /^Error: Codex can’t fork a conversation\.$/
  );
});

test('demo Send now selects the clicked message and a stale click leaves the next turn alone', async () => {
  const s = startHeld(codex);
  const sent = [s.session.send({ id: 'running', text: 'hello' })];
  await s.settle();
  sent.push(s.session.send({ id: 'first', text: 'hello again' }));
  sent.push(s.session.send({ id: 'second', text: 'ask me something' }));
  sent.push(s.session.send({ id: 'third', text: 'then this' }));
  await s.session.sendNow('second');
  await s.session.sendNow('second');
  await s.settle();
  assert.deepEqual(kinds(s), ['tool', 'question']);
  assert.deepEqual(s.session.queuedIds, ['first', 'third']);
  await s.session.sendNow('second');
  assert.deepEqual(kinds(s), ['tool', 'question'], 'the selected question is still waiting for its answer');
  assert.equal(await s.session.cancel('first'), true);
  assert.deepEqual(s.session.queuedIds, ['third']);
  await s.session.interrupt();
  await s.settle();
  await Promise.all(sent);
});
