import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANGE_LINES,
  activityRequest,
  activityStatus,
  appDone,
  clipLines,
  fileChange,
} from '../src/shared/activity-text.js';

const lines = (count) => Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n');

test('a change is kept whole while it is short', () => {
  for (const text of ['', 'one line', lines(CHANGE_LINES)]) assert.equal(clipLines(text), text);
});

test('one line over is kept whole: the line saying so would take its place', () => {
  assert.equal(clipLines(lines(CHANGE_LINES + 1)), lines(CHANGE_LINES + 1));
});

test('a long change keeps its first lines, and says how many more there were', () => {
  const clipped = clipLines(lines(1000));
  assert.equal(clipped, `${lines(CHANGE_LINES)}\n… ${1000 - CHANGE_LINES} more lines`);
  assert.equal(clipped.split('\n').length, CHANGE_LINES + 1);
});

test('clipping a change that was clipped already changes nothing', () => {
  const once = clipLines(lines(1000));
  assert.equal(clipLines(once), once);
});

test('a file change clips each side', () => {
  assert.deepEqual(fileChange(lines(1000), 'b'), { before: clipLines(lines(1000)), after: 'b' });
  assert.deepEqual(fileChange('', lines(500)), { before: '', after: clipLines(lines(500)) });
});

test('a manager’s invite is said by who joins which conversation, and as what', () => {
  const invite = {
    kind: 'app',
    action: 'invite',
    label: 'Claude (tags)',
    agent: 'Claude (Opus 5.5)',
    role: 'Reviewer',
  };
  assert.equal(activityRequest(invite), 'invite Claude (Opus 5.5) into Claude (tags) as Reviewer');
  assert.equal(activityStatus(invite), 'Inviting an agent');
  assert.equal(appDone(invite), 'invited an agent');
  assert.equal(activityRequest({ ...invite, role: undefined }), 'invite Claude (Opus 5.5) into Claude (tags)');
});

test('a manager’s answer is said by whose questions it answers, and how many', () => {
  const answer = {
    kind: 'app',
    action: 'answer-question',
    label: 'Claude (tags)',
    count: 1,
    answers: ['Vitest'],
    prompt: 'Which runner?\n→ Vitest',
  };
  assert.equal(activityRequest(answer), 'answer Claude (tags)’s question');
  assert.equal(activityRequest({ ...answer, count: 2 }), 'answer Claude (tags)’s 2 questions');
  assert.equal(activityStatus(answer), 'Answering a question');
  assert.equal(appDone(answer), 'answered a question');
  assert.equal(appDone({ ...answer, count: 2 }), 'answered 2 questions');
});
