import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dotOf, homeSections, projectLabel, roleOf, rowNote, waitingCount } from '../src/shared/phone-sections.js';
import { DEFAULT_LIST_VIEW, listSections } from '../src/shared/list-view.js';
import {
  answeredLine,
  instructionsCard,
  keepPlanning,
  planChoices,
  questionAnswer,
  toolCard,
} from '../src/renderer/phone/cards.js';
import {
  canStop,
  queuedOf,
  resultLine,
  signalLine,
  speakerOf,
  stateLabel,
  todoProgress,
} from '../src/renderer/phone/transcript.js';
import { followKeyboard } from '../src/renderer/phone/keyboard.js';
import { descriptor as claude } from '../src/providers/claude/index.js';

const contact = (id, view = {}) => ({
  id,
  name: id,
  status: 'online',
  unread: 0,
  prompt: null,
  lastActive: 0,
  ...view,
});
const ids = (section) => section.members.map((c) => c.id);

// ---- Home ---------------------------------------------------------------------------------------

test('Home lists who waits first, asking before finished, then who works, then desktop sections', () => {
  const sections = homeSections([
    contact('idle-old', { lastActive: 1 }),
    contact('finished', { unread: 2, lastActive: 50 }),
    contact('working', { status: 'busy', lastActive: 10 }),
    contact('asks-old', { status: 'away', prompt: { kind: 'tool', title: 'Wants to run a command' }, lastActive: 5 }),
    contact('archived', { archived: true, status: 'away', unread: 3 }),
    contact('asks-new', { status: 'away', prompt: { kind: 'question', title: 'Which DB?' }, lastActive: 60 }),
    contact('working-new', { status: 'busy', lastActive: 40, unread: 1 }),
    contact('offline', { status: 'offline', lastActive: 30 }),
    contact('idle-new', { lastActive: 20 }),
  ]);
  assert.deepEqual(
    sections.map((section) => [section.id, section.label]),
    [
      ['waiting', 'Waiting for you'],
      ['working', 'Working'],
      ['project:undefined', 'Other Contacts'],
      ['offline', 'Offline'],
      ['archived', 'Archived'],
    ]
  );
  // Newest first in each; one still at work is working, whatever it said before.
  assert.deepEqual(ids(sections[0]), ['asks-new', 'asks-old', 'finished']);
  assert.deepEqual(ids(sections[1]), ['working-new', 'working']);
  assert.deepEqual(ids(sections[2]), ['idle-old', 'idle-new']);
  assert.deepEqual(ids(sections[3]), ['offline']);
  assert.deepEqual(ids(sections[4]), ['archived']);
});

test('Home lists one with commands left running in the background among the working, saying so, not as finished', () => {
  const running = contact('checks', {
    unread: 1,
    lastActive: 30,
    personalMessage: '2 commands running in the background',
    inBackground: true,
  });
  const sections = homeSections([contact('idle'), running, contact('cart', { status: 'busy', lastActive: 10 })]);
  assert.deepEqual(
    sections.slice(0, 2).map((section) => [section.id, ids(section)]),
    [
      ['waiting', []],
      ['working', ['checks', 'cart']],
    ]
  );
  assert.equal(rowNote(running), '2 commands running in the background');
  assert.deepEqual(
    [dotOf(running), dotOf(contact('cart', { status: 'busy' })), dotOf(contact('idle'))],
    ['background', 'busy', 'online'],
    'its dot is the accent of one at work'
  );
  // Once they end, what it said is waiting for you.
  const ended = { ...running, personalMessage: '~/code/shop', inBackground: false };
  assert.deepEqual([ids(homeSections([ended])[0]), rowNote(ended), dotOf(ended)], [['checks'], 'Finished', 'online']);
});

test('the priority sections are always there, empty project sections are omitted, and nobody is in two', () => {
  assert.deepEqual(
    homeSections([]).map((section) => section.members.length),
    [0, 0]
  );
  const views = [contact('a', { status: 'away', unread: 1 }), contact('b', { status: 'busy', unread: 1 })];
  const placed = homeSections(views).flatMap(ids);
  assert.deepEqual(placed.sort(), ['a', 'b']);
});

test('a row says what its contact asks, that it finished, what it does, or where it works; managers wear a badge', () => {
  assert.equal(
    rowNote(contact('a', { status: 'away', prompt: { kind: 'plan', title: 'Add a dark theme' } })),
    'Add a dark theme'
  );
  assert.equal(
    rowNote(contact('a', { status: 'away', personalMessage: 'Waiting for you to approve something' })),
    'Waiting for you to approve something'
  );
  assert.equal(rowNote(contact('a', { unread: 1, personalMessage: '~/code/shop' })), 'Finished');
  assert.equal(rowNote(contact('a', { status: 'busy', personalMessage: 'Running npm test' })), 'Running npm test');
  assert.equal(rowNote(contact('a', { status: 'busy' })), 'Working');
  assert.equal(rowNote(contact('a', { location: '~/code/shop' })), 'shop');
  assert.equal(roleOf(contact('m', { manages: 'shop' })), 'Manager');
  assert.equal(roleOf(contact('pm', { manages: 'shop', leads: true })), 'Project manager');
  assert.equal(roleOf(contact('w')), '');
});

test('Home reuses the desktop project groups, managers first, with favorites, This computer and archived', () => {
  const views = [
    contact('worker', { project: 'shop', overseenBy: 'manager' }),
    contact('pinned', { project: 'shop', pinned: true }),
    contact('notes', { project: 'notes' }),
    contact('manager', { project: 'shop', manages: 'shop', oversees: true }),
    contact('lead', { project: 'shop', manages: 'shop', oversees: true, leads: true }),
    contact('computer', { place: 'computer' }),
    contact('favorite', { project: 'notes', favorite: true }),
    contact('offline', { project: 'shop', status: 'offline' }),
    contact('archived', { project: 'shop', archived: true }),
  ];
  const desktop = listSections(views, [], DEFAULT_LIST_VIEW).filter((section) => section.members.length);
  assert.deepEqual(homeSections(views).slice(2), desktop);
  assert.deepEqual(ids(desktop.find((section) => section.id === 'project:shop')), [
    'lead',
    'manager',
    'pinned',
    'worker',
  ]);
  const active = [
    contact('asks', { project: 'shop', prompt: { kind: 'tool', title: 'Continue?' } }),
    contact('works', { project: 'notes', status: 'busy' }),
  ];
  assert.deepEqual(homeSections([...views, ...active]).slice(2), desktop, 'Priority rows are not repeated in projects');
  assert.equal(new Set(homeSections([...views, ...active]).flatMap(ids)).size, views.length + active.length);
});

test('a priority row names its project folder or This computer, including long and Windows paths', () => {
  assert.equal(projectLabel(contact('a', { project: 'shop', location: '~/worktrees/task-123' })), 'shop');
  assert.equal(projectLabel(contact('a', { project: '/Users/me/code/a-long-project-name/' })), 'a-long-project-name');
  assert.equal(projectLabel(contact('a', { location: 'C:\\Users\\me\\shop\\' })), 'shop');
  assert.equal(projectLabel(contact('a', { place: 'computer', project: 'home' })), 'This computer');
  assert.equal(projectLabel(contact('a')), 'Other Contacts');
});

// ---- cards --------------------------------------------------------------------------------------

test('a permission card asks in the provider’s words or its own, shows what to look at, and answers each button', () => {
  // Decline and Allow side by side, Allow last; Always allow apart from both, on a quieter row of its own (PH-10).
  const card = toolCard(
    { kind: 'tool', activity: { kind: 'command', command: 'rm -rf dist' }, canAlways: true },
    'Claude'
  );
  assert.equal(card.title, 'Claude would like to run a command.');
  assert.equal(card.detail, 'rm -rf dist');
  assert.deepEqual(
    card.choices.map(({ label, answer, primary, quiet }) => [label, answer.decision, Boolean(primary), Boolean(quiet)]),
    [
      ['Decline', 'deny', false, false],
      ['Allow', 'allow', true, false],
      ['Always allow, don’t ask again', 'always', false, true],
    ]
  );
  const once = toolCard(
    { kind: 'tool', title: 'Continue with Codex?', reason: 'Claude is out.', activity: { kind: 'app' } },
    'Claude'
  );
  assert.deepEqual(
    [once.title, once.reason, once.choices.map((c) => c.label)],
    ['Continue with Codex?', 'Claude is out.', ['Decline', 'Allow']]
  );
  const edit = toolCard(
    { kind: 'tool', activity: { kind: 'edit', path: '/p/a.js', changes: [{ before: 'a\nb', after: 'c' }] } },
    'Claude'
  );
  assert.equal(edit.title, 'Claude would like to edit a.js.');
  assert.equal(edit.detail, '- a\n- b\n+ c');
  assert.equal(
    toolCard({ kind: 'tool', activity: { kind: 'web', url: 'https://x.dev' } }, 'C').detail,
    'https://x.dev'
  );
  assert.equal(toolCard({ kind: 'tool', activity: { kind: 'read', path: '/p/a' }, detail: 'Why' }, 'C').detail, 'Why');
});

test('an Always allow that covers the rest of the conversation says so, and only a phone with full access offers it', () => {
  const prompt = {
    kind: 'tool',
    title: 'Allow Computer Use to use "Preview"?',
    activity: { kind: 'tool', label: 'MCP tool', source: 'cua_repl' },
    reason: 'Codex works read-only here, but that doesn’t cover Computer Use: if you allow it for this conversation, …',
    canAlways: true,
    alwaysLabel: 'Allow Computer Use in Preview for this conversation',
    alwaysScope: 'conversation',
  };
  const choices = (may) =>
    toolCard(prompt, 'Codex', may).choices.map(({ label, answer, quiet }) => [label, answer.decision, Boolean(quiet)]);
  // Full access: on its quiet row, by what it covers. The read-only seat's warning shows on the card.
  assert.deepEqual(choices({ always: true }), [
    ['Decline', 'deny', false],
    ['Allow', 'allow', false],
    ['Allow Computer Use in Preview for this conversation', 'always', true],
  ]);
  assert.equal(toolCard(prompt, 'Codex').reason, prompt.reason);
  // Answer only (and Read only, which answers nothing): Allow once or Decline, as for any Always allow (PH-50).
  assert.deepEqual(choices({ always: false }), [
    ['Decline', 'deny', false],
    ['Allow', 'allow', false],
  ]);
  // What it says once answered.
  assert.equal(
    answeredLine({ kind: 'tool', decision: 'always', title: prompt.title, scope: 'conversation' }, 'Codex'),
    'You allowed for this conversation: Allow Computer Use to use "Preview"?.'
  );
  assert.equal(
    answeredLine(
      { kind: 'tool', decision: 'always', activity: { kind: 'command', command: 'ls' }, scope: 'conversation' },
      'Codex'
    ),
    'You allowed Codex to run “ls” for the rest of this conversation.'
  );
});

test('questions are answered once each has an option picked or something written, which wins', () => {
  const questions = [
    { question: 'Which test runner?', options: [{ label: 'node:test' }, { label: 'Vitest' }], multiSelect: false },
    { question: 'Which checks?', options: [{ label: 'Lint' }, { label: 'Types' }], multiSelect: true },
  ];
  assert.equal(questionAnswer(questions, [{ chosen: ['Vitest'], other: '' }]), null);
  assert.equal(
    questionAnswer(questions, [
      { chosen: ['Vitest'], other: '' },
      { chosen: [], other: '  ' },
    ]),
    null
  );
  assert.deepEqual(
    questionAnswer(questions, [
      { chosen: ['Vitest'], other: '' },
      { chosen: ['Lint', 'Types'], other: '' },
    ]),
    {
      decision: 'answer',
      answers: { 'Which test runner?': 'Vitest', 'Which checks?': 'Lint, Types' },
    }
  );
  assert.deepEqual(
    questionAnswer(questions, [
      { chosen: ['Vitest'], other: ' Bun ' },
      { chosen: ['Lint'], other: '' },
    ]).answers,
    { 'Which test runner?': 'Bun', 'Which checks?': 'Lint' }
  );
  assert.equal(questionAnswer([], []), null);
});

test("a plan is approved in one of its provider's modes, or sent back to keep planning", () => {
  assert.deepEqual(
    planChoices(claude.planApprovals).map(({ label, answer }) => [label, answer]),
    claude.planApprovals.map(({ label, mode }) => [label, { decision: 'approve-plan', mode }])
  );
  assert.ok(planChoices(claude.planApprovals).some((choice) => choice.primary));
  assert.deepEqual(planChoices(undefined), []);
  assert.deepEqual(keepPlanning('  '), { decision: 'feedback', message: 'Keep planning.' });
  assert.deepEqual(keepPlanning(' use tokens '), {
    decision: 'feedback',
    message: 'Keep planning. Feedback: use tokens',
  });
});

test('a change to the instructions is saved or not, and every answer says itself afterwards', () => {
  const card = instructionsCard(
    {
      kind: 'instructions',
      activity: { kind: 'app' },
      instructions: { project: 'shop', part: 'Every conversation', before: '', after: 'Use pnpm.' },
    },
    'Claude'
  );
  assert.equal(card.title, 'Claude would like to change shop’s Every conversation instructions.');
  assert.equal(card.detail, 'Use pnpm.');
  assert.deepEqual(
    card.choices.map((c) => c.answer.decision),
    ['deny', 'allow']
  );
  // What was answered says so with the verb of the button that answered it, and what it was about (PH-45).
  const command = { kind: 'command', command: 'ls -la' };
  assert.equal(
    answeredLine({ kind: 'tool', decision: 'allow', activity: command }, 'Claude'),
    'You allowed Claude to run “ls -la”.'
  );
  assert.equal(
    answeredLine({ kind: 'tool', decision: 'always', activity: command }, 'Claude'),
    'You allowed Claude to run “ls -la”, and won’t be asked again.'
  );
  assert.equal(
    answeredLine({ kind: 'tool', decision: 'deny', activity: { kind: 'edit', path: '/p/a.js' } }, 'Claude'),
    'You declined: Claude wanted to edit a.js.'
  );
  assert.equal(
    answeredLine({ kind: 'tool', decision: 'deny', title: 'Fetch x.dev?' }, 'Claude'),
    'You declined: Fetch x.dev?.'
  );
  assert.equal(
    answeredLine(
      { kind: 'tool', decision: 'allow', activity: { kind: 'command', command: `npm test ${'x'.repeat(80)}` } },
      'C'
    ),
    `You allowed C to run “npm test ${'x'.repeat(51)}…”.`
  );
  assert.equal(
    answeredLine({ kind: 'plan', decision: 'approve-plan', plan: '# Dark theme' }, 'Claude'),
    'You approved Claude’s plan: Dark theme.'
  );
  assert.equal(
    answeredLine({ kind: 'plan', decision: 'feedback', plan: '# Dark theme' }, 'Claude'),
    'You asked Claude to keep planning: Dark theme.'
  );
  assert.equal(answeredLine({ kind: 'question', decision: 'skip' }, 'Claude'), 'You let Claude decide.');
  assert.equal(answeredLine({ kind: 'question', decision: 'answer' }, 'Claude'), 'You answered Claude’s question.');
  // One a manager answered for you says whose answer it was.
  const byManager = { id: 'm1', name: 'shop manager' };
  assert.equal(
    answeredLine({ kind: 'question', decision: 'answer', answeredBy: byManager }, 'Claude'),
    'shop manager answered Claude’s question.'
  );
  assert.equal(
    answeredLine(
      { kind: 'instructions', decision: 'cancelled', instructions: { project: 'shop', part: '' } },
      'Claude'
    ),
    'Not saved: the turn ended before you answered: Claude’s change to shop’s instructions.'
  );
});

// ---- the conversation -----------------------------------------------------------------------------

test('a conversation says how its turns ended, which of your messages wait, and whether Stop has anyone to stop', () => {
  assert.equal(resultLine({ isError: false, durationMs: 3200 }), 'Done in 3s');
  assert.equal(resultLine({ isError: true, stopped: true }), 'Stopped.');
  assert.equal(resultLine({ isError: true, errorText: 'The API is down' }), 'Stopped early: The API is down.');
  assert.equal(
    resultLine({ isError: true, errorText: 'Gemini stopped after too many steps in one turn.' }),
    'Stopped early: Gemini stopped after too many steps in one turn.',
    'one full stop, not two'
  );
  assert.equal(resultLine({ isError: true, usageLimited: true, errorText: '' }), 'Usage limit reached.');
  assert.deepEqual(queuedOf(['a', 'b', 'c'], 2), ['b', 'c']);
  assert.deepEqual(queuedOf(['a'], 0), []);
  assert.deepEqual(queuedOf(['a'], 3), ['a']);
  assert.deepEqual(['working', 'waiting', 'connecting', 'idle', 'offline'].map(canStop), [
    true,
    true,
    true,
    false,
    false,
  ]);
  // One with no session yet is "offline" by its state, and as reachable as ever.
  assert.deepEqual(
    ['working', 'waiting', 'connecting', 'idle', 'offline'].map((state) => stateLabel(state)),
    ['Working', 'Waiting for you', 'Starting', 'Online', 'Online']
  );
  assert.equal(stateLabel('idle', 'offline'), 'Offline', 'its folder is gone');
  assert.equal(stateLabel('working', 'offline'), 'Working');
});

test('a to-do list says how far along it is, and what is being done', () => {
  const todos = [
    { text: 'Read the cart', activeForm: 'Reading the cart', status: 'completed' },
    { text: 'Fix the count', activeForm: 'Fixing the count', status: 'in_progress' },
    { text: 'Run the tests', status: 'pending' },
  ];
  assert.equal(todoProgress(todos), '1 of 3 done · Fixing the count');
  assert.equal(todoProgress(todos.map((todo) => ({ ...todo, status: 'completed' }))), '3 of 3 done');
  assert.equal(todoProgress([{ text: 'Ship it', status: 'in_progress' }]), '0 of 1 done · Ship it');
});

test('a line is said by whoever it names, a guest that left by its saved name; nudges say who sent them', () => {
  const participants = [
    { id: 'host', name: 'Claude', avatar: 'claude' },
    { id: 'guest', name: 'Codex', avatar: 'codex' },
  ];
  assert.deepEqual(speakerOf(participants, {}), { name: 'Claude', avatar: 'claude' });
  assert.deepEqual(speakerOf(participants, { speaker: 'guest' }), { name: 'Codex', avatar: 'codex' });
  assert.deepEqual(speakerOf(participants, { speaker: 'gone', speakerName: 'Gemini' }), {
    name: 'Gemini',
    avatar: null,
  });
  // Your nudge is the app's Stop (see Conversations.interrupt): the phone says what it did (PH-17).
  assert.equal(signalLine({ kind: 'nudge', from: 'me' }, 'Claude'), 'You stopped it.');
  assert.equal(signalLine({ kind: 'nudge', from: 'c1' }, 'Claude'), 'Claude has just sent you a nudge.');
  assert.equal(signalLine({ kind: 'wink', from: 'c1' }, 'Claude'), 'Claude has just sent you a wink.');
});

// ---- the keyboard ---------------------------------------------------------------------------------

/**
 * An iPhone's window as its keyboard changes it: what is visible of it, how far iOS has scrolled the page, and a
 * conversation `lines` px long, in a box as tall as the app less its bars.
 */
const iPhone = ({ height = 874, bars = 190, lines = 3000, conversation = true } = {}) => {
  const props = new Map();
  const root = {
    style: { setProperty: (name, value) => props.set(name, value), getPropertyValue: (name) => props.get(name) ?? '' },
    dataset: {},
  };
  let top = 0;
  const transcript = {
    scrollHeight: lines,
    get clientHeight() {
      return parseFloat(props.get('--ph-height') ?? height) - bars;
    },
    get scrollTop() {
      return top;
    },
    // As in a browser: never past the end.
    set scrollTop(value) {
      top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight));
    },
    contains: (node) => node === field,
  };
  // A box in a card, in the conversation, and the message box below it.
  const revealed = [];
  const typedIn = (selector) => selector === 'input, textarea';
  const field = { matches: typedIn, scrollIntoView: (options) => revealed.push([props.get('--ph-height'), options]) };
  const box = { matches: typedIn, scrollIntoView: () => assert.fail('the message box is below the conversation') };
  const listeners = {};
  const scrolledBack = [];
  const win = {
    innerWidth: 402,
    innerHeight: height,
    scrollY: 0,
    scrollTo: (x, y) => {
      scrolledBack.push([x, y]);
      win.scrollY = y;
    },
    visualViewport: { height, scale: 1, addEventListener: (type, listener) => (listeners[type] ??= []).push(listener) },
    document: {
      documentElement: root,
      activeElement: null,
      querySelector: (selector) => (conversation && selector === '.ph-transcript' ? transcript : null),
    },
  };
  /** What is visible changes (and with iOS 26 the window, `inner`), or iOS scrolls the page, and `visualViewport`
   * says so. */
  const viewport = (
    type,
    { visible = win.visualViewport.height, scrolled = win.scrollY, scale = 1, ...window } = {}
  ) => {
    const { inner = win.innerHeight, width = win.innerWidth } = window;
    Object.assign(win.visualViewport, { height: visible, scale });
    Object.assign(win, { scrollY: scrolled, innerHeight: inner, innerWidth: width });
    for (const listener of listeners[type] ?? []) listener();
  };
  return {
    win,
    root,
    transcript,
    field,
    box,
    revealed,
    viewport,
    scrolledBack,
    height: () => props.get('--ph-height'),
  };
};

test('the app fits above the iOS keyboard, and the page iOS scrolls up to show the box is put back', () => {
  const { win, root, box, viewport, scrolledBack, height } = iPhone();
  followKeyboard(win);
  assert.equal(height(), '874px');
  assert.equal('keyboard' in root.dataset, false);
  assert.deepEqual(scrolledBack, [], 'nothing to put back');
  // The box is tapped: the keyboard takes 336 px, and iOS scrolls the page up as much again to show the box.
  win.document.activeElement = box;
  viewport('resize', { visible: 538, scrolled: 336 });
  assert.equal(height(), '538px');
  assert.equal(root.dataset.keyboard, '');
  assert.equal(win.scrollY, 0);
  // It scrolls again as the keyboard settles, which `visualViewport` tells as a scroll.
  viewport('scroll', { scrolled: 52 });
  assert.equal(win.scrollY, 0);
  assert.deepEqual(scrolledBack, [
    [0, 0],
    [0, 0],
  ]);
  // The keyboard goes: the whole screen again.
  viewport('resize', { visible: 874, scrolled: 0 });
  assert.equal(height(), '874px');
  assert.equal('keyboard' in root.dataset, false);
  assert.equal(scrolledBack.length, 2);
});

test('a conversation read to its end stays at its end as the keyboard comes up; one read further back stays put', () => {
  const end = iPhone();
  end.transcript.scrollTop = Infinity;
  followKeyboard(end.win);
  end.viewport('resize', { visible: 538, scrolled: 336 });
  assert.equal(end.transcript.scrollTop, end.transcript.scrollHeight - end.transcript.clientHeight);
  const back = iPhone();
  back.transcript.scrollTop = 1200;
  followKeyboard(back.win);
  back.viewport('resize', { visible: 538, scrolled: 336 });
  assert.equal(back.transcript.scrollTop, 1200);
  // Home has no conversation to keep, and its page is put back all the same.
  const home = iPhone({ conversation: false });
  followKeyboard(home.win);
  home.viewport('resize', { visible: 538, scrolled: 336 });
  assert.equal(home.win.scrollY, 0);
});

test('a box tapped in a card stays in sight as the conversation gets shorter, and is left alone after that', () => {
  const card = iPhone();
  followKeyboard(card.win);
  card.win.document.activeElement = card.field;
  // iOS scrolls the whole page to show it, which is put back: the conversation shows it instead.
  card.viewport('resize', { visible: 538, scrolled: 403 });
  assert.deepEqual(card.revealed, [['538px', { block: 'nearest' }]]);
  assert.equal(card.win.scrollY, 0);
  // A scroll of the page alone leaves the conversation where the reader has it.
  card.viewport('scroll', { scrolled: 40 });
  assert.equal(card.revealed.length, 1);
  assert.equal(card.win.scrollY, 0);
  // The message box is below the conversation, in sight already.
  const message = iPhone();
  followKeyboard(message.win);
  message.win.document.activeElement = message.box;
  message.viewport('resize', { visible: 538, scrolled: 336 });
  assert.equal(message.win.scrollY, 0);
});

test('the keyboard is told by how much of the screen is left, upright or on its side, as iOS 26 shortens the window too', () => {
  const phone = iPhone({ height: 812 });
  followKeyboard(phone.win);
  phone.win.document.activeElement = phone.box;
  phone.viewport('resize', { visible: 409, inner: 409 });
  assert.equal(phone.height(), '409px');
  assert.equal(phone.root.dataset.keyboard, '');
  phone.viewport('resize', { visible: 812, inner: 812 });
  assert.equal('keyboard' in phone.root.dataset, false);
  // Turned on its side, the box still in focus: as tall as it is that way, then the keyboard.
  phone.viewport('resize', { visible: 402, inner: 402, width: 874 });
  assert.equal('keyboard' in phone.root.dataset, false);
  phone.viewport('resize', { visible: 126, inner: 126, width: 874 });
  assert.equal(phone.root.dataset.keyboard, '');
  // A computer's window made shorter, with nothing typed in, is just shorter.
  const computer = iPhone({ height: 900 });
  followKeyboard(computer.win);
  computer.viewport('resize', { visible: 600, inner: 600 });
  assert.equal(computer.height(), '600px');
  assert.equal('keyboard' in computer.root.dataset, false);
});

test('Safari’s bars coming and going are not the keyboard, and a reader zoomed in moves about the page freely', () => {
  const { win, root, box, viewport, scrolledBack, height } = iPhone();
  followKeyboard(win);
  win.document.activeElement = box;
  viewport('resize', { visible: 820 });
  assert.equal(height(), '820px');
  assert.equal('keyboard' in root.dataset, false);
  // Pinched to twice the size: half as much is visible, and the reader pans down the page.
  viewport('resize', { visible: 437, scale: 2 });
  viewport('scroll', { visible: 437, scale: 2, scrolled: 200 });
  assert.equal('keyboard' in root.dataset, false);
  assert.equal(win.scrollY, 200);
  assert.deepEqual(scrolledBack, []);
  // A browser without `visualViewport` has the app as tall as its window.
  const props = new Map();
  followKeyboard({
    innerHeight: 700,
    scrollY: 0,
    scrollTo: () => assert.fail('nothing to put back'),
    document: {
      documentElement: { style: { setProperty: (n, v) => props.set(n, v) }, dataset: {} },
      querySelector: () => null,
    },
  });
  assert.equal(props.get('--ph-height'), '700px');
});

// ---- its look -------------------------------------------------------------------------------------

const read = (file) => fs.readFileSync(new URL(`../src/renderer/${file}`, import.meta.url), 'utf8');
const NIGHT = '@media (prefers-color-scheme: dark)';
const declared = (css) => new Set([...css.matchAll(/^\s*(--[\w-]+):/gm)].map(([, name]) => name));

test("the phone app is drawn in the professional look's own roles, by day and at night", () => {
  const css = read('phone/phone.css');
  const [day, night] = read('styles/pro-theme.css').split(NIGHT).map(declared);
  const own = declared(css);
  const used = new Set(
    [...css.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)].map(([, name, fallback]) => {
      assert.ok(!fallback, `${name} has a default of its own: the palettes would not turn it`);
      return name;
    })
  );
  assert.ok(used.size > 30);
  for (const name of used) {
    if (own.has(name)) continue;
    assert.ok(day.has(name), `${name} is no role of the professional look`);
    if (!name.startsWith('--font')) assert.ok(night.has(name), `${name} has no colour at night`);
  }
});

test('a phone whose browser has no notifications says why: an iPhone’s Safari needs the Home Screen copy', async (t) => {
  // install.js listens for a browser's offer to install, as it loads.
  const had = globalThis.addEventListener;
  globalThis.addEventListener ??= () => {};
  t.after(() => (globalThis.addEventListener = had));
  const { withoutPush } = await import('../src/renderer/phone/notifications.js');
  assert.equal(withoutPush({ apple: true, installed: false }), 'home-screen');
  // The Home Screen copy without them is an iOS before 16.4.
  assert.equal(withoutPush({ apple: true, installed: true }), 'old-ios');
  assert.equal(withoutPush({ apple: false, installed: false }), 'unsupported');
  assert.equal(withoutPush({ apple: false, installed: true }), 'unsupported');
});

test('the number on the phone app’s icon is who waits for you, as Home’s first section counts them', () => {
  const views = [
    { id: 'a', name: 'asks', status: 'away', prompt: { kind: 'tool', title: 'x' } },
    { id: 'b', name: 'finished', status: 'online', unread: 2 },
    { id: 'c', name: 'works', status: 'busy', unread: 1 },
    { id: 'd', name: 'idle', status: 'online' },
    { id: 'e', name: 'put away', status: 'away', archived: true, prompt: { kind: 'tool', title: 'x' } },
  ];
  assert.equal(waitingCount(views), 2);
  assert.equal(waitingCount(views), homeSections(views)[0].members.length);
  assert.equal(waitingCount([]), 0);
});
