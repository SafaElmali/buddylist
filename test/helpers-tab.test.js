import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clock } from '../src/renderer/lib/format.js';
import {
  atWork,
  doing,
  end,
  endedAs,
  endedNote,
  helperOf,
  nobodyNote,
  ordered,
  summary,
  tagOf,
  timeOf,
} from '../src/renderer/chat/helpers.js';

const ASKS = { kind: 'delegate', label: 'Count the files', agent: 'Explore', prompt: 'Run ls and count.' };
const call = (more = {}) => ({ toolId: 'a1', activity: ASKS, ...more });
const working = (more = {}) => ({ ...helperOf(call(), { by: 'Claude', started: 1000, working: true }), ...more });
const step = (id, activity, pending = false) => ({ id, activity, pending });

// ---- a helper, from the call that asked for it ---------------------------------------------------

test('a helper is what its call says: what for, which kind, in which words, and for whom', () => {
  assert.deepEqual(helperOf(call({ speaker: 'guest-1' }), { by: 'Opus', started: 1000, working: true }), {
    id: 'a1',
    label: 'Count the files',
    agent: 'Explore',
    prompt: 'Run ls and count.',
    by: 'Opus',
    speaker: 'guest-1',
    status: 'working',
    started: 1000,
    took: null,
    report: '',
    steps: [],
  });
});

test('a call that says little still makes a helper', () => {
  const helper = helperOf(
    { toolId: 'a2', activity: { kind: 'delegate' } },
    { by: 'Claude', started: 0, working: true }
  );
  assert.deepEqual([helper.label, helper.agent, helper.prompt, helper.speaker], ['', '', '', undefined]);
});

test('a saved call that is not going on has ended, as its result says', () => {
  const about = { by: 'Claude', started: 1000, working: false };
  const done = helperOf(
    call({ output: 'There are **24**.', isError: false, declined: false, durationMs: 4300 }),
    about
  );
  assert.deepEqual([done.status, done.report, done.took], ['done', 'There are **24**.', 4300]);
  const stopped = helperOf(call({ output: '', isError: false, declined: false, stopped: true }), about);
  assert.deepEqual([stopped.status, stopped.report, stopped.took], ['stopped', '', null]);
  // Its result never came: the app was quit while it worked. It just looks finished.
  const lost = helperOf(call(), about);
  assert.deepEqual([lost.status, lost.report, lost.took], ['done', '', null]);
});

test('how a helper ended goes by its call’s result', () => {
  assert.equal(endedAs({ isError: false, declined: false }), 'done');
  assert.equal(endedAs({ isError: true, declined: false }), 'failed');
  assert.equal(endedAs({ isError: false, declined: false, stopped: true }), 'stopped');
  // You said no to the call itself: no helper ever started.
  assert.equal(endedAs({ isError: true, declined: true }), 'declined');
  assert.equal(endedAs({}), 'done');
});

test('ending a helper keeps its report and how long it took, and ends the step it was in', () => {
  const helper = working({
    steps: [step('b1', { kind: 'read', path: '/a.js' }), step('b2', { kind: 'search' }, true)],
  });
  const same = end(helper, { output: 'Done.', isError: false, declined: false, durationMs: 4300 }, 9000);
  assert.equal(same, helper);
  assert.deepEqual([helper.status, helper.report, helper.took], ['done', 'Done.', 4300], 'what its provider says');
  assert.deepEqual(
    helper.steps.map((s) => s.pending),
    [false, false]
  );
});

test('a helper whose provider does not say how long it took is timed by the clock', () => {
  const live = end(working(), { output: '', isError: true, declined: false }, 9000);
  assert.deepEqual([live.status, live.took], ['failed', 8000]);
  // A saved result has no clock to go by.
  assert.equal(end(working(), { output: '', isError: false, declined: false }).took, null);
});

// ---- what a row says ---------------------------------------------------------------------------------

test('time reads like a stopwatch', () => {
  assert.equal(clock(0), '0:00');
  assert.equal(clock(7400), '0:07');
  assert.equal(clock(59999), '0:59');
  assert.equal(clock(60000), '1:00');
  assert.equal(clock(760000), '12:40');
  assert.equal(clock(3723000), '1:02:03');
  // A clock that was set back counts from nothing, not below it.
  assert.equal(clock(-500), '0:00');
});

test('a row counts up while its helper works, and then says how long it took', () => {
  assert.equal(timeOf(working(), 43000), '0:42');
  assert.equal(timeOf({ status: 'done', started: 1000, took: 4300 }, 999999), '0:04');
  assert.equal(timeOf({ status: 'stopped', started: 1000, took: null }, 999999), '', 'unknown stays unsaid');
});

test('under its name a helper at work says what it is doing right now', () => {
  assert.equal(doing(working()), 'Getting started');
  const running = working({ steps: [step('b1', { kind: 'command', command: 'npm test' }, true)] });
  assert.equal(doing(running), 'Running npm test · 1 step');
  const between = working({
    steps: [step('b1', { kind: 'read', path: '/p/a.js' }), step('b2', { kind: 'command', command: 'ls' })],
  });
  assert.equal(doing(between), 'Thinking · 2 steps');
});

test('with several steps going on at once, it is the newest that is named', () => {
  const helper = working({
    steps: [
      step('b1', { kind: 'read', path: '/p/a.js' }, true),
      step('b2', { kind: 'search', query: 'total' }, true),
      step('b3', { kind: 'edit', path: '/p/cart.js' }, true),
    ],
  });
  assert.equal(doing(helper), 'Editing cart.js · 3 steps');
});

test('once it has ended, the line says how', () => {
  const steps = [step('b1', { kind: 'read', path: '/a.js' })];
  assert.equal(doing({ status: 'done', steps }), 'Finished · 1 step');
  assert.equal(doing({ status: 'failed', steps }), 'Ran into a problem · 1 step');
  assert.equal(doing({ status: 'stopped', steps: [...steps, ...steps] }), 'Stopped before it was done · 2 steps');
  assert.equal(doing({ status: 'declined', steps: [] }), 'Never started: you declined it');
  assert.equal(doing({ status: 'done', steps: [] }), 'Finished', 'no steps, no count');
});

test('with several agents here, a helper says whose it is', () => {
  assert.equal(tagOf({ agent: 'Explore', by: 'Claude' }, false), 'Explore');
  assert.equal(tagOf({ agent: 'Explore', by: 'Opus' }, true), 'Explore for Opus');
  assert.equal(tagOf({ agent: '', by: 'Opus' }, true), 'for Opus');
  assert.equal(tagOf({ agent: '', by: 'Claude' }, false), '');
});

// ---- what the tab says --------------------------------------------------------------------------------

const of = (...statuses) => statuses.map((status, i) => ({ id: `h${i}`, status }));

test('the line at the top counts the helpers at work', () => {
  assert.equal(summary(of('working', 'working', 'done')), '2 subagents at work');
  assert.equal(summary(of('working')), '1 subagent at work');
  assert.equal(summary(of('done', 'stopped')), 'No subagent at work');
  assert.equal(summary([]), 'No subagents yet');
  assert.equal(atWork(of('working', 'failed', 'working')), 2);
});

test('next to it, how many have ended, however they did', () => {
  assert.equal(endedNote(of('working', 'done', 'failed', 'stopped', 'declined')), '4 ended');
  assert.equal(endedNote(of('working', 'working')), '');
  assert.equal(endedNote([]), '');
});

test('the helpers at work come first as they were asked, then the others, the newest on top', () => {
  assert.deepEqual(
    ordered(of('done', 'working', 'stopped', 'working', 'failed')).map((h) => h.id),
    ['h1', 'h3', 'h4', 'h2', 'h0']
  );
  assert.deepEqual(ordered([]), []);
  const helpers = of('done', 'working');
  ordered(helpers);
  assert.deepEqual(
    helpers.map((h) => h.id),
    ['h0', 'h1'],
    'the list it was given stays as it was'
  );
});

test('without helpers the tab says whose would be listed', () => {
  assert.match(nobodyNote(['Claude']), /^Nobody is helping yet\. When Claude hands part of a job to a subagent/);
  assert.match(nobodyNote(['Claude', 'Opus']), /When an agent here hands/);
  assert.match(nobodyNote([]), /When an agent here hands/);
});
