import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayAndTime, formatTime, sentence } from '../src/renderer/lib/format.js';
import { offlineText } from '../src/providers/offline.js';

// Saturday 17 October 2026, in the afternoon, wherever the tests run.
const NOW = new Date(2026, 9, 17, 15, 30).getTime();
const at = (...date) => new Date(...date).getTime();
const said = (...date) => dayAndTime(at(...date), NOW);

test('what was said today and yesterday says so, with its time', () => {
  assert.equal(said(2026, 9, 17, 0, 20), `Today ${formatTime(at(2026, 9, 17, 0, 20))}`);
  assert.equal(said(2026, 9, 17, 15, 29), `Today ${formatTime(at(2026, 9, 17, 15, 29))}`);
  assert.equal(said(2026, 9, 16, 23, 59), `Yesterday ${formatTime(at(2026, 9, 16, 23, 59))}`);
  assert.equal(said(2026, 9, 16, 0, 0), `Yesterday ${formatTime(at(2026, 9, 16, 0, 0))}`);
});

test('what was said earlier that week says its day', () => {
  const sunday = at(2026, 9, 11, 0, 20);
  assert.equal(dayAndTime(sunday, NOW), `Sunday ${formatTime(sunday)}`);
  assert.equal(said(2026, 9, 15, 9, 0).split(' ')[0], 'Thursday');
});

test('what was said a week ago or more says its date, and its year when that is another one', () => {
  const week = at(2026, 9, 10, 12, 0);
  assert.equal(dayAndTime(week, NOW), `Oct 10 ${formatTime(week)}`);
  const lastYear = at(2025, 11, 31, 23, 0);
  assert.equal(dayAndTime(lastYear, NOW), `Dec 31, 2025 ${formatTime(lastYear)}`);
});

test('a day the clocks change on is one day, and a clock that is behind still says today', () => {
  // Sunday 29 March 2026 is 23 hours long in much of Europe; 1 November 2026 is 25 hours long in the US.
  assert.equal(dayAndTime(at(2026, 2, 28, 22, 0), at(2026, 2, 30, 1, 0)).split(' ')[0], 'Saturday');
  assert.equal(dayAndTime(at(2026, 10, 1, 0, 30), at(2026, 10, 2, 23, 30)).split(' ')[0], 'Yesterday');
  assert.equal(dayAndTime(NOW + 60_000, NOW).split(' ')[0], 'Today');
});

test('a sentence gets one full stop at its end: none more where it ends one already, as providers often do', () => {
  assert.equal(sentence('The API is down'), 'The API is down.');
  // Gemini, OpenCode and Hermes (ACP), when a turn is cut short.
  assert.equal(
    sentence('Gemini stopped after too many steps in one turn.'),
    'Gemini stopped after too many steps in one turn.'
  );
  assert.equal(
    sentence('Gemini ran out of room for its reply (token limit reached).'),
    'Gemini ran out of room for its reply (token limit reached).'
  );
  // Claude and Codex, offline: their own words, then what to do.
  const offline = offlineText("Can't reach the API server — check your internet or DNS (ENOTFOUND).");
  assert.equal(sentence(offline).match(/\.+$/)[0], '.');
  assert.equal(sentence('Codex failed. '), 'Codex failed.');
  assert.equal(sentence('Is it signed in?'), 'Is it signed in?');
  assert.equal(sentence('It said "overloaded."'), 'It said "overloaded."');
  assert.equal(sentence('Not signed in\nRun gemini to sign in'), 'Not signed in\nRun gemini to sign in.');
});
