import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from './fixtures/dom.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';

process.env.TZ = 'America/New_York';

// lib/api.js reads the bridge when it is first imported: the schedules are answered here, and the page hears of
// changes through `tell`.
const asked = [];
const listeners = [];
let stored = [];
let refuse = null;
const request =
  (name, reply) =>
  async (...args) => {
    asked.push([name, ...args]);
    if (refuse === name) throw new Error('That schedule is not there any more.');
    return reply(...args);
  };
globalThis.window = {
  addEventListener() {},
  messenger: {
    schedules: {
      list: request('list', () => stored.map((one) => ({ ...one }))),
      setOn: request('setOn', (id, on) => ({ ...stored.find((one) => one.id === id), on })),
      runNow: request('runNow', (id) => stored.find((one) => one.id === id)),
      remove: request('remove', () => true),
    },
    on: { schedules: (fn) => listeners.push(fn) },
  },
};
const tell = (views) => listeners.forEach((fn) => fn(views));
const { scheduleFacts, scheduleLine, schedulesPage } = await import('../src/renderer/settings/schedules.js');

const NOW = new Date(2026, 9, 26, 14, 20).getTime();
const at = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const schedule = (more = {}) => ({
  id: 's1',
  name: 'Triage new issues',
  prompt: 'Label the new issues.',
  cwd: '/work/shop',
  cron: '0 9 * * 1-5',
  provider: 'claude',
  model: '',
  effort: '',
  permissionMode: 'default',
  maxRuns: null,
  on: true,
  runs: 3,
  dueAfter: at(26, 9),
  lastRunAt: at(26, 9),
  next: at(27, 9),
  ...more,
});
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** The page, drawn on a page of its own, with what it said in the bar at the bottom. */
async function draw(t, schedules) {
  const document = page(t, 'professional');
  stored = schedules;
  asked.length = 0;
  listeners.length = Math.min(listeners.length, 1);
  const said = [];
  const nodes = schedulesPage({
    providers: [claude, codex],
    said: (text, failed = false) => said.push({ text, failed }),
    settings: { contactDefaults: {} },
  });
  document.body.append(...nodes);
  await settle();
  const node = nodes[0];
  return {
    document,
    node,
    said,
    names: () => node.querySelectorAll('.st-fold-name').map((one) => one.textContent),
    summaries: () => node.querySelectorAll('.st-fold-summary').map((one) => one.textContent),
    switches: () => node.querySelectorAll('.st-fold-aside input'),
    heads: () => node.querySelectorAll('.st-fold-head'),
  };
}

test('a schedule’s line says when it runs and when next, or that it is off, and why', () => {
  assert.equal(scheduleLine(schedule(), NOW), 'On weekdays at 9:00 AM · Next: Tomorrow 9:00 AM');
  assert.equal(scheduleLine(schedule({ on: false, next: null }), NOW), 'On weekdays at 9:00 AM · Off');
  assert.equal(
    scheduleLine(schedule({ on: false, next: null, runs: 5, maxRuns: 5 }), NOW),
    'On weekdays at 9:00 AM · Off after 5 of 5 runs'
  );
  assert.equal(
    scheduleLine(schedule({ lastError: 'Gone' }), NOW),
    'On weekdays at 9:00 AM · Next: Tomorrow 9:00 AM · Last run failed'
  );
});

test('an open line says where its runs work, who answers, how it last ran and how many runs it had', () => {
  assert.deepEqual(scheduleFacts(schedule({ maxRuns: 10 }), [claude], NOW), [
    { label: 'Project', value: 'shop' },
    { label: 'Service', value: 'Claude · Asks first' },
    { label: 'Last run', value: 'Today 9:00 AM' },
    { label: 'Runs', value: '3 of 10' },
  ]);
  const computer = schedule({
    computer: true,
    cwd: '',
    model: 'opus',
    permissionMode: 'bypassPermissions',
    lastRunAt: null,
    runs: 0,
    lastError: '/work/shop is not there any more.',
  });
  assert.deepEqual(scheduleFacts(computer, [claude], NOW), [
    { label: 'Project', value: 'This computer' },
    { label: 'Service', value: 'Claude · opus · Never asks' },
    { label: 'Last run', value: 'Not yet' },
    { label: 'Runs', value: '0, with no end' },
    { label: 'Last run failed', value: '/work/shop is not there any more.', warning: true },
  ]);
});

test('the page lists a folded line for each schedule, with its switch on the line', async (t) => {
  const { node, names, summaries, switches, heads } = await draw(t, [
    schedule(),
    schedule({ id: 's2', name: '', prompt: 'Check CI', cron: '0 * * * *', on: false, next: null }),
  ]);
  assert.equal(node.querySelector('h2').textContent, 'Schedules');
  assert.equal(node.querySelector('.st-group-head .btn').textContent, 'New schedule...');
  assert.deepEqual(names(), ['Triage new issues', 'Check CI']);
  assert.match(summaries()[0], /^On weekdays at 9:00 AM · Next: /);
  assert.equal(summaries()[1], 'Every hour · Off');
  assert.deepEqual(
    switches().map((box) => box.checked),
    [true, false]
  );
  assert.deepEqual(
    switches().map((box) => box.getAttribute('role')),
    ['switch', 'switch']
  );
  assert.deepEqual(
    heads().map((head) => head.getAttribute('aria-expanded')),
    ['false', 'false']
  );
  assert.equal(node.querySelectorAll('.st-fold-body').length, 0, 'nothing is open');
});

test('no schedules says how to add one', async (t) => {
  const { node } = await draw(t, []);
  assert.equal(node.querySelector('.st-list-empty').hidden, false);
  assert.match(node.querySelector('.st-list-empty').textContent, /^No schedules yet/);
});

test('the switch turns one on or off without opening it, and goes back when that is refused', async (t) => {
  const { switches, heads, said } = await draw(t, [schedule()]);
  const [box] = switches();
  box.checked = false;
  box.fire('change');
  await settle();
  assert.deepEqual(asked.at(-1), ['setOn', 's1', false]);
  assert.deepEqual(said.at(-1), { text: 'Turned off.', failed: false });
  assert.equal(heads()[0].getAttribute('aria-expanded'), 'false');
  refuse = 'setOn';
  t.after(() => (refuse = null));
  box.checked = true;
  box.fire('change');
  await settle();
  assert.equal(box.checked, false, 'back as it was');
  assert.deepEqual(said.at(-1), { text: 'That schedule is not there any more.', failed: true });
});

test('opened, a line says its facts, with Run now, Edit... and Delete', async (t) => {
  const { node, heads, said, document } = await draw(t, [schedule({ maxRuns: 10 })]);
  heads()[0].click();
  const body = node.querySelector('.st-fold-body');
  assert.deepEqual(
    body.querySelectorAll('dt').map((one) => one.textContent),
    ['Project', 'Service', 'Last run', 'Runs']
  );
  assert.equal(body.querySelectorAll('dd')[3].textContent, '3 of 10');
  const buttons = body.querySelectorAll('.st-row .btn');
  assert.deepEqual(
    buttons.map((one) => one.textContent),
    ['Run now', 'Edit...', 'Delete']
  );
  buttons[0].click();
  await settle();
  assert.deepEqual(asked.at(-1), ['runNow', 's1']);
  assert.equal(said.at(-1).text, 'Triage new issues started a run.');
  // Delete asks first.
  buttons[2].click();
  const question = document.body.querySelector('.modal');
  assert.match(question.textContent, /Delete the schedule “Triage new issues”\? The contacts its runs started stay\./);
  question.querySelector('.buttons').children[0].click();
  await settle();
  assert.deepEqual(asked.at(-1), ['remove', 's1']);
});

test('a run, or a change in another window, is said on the lines as it happens', async (t) => {
  const { node, names, summaries, switches, heads } = await draw(t, [schedule({ maxRuns: 4 })]);
  heads()[0].click();
  const box = switches()[0];
  // Its last run turned it off: the same line says so, its switch too, and what is open stays open.
  tell([schedule({ maxRuns: 4, runs: 4, on: false, next: null, lastError: 'Gone' })]);
  assert.equal(switches()[0], box, 'the same line');
  assert.equal(box.checked, false);
  assert.equal(summaries()[0], 'On weekdays at 9:00 AM · Off after 4 of 4 runs · Last run failed');
  assert.equal(node.querySelectorAll('.st-fold-body dd')[3].textContent, '4 of 4');
  assert.equal(node.querySelectorAll('.st-fold-body dt').at(-1).textContent, 'Last run failed');
  // One added in another window: the list is drawn anew.
  tell([schedule(), schedule({ id: 's2', name: 'Nightly' })]);
  assert.deepEqual(names(), ['Triage new issues', 'Nightly']);
});
