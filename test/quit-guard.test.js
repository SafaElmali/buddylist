import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QuitGuard, quitQuestion, whenQuitting } from '../src/main/quit-guard.js';
import { busyContacts } from '../src/shared/busy-contacts.js';

const contact = (name, status) => ({ id: name.toLowerCase(), name, status });
const BUSY = [
  contact('Claude', 'busy'),
  contact('Codex', 'online'),
  contact('Gemini', 'away'),
  contact('Old', 'offline'),
];

/**
 * The app as far as quitting goes: `before-quit` listeners in the order they were added, as
 * src/main/index.js adds them, and a quit that happens when none of them held it back.
 */
function fakeApp({ views = BUSY, answers = [], unattended = false } = {}) {
  const listeners = [];
  const asked = [];
  const ran = [];
  let quits = 0;
  let resolveAnswer = null;
  const app = {
    on: (name, listener) => {
      assert.equal(name, 'before-quit');
      listeners.push(listener);
    },
    quit() {
      const event = {
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
      for (const listener of listeners) listener(event);
      if (!event.defaultPrevented) quits += 1;
      return event;
    },
  };
  const guard = new QuitGuard({
    unattended,
    views: () => views,
    ask: (question) => {
      asked.push(question);
      if (answers.length) return Promise.resolve(answers.shift());
      // No answer queued: the question stays open until the test gives one.
      return new Promise((resolve) => (resolveAnswer = resolve));
    },
    quit: () => app.quit(),
  });
  // The guard first, then what index.js does as the app quits.
  app.on('before-quit', (event) => guard.beforeQuit(event));
  whenQuitting(app, () => ran.push('flush analytics, end conversations, come back from away'));
  return {
    app,
    guard,
    asked,
    ran,
    get quits() {
      return quits;
    },
    answer: async (yes) => {
      resolveAnswer(yes);
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('the contacts a quit would interrupt are those at work and those waiting for you', () => {
  assert.deepEqual(
    busyContacts(BUSY).map((view) => view.name),
    ['Claude', 'Gemini']
  );
  assert.deepEqual(busyContacts([contact('Codex', 'online'), contact('Old', 'offline')]), []);
});

test('the question says how many conversations end, and with whom, the way MSN did', () => {
  assert.deepEqual(quitQuestion(busyContacts(BUSY)), {
    type: 'warning',
    message: 'Signing out will end 2 conversations.',
    detail: 'Claude and Gemini are still working or waiting for you.',
    buttons: ['Quit', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  const one = quitQuestion([contact('Claude (shop-2)', 'busy')]);
  assert.equal(one.message, 'Signing out will end 1 conversation.');
  assert.equal(one.detail, 'Claude (shop-2) is still working or waiting for you.');
  const three = quitQuestion(['A', 'B', 'C'].map((name) => contact(name, 'busy')));
  assert.equal(three.detail, 'A, B and C are still working or waiting for you.');
  const eight = quitQuestion(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((name) => contact(name, 'away')));
  assert.equal(eight.message, 'Signing out will end 8 conversations.');
  assert.equal(eight.detail, 'A, B, C, D, E and 3 others are still working or waiting for you.');
  const six = quitQuestion(['A', 'B', 'C', 'D', 'E', 'F'].map((name) => contact(name, 'busy')));
  assert.equal(six.detail, 'A, B, C, D, E and 1 other are still working or waiting for you.');
});

test('restarting to update is asked about in its own words', () => {
  const question = quitQuestion(busyContacts(BUSY), { restart: true });
  assert.equal(question.message, 'Restarting to update will end 2 conversations.');
  assert.deepEqual(question.buttons, ['Restart', 'Cancel']);
});

test('quitting with a contact at work asks, and Cancel leaves everything as it was', async () => {
  const a = fakeApp();
  const event = a.app.quit();
  assert.equal(event.defaultPrevented, true);
  assert.equal(a.asked.length, 1);
  assert.equal(a.asked[0].message, 'Signing out will end 2 conversations.');
  await a.answer(false);
  assert.equal(a.quits, 0);
  assert.deepEqual(a.ran, [], 'no conversation was ended');
});

test('Quit quits, once, without asking again', async () => {
  const a = fakeApp();
  a.app.quit();
  await a.answer(true);
  assert.equal(a.quits, 1);
  assert.equal(a.ran.length, 1);
  assert.equal(a.asked.length, 1);
});

test('quitting again while the question is open is still that question', async () => {
  const a = fakeApp();
  a.app.quit();
  const again = a.app.quit();
  assert.equal(again.defaultPrevented, true);
  assert.equal(a.asked.length, 1);
  await a.answer(true);
  assert.equal(a.quits, 1);
});

test('with everyone idle the app quits at once', () => {
  const a = fakeApp({ views: [contact('Codex', 'online'), contact('Old', 'offline')] });
  const event = a.app.quit();
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(a.asked, []);
  assert.equal(a.quits, 1);
});

test('unattended tests quit with busy contacts and still run the shutdown listeners', () => {
  const a = fakeApp({ unattended: true });
  assert.equal(a.app.quit().defaultPrevented, false);
  assert.deepEqual(a.asked, []);
  assert.equal(a.quits, 1);
  assert.equal(a.ran.length, 1);
});

test('unattended restart does not open a native confirmation either', async () => {
  const a = fakeApp({ unattended: true });
  assert.equal(await a.guard.confirmRestart(), true);
  assert.deepEqual(a.asked, []);
  assert.equal(a.app.quit().defaultPrevented, false);
  assert.equal(a.quits, 1);
});

test('unattended quitting still waits for dev servers to stop', async () => {
  const a = fakeApp({ unattended: true });
  let running = true;
  whenQuitting(a.app, (event) => {
    if (!running) return;
    event.preventDefault();
    setImmediate(() => {
      running = false;
      a.app.quit();
    });
  });
  assert.equal(a.app.quit().defaultPrevented, true);
  assert.equal(a.quits, 0);
  await settle();
  assert.equal(running, false);
  assert.equal(a.quits, 1);
  assert.deepEqual(a.asked, []);
});

test('while macOS shuts down, restarts or logs out, nobody is asked', () => {
  const a = fakeApp();
  a.guard.systemShutdown();
  assert.equal(a.app.quit().defaultPrevented, false);
  assert.deepEqual(a.asked, []);
  assert.equal(a.quits, 1);
});

test('a quit held back again to stop the dev servers is asked about once', async () => {
  const a = fakeApp();
  // As Runs.holdQuit does: held back while something runs, then quit again once it has stopped.
  let running = 1;
  const stopped = [];
  whenQuitting(a.app, (event) => {
    if (!running) return;
    event.preventDefault();
    setImmediate(() => {
      running = 0;
      stopped.push('dev server');
      a.app.quit();
    });
  });
  a.app.quit();
  assert.deepEqual(stopped, [], 'nothing is stopped while the question is open');
  await a.answer(true);
  await settle();
  assert.deepEqual(stopped, ['dev server']);
  assert.equal(a.asked.length, 1);
  assert.equal(a.quits, 1);
});

test('Restart asks the same question, and the quit it brings goes ahead without asking again', async () => {
  const a = fakeApp({ answers: [true] });
  assert.equal(await a.guard.confirmRestart(), true);
  assert.equal(a.asked[0].message, 'Restarting to update will end 2 conversations.');
  assert.equal(a.app.quit().defaultPrevented, false);
  assert.equal(a.asked.length, 1);
  assert.equal(a.quits, 1);
});

test('Restart answered with Cancel changes nothing, and the next quit still asks', async () => {
  const a = fakeApp({ answers: [false] });
  assert.equal(await a.guard.confirmRestart(), false);
  assert.equal(a.app.quit().defaultPrevented, true);
  assert.equal(a.asked.length, 2);
});

test('Restart with everyone idle goes ahead without a question', async () => {
  const a = fakeApp({ views: [contact('Codex', 'online')] });
  assert.equal(await a.guard.confirmRestart(), true);
  assert.deepEqual(a.asked, []);
});

test('a question that could not be shown is a Cancel', async () => {
  const guard = new QuitGuard({
    views: () => BUSY,
    ask: () => Promise.reject(new Error('no dialog')),
    quit: () => assert.fail('nothing may quit'),
  });
  assert.equal(await guard.confirmRestart(), false);
  const event = { defaultPrevented: false, preventDefault: () => (event.defaultPrevented = true) };
  guard.beforeQuit(event);
  await settle();
  assert.equal(event.defaultPrevented, true);
});
