import { test } from 'node:test';
import { fallbackPermissionModes } from '../src/shared/limit-fallbacks.js';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { OUTSIDE_SANDBOX, appTools } from '../src/main/app-tools.js';
import {
  APP_TOOLS,
  COMMAND_MAX,
  MOST_AT_ONCE,
  REPORT_MAX,
  SAVED_INSTRUCTIONS_MAX,
  appActivity,
  cleanCommand,
  howMany,
  reportNote,
  reportedBy,
  workerStart,
} from '../src/shared/app-tools.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';
import { descriptor as gemini } from '../src/providers/gemini/descriptor.js';
import { descriptor as hermes } from '../src/providers/hermes/descriptor.js';
import { APP_TOOL_INSTRUCTIONS, appToolName, appToolServer, sdkTool } from '../src/providers/claude/app-tools.js';
import { NAME_MAX } from '../src/shared/terminal.js';
import { BRIEF_MAX, MESSAGE_MAX, REPORT_UP_MAX } from '../src/shared/managers.js';
import { DRAFT_LIMIT } from '../src/shared/github-item.js';

const NO_INSTRUCTIONS = { general: '', pullRequest: '', review: '' };

/**
 * The app's tools for a contact, with a window that is open or not, and what it was asked to open.
 * `started` is what the conversations it starts are, or how starting one goes wrong; `begun` what it was asked.
 * `settings` are the app's, as the tools read them when they are asked. `told` is what the contact's project
 * is told, and `saying` what the user answers on the card that asks to save it (or a function of what it asks);
 * `questions` what the cards asked, and `saved` what was kept. `agents` are the services whose agents can join a
 * conversation it starts.
 */
function setup({
  watching = true,
  contacts = [{ id: 'c1' }],
  started = { name: 'Claude (roster)', worktree: true },
  settings = {},
  told = NO_INSTRUCTIONS,
  saying = { decision: 'allow' },
  managers,
  agents,
} = {}) {
  const asked = [];
  const begun = [];
  const terminals = {
    wanted: (contactId, names, command) => {
      if (watching) asked.push({ contactId, names, command });
      return watching;
    },
  };
  const startConversation = async (hostId, opts) => {
    begun.push({ hostId, ...opts });
    if (started instanceof Error) throw started;
    return started;
  };
  const questions = [];
  const saved = [];
  const instructions = {
    of: async (hostId) => ({ key: 'git:/code/shop/.git', name: 'shop', instructions: { ...told }, hostId }),
    save: (key, kept) => saved.push({ key, instructions: kept }),
  };
  // The card in the conversation, as the agent's session shows it: what it asked, and what the user answered.
  const context = {
    ask: async (request) => {
      questions.push(request);
      return typeof saying === 'function' ? saying(request) : saying;
    },
  };
  const store = { getContact: (id) => contacts.find((c) => c.id === id), settings };
  const toolsFor = appTools({ store, terminals, startConversation, instructions, managers, agents });
  const tool = (hostId, name) => toolsFor(hostId).find((t) => t.name === name);
  return {
    toolsFor,
    tool,
    asked,
    begun,
    questions,
    saved,
    open: tool('c1', APP_TOOLS.terminals),
    start: tool('c1', APP_TOOLS.conversation),
    told: withContext(tool('c1', APP_TOOLS.instructions), context),
    context,
  };
}

/** A tool as its session runs it: with what it asks the user with. */
const withContext = (tool, context) => tool && { ...tool, run: (input) => tool.run(input, context) };

/** What a tool takes, checked as the agent's call is before the tool is run. */
const takes = (tool, input) => z.object(tool.input).safeParse(input).success;

// ---- how many, and what was asked for ----------------------------------------------------------

test('a request is for as many as it names, or as many as it counts when that is more', () => {
  assert.equal(howMany(6), 6);
  assert.equal(howMany(undefined, ['a', 'b']), 2);
  assert.equal(howMany(1, ['a', 'b', 'c']), 3);
  assert.equal(howMany(4, ['a']), 4);
});

test('a request that says neither is for one, and none is for more than can be asked for at once', () => {
  assert.equal(howMany(), 1);
  assert.equal(howMany(0, []), 1);
  assert.equal(howMany(-3), 1);
  assert.equal(howMany(2.5), 1);
  assert.equal(howMany('6'), 1);
  assert.equal(howMany(MOST_AT_ONCE + 50), MOST_AT_ONCE);
  assert.equal(howMany(1, Array(MOST_AT_ONCE + 5).fill('x')), MOST_AT_ONCE);
});

test('a command is one line, as it is typed, and not endlessly long', () => {
  assert.equal(cleanCommand('  claude  '), 'claude');
  assert.equal(cleanCommand('npm run dev -- --port 3000'), 'npm run dev -- --port 3000');
  assert.equal(cleanCommand(undefined), '');
  assert.equal(cleanCommand('   '), '');
  // Only the first of several lines is a command: the rest would be typed into what it started.
  assert.equal(cleanCommand('claude\nrm -rf x'), 'claude');
  assert.equal(cleanCommand('x'.repeat(COMMAND_MAX + 50)).length, COMMAND_MAX);
});

test('what an agent asked the app for is an activity: how many terminals, their names, and what is to run', () => {
  assert.deepEqual(appActivity(APP_TOOLS.terminals, { count: 6 }), {
    kind: 'app',
    action: 'terminals',
    count: 6,
    names: [],
  });
  assert.deepEqual(appActivity(APP_TOOLS.terminals, { names: ['dev server', ' ', 'tests'] }), {
    kind: 'app',
    action: 'terminals',
    count: 3,
    names: ['dev server', 'tests'],
  });
  assert.deepEqual(appActivity(APP_TOOLS.terminals, { count: 2, command: 'claude' }), {
    kind: 'app',
    action: 'terminals',
    count: 2,
    names: [],
    command: 'claude',
  });
  assert.deepEqual(appActivity(APP_TOOLS.terminals), { kind: 'app', action: 'terminals', count: 1, names: [] });
  assert.equal(appActivity('create_issue', {}), null);
});

test('a conversation an agent starts is an activity: what it is to do, and whether the user asked for it', () => {
  assert.deepEqual(appActivity(APP_TOOLS.conversation, { prompt: '  Update the roster\nin the promo  ' }), {
    kind: 'app',
    action: 'conversation',
    started: false,
    prompt: 'Update the roster\nin the promo',
  });
  assert.equal(appActivity(APP_TOOLS.conversation, { prompt: 'x', asked_by_user: true }).started, true);
  assert.equal(appActivity(APP_TOOLS.conversation, { prompt: 'x', asked_by_user: 'yes' }).started, false);
  assert.equal(appActivity(APP_TOOLS.conversation).prompt, '');
});

// ---- opening terminals ---------------------------------------------------------------------------

test('"open six terminals" asks the conversation’s window for six, and says so', async () => {
  const { open, asked } = setup();
  assert.equal(await open.run({ count: 6 }), '6 terminals are opening beside the conversation.');
  assert.deepEqual(asked, [{ contactId: 'c1', names: [null, null, null, null, null, null], command: null }]);
});

test('without a count it is one terminal', async () => {
  const { open, asked } = setup();
  assert.equal(await open.run({}), 'A terminal is opening beside the conversation.');
  assert.deepEqual(asked[0].names, [null]);
});

test('terminals are called what the agent named them, in order, and the rest are numbered', async () => {
  const { open, asked } = setup();
  await open.run({ count: 3, names: ['  dev   server\n', 'tests'] });
  assert.deepEqual(asked[0].names, ['dev server', 'tests', null]);
});

test('a name is kept as a name the user typed is: on one line, and not endlessly long', async () => {
  const { open, asked } = setup();
  await open.run({ names: ['x'.repeat(NAME_MAX + 20), '   '] });
  assert.deepEqual(asked[0].names, ['x'.repeat(NAME_MAX), null]);
});

test('with the conversation’s window closed no terminal is opened, and the agent is told why', async () => {
  const { open, asked } = setup({ watching: false });
  await assert.rejects(open.run({ count: 2 }), /window is closed, so no terminal was opened/);
  assert.deepEqual(asked, []);
});

test('a call for more than can be opened at once, or for nonsense, is refused before it is run', () => {
  const { open } = setup();
  assert.ok(takes(open, {}));
  assert.ok(takes(open, { count: MOST_AT_ONCE, names: ['a'], command: 'claude' }));
  assert.ok(!takes(open, { count: MOST_AT_ONCE + 1 }));
  assert.ok(!takes(open, { count: 0 }));
  assert.ok(!takes(open, { count: 1.5 }));
  assert.ok(!takes(open, { names: Array(MOST_AT_ONCE + 1).fill('a') }));
  assert.ok(!takes(open, { names: [1, 2] }));
  assert.ok(!takes(open, { command: 7 }));
  assert.ok(!takes(open, { command: 'x'.repeat(COMMAND_MAX + 1) }));
});

test('a contact that is gone has no tools', () => {
  assert.deepEqual(setup().toolsFor('nobody'), []);
});

// ---- with something running in them --------------------------------------------------------------

test('"two terminals running claude" asks for two, with claude to be typed into each', async () => {
  const { open, asked } = setup();
  const answer = await open.run({ count: 2, names: ['claude 1', 'claude 2'], command: '  claude ' });
  assert.deepEqual(asked, [{ contactId: 'c1', names: ['claude 1', 'claude 2'], command: 'claude' }]);
  assert.equal(answer, '2 terminals are opening beside the conversation, with claude typed into each.');
});

test('one terminal has it typed into it', async () => {
  const { open } = setup();
  assert.equal(
    await open.run({ command: 'npm run dev' }),
    'A terminal is opening beside the conversation, with npm run dev typed into it.'
  );
});

test('a command of several lines is refused: what follows the first would be typed into what it started', async () => {
  const { open, asked } = setup();
  await assert.rejects(open.run({ command: 'claude\nyes' }), /A command for a terminal is one line\./);
  assert.deepEqual(asked, []);
});

test('opening terminals is not asked about, unless something is to run in them', () => {
  const { open } = setup();
  assert.equal(open.ask({}), false);
  assert.equal(open.ask({ count: 6, names: ['a'] }), false);
  assert.equal(open.ask({ command: '   ' }), false);
  assert.equal(open.ask({ command: 'claude' }), true);
  assert.equal(open.ask(), false);
});

// ---- starting another conversation ----------------------------------------------------------------

test('a conversation the user asked for starts at once, from the main line unless the agent says otherwise', async () => {
  const { start, begun } = setup();
  const answer = await start.run({ prompt: '  Update the promo roster.  ', asked_by_user: true });
  assert.deepEqual(begun, [
    { hostId: 'c1', prompt: 'Update the promo roster.', now: true, fromHere: false, invite: [] },
  ]);
  assert.match(
    answer,
    /^Claude \(roster\) has started, in a worktree of its own\. It is listed under this conversation\./
  );
  assert.match(answer, /You hear its first reply and later outcomes; progress waits while background work runs/);
});

test('one the agent thought of waits for the user, with the prompt in its message box', async () => {
  const { start, begun } = setup({ started: { name: 'Claude', worktree: false } });
  const answer = await start.run({ prompt: 'Tidy the CSS', from_this_branch: true });
  assert.deepEqual(begun, [{ hostId: 'c1', prompt: 'Tidy the CSS', now: false, fromHere: true, invite: [] }]);
  assert.match(answer, /^Claude is in the user’s contact list, under this conversation, with the prompt waiting/);
  assert.match(answer, /Nothing runs until the user sends it\./);
});

test('the agent is told that one it thought of waits for the user', () => {
  const { start } = setup();
  assert.match(
    start.description,
    /one you thought of waits with the prompt in its message box until the user sends it/
  );
});

test('with Settings saying so, one the agent thought of starts at once too, and the agent is told so', async () => {
  const { start, begun } = setup({ settings: { startConversations: true } });
  assert.match(start.description, /It starts at once, also one you thought of/);
  assert.doesNotMatch(start.description, /waits/);
  const answer = await start.run({ prompt: 'Tidy the CSS' });
  assert.deepEqual(begun, [{ hostId: 'c1', prompt: 'Tidy the CSS', now: true, fromHere: false, invite: [] }]);
  assert.match(answer, /^Claude \(roster\) has started, in a worktree of its own\./);
});

test('the user is shown whether it started, as Settings have it when the agent asks', async () => {
  const settings = { startConversations: false };
  const { start, begun } = setup({ settings });
  assert.deepEqual(start.activity({ prompt: ' Tidy the CSS ' }), {
    kind: 'app',
    action: 'conversation',
    started: false,
    prompt: 'Tidy the CSS',
  });
  assert.equal(start.activity({ prompt: 'x', asked_by_user: true }).started, true);
  // Turned on after the agent was given the tool: the next one it adds starts at once.
  settings.startConversations = true;
  assert.equal(start.activity({ prompt: 'x' }).started, true);
  await start.run({ prompt: 'x' });
  assert.equal(begun[0].now, true);
});

test('starting a conversation is never asked about: one the user did not ask for waits for them anyway', () => {
  const { start } = setup();
  assert.equal(start.ask({ prompt: 'x' }), false);
  assert.equal(start.ask({ prompt: 'x', asked_by_user: true }), false);
});

test('a conversation with nothing to do is refused, and so is a call that is not one', async () => {
  const { start, begun } = setup();
  await assert.rejects(start.run({ prompt: '   ' }), /Say what the new conversation is to do\./);
  assert.deepEqual(begun, []);
  assert.ok(takes(start, { prompt: 'x' }));
  assert.ok(takes(start, { prompt: 'x'.repeat(DRAFT_LIMIT), asked_by_user: false, from_this_branch: true }));
  assert.ok(!takes(start, {}));
  assert.ok(!takes(start, { prompt: '' }));
  assert.ok(!takes(start, { prompt: 'x'.repeat(DRAFT_LIMIT + 1) }));
  assert.ok(!takes(start, { prompt: 'x', asked_by_user: 'yes' }));
});

test('what kept it from starting is what the agent is told', async () => {
  const { start } = setup({ started: new Error('Pick a folder that exists.') });
  await assert.rejects(start.run({ prompt: 'x', asked_by_user: true }), /Pick a folder that exists\./);
});

const AGENTS = [
  { id: 'claude', name: 'Claude' },
  { id: 'codex', name: 'Codex' },
  { id: 'gemini', name: 'Gemini' },
];

test('other agents can be in it from the start, by service, and the agent is told so', () => {
  const { start } = setup({ agents: AGENTS });
  assert.match(start.description, /Other agents, such as Codex, can be in it from the start, as in a group chat/);
  assert.ok(takes(start, { prompt: 'x', invite: ['codex'] }));
  assert.ok(takes(start, { prompt: 'x', invite: ['claude', 'gemini'] }));
  assert.ok(takes(start, { prompt: 'x', invite: [] }));
  assert.ok(!takes(start, { prompt: 'x', invite: ['Codex'] }));
  assert.ok(!takes(start, { prompt: 'x', invite: ['copilot'] }));
  assert.ok(!takes(start, { prompt: 'x', invite: 'codex' }));
  assert.ok(!takes(start, { prompt: 'x', invite: Array.from({ length: MOST_AT_ONCE + 1 }, () => 'codex') }));
});

test('the agents asked for join it each once, and the agent is told who is in it', async () => {
  const { start, begun } = setup({
    agents: AGENTS,
    started: { name: 'Claude (roster)', worktree: true, joined: ['Codex', 'Gemini'] },
  });
  const answer = await start.run({ prompt: 'Build it', asked_by_user: true, invite: ['codex', 'gemini', 'codex'] });
  assert.deepEqual(begun, [
    { hostId: 'c1', prompt: 'Build it', now: true, fromHere: false, invite: ['codex', 'gemini'] },
  ]);
  assert.match(
    answer,
    /^Claude \(roster\) has started, in a worktree of its own, with Codex and Gemini in it\. It is listed under/
  );
  assert.doesNotMatch(answer, /Not every agent/);
});

test('one that waits for the user has the agents asked for in it too', async () => {
  const { start, begun } = setup({ agents: AGENTS, started: { name: 'Claude', worktree: false, joined: ['Codex'] } });
  const answer = await start.run({ prompt: 'Build it', invite: ['codex'] });
  assert.deepEqual(begun[0].invite, ['codex']);
  assert.equal(begun[0].now, false);
  assert.match(answer, /^Claude is in the user’s contact list, with Codex in it, under this conversation, with the/);
});

test('an agent that could not join is said, and the agent is pointed to the conversation for why', async () => {
  const { start } = setup({ agents: AGENTS, started: { name: 'Claude (roster)', worktree: true, joined: [] } });
  const answer = await start.run({ prompt: 'Build it', asked_by_user: true, invite: ['codex'] });
  assert.match(
    answer,
    /^Claude \(roster\) has started, in a worktree of its own\. It is listed under this conversation\./
  );
  assert.match(answer, /Not every agent you asked for could join: its conversation says why\./);
});

test('with no services to invite, the tool offers none, and a call naming some still starts it alone', async () => {
  const { start, begun } = setup({ started: { name: 'Claude (roster)', worktree: true } });
  assert.equal(start.input.invite, undefined);
  assert.doesNotMatch(start.description, /Other agents/);
  const answer = await start.run({ prompt: 'Build it', asked_by_user: true, invite: ['codex'] });
  assert.deepEqual(begun[0].invite, []);
  assert.doesNotMatch(answer, /with .* in it|Not every agent/);
});

// ---- what the project is told -------------------------------------------------------------------

const SCOPE = '## Scope\nOpen the PR and merge it once its checks pass.';

test('reading the instructions answers with what the project is told, and asks nobody', async () => {
  const { told, questions, saved } = setup({ told: { ...NO_INSTRUCTIONS, general: 'Use pnpm.' } });
  assert.equal(await told.run({}), 'The Every conversation instructions of shop:\n\nUse pnpm.');
  assert.deepEqual(questions, []);
  assert.deepEqual(saved, []);
});

test('instructions the project has none of are said to be none', async () => {
  const { told } = setup();
  assert.equal(await told.run({ part: 'create_pr' }), 'shop has no Create PR instructions.');
});

/** What the card asks, for `after` to be the instructions where they are `before`. */
const card = (after, { before = '', part = 'Every conversation' } = {}) => ({
  kind: 'instructions',
  activity: { kind: 'app', action: 'save-instructions', label: part, prompt: after },
  instructions: { project: 'shop', part, before, after },
});

test('saving them asks on a card in the conversation, with what they are and what they would be', async () => {
  const { told, questions, saved } = setup();
  const answer = await told.run({ text: SCOPE });
  assert.deepEqual(questions, [card(SCOPE)]);
  assert.deepEqual(saved, [
    { key: 'git:/code/shop/.git', instructions: { general: SCOPE, pullRequest: '', review: '' } },
  ]);
  assert.equal(
    answer,
    `Saved as you wrote them: the Every conversation instructions of shop. They are now:\n\n${SCOPE}`
  );
});

test('saving one of them keeps the others as they are, and the agent is told what it replaced', async () => {
  const before = { general: 'Use pnpm.', pullRequest: 'Open it as a draft.', review: 'One commit per comment.' };
  const { told, questions, saved } = setup({ told: before });
  const answer = await told.run({ part: 'create_pr', text: 'Attach the proof video.' });
  assert.deepEqual(questions, [card('Attach the proof video.', { before: 'Open it as a draft.', part: 'Create PR' })]);
  assert.deepEqual(saved[0].instructions, { ...before, pullRequest: 'Attach the proof video.' });
  assert.equal(
    answer,
    'Saved as you wrote them: the Create PR instructions of shop. They are now:\n\nAttach the proof video.' +
      '\n\nWhat they were before:\n\nOpen it as a draft.'
  );
});

test('the review comments’ instructions are saved as theirs', async () => {
  const { told, saved } = setup();
  await told.run({ part: 'review_comments', text: 'Run the file’s tests.' });
  assert.equal(saved[0].instructions.review, 'Run the file’s tests.');
});

test('what the user edited on the card is what is saved, and the agent is told so, with the text saved', async () => {
  const { told, questions, saved } = setup({
    told: { ...NO_INSTRUCTIONS, general: 'Use pnpm.' },
    saying: { decision: 'edit', text: '## Scope\r\nOpen the PR. Leave merging to me.  \n\n' },
  });
  const answer = await told.run({ text: SCOPE });
  assert.equal(questions.length, 1);
  // As Settings keeps them, whatever the card sent.
  assert.equal(saved[0].instructions.general, '## Scope\nOpen the PR. Leave merging to me.');
  assert.equal(
    answer,
    'Saved with the user’s edits: the Every conversation instructions of shop. They are now:\n\n' +
      '## Scope\nOpen the PR. Leave merging to me.\n\nWhat they were before:\n\nUse pnpm.'
  );
});

test('an edit that comes to the agent’s own text is no edit', async () => {
  const { told, saved } = setup({ saying: { decision: 'edit', text: `\n${SCOPE}  \n` } });
  const answer = await told.run({ text: SCOPE });
  assert.equal(saved[0].instructions.general, SCOPE);
  assert.match(answer, /^Saved as you wrote them: /);
});

test('an edit back to the original text saves exactly that text and tells the agent what was approved', async () => {
  const { told, saved } = setup({
    told: { ...NO_INSTRUCTIONS, general: 'Use pnpm.' },
    saying: { decision: 'edit', text: 'Use pnpm.' },
  });
  assert.equal(
    await told.run({ text: SCOPE }),
    'Saved with the user’s edits: the Every conversation instructions of shop. They are now:\n\nUse pnpm.' +
      '\n\nWhat they were before:\n\nUse pnpm.'
  );
  assert.equal(saved[0].instructions.general, 'Use pnpm.');
});

test('an edit that empties them takes them out, as the user edited them', async () => {
  const { told, saved } = setup({
    told: { ...NO_INSTRUCTIONS, general: 'Use pnpm.' },
    saying: { decision: 'edit', text: '   ' },
  });
  const answer = await told.run({ text: SCOPE });
  assert.equal(saved[0].instructions.general, '');
  assert.equal(
    answer,
    'Removed with the user’s edits: the Every conversation instructions of shop.\n\nWhat they were before:\n\nUse pnpm.'
  );
});

test('instructions the user said no to are not saved, and the agent is told so', async () => {
  const { told, questions, saved } = setup({ saying: { decision: 'deny' } });
  await assert.rejects(told.run({ text: SCOPE }), /^Error: The user chose not to save them\. Nothing was changed\.$/);
  assert.equal(questions.length, 1);
  assert.deepEqual(saved, []);
});

test('a card the turn ended under saves nothing: interrupted, stopped or closed, it answers cancelled', async () => {
  const { told, saved } = setup({ saying: { decision: 'cancelled' } });
  await assert.rejects(told.run({ text: SCOPE }), /The turn ended before the user answered\. Nothing was changed\./);
  assert.deepEqual(saved, []);
});

test('no other answer saves them either', async () => {
  for (const decision of ['always', 'answer', 'skip', 'feedback', 'approve-plan', 'nonsense']) {
    const { told, saved } = setup({ saying: { decision, text: 'Something else.' } });
    await assert.rejects(told.run({ text: SCOPE }), /Nothing was changed/, decision);
    assert.deepEqual(saved, [], decision);
  }
});

test('the others are saved as they are by the time the user answers, not as they were when the card came', async () => {
  const saved = [];
  // The card waits while the user changes the Create PR instructions in Settings.
  let reads = 0;
  const later = { general: 'Use pnpm.', pullRequest: 'Open it as a draft.', review: '' };
  const tool = withContext(
    appTools({
      store: { getContact: () => ({ id: 'c1' }), settings: {} },
      terminals: { wanted: () => true },
      startConversation: async () => ({}),
      instructions: {
        of: async () => ({ key: 'k', name: 'shop', instructions: reads++ ? later : { ...NO_INSTRUCTIONS } }),
        save: (key, kept) => saved.push({ key, instructions: kept }),
      },
    })('c1').find((t) => t.name === APP_TOOLS.instructions),
    { ask: async () => ({ decision: 'allow' }) }
  );
  await tool.run({ text: SCOPE });
  assert.deepEqual(saved, [{ key: 'k', instructions: { ...later, general: SCOPE } }]);
});

test('they are asked about and saved as Settings keeps them: without the room around them', async () => {
  const { told, questions, saved } = setup();
  await told.run({ text: '\n  \n## Scope\r\nMerge it.  \n\n' });
  assert.equal(questions[0].instructions.after, '## Scope\nMerge it.');
  assert.equal(saved[0].instructions.general, '## Scope\nMerge it.');
});

test('the same instructions again change nothing, and nobody is asked', async () => {
  const { told, questions, saved } = setup({ told: { ...NO_INSTRUCTIONS, general: SCOPE } });
  assert.equal(
    await told.run({ text: `${SCOPE}\n` }),
    'The Every conversation instructions of shop are that already. Nothing was changed.'
  );
  assert.deepEqual(questions, []);
  assert.deepEqual(saved, []);
});

test('empty text takes them out, once the user said so', async () => {
  const { told, questions, saved } = setup({ told: { ...NO_INSTRUCTIONS, general: SCOPE } });
  const answer = await told.run({ text: '  ' });
  assert.deepEqual(questions, [card('', { before: SCOPE })]);
  assert.equal(saved[0].instructions.general, '');
  assert.equal(answer, `Removed: the Every conversation instructions of shop.\n\nWhat they were before:\n\n${SCOPE}`);
});

test('instructions too long for the card to show are refused, before anyone is asked', async () => {
  const { told, questions } = setup();
  assert.ok(takes(told, { text: 'x'.repeat(SAVED_INSTRUCTIONS_MAX) }));
  assert.ok(!takes(told, { text: 'x'.repeat(SAVED_INSTRUCTIONS_MAX + 1) }));
  await assert.rejects(told.run({ text: 'x'.repeat(SAVED_INSTRUCTIONS_MAX + 1) }), /Longer ones are typed in Settings/);
  assert.deepEqual(questions, []);
});

test('the instructions are only the project’s three, by the names the agent is given', () => {
  const { told } = setup();
  assert.ok(takes(told, {}));
  for (const part of ['every_conversation', 'create_pr', 'review_comments']) assert.ok(takes(told, { part }));
  assert.ok(!takes(told, { part: 'general' }));
  assert.ok(!takes(told, { text: 42 }));
});

test('the tool itself is never asked about: saving asks on a card of its own, whatever the permissions', () => {
  const { told } = setup();
  assert.equal(told.ask({}), false);
  assert.equal(told.ask({ text: SCOPE }), false);
});

// ---- an agent that changes no files ------------------------------------------------------------------

/** The tools of an agent whose session keeps it from changing files, as its session runs them. */
const readOnlyTools = (tools, hostId = 'c1', speakerId = hostId) => {
  const all = tools.toolsFor(hostId, speakerId, { readOnly: true });
  const named = (name) =>
    withContext(
      all.find((one) => one.name === name),
      tools.context
    );
  return { all, open: named(APP_TOOLS.terminals), start: named(APP_TOOLS.conversation) };
};

const terminalCard = (input) => ({
  kind: 'tool',
  canAlways: false,
  activity: appActivity(APP_TOOLS.terminals, input),
  reason: OUTSIDE_SANDBOX,
});

test('a read-only agent’s command for a terminal asks on a card of its own, saying it runs outside the sandbox', async () => {
  const tools = setup();
  const { open } = readOnlyTools(tools);
  // Its provider shows no card of its own for it: the tool asks as it runs, the same in every mode.
  assert.equal(open.ask({ command: 'echo hi' }), false);
  const answer = await open.run({ count: 2, command: ' echo hi ' });
  assert.deepEqual(tools.questions, [terminalCard({ count: 2, command: 'echo hi' })]);
  assert.match(OUTSIDE_SANDBOX, /your own shell, outside the read-only sandbox/);
  assert.deepEqual(tools.asked, [{ contactId: 'c1', names: [null, null], command: 'echo hi' }]);
  assert.equal(answer, '2 terminals are opening beside the conversation, with echo hi typed into each.');
});

test('in a mode that never asks, a read-only agent’s command for a terminal still waits for the user', async () => {
  const tools = setup({ saying: { decision: 'deny' } });
  const open = tools.toolsFor('c1', 'c1', { readOnly: true }).find((one) => one.name === APP_TOOLS.terminals);
  // As its session runs it in Never ask: the mode lets its agent act unasked.
  await assert.rejects(open.run({ command: 'echo hi' }, { ...tools.context, unasked: true }), /chose not to run it/);
  assert.deepEqual(tools.questions, [terminalCard({ command: 'echo hi' })]);
  assert.deepEqual(tools.asked, []);
});

test('a read-only agent’s command the user said no to opens no terminal, and the agent is told why', async () => {
  for (const [saying, why] of [
    [{ decision: 'deny' }, /The user chose not to run it\. No terminal was opened\./],
    [{ decision: 'feedback', message: 'Not now.' }, /Not now\./],
    [{ decision: 'cancelled' }, /The turn ended before the user answered\. No terminal was opened\./],
  ]) {
    const tools = setup({ saying });
    await assert.rejects(readOnlyTools(tools).open.run({ command: 'echo hi' }), why);
    assert.deepEqual(tools.asked, []);
  }
});

test('a read-only agent opens terminals without a command unasked, as any agent does', async () => {
  const tools = setup();
  const { open } = readOnlyTools(tools);
  assert.equal(open.ask({ count: 2 }), false);
  await open.run({ count: 2, names: ['logs'] });
  assert.deepEqual(tools.questions, []);
  assert.deepEqual(tools.asked, [{ contactId: 'c1', names: ['logs', null], command: null }]);
});

test('an agent that may change files has its command asked about by its provider, as before', async () => {
  const tools = setup();
  assert.equal(tools.open.ask({ command: 'echo hi' }), true);
  await tools.open.run({ command: 'echo hi' }, tools.context);
  assert.deepEqual(tools.questions, [], 'no second card from the tool itself');
});

test('a manager’s command for a terminal asks too: its conversation is read-only', async () => {
  const tools = setup({ contacts: [{ id: 'm1', manages: 'git:/code/shop/.git' }], managers: managersFor() });
  await readOnlyTools(tools, 'm1').open.run({ command: 'echo hi' });
  assert.deepEqual(tools.questions, [terminalCard({ command: 'echo hi' })]);
  const lead = setup({ contacts: [{ id: 'p1', manages: 'git:/code/shop/.git' }], managers: leadsFor() });
  await readOnlyTools(lead, 'p1').open.run({ command: 'echo hi' });
  assert.deepEqual(lead.questions, [terminalCard({ command: 'echo hi' })], 'and so does a project manager’s');
});

test('a conversation a read-only agent starts waits for the user, even one it says the user asked for', async () => {
  const tools = setup({ contacts: [{ id: 'c1' }, { id: 'r1' }] });
  const { start } = readOnlyTools(tools, 'c1', 'r1');
  const input = { prompt: 'Fix the cart total.', asked_by_user: true };
  assert.equal(start.ask(input), false);
  assert.equal(start.activity(input).started, false, 'its line says it waits for the user to start it');
  const answer = await start.run(input);
  assert.deepEqual(tools.begun, [
    { hostId: 'c1', prompt: 'Fix the cart total.', now: false, fromHere: false, invite: [], speakerId: 'r1' },
  ]);
  assert.match(answer, /with the prompt waiting in its message box\..*Nothing runs until the user sends it\./s);
  assert.deepEqual(tools.questions, [], 'no card: the draft is the user’s to start');
});

test('a read-only agent is told what it starts waits for the user, and has no word for the user asking', () => {
  const tools = setup();
  const { start } = readOnlyTools(tools);
  assert.match(start.description, /It waits with the prompt in its message box until the user starts it/);
  assert.doesNotMatch(start.description, /asked_by_user/);
  assert.ok(!('asked_by_user' in start.input));
  // What it says of the user anyway changes nothing.
  assert.equal(z.object(start.input).parse({ prompt: 'x', asked_by_user: true }).asked_by_user, undefined);
});

test('Settings’ start at once doesn’t start what a read-only agent adds', async () => {
  const tools = setup({ settings: { startConversations: true } });
  const { start } = readOnlyTools(tools);
  assert.doesNotMatch(start.description, /It starts at once/);
  assert.equal(start.activity({ prompt: 'x' }).started, false);
  await start.run({ prompt: 'x' });
  assert.equal(tools.begun.at(-1).now, false);
});

test('a read-only agent outside a manager’s conversation can’t invite agents anywhere', () => {
  const tools = setup({ contacts: [{ id: 'c1' }, { id: 'm1' }], managers: invitingFor(), agents: AGENTS });
  assert.ok(!readOnlyTools(tools).all.some((tool) => tool.name === APP_TOOLS.invite));
});

test('a manager still starts at once what the user asked for, as far as it may', async () => {
  const held = new Set();
  const tools = setup({
    contacts: [{ id: 'm1', manages: 'git:/code/shop/.git' }],
    managers: leadsFor({ startsAtOnce: (id) => !held.has(id) }),
  });
  const { start } = readOnlyTools(tools, 'm1');
  assert.ok('asked_by_user' in start.input);
  const input = { prompt: 'Fix COM-630.', asked_by_user: true };
  assert.equal(start.activity(input).started, true);
  await start.run(input);
  assert.equal(tools.begun.at(-1).now, true);
  await start.run({ prompt: 'Tidy the CSS.' });
  assert.equal(tools.begun.at(-1).now, false, 'one it thought of waits, as ever');
  // Acting on a project manager's message the user did not approve, what it says the user asked is not so.
  held.add('m1');
  await start.run({ ...input, request_id: 'held' });
  assert.equal(tools.begun.at(-1).now, false);
});

test('an agent answering as part of a manager starts what the user asked for at once, as the manager does', async () => {
  const tools = setup({
    contacts: [{ id: 'm1', manages: 'git:/code/shop/.git' }, { id: 'g1' }],
    managers: invitingFor(),
    agents: AGENTS,
  });
  const { all, start } = readOnlyTools(tools, 'm1', 'g1');
  await start.run({ prompt: 'Fix COM-630.', asked_by_user: true });
  assert.deepEqual(tools.begun.at(-1), {
    hostId: 'm1',
    prompt: 'Fix COM-630.',
    now: true,
    fromHere: false,
    invite: [],
    speakerId: 'g1',
  });
  // And invites one the user asked for unasked, as the manager does.
  const invite = all.find((tool) => tool.name === APP_TOOLS.invite);
  assert.equal(invite.ask({ to: 'Claude (tags)', service: 'claude', asked_by_user: true }), false);
  assert.equal(invite.ask({ to: 'Claude (tags)', service: 'claude' }), true);
});

test('the note from a conversation it started says who it is from, and that the user did not write it', () => {
  const note = reportNote('Claude (promo)', 'x'.repeat(REPORT_MAX + 10));
  assert.match(note, /^\[Claude \(promo\), a conversation you started, finished a turn\. .*not from the user/);
  assert.ok(note.endsWith(`${'x'.repeat(REPORT_MAX)}…`));
  assert.ok(reportNote('A', 'short').endsWith('\nshort'));
});

test('a note is told by who it is from, and anything else is no note', () => {
  assert.equal(reportedBy(reportNote('Claude (promo)', 'Done.')), 'Claude (promo)');
  assert.equal(reportedBy(`${reportNote('Claude (a)', 'x')}\n\n${reportNote('Claude (b)', 'y')}`), 'Claude (a)');
  assert.equal(reportedBy('update the roster'), null);
  assert.equal(reportedBy('[Group conversation]\nYou are Claude.'), null);
  assert.equal(reportedBy('the roster, a conversation you started, finished a turn.'), null);
});

// ---- as Claude is given them ------------------------------------------------------------------

test('Claude is given the app’s tools as one server of them, each under its own name', () => {
  const { toolsFor } = setup();
  const server = appToolServer(toolsFor('c1'));
  assert.equal(server.type, 'sdk');
  assert.equal(server.name, 'messenger');
  assert.equal(appToolName(APP_TOOLS.terminals), 'mcp__messenger__open_terminals');
  assert.equal(appToolName(APP_TOOLS.conversation), 'mcp__messenger__start_conversation');
  assert.equal(appToolName(APP_TOOLS.instructions), 'mcp__messenger__project_instructions');
  assert.deepEqual(
    toolsFor('c1').map((tool) => tool.name),
    ['open_terminals', 'start_conversation', 'project_instructions']
  );
});

test('Claude is told what the tool is for, and that it can run something in the terminals', () => {
  assert.match(APP_TOOL_INSTRUCTIONS, /mcp__messenger__open_terminals opens terminals beside this conversation/);
  assert.match(APP_TOOL_INSTRUCTIONS, /terminals running claude/);
  assert.match(APP_TOOL_INSTRUCTIONS, /mcp__messenger__start_conversation starts another conversation/);
  assert.match(APP_TOOL_INSTRUCTIONS, /mcp__messenger__project_instructions reads and saves what this project/);
});

test('what a tool answers is text for Claude, and so is what went wrong', async () => {
  const answers = sdkTool({ name: 'x', description: 'x', input: {}, ask: () => false, run: async () => 'Done.' });
  assert.deepEqual(await answers.handler({}, {}), { content: [{ type: 'text', text: 'Done.' }] });
  const fails = sdkTool({
    name: 'y',
    description: 'y',
    input: {},
    ask: () => false,
    run: () => {
      throw new Error('The window is closed.');
    },
  });
  assert.deepEqual(await fails.handler({}, {}), {
    content: [{ type: 'text', text: 'The window is closed.' }],
    isError: true,
  });
});

test('a tool Claude calls asks the user with its session, as it runs', async () => {
  const context = { ask: async () => ({ decision: 'deny' }) };
  const given = [];
  const asking = sdkTool(
    {
      name: 'z',
      description: 'z',
      input: {},
      ask: () => false,
      run: async (input, ctx) => given.push(ctx) && 'Asked.',
    },
    () => context
  );
  await asking.handler({}, {});
  assert.deepEqual(given, [context]);
});

// ---- a project's manager's tools ---------------------------------------------------------------

/** Managers that take the contact `m1` for a manager, with what each tool was asked. */
const managersFor = () => {
  const calls = [];
  return {
    calls,
    oversees: (contact) => contact.id === 'm1',
    say: async (...args) => (calls.push(['say', ...args]), 'Sent.'),
    answer: async (...args) => (calls.push(['answer', ...args]), 'Answered.'),
    // The card a worker waits on: what it asks, for the manager's answer to be shown under.
    questionsOf: (...args) => (calls.push(['questionsOf', ...args]), ['Which runner?', 'What to cover?']),
    look: async (...args) => (calls.push(['look', ...args]), 'Looked.'),
    brief: (...args) => (calls.push(['brief', ...args]), 'Brief.'),
    sources: (...args) => (calls.push(['sources', ...args]), 'Sources.'),
  };
};

test('a project’s manager also messages the conversations it oversees, looks at them, and keeps the brief', () => {
  const { toolsFor } = setup({ contacts: [{ id: 'c1' }, { id: 'm1' }], managers: managersFor() });
  assert.deepEqual(
    toolsFor('m1').map((tool) => tool.name),
    [
      'open_terminals',
      'start_conversation',
      'project_instructions',
      'message_conversation',
      'answer_question',
      'project_conversations',
      'project_brief',
      'project_sources',
      'message_project_manager',
    ]
  );
  assert.equal(toolsFor('c1').length, 3, 'any other contact has the app’s tools alone');
});

test('a manager’s tools do what the managers do, for that manager, and only its messages are asked about', async () => {
  const managers = managersFor();
  const { tool } = setup({ contacts: [{ id: 'm1' }], managers });
  const message = tool('m1', APP_TOOLS.message);
  const look = tool('m1', APP_TOOLS.look);
  const brief = tool('m1', APP_TOOLS.brief);
  const sources = tool('m1', APP_TOOLS.sources);
  assert.equal(await message.run({ to: 'Claude (tags)', text: 'Fix it.' }), 'Sent.');
  assert.equal(await look.run({}), 'Looked.');
  assert.equal(await look.run({ name: 'Claude (tags)' }), 'Looked.');
  assert.equal(brief.run({}), 'Brief.');
  assert.equal(brief.run({ text: 'Goals' }), 'Brief.');
  assert.equal(sources.run({ add: [{ name: 'PRD', url: 'https://x.dev' }] }), 'Sources.');
  assert.deepEqual(managers.calls, [
    ['say', 'm1', 'Claude (tags)', 'Fix it.', false],
    ['look', 'm1', undefined],
    ['look', 'm1', 'Claude (tags)'],
    ['brief', 'm1', undefined],
    ['brief', 'm1', 'Goals'],
    ['sources', 'm1', { add: [{ name: 'PRD', url: 'https://x.dev' }], remove: undefined }],
  ]);
  // A message sets another agent to work: the user reads it before it goes.
  assert.equal(message.ask({ to: 'Claude (tags)', text: 'Fix it.' }), true);
  for (const one of [look, brief, sources]) assert.equal(one.ask({}), false);
  assert.equal(takes(sources, { add: [{ name: 'PRD' }], remove: ['COM-630'] }), true);
  assert.equal(takes(sources, {}), true, 'to read them');
});

test('a manager’s message names who it is for, and neither it nor the brief is endlessly long', () => {
  const { tool } = setup({ contacts: [{ id: 'm1' }], managers: managersFor() });
  const message = tool('m1', APP_TOOLS.message);
  assert.equal(takes(message, { to: 'Claude (tags)', text: 'Fix it.' }), true);
  assert.equal(takes(message, { text: 'Fix it.' }), false);
  assert.equal(takes(message, { to: 'Claude (tags)', text: 'x'.repeat(MESSAGE_MAX + 1) }), false);
  const brief = tool('m1', APP_TOOLS.brief);
  assert.equal(takes(brief, {}), true, 'to read it');
  assert.equal(takes(brief, { text: 'x'.repeat(BRIEF_MAX + 1) }), false);
});

test('a manager answers a worker’s question with answer_question, and the user is asked first, as for a message', async () => {
  const managers = managersFor();
  const { tool } = setup({ contacts: [{ id: 'm1' }], managers });
  const answer = tool('m1', APP_TOOLS.answer);
  const message = tool('m1', APP_TOOLS.message);
  const input = { to: 'Claude (tags)', answers: [{ options: ['Vitest'] }, { own_answer: 'Errors too' }] };
  assert.equal(await answer.run(input), 'Answered.');
  await answer.run({ ...input, card: 'r2' });
  assert.deepEqual(managers.calls, [
    ['answer', 'm1', 'Claude (tags)', input.answers, ''],
    ['answer', 'm1', 'Claude (tags)', input.answers, 'r2'],
  ]);
  // The same path a message takes, whatever is answered: the mode decides whether the user is asked.
  for (const asked of [input, { to: 'x', answers: [{ own_answer: 'yes' }] }]) {
    assert.equal(answer.ask(asked), true);
    assert.equal(answer.ask(asked), message.ask({ to: 'x', text: 'y' }));
  }
});

test('answer_question takes a conversation and one answer for each question: options by label, or words of its own', () => {
  const { tool } = setup({ contacts: [{ id: 'm1' }], managers: managersFor() });
  const answer = tool('m1', APP_TOOLS.answer);
  assert.ok(takes(answer, { to: 'Claude (tags)', answers: [{ options: ['A'] }] }));
  assert.ok(
    takes(answer, { to: 'Claude (tags)', answers: [{ options: ['A', 'B'] }, { own_answer: 'C' }], card: 'r1' })
  );
  assert.ok(!takes(answer, { answers: [{ options: ['A'] }] }), 'whose question');
  assert.ok(!takes(answer, { to: 'Claude (tags)' }), 'what it answers');
  assert.ok(!takes(answer, { to: 'Claude (tags)', answers: [] }));
  assert.ok(!takes(answer, { to: 'Claude (tags)', answers: [{ own_answer: 'x'.repeat(MESSAGE_MAX + 1) }] }));
  assert.ok(!takes(answer, { to: 'Claude (tags)', answers: [{ options: 'A' }] }));
});

test('answer_question is for questions alone: approvals, permissions and plans stay with the user', () => {
  const { tool } = setup({ contacts: [{ id: 'm1' }], managers: managersFor() });
  const { description } = tool('m1', APP_TOOLS.answer);
  assert.match(
    description,
    /Answer only where the project’s brief, its sources or what the user decided earlier settle it/
  );
  assert.match(description, /Otherwise leave the question to the user, and tell them what it asks/);
  assert.match(
    description,
    /It never answers a permission request, an approval to run a command or use a tool, or a plan: those stay with the user/
  );
  assert.match(description, /The first answer counts/);
  assert.match(description, /The user is asked first/);
});

test('an answer is shown as whose questions it answers, with each question and its answer', () => {
  const managers = managersFor();
  const { tool } = setup({ contacts: [{ id: 'm1' }], managers });
  const answer = tool('m1', APP_TOOLS.answer);
  const input = { to: 'Claude (tags)', answers: [{ options: ['Vitest'] }, { options: ['Edge cases', 'Errors'] }] };
  assert.deepEqual(answer.activity({ ...input, card: 'r1' }), {
    kind: 'app',
    action: 'answer-question',
    label: 'Claude (tags)',
    count: 2,
    answers: ['Vitest', 'Edge cases, Errors'],
    prompt: 'Which runner?\n→ Vitest\n\nWhat to cover?\n→ Edge cases, Errors',
  });
  assert.deepEqual(managers.calls, [['questionsOf', 'm1', 'Claude (tags)', 'r1']]);
  // As the provider words it from the input alone, where the card is gone.
  assert.deepEqual(appActivity(APP_TOOLS.answer, { to: 'Claude (tags)', answers: [{ own_answer: ' Both ' }] }), {
    kind: 'app',
    action: 'answer-question',
    label: 'Claude (tags)',
    count: 1,
    answers: ['Both'],
    prompt: '→ Both',
  });
});

// ---- a project manager's tools -----------------------------------------------------------------

/** Managers that take `p1` for a project manager over `m1`, with what each tool was asked. */
const leadsFor = ({ startsAtOnce = () => true } = {}) => {
  const managers = managersFor();
  return {
    ...managers,
    oversees: (contact) => ['m1', 'p1'].includes(contact.id),
    leads: (contact) => contact.id === 'p1',
    leadOf: (contact) => (contact.id === 'm1' ? { id: 'p1', name: 'shop project manager' } : null),
    teams: async (...args) => (managers.calls.push(['teams', ...args]), 'Teams.'),
    tellManager: async (leadId, to, text, how) => {
      const approved = await how.approve();
      managers.calls.push(['tellManager', leadId, to, text, { job: how.job, urgent: how.urgent, approved }]);
      return approved ? 'Approved.' : 'Unapproved.';
    },
    report: (...args) => (managers.calls.push(['report', ...args]), 'Reported.'),
    startsAtOnce,
  };
};

test('a project manager messages managers and looks at the teams, but starts no conversation and messages no worker', () => {
  const { toolsFor } = setup({ contacts: [{ id: 'm1' }, { id: 'p1' }], managers: leadsFor() });
  assert.deepEqual(
    toolsFor('p1').map((tool) => tool.name),
    ['open_terminals', 'project_instructions', 'message_manager', 'project_teams', 'project_brief', 'project_sources']
  );
  assert.ok(
    !toolsFor('p1').some((tool) => [APP_TOOLS.conversation, APP_TOOLS.message, APP_TOOLS.answer].includes(tool.name))
  );
});

test('a project manager’s message asks the user on its own card, and says whether they approved it', async () => {
  const managers = leadsFor();
  const { tool, questions } = setup({ contacts: [{ id: 'p1' }], managers });
  const tell = tool('p1', APP_TOOLS.tellManager);
  // The provider asks nothing: the card is the tool's own, once it knows whom it is for.
  assert.equal(tell.ask({ to: 'review manager', text: 'Review it.' }), false);
  const input = { to: 'review manager', text: 'Review it against COM-630.', job: 'Claude (tags)', urgent: false };
  assert.equal(
    await tell.run(input, { ask: async (request) => (questions.push(request), { decision: 'allow' }) }),
    'Approved.'
  );
  assert.equal(questions.length, 1);
  assert.equal(questions[0].kind, 'tool');
  assert.deepEqual(questions[0].activity, {
    kind: 'app',
    action: 'message',
    urgent: false,
    label: 'review manager',
    prompt: 'Review it against COM-630.',
    job: 'Claude (tags)',
  });
  // Never ask: no card, and it goes without the user's approval.
  assert.equal(await tell.run(input, { ask: async () => assert.fail('asks nothing'), unasked: true }), 'Unapproved.');
  await assert.rejects(tell.run(input, { ask: async () => ({ decision: 'deny' }) }), /chose not to send it/);
  await assert.rejects(
    tell.run(input, { ask: async () => ({ decision: 'cancelled' }) }),
    /turn ended before the user answered/
  );
  assert.deepEqual(
    managers.calls.map(([name, ...args]) => [name, args.at(-1).approved]),
    [
      ['tellManager', true],
      ['tellManager', false],
    ],
    'a declined or cancelled card sends nothing'
  );
});

test('a project manager’s look at the teams takes a manager or a conversation, and asks nothing', async () => {
  const managers = leadsFor();
  const { tool } = setup({ contacts: [{ id: 'p1' }], managers });
  const teams = tool('p1', APP_TOOLS.teams);
  assert.equal(teams.ask({}), false);
  assert.equal(await teams.run({}), 'Teams.');
  assert.equal(await teams.run({ manager: 'review manager' }), 'Teams.');
  assert.equal(await teams.run({ conversation: 'Claude (tags)' }), 'Teams.');
  assert.deepEqual(managers.calls, [
    ['teams', 'p1', { manager: undefined, conversation: undefined }],
    ['teams', 'p1', { manager: 'review manager', conversation: undefined }],
    ['teams', 'p1', { manager: undefined, conversation: 'Claude (tags)' }],
  ]);
});

test('a manager reports to its project manager without asking, named on its line, and briefly', async () => {
  const managers = leadsFor();
  const { tool } = setup({ contacts: [{ id: 'm1' }, { id: 'p1' }], managers });
  const report = tool('m1', APP_TOOLS.report);
  assert.equal(report.ask({ text: 'Approved.' }), false);
  assert.equal(report.run({ text: 'Approved, with two changes.' }), 'Reported.');
  assert.deepEqual(managers.calls, [['report', 'm1', 'Approved, with two changes.']]);
  assert.equal(report.activity({ text: 'Approved.' }).label, 'shop project manager');
  assert.equal(takes(report, { text: 'x'.repeat(REPORT_UP_MAX + 1) }), false);
});

test('a manager acting on a project manager’s message the user did not approve starts nothing at once', async () => {
  const held = new Set(['m1']);
  const { tool, begun } = setup({
    contacts: [{ id: 'm1', manages: 'git:/code/shop/.git' }],
    managers: leadsFor({ startsAtOnce: (id) => !held.has(id) }),
  });
  const start = tool('m1', APP_TOOLS.conversation);
  const input = { prompt: 'Review COM-630.', asked_by_user: true };
  assert.equal(start.activity(input).started, false, 'its line says it waits for the user');
  await start.run(input);
  assert.equal(begun.at(-1).now, false, 'its first message waits in its message box');
  held.delete('m1');
  assert.equal(start.activity(input).started, true);
  await start.run({ ...input, request_id: 'again' });
  assert.equal(begun.at(-1).now, true, 'once the user wrote to it, what they ask starts at once');
});

test('Settings’ start at once still starts what a manager acting on an unapproved message starts', async () => {
  const { tool, begun } = setup({
    contacts: [{ id: 'm1', manages: 'git:/code/shop/.git' }],
    settings: { startConversations: true },
    managers: leadsFor({ startsAtOnce: () => false }),
  });
  await tool('m1', APP_TOOLS.conversation).run({ prompt: 'Review COM-630.', asked_by_user: true });
  assert.equal(begun.at(-1).now, true);
});

// ---- a manager inviting agents into its workers -----------------------------------------------------

/** Managers that take `m1` for a manager, whose invites are recorded, as is whether its turn was the user's. */
const invitingFor = ({ startsAtOnce = () => true } = {}) => {
  const managers = managersFor();
  return {
    ...managers,
    invite: async (...args) => (managers.calls.push(['invite', ...args]), 'Joined.'),
    startsAtOnce,
  };
};

test('with services to invite, a manager also invites agents into its workers, after messaging them', () => {
  const { toolsFor } = setup({ contacts: [{ id: 'c1' }, { id: 'm1' }], managers: invitingFor(), agents: AGENTS });
  assert.deepEqual(
    toolsFor('m1').map((tool) => tool.name),
    [
      'open_terminals',
      'start_conversation',
      'project_instructions',
      'message_conversation',
      'answer_question',
      'invite_to_conversation',
      'project_conversations',
      'project_brief',
      'project_sources',
      'message_project_manager',
    ]
  );
  assert.ok(!toolsFor('c1').some((tool) => tool.name === APP_TOOLS.invite), 'a contact that is no manager has none');
});

test('an invite takes a conversation, a service, and a model, effort, role, message and whether the user asked', () => {
  const { tool } = setup({ contacts: [{ id: 'm1' }], managers: invitingFor(), agents: AGENTS });
  const invite = tool('m1', APP_TOOLS.invite);
  assert.ok(takes(invite, { to: 'Claude (tags)', service: 'claude' }));
  assert.ok(
    takes(invite, {
      to: 'Claude (tags)',
      service: 'claude',
      model: 'claude-opus-5-5',
      effort: 'high',
      role: 'Reviewer',
      message: 'Review COM-630.',
      asked_by_user: true,
    })
  );
  assert.ok(takes(invite, { to: 'Claude (tags)', role: 'Tester' }), 'a role says its own service');
  assert.ok(!takes(invite, { service: 'claude' }), 'into which conversation');
  assert.ok(!takes(invite, { to: 'Claude (tags)', service: 'copilot' }));
  assert.ok(!takes(invite, { to: 'Claude (tags)', service: 'claude', message: 'x'.repeat(MESSAGE_MAX + 1) }));
});

test('an invite the user asked for goes unasked, and any other the user approves first', () => {
  const held = new Set();
  const { tool } = setup({
    contacts: [{ id: 'm1' }],
    managers: invitingFor({ startsAtOnce: (id) => !held.has(id) }),
    agents: AGENTS,
  });
  const invite = tool('m1', APP_TOOLS.invite);
  const input = { to: 'Claude (tags)', service: 'claude' };
  assert.equal(invite.ask({ ...input, asked_by_user: true }), false);
  assert.equal(invite.ask(input), true);
  assert.equal(invite.ask({ ...input, asked_by_user: false }), true);
  // Acting on a project manager's message the user did not approve, what the agent says the user asked is not so.
  held.add('m1');
  assert.equal(invite.ask({ ...input, asked_by_user: true }), true);
});

test('an invite is shown as who joins which conversation, as what, with what it is asked', () => {
  const { tool } = setup({ contacts: [{ id: 'm1' }], managers: invitingFor(), agents: AGENTS });
  const invite = tool('m1', APP_TOOLS.invite);
  assert.deepEqual(
    invite.activity({ to: 'Claude (tags)', service: 'claude', model: 'claude-opus-5-5', message: 'Review it.' }),
    {
      kind: 'app',
      action: 'invite',
      label: 'Claude (tags)',
      agent: 'Claude (claude-opus-5-5)',
      role: 'Reviewer',
      prompt: 'Review it.',
    }
  );
  assert.deepEqual(invite.activity({ to: 'Claude (tags)', service: 'codex', role: 'Tester' }), {
    kind: 'app',
    action: 'invite',
    label: 'Claude (tags)',
    agent: 'Codex',
    role: 'Tester',
  });
  // As the provider words it from the input alone.
  assert.deepEqual(appActivity(APP_TOOLS.invite, { to: 'Claude (tags)', service: 'codex' }), {
    kind: 'app',
    action: 'invite',
    label: 'Claude (tags)',
    agent: 'codex',
    role: 'Reviewer',
  });
});

test('an invite is the manager’s, with what was asked, and its answer is the agent’s', async () => {
  const managers = invitingFor();
  const { tool } = setup({ contacts: [{ id: 'm1' }], managers, agents: AGENTS });
  const invite = tool('m1', APP_TOOLS.invite);
  const input = {
    to: 'Claude (tags)',
    service: 'claude',
    model: 'claude-opus-5-5',
    effort: 'high',
    role: 'Reviewer',
    message: 'Review COM-630.',
    asked_by_user: true,
  };
  assert.equal(await invite.run(input), 'Joined.');
  await invite.run({ to: 'Claude (posts)', role: 'Tester' });
  assert.deepEqual(managers.calls, [
    [
      'invite',
      'm1',
      {
        to: 'Claude (tags)',
        service: 'claude',
        model: 'claude-opus-5-5',
        effort: 'high',
        role: 'Reviewer',
        message: 'Review COM-630.',
      },
    ],
    ['invite', 'm1', { to: 'Claude (posts)', service: '', model: '', effort: '', role: 'Tester', message: '' }],
  ]);
});

test('a manager is told what an agent it invites does unless a role says otherwise, and to say what to review', () => {
  const { tool } = setup({ contacts: [{ id: 'm1' }], managers: invitingFor(), agents: AGENTS });
  const { description } = tool('m1', APP_TOOLS.invite);
  assert.match(description, /that worker’s own conversation, as a guest the user sees in its Agents tab/);
  assert.match(
    description,
    /Without a role it is a reviewer: it changes no files, and answers once the worker has changed files/
  );
  assert.match(description, /instead of subagents of your own/);
  assert.match(description, /hand-offs stop at the conversation’s limit/);
});

test('agents in a new conversation can have a model, an effort level and a role, and a service alone still works', async () => {
  const { start, begun } = setup({ agents: AGENTS, started: { name: 'Claude (roster)', worktree: true, joined: [] } });
  const invitee = { service: 'codex', model: 'gpt-5.5', effort: 'high', role: 'Tester' };
  assert.ok(takes(start, { prompt: 'x', invite: [invitee, 'gemini'] }));
  assert.ok(!takes(start, { prompt: 'x', invite: [{ model: 'gpt-5.5' }] }), 'which service');
  assert.ok(!takes(start, { prompt: 'x', invite: [{ service: 'copilot' }] }));
  await start.run({
    prompt: 'Build it',
    asked_by_user: true,
    invite: [invitee, 'gemini', { service: 'gemini' }, { ...invitee }, { service: 'claude', model: ' opus ' }],
  });
  assert.deepEqual(begun[0].invite, [invitee, 'gemini', { service: 'claude', model: 'opus' }]);
});

test('Claude is not told of a manager’s tools, which a manager is told of itself', () => {
  assert.ok(!APP_TOOL_INSTRUCTIONS.includes(APP_TOOLS.message));
});

test('a manager is told that the conversations it starts are as its settings say, and any other that they are like it', () => {
  const { tool } = setup({ contacts: [{ id: 'c1' }, { id: 'm1', manages: 'git:/code/shop/.git' }] });
  const manager = tool('m1', APP_TOOLS.conversation).description;
  assert.match(manager, /as the manager’s settings say under New workers use/);
  assert.match(manager, /in the mode a new contact of that service starts in, not the manager’s/);
  assert.doesNotMatch(manager, /uses your service/);
  assert.match(tool('c1', APP_TOOLS.conversation).description, /Its main agent uses your service, model, effort/);
});

// ---- what a manager's workers answer with -------------------------------------------------------

const SERVICES = [claude, codex, gemini, hermes];
const known = (id) => SERVICES.find((one) => one.id === id) || claude;
const contact = (id, provider, model, permissionMode, effort) => ({
  id,
  provider,
  name: id,
  cwd: '/code/shop',
  model,
  permissionMode,
  sessionId: null,
  ...(effort && { effort }),
});
const CLAUDE_MANAGER = contact('m1', 'claude', 'sonnet', 'bypassPermissions', 'low');
const CODEX_MANAGER = contact('m2', 'codex', 'gpt-5.5-mini', 'full-access', 'low');
const YOURS = contact('c9', 'claude', 'opus', 'acceptEdits', 'high');
const startOf = (workers, { manager, starter = manager, yours = YOURS, defaults }) =>
  workerStart(workers, { manager, starter, yours, descriptor: known, first: claude, defaults });

for (const manager of [CLAUDE_MANAGER, CODEX_MANAGER]) {
  const name = manager.provider === 'claude' ? 'Claude' : 'Codex';

  test(`a ${name} manager's worker starts with your defaults, in their service's own mode`, () => {
    assert.deepEqual(startOf({ use: 'defaults' }, { manager }), {
      provider: 'claude',
      model: 'opus',
      effort: 'high',
      permissionMode: claude.defaultPermissionMode,
    });
    const codexYours = contact('c8', 'codex', 'gpt-5.5', 'full-access', 'xhigh');
    assert.deepEqual(startOf({ use: 'defaults' }, { manager, yours: codexYours }), {
      provider: 'codex',
      model: 'gpt-5.5',
      effort: 'xhigh',
      permissionMode: codex.defaultPermissionMode,
    });
  });

  test(`a ${name} manager's worker with nobody to start like is the first service as it is`, () => {
    assert.deepEqual(startOf({ use: 'defaults' }, { manager, yours: null }), {
      provider: 'claude',
      model: '',
      effort: null,
      permissionMode: claude.defaultPermissionMode,
    });
  });

  test(`a ${name} manager's worker the same as the manager is the manager, mode and all`, () => {
    assert.deepEqual(startOf({ use: 'manager' }, { manager }), {
      provider: manager.provider,
      model: manager.model,
      effort: 'low',
      permissionMode: manager.permissionMode,
    });
  });

  test(`a ${name} manager's worker on a service and model you pick is in that service's own mode`, () => {
    assert.deepEqual(startOf({ use: 'picked', provider: 'codex', model: 'gpt-5.5', effort: 'xhigh' }, { manager }), {
      provider: 'codex',
      model: 'gpt-5.5',
      effort: 'xhigh',
      permissionMode: codex.defaultPermissionMode,
    });
    assert.deepEqual(startOf({ use: 'picked', provider: 'gemini', model: '' }, { manager }), {
      provider: 'gemini',
      model: '',
      effort: null,
      permissionMode: gemini.defaultPermissionMode,
    });
  });
}

test('a worker on your defaults starts as Settings > New contacts says, and like your last contact otherwise', () => {
  const manager = CLAUDE_MANAGER;
  assert.deepEqual(
    startOf(
      { use: 'defaults' },
      { manager, defaults: { claude: { model: 'haiku', effort: 'low', permissionMode: 'acceptEdits' } } }
    ),
    { provider: 'claude', model: 'haiku', effort: 'low', permissionMode: 'acceptEdits' }
  );
  // A mode alone: your last contact's model and level, in the mode picked rather than the service's own.
  assert.deepEqual(startOf({ use: 'defaults' }, { manager, defaults: { claude: { permissionMode: 'plan' } } }), {
    provider: 'claude',
    model: 'opus',
    effort: 'high',
    permissionMode: 'plan',
  });
  // Another model, and its own level: your contact's level was for its model.
  assert.deepEqual(startOf({ use: 'defaults' }, { manager, defaults: { claude: { model: 'sonnet' } } }), {
    provider: 'claude',
    model: 'sonnet',
    effort: null,
    permissionMode: claude.defaultPermissionMode,
  });
  // With nobody added yet, the first service as Settings has it.
  assert.deepEqual(startOf({ use: 'defaults' }, { manager, yours: null, defaults: { claude: { model: 'sonnet' } } }), {
    provider: 'claude',
    model: 'sonnet',
    effort: null,
    permissionMode: claude.defaultPermissionMode,
  });
  // Another service's defaults say nothing of this one, and a picked service is as it was picked.
  assert.equal(startOf({ use: 'defaults' }, { manager, defaults: { codex: { model: 'gpt-5.5' } } }).model, 'opus');
  assert.equal(
    startOf({ use: 'picked', provider: 'claude', model: 'opus' }, { manager, defaults: { claude: { model: 'haiku' } } })
      .model,
    'opus'
  );
});

test('the service’s default Permission mode is the one New contacts picks for the worker’s service', () => {
  const defaults = { claude: { permissionMode: 'plan' }, codex: { permissionMode: 'read-only' } };
  for (const manager of [CLAUDE_MANAGER, CODEX_MANAGER]) {
    assert.equal(startOf({ use: 'defaults' }, { manager, defaults }).permissionMode, 'plan');
    // A service picked for the workers starts in its own New contacts mode, not another service's.
    assert.equal(
      startOf({ use: 'picked', provider: 'codex', model: 'gpt-5.5' }, { manager, defaults }).permissionMode,
      'read-only'
    );
  }
  // Same as the manager, as New workers use, is the manager's mode whatever New contacts says.
  assert.equal(startOf({ use: 'manager' }, { manager: CLAUDE_MANAGER, defaults }).permissionMode, 'bypassPermissions');
});

test('a Permission mode the manager picks or takes from itself beats the one New contacts picks', () => {
  const defaults = { claude: { permissionMode: 'plan' } };
  const picked = { use: 'defaults', mode: 'picked', permissionMode: 'acceptEdits' };
  assert.equal(startOf(picked, { manager: CLAUDE_MANAGER, defaults }).permissionMode, 'acceptEdits');
  const same = { use: 'defaults', mode: 'manager' };
  assert.equal(startOf(same, { manager: CLAUDE_MANAGER, defaults }).permissionMode, 'bypassPermissions');
});

test('a worker never takes a manager’s mode that asks nothing, but for the same as the manager', () => {
  for (const use of ['defaults', 'picked']) {
    const workers = use === 'picked' ? { use, provider: 'claude', model: 'opus' } : { use };
    assert.notEqual(startOf(workers, { manager: CLAUDE_MANAGER }).permissionMode, 'bypassPermissions', use);
    assert.notEqual(startOf(workers, { manager: CODEX_MANAGER }).permissionMode, 'full-access', use);
  }
});

test('your defaults are your contact’s service and model, never its mode', () => {
  const bold = contact('c7', 'codex', 'gpt-5.5', 'full-access');
  assert.equal(startOf({ use: 'defaults' }, { manager: CLAUDE_MANAGER, yours: bold }).permissionMode, 'ask');
});

test('a service picked that is not there any more is your defaults instead', () => {
  assert.deepEqual(
    startOf({ use: 'picked', provider: 'gone', model: 'x' }, { manager: CLAUDE_MANAGER }),
    startOf({ use: 'defaults' }, { manager: CLAUDE_MANAGER })
  );
  const stale = contact('c6', 'gone', 'x', 'default');
  assert.equal(startOf({ use: 'defaults' }, { manager: CLAUDE_MANAGER, yours: stale }).provider, 'claude');
});

test('the same as the manager is the guest that starts it, in its mode there when that is no looser', () => {
  const guest = contact('g1', 'codex', 'gpt-5.5', 'read-only', 'xhigh');
  assert.deepEqual(startOf({ use: 'manager' }, { manager: CLAUDE_MANAGER, starter: guest }), {
    provider: 'codex',
    model: 'gpt-5.5',
    effort: 'xhigh',
    permissionMode: 'read-only',
  });
});

test('a guest’s worker is never in a looser mode than a manager in a stricter one', () => {
  const readOnly = { ...CLAUDE_MANAGER, permissionMode: 'plan' };
  const guest = contact('g1', 'codex', 'gpt-5.5', 'full-access');
  assert.equal(startOf({ use: 'manager' }, { manager: readOnly, starter: guest }).permissionMode, 'read-only');
  const asks = { ...CLAUDE_MANAGER, permissionMode: 'default' };
  assert.equal(startOf({ use: 'manager' }, { manager: asks, starter: guest }).permissionMode, 'ask');
  // A Codex manager's workspace grant is ask-first on another service.
  const auto = { ...CODEX_MANAGER, permissionMode: 'auto' };
  const claudeGuest = contact('g2', 'claude', 'opus', 'acceptEdits');
  assert.equal(startOf({ use: 'manager' }, { manager: auto, starter: claudeGuest }).permissionMode, 'default');
  // A guest on the manager's service in the manager's mode keeps it.
  const codexGuest = contact('g3', 'codex', 'gpt-5.5', 'auto');
  assert.equal(startOf({ use: 'manager' }, { manager: auto, starter: codexGuest }).permissionMode, 'auto');
});

test('a guest whose service has no mode as strict as the manager’s starts the manager’s own worker', () => {
  const readOnly = { ...CLAUDE_MANAGER, permissionMode: 'plan' };
  const guest = contact('g1', 'hermes', '', 'default');
  assert.deepEqual(startOf({ use: 'manager' }, { manager: readOnly, starter: guest }), {
    provider: 'claude',
    model: 'sonnet',
    effort: 'low',
    permissionMode: 'plan',
  });
});

test('work requests and accepted proposals are explained as user-requested while drafts still wait', async () => {
  const { start, begun } = setup();
  assert.match(start.description, /such as "fix this"/);
  assert.match(start.description, /approves work you proposed/);
  assert.match(start.input.asked_by_user.description, /need not ask for a new conversation or name this tool/);
  await start.run({ prompt: 'Fix this', asked_by_user: true });
  await start.run({ prompt: 'Accepted proposal', asked_by_user: true });
  await start.run({ prompt: 'An unrequested idea', asked_by_user: false });
  assert.deepEqual(
    begun.map((entry) => entry.now),
    [true, true, false]
  );
});

// ---- Permission mode -----------------------------------------------------------------------------

test('a worker is in its service’s default mode unless Permission mode says otherwise', () => {
  for (const mode of [undefined, 'nope']) {
    assert.equal(
      startOf({ use: 'defaults', mode }, { manager: CLAUDE_MANAGER }).permissionMode,
      claude.defaultPermissionMode
    );
  }
});

test('a picked Permission mode is the user’s choice, also a looser one than the manager’s', () => {
  const asked = (workers, manager) => startOf({ ...workers, mode: 'picked' }, { manager }).permissionMode;
  assert.equal(asked({ use: 'defaults', permissionMode: 'bypassPermissions' }, CLAUDE_MANAGER), 'bypassPermissions');
  assert.equal(asked({ use: 'defaults', permissionMode: 'acceptEdits' }, CODEX_MANAGER), 'acceptEdits');
  assert.equal(
    asked({ use: 'picked', provider: 'codex', model: '', permissionMode: 'full-access' }, CLAUDE_MANAGER),
    'full-access'
  );
  // Also for the same as the manager: the mode is picked, the service is the manager's.
  const sameAsManager = startOf(
    { use: 'manager', mode: 'picked', permissionMode: 'acceptEdits' },
    { manager: CLAUDE_MANAGER }
  );
  assert.equal(sameAsManager.permissionMode, 'acceptEdits');
  assert.equal(sameAsManager.model, 'sonnet');
});

test('a picked Permission mode the worker’s service doesn’t have is that service’s default', () => {
  assert.equal(
    startOf(
      { use: 'picked', provider: 'codex', model: '', mode: 'picked', permissionMode: 'bypassPermissions' },
      { manager: CLAUDE_MANAGER }
    ).permissionMode,
    codex.defaultPermissionMode
  );
  assert.equal(
    startOf({ use: 'defaults', mode: 'picked', permissionMode: 'gone' }, { manager: CLAUDE_MANAGER }).permissionMode,
    claude.defaultPermissionMode
  );
});

test('Permission mode the same as the manager is no looser than the manager’s', () => {
  const same = (workers, manager, yours) => startOf({ ...workers, mode: 'manager' }, { manager, yours });
  // The manager's own service: its own mode.
  assert.equal(same({ use: 'defaults' }, CLAUDE_MANAGER).permissionMode, 'bypassPermissions');
  // Another service: the loosest of its modes that is no looser.
  const codexYours = contact('c8', 'codex', 'gpt-5.5', 'full-access', 'xhigh');
  const onCodex = same({ use: 'defaults' }, CLAUDE_MANAGER, codexYours);
  assert.equal(onCodex.provider, 'codex');
  assert.deepEqual([onCodex.permissionMode], fallbackPermissionModes(claude, 'bypassPermissions', codex).slice(0, 1));
  const strict = contact('m3', 'claude', 'sonnet', 'default');
  const underStrict = same({ use: 'picked', provider: 'codex', model: '' }, strict);
  assert.ok(fallbackPermissionModes(claude, 'default', codex).includes(underStrict.permissionMode));
  // With nothing no looser to take, the service's default.
  assert.equal(
    same({ use: 'picked', provider: 'hermes', model: '' }, strict).permissionMode,
    hermes.defaultPermissionMode
  );
});

test('Permission mode same as the manager changes nothing where New workers use is already the manager', () => {
  assert.deepEqual(
    startOf({ use: 'manager', mode: 'manager' }, { manager: CODEX_MANAGER }),
    startOf({ use: 'manager' }, { manager: CODEX_MANAGER })
  );
});

test('urgent manager messages still require approval and default to ordinary delivery', async () => {
  const managers = managersFor();
  const { tool } = setup({ contacts: [{ id: 'm1' }], managers });
  const message = tool('m1', APP_TOOLS.message);
  const input = { to: 'Worker', text: 'Do not push', urgent: true };
  assert.equal(takes(message, input), true);
  assert.equal(takes(message, { ...input, urgent: 'true' }), false);
  assert.equal(message.ask(input), true);
  await message.run(input);
  assert.deepEqual(managers.calls.at(-1), ['say', 'm1', 'Worker', 'Do not push', true]);
  assert.equal(message.input.urgent.parse(undefined), false);
});
