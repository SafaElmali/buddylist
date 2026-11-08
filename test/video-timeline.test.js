import test from 'node:test';
import assert from 'node:assert/strict';
import { captionLines, srt, srtTime, timeline } from '../scripts/video/timeline.js';

test('the film is the take without its cuts', () => {
  const { duration, toTake, toFilm } = timeline({
    duration: 20000,
    cuts: [
      { from: 8000, to: 11000 },
      { from: 2000, to: 3000 },
    ],
  });
  assert.equal(duration, 16);
  assert.equal(toTake(1), 1000);
  assert.equal(toTake(2.5), 3500);
  assert.equal(toTake(8), 12000);
  assert.equal(toFilm(1000), 1);
  assert.equal(toFilm(3500), 2.5);
  assert.equal(toFilm(12000), 8);
  // A moment cut out is where the cut is.
  assert.equal(toFilm(9500), 7);
  assert.equal(toFilm(2500), 2);
});

test('a take with no cuts is the film', () => {
  const { duration, toTake, toFilm } = timeline({ duration: 4500, cuts: [] });
  assert.equal(duration, 4.5);
  assert.equal(toTake(2), 2000);
  assert.equal(toFilm(2000), 2);
});

test('SubRip times', () => {
  assert.equal(srtTime(0), '00:00:00,000');
  assert.equal(srtTime(83.4), '00:01:23,400');
  assert.equal(srtTime(3723.0456), '01:02:03,046');
  assert.equal(srtTime(-1), '00:00:00,000');
});

test('a caption is one line where it fits, else two lines as even as they can be', () => {
  assert.deepEqual(captionLines('Give the project a manager.'), ['Give the project a manager.']);
  assert.deepEqual(captionLines('Whenever an agent changes files, the manager checks the work against the ticket.'), [
    'Whenever an agent changes files, the',
    'manager checks the work against the ticket.',
  ]);
  // The accent marks of an on-screen caption are no part of the words.
  assert.deepEqual(captionLines('It checks **every** change'), ['It checks every change']);
});

test('the captions file has a cue for each line said, timed to the film', () => {
  const file = srt([
    { at: 4.2, end: 7.9, text: 'It reads your tickets.' },
    { at: 1, end: 3.5, text: 'Give the project a manager.' },
  ]);
  assert.equal(
    file,
    '1\n00:00:01,000 --> 00:00:03,500\nGive the project a manager.\n\n' +
      '2\n00:00:04,200 --> 00:00:07,900\nIt reads your tickets.\n'
  );
});

test('a cue ends where the next starts, and a long line is split at its sentences', () => {
  const long =
    'This change is missing the test the ticket asks for. So the manager writes to that agent, and asks you first.';
  const file = srt([
    { at: 0, end: 10, text: long },
    { at: 9, end: 12, text: 'Accept.' },
  ]);
  const cues = file.trim().split('\n\n');
  assert.equal(cues.length, 3);
  assert.match(cues[0], /^1\n00:00:00,000 --> 00:00:04,\d{3}\nThis change is missing the\ntest the ticket asks for\.$/);
  assert.match(cues[1], /^2\n00:00:04,\d{3} --> 00:00:09,000\n/);
  assert.match(cues[2], /^3\n00:00:09,000 --> 00:00:12,000\nAccept\.$/);
});
