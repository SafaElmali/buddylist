import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backgroundStatus, runningOf, runningWhat } from '../src/shared/background.js';
import { describeActivity } from '../src/renderer/chat/activity.js';
import {
  Background,
  READ_EVERY_MS,
  doing,
  endedNote,
  listedOf,
  nobodyNote,
  ordered,
  outputText,
  summary,
  tagOf,
  timeOf,
} from '../src/renderer/chat/background.js';
import { clock } from '../src/renderer/lib/format.js';

const task = (id, more = {}) => ({
  id,
  kind: 'command',
  label: `Run ${id}`,
  command: `npm run ${id}`,
  status: 'running',
  started: 1000,
  ended: null,
  ...more,
});
const of = (...statuses) => statuses.map((status, i) => task(`t${i}`, { status }));

// ---- in words ----------------------------------------------------------------------------------

test('what runs is counted by kind, and what ended is not', () => {
  assert.equal(runningWhat([]), '');
  assert.equal(runningWhat(undefined), '');
  assert.equal(runningWhat([task('a')]), 'a command');
  assert.equal(runningWhat([task('a'), task('b'), task('c', { kind: 'watcher' })]), '2 commands and a watcher');
  assert.equal(runningWhat([task('w', { kind: 'watcher' }), task('v', { kind: 'watcher' })]), '2 watchers');
  assert.equal(runningWhat([task('a', { status: 'done' }), task('b', { status: 'stopped' })]), '');
  assert.deepEqual(
    runningOf(of('running', 'done', 'running')).map((t) => t.id),
    ['t0', 't2']
  );
});

test('the contact list says it as a line of its own, and nothing once it all ended', () => {
  assert.equal(backgroundStatus([task('a')]), 'A command running in the background');
  assert.equal(
    backgroundStatus([task('a'), task('b', { kind: 'watcher' })]),
    'A command and a watcher running in the background'
  );
  assert.equal(backgroundStatus([task('a', { status: 'failed' })]), '');
  assert.equal(backgroundStatus(), '');
});

test('a command that goes on in the background says so in the conversation', () => {
  // What it says is trusted markup: the text of it, without its tags.
  const said = (activity) => {
    const markup = describeActivity(activity, '/p');
    const [text] = Object.getOwnPropertySymbols(markup).map((key) => markup[key]);
    return text.replace(/<[^>]+>/g, '');
  };
  assert.equal(
    said({ kind: 'command', command: 'npm run dev', background: true }),
    'started npm run dev in the background'
  );
  assert.equal(said({ kind: 'command', command: 'npm test' }), 'ran npm test');
});

// ---- the tab -----------------------------------------------------------------------------------

test('everyone’s tasks are listed in the order they started, each known apart from another agent’s', () => {
  const claude = { id: 'c', name: 'Claude', background: [task('a', { started: 3000 }), task('b', { started: 1000 })] };
  const opus = { id: 'o', name: 'Opus', background: [task('a', { started: 2000 })] };
  const codex = { id: 'x', name: 'Codex' };
  assert.deepEqual(
    listedOf([claude, opus, codex]).map(({ key, by, speaker }) => [key, by, speaker]),
    [
      ['c:b', 'Claude', 'c'],
      ['o:a', 'Opus', 'o'],
      ['c:a', 'Claude', 'c'],
    ]
  );
  assert.deepEqual(listedOf([codex]), []);
});

test('the ones that run come first, as they started, then the ones that ended, newest on top', () => {
  const tasks = [
    task('a', { status: 'done' }),
    task('b'),
    task('c', { status: 'stopped' }),
    task('d'),
    task('e', { status: 'failed' }),
  ];
  assert.deepEqual(
    ordered(tasks).map((t) => t.id),
    ['b', 'd', 'e', 'c', 'a']
  );
});

test('the line at the top counts what runs, and how many ended', () => {
  assert.equal(summary(of('running', 'running', 'done')), '2 running');
  assert.equal(summary(of('done', 'stopped')), 'Nothing running');
  assert.equal(summary([]), 'Nothing yet');
  assert.equal(endedNote(of('running', 'done', 'failed')), '2 ended');
  assert.equal(endedNote(of('running')), '');
});

test('a task’s time is how long it has run, or ran', () => {
  assert.equal(timeOf(task('a'), 61_000), clock(60_000));
  assert.equal(timeOf(task('a', { status: 'done', ended: 4000 }), 99_000), clock(3000));
  assert.equal(timeOf(task('a', { status: 'stopped', ended: null }), 99_000), '', 'nobody said when');
});

test('under its name: that it runs, or how it ended, in its agent’s words where it said', () => {
  assert.equal(doing(task('a')), 'Running in the background');
  assert.equal(doing(task('a', { status: 'done' })), 'Finished');
  assert.equal(doing(task('a', { status: 'failed' })), 'Failed');
  assert.equal(doing(task('a', { status: 'stopped' })), 'Stopped');
  assert.equal(
    doing(task('a', { status: 'done', summary: 'Background command "npm test" completed (exit code 0)' })),
    'Background command "npm test" completed (exit code 0)'
  );
});

test('the tag says its kind, and whose it is with several agents here', () => {
  assert.equal(tagOf({ kind: 'command', by: 'Claude' }, false), 'Command');
  assert.equal(tagOf({ kind: 'watcher', by: 'Opus' }, true), 'Watcher for Opus');
});

test('without anything to list, the tab says whose would be listed', () => {
  assert.match(nobodyNote(['Claude']), /^Nothing has run in the background yet\. When Claude starts a command/);
  assert.match(nobodyNote(['Claude', 'Opus']), /When an agent here starts/);
  assert.match(nobodyNote([]), /When an agent here starts/);
});

test('what it printed is shown as it was read, and says so while there is nothing to show', () => {
  assert.equal(outputText('✓ build\n✓ test\n\n', true), '✓ build\n✓ test');
  assert.equal(outputText(null, true), 'Reading what it printed…');
  assert.equal(outputText(null, false), 'What it printed can no longer be read.');
  assert.equal(outputText('', true), 'Nothing printed yet.');
  assert.equal(outputText('  \n', false), 'It printed nothing.');
});

// The tab needs named children and text writes, not layout, to exercise its polling lifecycle.
class BackgroundNode {
  nodes = new Map();
  writes = 0;
  scrollTop = 0;
  clientHeight = 100;
  scrollHeight = 100;
  classList = { toggle() {} };

  querySelector(selector) {
    if (!this.nodes.has(selector)) this.nodes.set(selector, new BackgroundNode());
    return this.nodes.get(selector);
  }

  set textContent(value) {
    this.text = value;
    this.writes += 1;
  }

  replaceChildren(...children) {
    this.children = children;
  }

  addEventListener() {}
  setAttribute() {}
  scrollIntoView() {}
}

function backgroundTab(t, output = async () => ({ output: 'still running' })) {
  const savedDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ content: { firstElementChild: new BackgroundNode() } }) };
  t.after(() => {
    if (savedDocument === undefined) delete globalThis.document;
    else globalThis.document = savedDocument;
  });
  t.mock.timers.enable({ apis: ['setInterval'] });
  const pane = {
    selected: null,
    shows(id) {
      return this.selected === id;
    },
    open(tab) {
      const changed = this.selected !== tab.id;
      this.selected = tab.id;
      if (changed) tab.onSelect?.();
    },
  };
  const ctx = {
    participants: [
      { id: 'c', name: 'Claude', provider: { background: true }, background: [task('a', { toolId: 'tool' })] },
    ],
  };
  let reads = 0;
  const background = new Background(pane, ctx, {
    stop: async () => {},
    output: async (...args) => {
      reads += 1;
      return output(...args);
    },
  });
  background.update();
  const time = background.list.children[0].querySelector('.helper-time');
  const tick = async (ms = READ_EVERY_MS) => {
    t.mock.timers.tick(ms);
    await new Promise(setImmediate);
  };
  return { background, pane, ctx, time, tick, reads: () => reads };
}

test('background clocks and output reads pause while its tab is hidden and catch up when selected', async (t) => {
  const { background, pane, time, tick, reads } = backgroundTab(t);
  const initialWrites = time.writes;
  await tick(60_000);
  assert.equal(time.writes, initialWrites, 'a tab never opened does no clock work');

  background.reveal('tool');
  await tick();
  assert.equal(reads(), 1, 'opening a row reads its output');
  await tick();
  assert.equal(reads(), 2, 'an expanded visible row continues reading');

  pane.selected = 'changes';
  const hiddenWrites = time.writes;
  const hiddenReads = reads();
  for (let i = 0; i < 30; i += 1) await tick();
  assert.equal(reads() - hiddenReads, 0, 'a minute on another tab makes no output requests');
  assert.equal(time.writes - hiddenWrites, 0, 'a hidden tab does no elapsed-time writes');

  background.show();
  await new Promise(setImmediate);
  assert.equal(reads(), hiddenReads + 1, 'returning reads immediately');
  assert.equal(time.writes, hiddenWrites + 1, 'returning updates elapsed time immediately');
  await tick();
  assert.equal(reads(), hiddenReads + 2, 'polling resumes');

  pane.selected = null;
  const closedReads = reads();
  await tick(60_000);
  assert.equal(reads(), closedReads, 'closing the pane also pauses reads');
});

test('an expanded background task is read one last time when it ends while hidden', async (t) => {
  const { background, pane, ctx, tick, reads } = backgroundTab(t);
  background.reveal('tool');
  await tick();
  pane.selected = 'changes';
  ctx.participants[0].background[0] = task('a', { toolId: 'tool', status: 'done', ended: 4000 });
  background.update();
  await new Promise(setImmediate);
  assert.equal(reads(), 2, 'the final output is kept before its agent goes away');
  await tick(60_000);
  assert.equal(reads(), 2, 'an ended task is not polled');
});
