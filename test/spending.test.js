import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History } from '../src/main/storage/history.js';
import { Spending, periodStarts } from '../src/main/spending.js';
import { statusLine, totals } from '../src/renderer/spending/report.js';
import { dollars } from '../src/renderer/lib/format.js';
import { tempDir } from './fixtures/temp-dir.js';

const tmp = () => tempDir('cm-spending-');
const at = (month, date, hour = 12) => new Date(2026, month, date, hour).getTime();
// Sunday, October 18th 2026, at noon, in whatever time zone the tests run in.
const NOW = at(9, 18);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
const nearly = (spent, expected) => {
  for (const period of ['today', 'week', 'month']) near(spent[period], expected[period]);
};

const contact = (id, extra = {}) => ({ id, name: id, avatar: 'default', providerName: 'Claude Code', ...extra });
const result = (time, costUsd, extra = {}) => ({ kind: 'result', time, costUsd, ...extra });
/** A turn: what you said, and how it ended. */
function turn(history, contactId, time, costUsd, extra = {}) {
  history.append(contactId, { kind: 'user', text: 'go on', time: time - 1000 });
  history.append(contactId, result(time, costUsd, extra));
}
/** Moves the conversation going on into the message history. */
const archive = (history, contactId) => history.archive(contactId, { cwd: '/work' });
/** Some time passes, for the conversation going on to have been added to at another moment. */
const later = () => new Promise((resolve) => setTimeout(resolve, 5));

// ---- the periods ----------------------------------------------------------------------------------

test('today, this week and this month go by the calendar: midnight, the Monday and the 1st', () => {
  assert.deepEqual(periodStarts(NOW), { today: at(9, 18, 0), week: at(9, 12, 0), month: at(9, 1, 0) });
  assert.deepEqual(periodStarts(at(9, 18, 0)), periodStarts(NOW), 'midnight is the day it starts');
});

test('on a Monday the week starts today, and early in a month it started in the one before', () => {
  assert.equal(periodStarts(at(9, 19, 9)).week, at(9, 19, 0));
  assert.deepEqual(periodStarts(at(9, 3)), { today: at(9, 3, 0), week: at(8, 28, 0), month: at(9, 1, 0) });
});

// ---- what every contact spent ---------------------------------------------------------------------

test('nobody has spent anything yet', async () => {
  const report = await new Spending(new History(tmp())).report([contact('c1')], NOW);
  assert.deepEqual(report, {
    since: periodStarts(NOW),
    total: { today: 0, week: 0, month: 0 },
    contacts: [],
    uncounted: [],
  });
});

test('each turn counts in every period it falls in, and nothing from before the month does', async () => {
  const history = new History(tmp());
  turn(history, 'c1', at(8, 30), 1.0); // last month: the total it was at, no more
  turn(history, 'c1', at(9, 5), 1.5); // this month
  turn(history, 'c1', at(9, 13), 2.25); // this week
  turn(history, 'c1', at(9, 18, 9), 2.5); // this morning
  const report = await new Spending(history).report([contact('c1')], NOW);
  nearly(report.total, { today: 0.25, week: 1.0, month: 1.5 });
  assert.equal(report.contacts.length, 1);
  assert.equal(report.contacts[0].id, 'c1');
  nearly(report.contacts[0], { today: 0.25, week: 1.0, month: 1.5 });
});

test('a week that began last month counts its days there, which the month does not', async () => {
  const history = new History(tmp());
  turn(history, 'c1', at(8, 29), 0.4); // Tuesday, September 29th
  turn(history, 'c1', at(9, 2), 0.5); // Friday, October 2nd
  const report = await new Spending(history).report([contact('c1')], at(9, 3));
  nearly(report.total, { today: 0, week: 0.5, month: 0.1 });
  assert.deepEqual(
    report.contacts.map((c) => c.id),
    ['c1']
  );
});

test('the past conversations in the message history count as well, each its own session', async () => {
  const history = new History(tmp());
  turn(history, 'c1', at(9, 2), 0.3);
  turn(history, 'c1', at(9, 3), 0.8);
  archive(history, 'c1');
  turn(history, 'c1', at(9, 14), 0.2);
  archive(history, 'c1');
  turn(history, 'c1', at(9, 18, 10), 0.05);
  const report = await new Spending(history).report([contact('c1')], NOW);
  nearly(report.total, { today: 0.05, week: 0.25, month: 1.05 });
});

test('a past conversation that ended before the month is not read, and one in it is read only once', async () => {
  const history = new History(tmp());
  turn(history, 'c1', at(8, 10), 4.0);
  archive(history, 'c1');
  turn(history, 'c1', at(9, 6), 0.6);
  archive(history, 'c1');
  const read = [];
  const readArchivedLater = history.readArchivedLater.bind(history);
  history.readArchivedLater = (contactId, id) => {
    read.push(id);
    return readArchivedLater(contactId, id);
  };
  const spending = new Spending(history);
  nearly((await spending.report([contact('c1')], NOW)).total, { today: 0, week: 0, month: 0.6 });
  const [october, september] = history.listArchived('c1');
  assert.deepEqual(read, [october.id]);
  nearly((await spending.report([contact('c1')], NOW)).total, { today: 0, week: 0, month: 0.6 });
  assert.equal(read.length, 1, 'it was read the first time only');
  assert.ok(september);

  // One archived since is read; one deleted since is no longer counted.
  turn(history, 'c1', at(9, 15), 0.7);
  archive(history, 'c1');
  nearly((await spending.report([contact('c1')], NOW)).total, { today: 0, week: 0.7, month: 1.3 });
  assert.equal(read.length, 2);
  history.deleteArchived('c1', october.id);
  nearly((await spending.report([contact('c1')], NOW)).total, { today: 0, week: 0.7, month: 0.7 });
});

test('the conversation going on is read again once it has been added to, and not before', async () => {
  const history = new History(tmp());
  turn(history, 'c1', at(9, 18, 9), 0.1);
  const spending = new Spending(history);
  near((await spending.report([contact('c1')], NOW)).total.today, 0.1);
  const read = history.read.bind(history);
  let reads = 0;
  history.read = (contactId) => {
    reads += 1;
    return read(contactId);
  };
  near((await spending.report([contact('c1')], NOW)).total.today, 0.1);
  assert.equal(reads, 0);
  await later();
  turn(history, 'c1', at(9, 18, 11), 0.35);
  near((await spending.report([contact('c1')], NOW)).total.today, 0.35);
  assert.equal(reads, 1);
  // A new conversation starts with nothing spent in it.
  await later();
  archive(history, 'c1');
  near((await spending.report([contact('c1')], NOW)).total.today, 0.35);
  history.clearArchive('c1');
  near((await spending.report([contact('c1')], NOW)).total.today, 0);
});

test('a guest in a conversation has a total of its own', async () => {
  const history = new History(tmp());
  turn(history, 'c1', at(9, 18, 8), 2.0);
  turn(history, 'c1', at(9, 18, 9), 0.3, { speaker: 'g1', speakerName: 'Opus' });
  turn(history, 'c1', at(9, 18, 10), 2.5);
  const report = await new Spending(history).report([contact('c1')], NOW);
  near(report.total.today, 2.0 + 0.3 + 0.5);
});

test('a fork’s copy of the conversation it came from is counted once, for the contact it was forked from', async () => {
  const history = new History(tmp());
  turn(history, 'c1', at(9, 13), 0.4);
  turn(history, 'c1', at(9, 14), 1.0);
  // Forked: the copy has its entries, with ids of its own, and goes on in a session of its own.
  history.begin(
    'c2',
    history.read('c1').map((entry, i) => ({ ...entry, costOrigin: entry.id, id: `copy-${i}` }))
  );
  history.append('c2', { kind: 'notice', text: 'Forked from c1’s conversation.', costReset: true });
  turn(history, 'c2', at(9, 18, 9), 0.25);
  turn(history, 'c1', at(9, 18, 10), 1.5);
  const report = await new Spending(history).report([contact('c1'), contact('c2')], NOW);
  nearly(report.total, { today: 0.75, week: 1.75, month: 1.75 });
  nearly(
    report.contacts.find((c) => c.id === 'c1'),
    { today: 0.5, week: 1.5, month: 1.5 }
  );
  nearly(
    report.contacts.find((c) => c.id === 'c2'),
    { today: 0.25, week: 0.25, month: 0.25 }
  );
});

test('unrelated results at the same millisecond and price are separate expenses, including guests', async () => {
  const history = new History(tmp());
  turn(history, 'c1', at(9, 18, 9), 0.4);
  turn(history, 'c2', at(9, 18, 9), 0.4);
  turn(history, 'c2', at(9, 18, 9), 0.4, { speaker: 'guest' });
  const report = await new Spending(history).report([contact('c1'), contact('c2')], NOW);
  near(report.total.today, 1.2);
});

test('legacy forks count copied results once and start their own total even when it is larger', async () => {
  const history = new History(tmp());
  turn(history, 'c1', at(9, 13), 0.4);
  history.begin(
    'c2',
    history.read('c1').map((entry, i) => ({ ...entry, id: `copy-${i}` }))
  );
  history.append('c2', { kind: 'notice', text: 'Forked from c1’s conversation.' });
  turn(history, 'c2', at(9, 18, 9), 0.75);
  const report = await new Spending(history).report([contact('c1'), contact('c2')], NOW);
  near(report.total.week, 1.15);
  near(report.contacts.find((c) => c.id === 'c2').today, 0.75);
});

test('a result arriving in the same millisecond as the last read still refreshes the total', async (t) => {
  t.mock.method(Date, 'now', () => NOW);
  const history = new History(tmp());
  turn(history, 'c1', at(9, 18, 9), 0.1);
  const spending = new Spending(history);
  near((await spending.report([contact('c1')], NOW)).total.today, 0.1);
  turn(history, 'c1', at(9, 18, 10), 0.6);
  near((await spending.report([contact('c1')], NOW)).total.today, 0.6);
  history.begin('c1', [result(at(9, 18, 11), 0.3)]);
  near((await spending.report([contact('c1')], NOW)).total.today, 0.3);
});

test('the contacts that spent the most this month come first, archived ones too', async () => {
  const history = new History(tmp());
  turn(history, 'small', at(9, 18, 9), 0.2);
  turn(history, 'big', at(9, 2), 3.0);
  turn(history, 'week', at(9, 13), 0.2);
  turn(history, 'week', at(9, 14), 0.9);
  const contacts = [contact('small'), contact('big', { archived: true }), contact('week'), contact('idle')];
  const report = await new Spending(history).report(contacts, NOW);
  assert.deepEqual(
    report.contacts.map(({ id, archived }) => [id, archived]),
    [
      ['big', true],
      ['week', false],
      ['small', false],
    ]
  );
  assert.deepEqual(Object.keys(report.contacts[0]).sort(), [
    'archived',
    'avatar',
    'id',
    'month',
    'name',
    'today',
    'week',
  ]);
});

test('an agent that answered this month without saying what it cost is not counted, and is named', async () => {
  const history = new History(tmp());
  turn(history, 'codex', at(9, 18, 9), 0);
  turn(history, 'old-codex', at(8, 20), 0); // last month: nothing to say about this one
  turn(history, 'claude', at(9, 18, 9), 0.4);
  turn(history, 'claude', at(9, 18, 10), 0); // a crashed turn
  turn(history, 'same', at(9, 14), 0.4);
  archive(history, 'same');
  turn(history, 'same', at(9, 15), 0.4); // a new session that cost the same: still counted
  turn(history, 'free', at(8, 20), 0.6);
  turn(history, 'free', at(9, 14), 0.6); // a turn that added nothing
  const contacts = [
    contact('codex', { providerName: 'Codex' }),
    contact('old-codex', { providerName: 'Codex' }),
    contact('claude'),
    contact('same'),
    contact('free'),
  ];
  const report = await new Spending(history).report(contacts, NOW);
  assert.deepEqual(report.uncounted, [{ id: 'codex', name: 'codex', providerName: 'Codex' }]);
  assert.deepEqual(
    report.contacts.map((c) => c.id),
    ['same', 'claude']
  );
});

test('a contact that is gone is forgotten with its conversations', async () => {
  const history = new History(tmp());
  turn(history, 'c1', at(9, 14), 0.5);
  const spending = new Spending(history);
  near((await spending.report([contact('c1')], NOW)).total.week, 0.5);
  history.purge('c1');
  assert.deepEqual((await spending.report([], NOW)).total, { today: 0, week: 0, month: 0 });
});

// ---- what the window says -------------------------------------------------------------------------

test('dollars, to the cent', () => {
  assert.equal(dollars(0), '$0.00');
  assert.equal(dollars(0.004), '<$0.01');
  assert.equal(dollars(0.42), '$0.42');
  assert.equal(dollars(12.5), '$12.50');
  assert.equal(dollars(1204.499), '$1,204.50');
});

test('the totals along the top say when each period began', () => {
  const report = { since: periodStarts(NOW), total: { today: 0.25, week: 1, month: 72.154 } };
  const day = (time, how) => new Date(time).toLocaleDateString([], how);
  const short = { weekday: 'short', month: 'short', day: 'numeric' };
  assert.deepEqual(totals(report), [
    { label: 'Today', amount: '$0.25', since: day(at(9, 18), short) },
    { label: 'This week', amount: '$1.00', since: `Since ${day(at(9, 12), short)}` },
    { label: 'This month', amount: '$72.15', since: `Since ${day(at(9, 1), { month: 'long', day: 'numeric' })}` },
  ]);
});

test('the status bar names the agents that don’t say what they cost', () => {
  const codex = (id) => ({ id, name: id, providerName: 'Codex' });
  assert.equal(statusLine([]), 'As each agent reports it, from your message history.');
  assert.equal(statusLine([codex('a')]), 'Codex doesn’t say what a reply costs, so 1 contact isn’t counted.');
  assert.equal(
    statusLine([codex('a'), codex('b'), { id: 'c', name: 'c', providerName: 'Gemini' }]),
    'Codex and Gemini don’t say what a reply costs, so 3 contacts aren’t counted.'
  );
});
