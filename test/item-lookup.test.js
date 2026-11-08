import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ItemLookup } from '../src/renderer/contacts/item-lookup.js';
import { REFERENCE_HELP } from '../src/shared/github-item.js';

const PAUSE = 400;
const issue = (number) => ({
  kind: 'issue',
  number,
  title: `Issue ${number}`,
  body: '',
  url: 'https://x.dev/a/b/issues/1',
});

/** Lets everything that is already due happen: answers that came in, and what follows from them. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A lookup whose questions are answered by hand: `answer(text, item)` and `fail(text, error)`
 * settle the oldest open question for that text. The clock only moves with `wait`.
 */
function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const asked = [];
  const open = [];
  const states = [];
  const lookup = new ItemLookup({
    ask: (text) =>
      new Promise((resolve, reject) => {
        asked.push(text);
        open.push({ text, resolve, reject });
      }),
    changed: (state) => states.push(state.status),
    pauseMs: PAUSE,
  });
  const take = (text) =>
    open.splice(
      open.findIndex((q) => q.text === text),
      1
    )[0];
  return {
    lookup,
    asked,
    states,
    wait: (ms = PAUSE) => t.mock.timers.tick(ms),
    answer: async (text, item) => {
      take(text).resolve(item);
      await settle();
    },
    fail: async (text, error) => {
      take(text).reject(error);
      await settle();
    },
  };
}

// ---- while typing ----------------------------------------------------------------------------------

test('nothing is asked until the typing has paused, and then it is asked once', async (t) => {
  const { lookup, asked, states, wait, answer } = setup(t);
  assert.deepEqual(lookup.state, { status: 'empty' });
  lookup.typed(' #123 ');
  assert.deepEqual(states, ['looking'], 'the form says so at once');
  wait(PAUSE - 1);
  assert.deepEqual(asked, []);
  wait(1);
  await settle();
  assert.deepEqual(asked, ['#123'], 'without the spaces around it');
  await answer('#123', issue(123));
  assert.deepEqual(lookup.state, { status: 'found', item: issue(123) });
  assert.deepEqual(lookup.item, issue(123));
  assert.deepEqual(states, ['looking', 'found']);
  wait(5000);
  assert.deepEqual(asked, ['#123'], 'and never again for the same text');
});

test('every key pressed starts the pause over: only what is left standing is asked', async (t) => {
  const { lookup, asked, wait } = setup(t);
  for (const text of ['1', '12', '123']) {
    lookup.typed(text);
    wait(PAUSE - 50);
  }
  await settle();
  assert.deepEqual(asked, []);
  wait(50);
  await settle();
  assert.deepEqual(asked, ['123']);
});

test('typing never waits for an answer that is still on its way', async (t) => {
  const { lookup, asked, states, wait } = setup(t);
  lookup.typed('12');
  wait();
  await settle();
  assert.deepEqual(asked, ['12']);
  // Nobody answers. The next key is taken all the same, at once.
  assert.equal(lookup.typed('123'), undefined);
  assert.equal(lookup.state.status, 'looking');
  wait();
  await settle();
  assert.deepEqual(asked, ['12', '123']);
  assert.deepEqual(states, ['looking', 'looking']);
});

test('an answer for text that is no longer in the field is dropped', async (t) => {
  const { lookup, states, wait, answer } = setup(t);
  lookup.typed('12');
  wait();
  await settle();
  lookup.typed('123');
  wait();
  await settle();
  // The late answer to the first question, then the answer to the one that still counts.
  await answer('12', issue(12));
  assert.equal(lookup.state.status, 'looking');
  assert.equal(lookup.item, null);
  await answer('123', issue(123));
  assert.equal(lookup.item.number, 123);
  assert.deepEqual(states, ['looking', 'looking', 'found']);
});

test('answers that come back in the wrong order end with the right one', async (t) => {
  const { lookup, wait, answer, fail } = setup(t);
  lookup.typed('12');
  wait();
  await settle();
  lookup.typed('123');
  wait();
  await settle();
  await answer('123', issue(123));
  await fail('12', new Error('There is no issue or pull request #12 in this project on GitHub.'));
  assert.deepEqual(lookup.state, { status: 'found', item: issue(123) });
});

test('going back to what was typed before asks again, and the old answer stays dropped', async (t) => {
  const { lookup, asked, wait, answer } = setup(t);
  lookup.typed('12');
  wait();
  await settle();
  lookup.typed('123');
  lookup.typed('12');
  await answer('12', issue(12));
  assert.equal(lookup.state.status, 'looking', 'that answer was for an earlier question');
  wait();
  await settle();
  assert.deepEqual(asked, ['12', '12']);
  await answer('12', issue(12));
  assert.equal(lookup.item.number, 12);
});

test('the same text again, give or take a space, is not a change', async (t) => {
  const { lookup, asked, states, wait, answer } = setup(t);
  lookup.typed('123');
  wait();
  await settle();
  await answer('123', issue(123));
  lookup.typed('123 ');
  lookup.typed('123');
  wait(5000);
  assert.deepEqual(asked, ['123']);
  assert.deepEqual(states, ['looking', 'found']);
  assert.equal(lookup.item.number, 123);
});

test('an emptied field has nothing, and an answer still on its way is dropped', async (t) => {
  const { lookup, asked, states, wait, answer } = setup(t);
  lookup.typed('123');
  wait();
  await settle();
  lookup.typed('');
  assert.deepEqual(lookup.state, { status: 'empty' });
  await answer('123', issue(123));
  assert.deepEqual(lookup.state, { status: 'empty' });
  assert.equal(lookup.item, null);
  // Emptied before the pause was over, it is not even asked.
  lookup.typed('45');
  lookup.typed('   ');
  wait(5000);
  assert.deepEqual(asked, ['123']);
  assert.deepEqual(states, ['looking', 'empty', 'looking', 'empty']);
});

test('text that is neither a number nor a link is not asked about', async (t) => {
  const { lookup, asked, wait } = setup(t);
  for (const text of ['fix login', 'https://github.com/acme', '#', '12a']) {
    lookup.typed(text);
    assert.equal(lookup.state.status, 'unreadable', text);
    wait(5000);
  }
  await settle();
  assert.deepEqual(asked, []);
  // Halfway through typing a link is no mistake yet; finished, it is looked up.
  lookup.typed('https://github.com/acme/shop/issues/9');
  assert.equal(lookup.state.status, 'looking');
  wait();
  await settle();
  assert.deepEqual(asked, ['https://github.com/acme/shop/issues/9']);
});

test('a lookup that fails says why, until the field says something else', async (t) => {
  const { lookup, states, wait, fail } = setup(t);
  const error = new Error('The GitHub CLI is not signed in. Run "gh auth login" in a terminal, then try again.');
  lookup.typed('123');
  wait();
  await settle();
  await fail('123', error);
  assert.deepEqual(lookup.state, { status: 'failed', error });
  assert.equal(lookup.item, null);
  lookup.typed('124');
  assert.deepEqual(lookup.state, { status: 'looking' });
  assert.deepEqual(states, ['looking', 'failed', 'looking']);
});

test('a lookup that throws before it has asked anything fails the same way', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lookup = new ItemLookup({
    ask: () => {
      throw new Error('no bridge');
    },
    changed() {},
    pauseMs: PAUSE,
  });
  lookup.typed('123');
  t.mock.timers.tick(PAUSE);
  await settle();
  assert.equal(lookup.state.status, 'failed');
  assert.equal(lookup.state.error.message, 'no bridge');
});

// ---- when OK is pressed ----------------------------------------------------------------------------

test('with nothing in the field, or an answer already showing, OK goes ahead', async (t) => {
  const { lookup, asked, wait, answer } = setup(t);
  assert.equal(await lookup.settled(), true);
  assert.deepEqual(asked, []);
  lookup.typed('123');
  wait();
  await settle();
  await answer('123', issue(123));
  assert.equal(await lookup.settled(), true);
  assert.deepEqual(asked, ['123']);
});

test('OK pressed during the pause asks at once, and waits to show what was found', async (t) => {
  const { lookup, asked, answer } = setup(t);
  lookup.typed('123');
  const settled = lookup.settled();
  await settle();
  assert.deepEqual(asked, ['123'], 'without waiting for the pause');
  let done = false;
  settled.then(() => (done = true));
  await settle();
  assert.equal(done, false, 'nothing is made before the answer is in');
  await answer('123', issue(123));
  // The form has only just been filled in: the user gets to look before anything is made.
  assert.equal(await settled, false);
  assert.equal(lookup.item.number, 123);
  assert.equal(await lookup.settled(), true, 'the next OK goes ahead');
  t.mock.timers.tick(5000);
  await settle();
  assert.deepEqual(asked, ['123'], 'and the pause that was cut short asks nothing more');
});

test('OK pressed while the answer is on its way waits for that one, and asks nothing twice', async (t) => {
  const { lookup, asked, wait, answer } = setup(t);
  lookup.typed('123');
  wait();
  await settle();
  const settled = lookup.settled();
  await settle();
  assert.deepEqual(asked, ['123']);
  await answer('123', issue(123));
  assert.equal(await settled, false);
});

test('OK is refused with the reason when the lookup fails, or failed before', async (t) => {
  const { lookup, fail } = setup(t);
  const error = new Error('GitHub could not be reached. Check your internet connection.');
  lookup.typed('123');
  const refused = assert.rejects(lookup.settled(), error);
  await settle();
  await fail('123', error);
  await refused;
  await assert.rejects(lookup.settled(), error, 'still the case on a second OK');
});

test('OK is refused for text that names nothing', async (t) => {
  const { lookup, asked } = setup(t);
  lookup.typed('fix login');
  await assert.rejects(lookup.settled(), { message: REFERENCE_HELP });
  assert.deepEqual(asked, []);
});

test('text changed while OK was waiting leaves the form open', async (t) => {
  const { lookup, answer } = setup(t);
  lookup.typed('12');
  const settled = lookup.settled();
  await settle();
  lookup.typed('123');
  await answer('12', issue(12));
  assert.equal(await settled, false);
  assert.equal(lookup.state.status, 'looking');
  assert.equal(lookup.item, null);
});
