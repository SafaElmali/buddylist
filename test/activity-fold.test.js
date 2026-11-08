import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ActivityLines,
  foldPictures,
  foldPlans,
  foldSays,
  OPENED_AT_MOST,
  outcomeOf,
  tally,
} from '../src/renderer/chat/activity.js';
import { Conversation } from '../src/renderer/chat/conversation.js';
import { page } from './fixtures/dom.js';

const run = (command) => ({ kind: 'command', command });
const read = (path) => ({ kind: 'read', path });
const edit = (path) => ({ kind: 'edit', path });
const step = (activity, pending = false) => ({ activity, pending, since: 0 });

// ---- what a run of calls came to ---------------------------------------------------------------------

test('a run is told by what was done, in the order of the kinds', () => {
  assert.equal(
    tally([read('a.js'), run('ls'), edit('a.js'), run('npm test'), read('b.js'), run('git status')]),
    'ran 3 commands, read 2 files and edited a file'
  );
});

test('one of a kind is "a" one', () => {
  assert.equal(tally([run('ls'), read('a.js')]), 'ran a command and read a file');
});

test('a command left running in the background was started, not run', () => {
  const left = (command) => ({ kind: 'command', command, background: true });
  assert.equal(tally([left('npm run dev'), left('gh run watch')]), 'started 2 commands in the background');
  assert.equal(
    tally([run('npm test'), left('npm run dev'), read('a.js')]),
    'ran a command, started a command in the background and read a file'
  );
});

test('a file read or edited again is counted once, and writing one is editing it', () => {
  assert.equal(tally([read('a.js'), read('a.js')]), 'read a file');
  assert.equal(tally([{ kind: 'write', path: 'new.js' }, edit('new.js'), edit('old.js')]), 'edited 2 files');
});

test('searches and the web are said by how often', () => {
  const search = { kind: 'search', query: 'TODO' };
  const web = { kind: 'web', url: 'https://example.com' };
  assert.equal(tally([search, search]), 'searched the project twice');
  assert.equal(tally([web, web, web, search]), 'searched the project and browsed the web 3 times');
});

test('helpers and skills are named', () => {
  const helper = { kind: 'delegate', label: 'Count the files' };
  assert.equal(tally([helper, helper]), 'asked 2 subagents');
  assert.equal(tally([{ kind: 'skill', label: 'tdd' }, run('ls')]), 'ran a command and used the tdd skill');
  assert.equal(
    tally([
      { kind: 'skill', label: 'tdd' },
      { kind: 'skill', label: 'ship' },
    ]),
    'used 2 skills'
  );
});

test('any other call is a tool, and "other" beside the ones that are named', () => {
  const plan = { kind: 'plan' };
  const mcp = { kind: 'mcp', label: 'search_docs', source: 'Docs' };
  assert.equal(tally([plan, mcp]), 'used 2 tools');
  assert.equal(tally([run('ls'), mcp]), 'ran a command and used one other tool');
  assert.equal(tally([run('ls'), mcp, plan]), 'ran a command and used 2 other tools');
});

// ---- what the line of a run says ---------------------------------------------------------------------

test('a call of the agent’s own going on is counted once it is over: the line under the newest says it', () => {
  assert.equal(foldSays('Claude', [step(read('src/a.js')), step(run('npm test'), true)]), 'Claude read a file');
  assert.equal(
    foldSays('Claude', [step(read('src/a.js')), step(run('npm test'))]),
    'Claude ran a command and read a file'
  );
});

test('a run of calls that are all going on is counted as it is', () => {
  const steps = [step(read('src/a.js'), true), step(read('src/b.js'), true)];
  assert.equal(foldSays('Claude', steps), 'Claude read 2 files');
});

test('a run with nothing going on says what it came to', () => {
  assert.equal(foldSays('Codex', [step(run('ls')), step(read('a.js'))]), 'Codex ran a command and read a file');
});

// ---- a helper's steps are the helper's ---------------------------------------------------------------

const ASKED = { kind: 'delegate', label: 'Look around' };
const byHelper = (activity, helper, pending = false) => ({ ...step(activity, pending), sub: true, helper });

test('a step a helper is taking is said to be the helper’s', () => {
  const steps = [step(ASKED, true), byHelper(read('src/b.js'), 'h1', true)];
  assert.equal(foldSays('Claude', steps), 'A subagent is reading b.js');
});

test('what the agent did is counted without its helpers’ steps', () => {
  const steps = [step(ASKED), byHelper(read('a.js'), 'h1'), byHelper(run('npm test'), 'h1'), step(run('ls'))];
  assert.equal(foldSays('Claude', steps), 'Claude ran a command and asked a subagent');
});

test('a run of nothing but helpers’ steps is theirs', () => {
  assert.equal(
    foldSays('Claude', [byHelper(run('ls'), 'h1'), byHelper(read('a.js'), 'h1')]),
    'A subagent ran a command and read a file'
  );
  assert.equal(
    foldSays('Claude', [byHelper(run('ls'), 'h1'), byHelper(run('pwd'), 'h2')]),
    '2 subagents ran 2 commands'
  );
});

test('a run shows the pictures its calls handed back, in the order the calls were made', () => {
  const steps = [
    { ...step(read('a.png')), pictures: ['data:image/png;base64,AAAA'] },
    step(run('ls')),
    { ...step(run('screenshot')), pictures: ['data:image/jpeg;base64,BBBB', 'data:image/jpeg;base64,CCCC'] },
  ];
  assert.deepEqual(foldPictures(steps), [
    'data:image/png;base64,AAAA',
    'data:image/jpeg;base64,BBBB',
    'data:image/jpeg;base64,CCCC',
  ]);
  assert.deepEqual(foldPictures([step(run('ls'))]), []);
});

test('a run shows each plan its calls wrote to once, in the order they were first written to', () => {
  const steps = [
    { ...step(edit('COM-630-plan.md')), plan: 'COM-630-plan.md' },
    step(run('ls')),
    { ...step(edit('docs/plans/auth.md')), plan: 'docs/plans/auth.md' },
    { ...step(edit('COM-630-plan.md')), plan: 'COM-630-plan.md' },
  ];
  assert.deepEqual(foldPlans(steps), ['COM-630-plan.md', 'docs/plans/auth.md']);
  assert.deepEqual(foldPlans([step(edit('a.js')), step(run('ls'))]), []);
});

test('a call’s line says what it came to: a question you skipped was skipped, not declined or failed', () => {
  assert.equal(outcomeOf({ isError: true, declined: false, skipped: true }), 'skipped');
  assert.equal(outcomeOf({ isError: true, declined: true }), 'declined');
  assert.equal(outcomeOf({ isError: false, declined: false, stopped: true }), 'stopped');
  assert.equal(outcomeOf({ isError: true, declined: false }), 'failed');
  assert.equal(outcomeOf({ isError: false, declined: false }), '', 'one that went through says nothing more');
});

// ---- what was opened, opened again ----------------------------------------------------------------

/** A command's call, as the conversation's history keeps it, with what it printed. */
const call = (toolId, command) => ({ kind: 'tool', toolId, activity: run(command), output: `${command}: done` });

/** A conversation drawn from its history in a page: runs of calls, a notice between each two. */
function transcript(t, runs) {
  const document = page(t);
  const root = document.createElement('div');
  document.body.append(root);
  const ctx = { participants: [{ id: 'host', name: 'Claude' }], profile: {}, myColor: '', contact: { cwd: '/repo' } };
  const conversation = new Conversation(/** @type {any} */ (root), ctx);
  const activities = new ActivityLines(conversation, ctx);
  conversation.batch(() =>
    runs.forEach((calls, i) => {
      if (i) conversation.addNotice('Something else was said.');
      for (const one of calls) activities.add(/** @type {any} */ (one), { fromHistory: true });
    })
  );
  const tool = (id) => root.querySelector(`.tool[data-tool="${id}"]`);
  const fold = (id) => root.querySelector(`.fold[data-run="${id}"]`);
  return { root, activities, tool, fold };
}

const RUNS = [
  [call('t1', 'ls'), call('t2', 'npm test'), call('t3', 'git status')],
  [call('t4', 'pwd'), call('t5', 'whoami')],
];

test('what was opened in the lines of tool calls is told by the calls, and opened again', (t) => {
  const left = transcript(t, RUNS);
  assert.deepEqual(left.activities.opened, { runs: [], details: [] }, 'nothing opened yet');
  left.fold('t1').querySelector('.fold-head').click();
  left.tool('t2').querySelector('.toggle').click();
  // An output shown in a run that was put away again stays shown in it.
  left.tool('t5').querySelector('.toggle').click();
  assert.deepEqual(left.activities.opened, { runs: ['t1'], details: ['t2', 't5'] });

  const back = transcript(t, [...RUNS, [call('t6', 'date')]]);
  back.activities.reopen(left.activities.opened);
  assert.ok(back.fold('t1').classList.contains('open'));
  assert.equal(back.fold('t1').querySelector('.fold-head').getAttribute('aria-expanded'), 'true');
  assert.equal(back.fold('t4').classList.contains('open'), false);
  for (const [id, shown] of [
    ['t1', false],
    ['t2', true],
    ['t5', true],
    ['t6', false],
  ]) {
    assert.equal(back.tool(id).querySelector('pre.output').hidden, !shown, id);
    assert.equal(back.tool(id).querySelector('.toggle').textContent, shown ? 'Hide' : 'Show output', id);
  }
  assert.deepEqual(back.activities.opened, left.activities.opened);
});

test('what was opened in lines that are no longer there, or is no list of calls, opens nothing', (t) => {
  const { activities } = transcript(t, RUNS);
  for (const opened of [null, undefined, {}, { runs: 't1' }, { runs: [7, null], details: [{}] }, { runs: ['gone'] }]) {
    assert.doesNotThrow(() => activities.reopen(/** @type {any} */ (opened)));
  }
  assert.deepEqual(activities.opened, { runs: [], details: [] });
});

test('no more opened lines are kept than so many: the newest ones', (t) => {
  const calls = Array.from({ length: OPENED_AT_MOST + 5 }, (_, i) => [call(`t${i}`, `echo ${i}`)]);
  const { activities, tool } = transcript(t, calls);
  calls.forEach(([one]) => tool(one.toolId).querySelector('.toggle').click());
  const { details } = activities.opened;
  assert.equal(details.length, OPENED_AT_MOST);
  assert.equal(details[0], 't5');
  assert.equal(details.at(-1), `t${OPENED_AT_MOST + 4}`);
});
