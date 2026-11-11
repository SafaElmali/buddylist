import { test } from 'node:test';
import assert from 'node:assert/strict';

// The module is the conversation window's: it reaches for the bridge when it loads.
globalThis.window ??= { messenger: {} };
const {
  howItEnded,
  oneLine,
  portText,
  projectSettingsItems,
  RunCommand,
  runButton,
  runMenuItems,
  startedText,
  waitingText,
} = await import('../src/renderer/chat/run.js');

const run = (extra = {}) => ({
  id: 'r1',
  command: 'pnpm dev',
  port: 4100,
  movedFrom: null,
  startedAt: 0,
  output: '',
  ended: null,
  ...extra,
});

test('the button says Run until something runs', () => {
  const idle = runButton(null);
  assert.deepEqual([idle.label, idle.running], ['Run', false]);
  assert.match(idle.title, /port of its own/);
});

test('while a command runs the button stops it, and says which command and where', () => {
  const face = runButton(run());
  assert.deepEqual([face.label, face.running], ['Stop Run', true]);
  assert.equal(face.title, 'Stop pnpm dev, which is running on port 4100');
  // Not to be taken for the Stop button, which stops the agent.
  assert.notEqual(face.label, 'Stop');
});

test('once the command has ended the button is Run again', () => {
  const ended = run({ ended: { code: 1, signal: null, stopped: false } });
  assert.deepEqual(runButton(ended), runButton(null));
});

test('a very long command is cut short in the button’s tooltip', () => {
  const { title } = runButton(run({ command: `FOO=1 ${'x'.repeat(500)}` }));
  assert.ok(title.length < 160);
  assert.match(title, /…/);
});

test('a command of a few lines is shown on one line, each after the one before', () => {
  const few = run({ command: 'pnpm install\n\n  pnpm dev --port $PORT\n' });
  assert.equal(oneLine(few.command), 'pnpm install ↵ pnpm dev --port $PORT');
  assert.equal(runButton(few).title, 'Stop pnpm install ↵ pnpm dev --port $PORT, which is running on port 4100');
  assert.equal(
    words(startedText(few)),
    'You started pnpm install ↵ pnpm dev --port $PORT on port 4100: http://localhost:4100'
  );
});

test('the line says which port, and why it is not the one before', () => {
  assert.equal(portText(run()), 'port 4100');
  assert.equal(portText(run({ port: 4110, movedFrom: 4100 })), 'port 4110, because 4100 was taken by something else');
});

test('how it ended: stopped, done, failed with its exit code, or ended by a signal', () => {
  assert.deepEqual(howItEnded({ code: null, signal: 'SIGTERM', stopped: true }), {
    text: 'was stopped',
    failed: false,
  });
  assert.deepEqual(howItEnded({ code: 0, signal: null, stopped: false }), { text: 'has ended', failed: false });
  assert.deepEqual(howItEnded({ code: 1, signal: null, stopped: false }), {
    text: 'ended with exit code 1',
    failed: true,
  });
  assert.deepEqual(howItEnded({ code: null, signal: 'SIGKILL', stopped: false }), {
    text: 'was ended by SIGKILL',
    failed: true,
  });
  // A command that was stopped and then exits with an error on its way out did not fail.
  assert.equal(howItEnded({ code: 130, signal: null, stopped: true }).failed, false);
});

test('the Code menu has the button’s action and the way to change the command', () => {
  const done = [];
  const actions = { toggle: () => done.push('toggle'), change: () => done.push('change') };
  const idle = runMenuItems(null, actions);
  assert.deepEqual(
    idle.map((item) => (item.separator ? '-' : item.label)),
    ['Run this project', 'Change the run command...']
  );
  const running = runMenuItems(run(), actions);
  assert.equal(running[0].label, 'Stop running pnpm dev');
  for (const item of running) item.action?.();
  assert.deepEqual(done, ['toggle', 'change']);
});

// What html`` made: the page takes it as markup, and the tests read it as text.
const markup = (value) => Object.getOwnPropertySymbols(value).map((key) => value[key])[0];
const words = (value) =>
  markup(value)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

test('the menu lists the project’s other scripts, each to start or to stop', () => {
  const done = [];
  const actions = { toggle: () => done.push('toggle'), change: () => done.push('change') };
  const others = [
    { name: 'Tests', running: false, toggle: () => done.push('tests') },
    { name: 'Storybook', running: true, toggle: () => done.push('storybook') },
  ];
  const items = runMenuItems(null, actions, others);
  assert.deepEqual(
    items.map((item) => (item.separator ? '-' : item.label)),
    ['Run this project', 'Run Tests', 'Stop Storybook', 'Change the run command...']
  );
  for (const item of items) item.action?.();
  assert.deepEqual(done, ['toggle', 'tests', 'storybook', 'change']);
});

test('the way to the project’s settings opens them at its scripts, and its instructions at their page', () => {
  const done = [];
  const items = projectSettingsItems((section = 'scripts') => done.push(`settings:${section}`));
  assert.deepEqual(
    items.map((item) => item.label),
    ['Project settings...', 'Project instructions...']
  );
  for (const item of items) item.action?.();
  assert.deepEqual(done, ['settings:scripts', 'settings:instructions']);
});

test('where there is no Settings window, as in the browser preview, the menu does not offer one', () => {
  assert.deepEqual(projectSettingsItems(null), []);
});

test('a run’s line links to where its project says it is looked at, the first page first', () => {
  const plain = startedText(run({ kind: 'run', urls: [{ name: '', url: 'http://localhost:4100' }] }));
  assert.equal(words(plain), 'You started pnpm dev on port 4100: http://localhost:4100');
  const named = startedText(
    run({
      kind: 'run',
      urls: [
        { name: '', url: 'https://localhost:4100' },
        { name: 'Admin', url: 'http://localhost:4101/admin' },
      ],
    })
  );
  assert.equal(words(named), 'You started pnpm dev on port 4100: https://localhost:4100, Admin');
  assert.match(markup(named), /<a href="https:\/\/localhost:4100">/);
  assert.match(markup(named), /<a href="http:\/\/localhost:4101\/admin">Admin<\/a>/);
  // A run from before a run said where it is looked at: its port is where.
  assert.equal(words(startedText(run())), 'You started pnpm dev on port 4100: http://localhost:4100');
});

test('a setup script’s line says what it is for, and names no port or page', () => {
  const line = startedText(run({ kind: 'setup', command: 'pnpm install', urls: [] }));
  assert.equal(words(line), 'Setting up this worktree with pnpm install');
  assert.doesNotMatch(markup(line), /href|port/);
});

test('a worktree whose setup waits has a line that says the script waits for the user, and why', () => {
  const line = waitingText('pnpm install');
  assert.equal(
    words(line),
    'This worktree is not set up yet: its setup script, pnpm install, would run code that is not on the project’s own branches, such as a pull request’s. Press Run setup in the Setup tab once you have looked it over.'
  );
  assert.doesNotMatch(markup(waitingText('echo "<img src=x>"')), /<img/);
});

test('what a command printed into its own name is never markup', () => {
  const line = startedText(
    run({ kind: 'run', command: 'echo "<img src=x>"', urls: [{ name: '<b>x</b>', url: 'http://a.test/"' }] })
  );
  assert.doesNotMatch(markup(line), /<img|<b>/);
  assert.match(markup(line), /&lt;img src=x&gt;/);
});

// ---- the Setup and Run tabs beside the conversation ------------------------------------------------

const { scriptButtons, tabState } = await import('../src/renderer/chat/script-tabs.js');

test('a tab offers to add the script a project has none of, and to run the one it has', () => {
  assert.equal(tabState({ has: false, runs: [], editing: false }), 'add');
  assert.equal(tabState({ has: true, runs: [], editing: false }), 'ready');
  // Once something ran, what it printed is what there is to show.
  assert.equal(tabState({ has: true, runs: [{}], editing: false }), 'output');
  // Also for a script that was taken away since: its output is still there to read.
  assert.equal(tabState({ has: false, runs: [{}], editing: false }), 'output');
  for (const has of [true, false]) assert.equal(tabState({ has, runs: [{}], editing: true }), 'edit');
});

test('the Setup tab has one button: run it, run it again, or stop it', () => {
  const none = { setup: '', scripts: [], runs: [] };
  assert.deepEqual(scriptButtons('setup', none), [], 'no script, nothing to run');
  const ready = { setup: 'pnpm install', scripts: [], runs: [] };
  assert.deepEqual(scriptButtons('setup', ready), [{ script: 'setup', label: 'Run setup', running: false }]);
  const going = { ...ready, runs: [{ run: run({ kind: 'setup', script: 'setup' }) }] };
  assert.deepEqual(scriptButtons('setup', going), [{ script: 'setup', label: 'Stop setup', running: true }]);
  const ended = { code: 0, signal: null, stopped: false };
  const done = { ...ready, runs: [{ run: run({ script: 'setup', ended }) }] };
  assert.deepEqual(scriptButtons('setup', done), [{ script: 'setup', label: 'Run setup again', running: false }]);
});

test('the Run tab has a button for each of the project’s scripts, the first being Run itself', () => {
  const scripts = [
    { id: 'dev', name: 'Dev server' },
    { id: 'tests', name: 'Tests' },
  ];
  assert.deepEqual(scriptButtons('run', { setup: '', scripts, runs: [] }), [
    { script: 'dev', label: 'Run', running: false },
    { script: 'tests', label: 'Run Tests', running: false },
  ]);
  const runs = [
    { run: run({ script: 'tests' }) },
    // One that has ended is not running, whatever it was.
    { run: run({ script: 'dev', ended: { code: 1, signal: null, stopped: false } }) },
  ];
  assert.deepEqual(scriptButtons('run', { setup: '', scripts, runs }), [
    { script: 'dev', label: 'Run', running: false },
    { script: 'tests', label: 'Stop Tests', running: true },
  ]);
  assert.deepEqual(scriptButtons('run', { setup: 'make', scripts: [], runs: [] }), []);
});

test('the scripts that printed something can go with a message: the newest run of each, under its name', async (t) => {
  const { page } = await import('./fixtures/dom.js');
  const document = page(t);
  document.querySelector = (selector) => document.body.querySelector(selector);
  Object.assign(globalThis.window.messenger, {
    on: { run: () => {}, project: () => {} },
    run: {
      state: async () => [
        run({ id: 'r1', script: 'web', kind: 'run', output: 'old' }),
        run({ id: 's1', script: 'setup', kind: 'setup', output: 'installed' }),
        run({ id: 'r2', script: 'web', kind: 'run', output: 'ready on port 4100\n' }),
      ],
      scripts: async () => ({
        project: 'shop',
        setup: 'pnpm install',
        scripts: [
          { id: 'web', name: 'Run', command: 'pnpm dev' },
          { id: 'test', name: 'test', command: 'pnpm test' },
        ],
      }),
    },
    projects: { of: async () => ({ key: 'git:/w/shop/.git' }) },
  });
  const conversation = { append() {}, line: () => document.createElement('div'), addError() {} };
  const runs = new RunCommand(conversation, { contactId: 'c1' });
  await runs.attach();
  assert.deepEqual(runs.outputs(), [
    { kind: 'script', id: 'setup', name: 'Setup' },
    { kind: 'script', id: 'web', name: 'Run' },
  ]);
  assert.deepEqual(runs.output('web'), { name: 'Run', text: 'ready on port 4100\n' });
  assert.deepEqual(runs.output('setup'), { name: 'Setup', text: 'installed' });
  assert.equal(runs.output('test'), null, 'a script that never ran here has nothing to hand over');
});
