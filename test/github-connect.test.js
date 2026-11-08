import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONNECT_TEXT, connectStep, connectTitle, messageParts } from '../src/shared/github-connect.js';

test('the line under your name says what connecting is for, and pointing at it what is missing', () => {
  assert.match(CONNECT_TEXT, /^Connect to GitHub/);
  assert.match(connectTitle('missing'), /not installed/);
  assert.match(connectTitle('signed-out'), /not signed in/);
  assert.equal(connectTitle('something new'), connectTitle('signed-out'));
});

test('a sign-in goes from asking for a code, to having one, to waiting for GitHub to hear it', () => {
  assert.equal(connectStep({}), 'asking');
  assert.equal(connectStep({ code: '1A2B-3C4D', url: 'https://github.com/login/device' }), 'code');
  assert.equal(connectStep({ code: '1A2B-3C4D', opened: true }), 'waiting');
});

test('a sign-in that did not go through says so, whatever it had got to', () => {
  assert.equal(connectStep({ problem: 'The GitHub CLI is not installed.' }), 'failed');
  assert.equal(connectStep({ code: '1A2B-3C4D', opened: true, problem: 'It has expired.' }), 'failed');
});

test('a message is cut where its web addresses are, so that each can be clicked', () => {
  assert.deepEqual(
    messageParts('The GitHub CLI is not installed. Get "gh" from https://cli.github.com, then try again.'),
    [
      { text: 'The GitHub CLI is not installed. Get "gh" from ', link: false },
      { text: 'https://cli.github.com', link: true },
      { text: ', then try again.', link: false },
    ]
  );
  assert.deepEqual(messageParts('https://cli.github.com'), [{ text: 'https://cli.github.com', link: true }]);
  assert.deepEqual(messageParts('See https://a.example and https://b.example/x.'), [
    { text: 'See ', link: false },
    { text: 'https://a.example', link: true },
    { text: ' and ', link: false },
    { text: 'https://b.example/x', link: true },
    { text: '.', link: false },
  ]);
});

test('a message without an address is one piece, and no message is none', () => {
  assert.deepEqual(messageParts('GitHub could not be reached.'), [
    { text: 'GitHub could not be reached.', link: false },
  ]);
  assert.deepEqual(messageParts(''), []);
});
