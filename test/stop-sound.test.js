import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { isGroup } from '../src/renderer/chat/participants.js';
import { STOP_AGAIN_MS, StopKey } from '../src/renderer/chat/stop-key.js';

const source = readFileSync(new URL('../src/renderer/chat/main.js', import.meta.url), 'utf8');
// Exercise the window's actual handlers without booting its unrelated panes and account services.
const handler = (name) => source.match(new RegExp(`async function ${name}\\(\\) \\{[\\s\\S]*?\\n\\}`))[0];
// The keys as the window hears them: first on their way down (capture), then as the document has them.
const keyboard = source.match(
  / {2}window\.addEventListener\('keydown', \(e\) => stopKey\.heard\(e\), true\);[\s\S]*?\n {2}document\.addEventListener\('keydown', \(e\) => \{[\s\S]*?\n {2}\}\);/
)[0];
const stopKeySource = source.match(/^const stopKey = new StopKey\([\s\S]*?\n\}\);$/m)[0];
const presence = source.match(/^function refreshPresence\(\) \{[\s\S]*?\n\}$/m)[0];
const soundSource = readFileSync(new URL('../src/renderer/lib/sounds.js', import.meta.url), 'utf8');

const CLAUDE = { id: 'contact-1', name: 'Claude' };
const CODEX = { id: 'guest-1', name: 'Codex' };

function window({ state = 'working', enabled = true, audioWorks = true, participants = [CLAUDE] } = {}) {
  const played = [];
  const interrupted = [];
  const nudges = [];
  const errors = [];
  const states = [];
  /** What the status bar said each time it was drawn, while a first Esc waited: null once it says the usual. */
  const statuses = [];
  const said = { textContent: '' };
  let finish;
  let keydown;
  const heard = {};
  const ctx = { state, contactId: 'contact-1', participants, stopHint: null };
  const surfaces = { terminal: false, browser: false, overlay: false, settings: false, voice: false };
  const composer = { editing: false, stopEditing: () => (composer.editing = false), refresh() {} };
  const context = vm.createContext({
    ctx,
    composer,
    StopKey,
    isGroup,
    $: (selector) => (selector === '#stop-said' ? said : null),
    renderStatus: (now) => statuses.push(now.stopHint),
    renderPresence() {},
    showWorking() {},
    meter: { paint() {} },
    pullRequest: { paint() {} },
    todos: { paint() {} },
    nowLines: { paint() {} },
    statusLine: () => ({ text: '' }),
    settingsView: { isOpen: () => surfaces.settings, setBusy() {} },
    window: { addEventListener: (type, listener, capture) => (heard[type] = { listener, capture }) },
    Audio: class {
      constructor(src) {
        this.src = src;
      }
      play() {
        played.push(this.src);
        return audioWorks ? Promise.resolve() : Promise.reject(new Error('No audio device'));
      }
      pause() {}
    },
    api: {
      chat: {
        interrupt: (id) => {
          interrupted.push(id);
          return new Promise((resolve) => (finish = resolve));
        },
      },
    },
    conversation: {
      lastReceived: null,
      addNudge: (from) => nudges.push(from),
      addError: (text) => errors.push(text),
    },
    errorText: (err) => err.message,
    document: {
      body: { classList: { add() {}, remove() {} }, offsetWidth: 1 },
      querySelector: () => surfaces.overlay,
      addEventListener: (_type, listener) => (keydown = listener),
    },
    terminals: { owns: () => surfaces.terminal },
    files: { ownsFind: () => false },
    browser: { owns: () => surfaces.browser },
    voice: { keyDown: () => surfaces.voice },
    archived: () => false,
    keys: () => ({}),
    matchesShortcut: () => false,
    isFindKey: () => false,
    shortcutAnswer: () => null,
    IS_MAC: true,
    NEXT_TAB_SHORTCUT: '',
    PREVIOUS_TAB_SHORTCUT: '',
  });
  vm.runInContext(soundSource.replace('export const sounds', 'const sounds'), context);
  // Stop's own presence is noted: whether it was stopping each time the window was drawn again.
  const counted = presence.replace('{', '{\n  states.push(Boolean(ctx.stopping));');
  vm.runInContext(
    [
      'const host = () => ctx.participants[0];',
      stopKeySource,
      counted,
      handler('stop'),
      handler('nudge'),
      keyboard,
    ].join('\n'),
    Object.assign(context, { states })
  );
  const setEnabled = (on) => vm.runInContext(`sounds.setEnabled(${Boolean(on)})`, context);
  setEnabled(enabled);
  /**
   * A key, as the window has it. `taken`: something in the window had it on its way, such as a popup, a find bar
   * or an edit in a card, and kept it from the document.
   */
  const key = (name, { repeat = false, isComposing = false, taken = false } = {}) => {
    const e = { key: name, repeat, isComposing, preventDefault() {} };
    heard.keydown.listener(e);
    if (!taken) keydown(e);
  };
  return {
    ctx,
    surfaces,
    composer,
    played,
    interrupted,
    nudges,
    errors,
    states,
    api: context.api,
    setEnabled,
    stop: () => context.stop(),
    finish: (settled = true) => {
      if (settled) ctx.state = 'idle';
      finish();
    },
    statuses,
    said,
    heard,
    key,
    escape: (options) => key('Escape', options),
    /** Esc twice, as fast as anyone presses it. */
    twice: () => {
      key('Escape');
      key('Escape');
    },
    refreshPresence: () => context.refreshPresence(),
    blur: () => heard.blur.listener(),
  };
}

test('Stop locks both entry points immediately and releases after completion or failure', async () => {
  const w = window();
  const first = w.stop();
  assert.equal(w.ctx.stopping, true);
  await w.stop();
  assert.equal(w.interrupted.length, 1);
  assert.equal(w.played.length, 1);
  w.finish();
  await first;
  assert.equal(w.ctx.stopping, false);
  assert.deepEqual(w.states, [true, false]);
  w.ctx.state = 'working';
  w.api.chat.interrupt = async () => {
    throw new Error('Connection lost');
  };
  await w.stop();
  assert.equal(w.ctx.stopping, false);
  assert.deepEqual(w.errors, ['Connection lost']);
});

test('an interrupt acknowledgement before the final state keeps Stop locked', async () => {
  const w = window();
  const first = w.stop();
  w.finish(false);
  await first;
  assert.equal(w.ctx.stopping, true);
  await w.stop();
  assert.equal(w.interrupted.length, 1);
  assert.equal(w.played.length, 1);
});

for (const state of ['working', 'waiting', 'connecting']) {
  test(`Stop in ${state} plays immediately once, with no added nudge line`, async () => {
    const w = window({ state });
    const stopped = w.stop();
    assert.deepEqual(w.played, ['sounds/nudge.wav'], 'before the interrupt finishes');
    assert.deepEqual(w.interrupted, ['contact-1']);
    assert.deepEqual(w.nudges, []);
    w.finish();
    await stopped;
    assert.equal(w.played.length, 1, 'completion does not replay it');
    w.ctx.state = 'online';
    await w.stop();
    assert.equal(w.played.length, 1, 'a stale Stop with no turn does nothing');
  });
}

test('Stop uses the live sound preference without changing cancellation', async () => {
  const w = window({ enabled: false });
  const first = w.stop();
  assert.deepEqual(w.played, []);
  assert.equal(w.interrupted.length, 1);
  w.finish();
  await first;
  w.setEnabled(true);
  w.ctx.state = 'working';
  const second = w.stop();
  assert.deepEqual(w.played, ['sounds/nudge.wav']);
  assert.equal(w.interrupted.length, 2);
  w.finish();
  await second;
  w.setEnabled(false);
  w.ctx.state = 'working';
  const third = w.stop();
  w.finish();
  await third;
  assert.equal(w.played.length, 1);
  assert.equal(w.interrupted.length, 3);
});

test('an unavailable audio device does not prevent Stop', async () => {
  const w = window({ audioWorks: false });
  const stopped = w.stop();
  assert.deepEqual(w.interrupted, ['contact-1']);
  w.finish();
  await stopped;
});

test('one Escape stops nobody: it says in the status bar, and to a screen reader, that a second one would', () => {
  const w = window();
  w.escape();
  assert.deepEqual(w.interrupted, []);
  assert.deepEqual(w.played, []);
  assert.deepEqual(w.nudges, []);
  assert.equal(w.ctx.stopHint, 'Press Esc again to stop Claude.');
  assert.equal(w.statuses.at(-1), 'Press Esc again to stop Claude.', 'the status bar is drawn with it');
  assert.equal(w.said.textContent, 'Press Esc again to stop Claude.');
  assert.equal(w.heard.keydown.capture, true, 'every key is heard before anything in the window takes it');
});

test('a second Escape in time stops it as one did before: the sound, the nudge and the interrupt', () => {
  const w = window();
  w.twice();
  assert.deepEqual(w.played, ['sounds/nudge.wav']);
  assert.deepEqual(w.nudges, ['me']);
  assert.deepEqual(w.interrupted, ['contact-1']);
  assert.equal(w.ctx.stopHint, null, 'the status bar says the usual again');
  assert.equal(w.said.textContent, '');
  w.escape();
  assert.equal(w.interrupted.length, 1, 'the press after a stop is a first again');
  w.escape();
  assert.equal(w.interrupted.length, 2);
});

test('a held Escape repeats as one press, and is never the second', () => {
  const w = window();
  w.escape();
  w.escape({ repeat: true });
  w.escape({ repeat: true });
  assert.deepEqual(w.interrupted, []);
  assert.equal(w.ctx.stopHint, 'Press Esc again to stop Claude.', 'a repeat does not put the first away either');
  w.escape();
  assert.deepEqual(w.interrupted, ['contact-1'], 'the next real press is the second');
  const held = window();
  held.escape({ repeat: true });
  held.escape({ repeat: true });
  assert.equal(held.ctx.stopHint, null, 'repeats alone are no first press');
});

test('after the wait, the next Escape is a first again', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = window();
  w.escape();
  t.mock.timers.tick(STOP_AGAIN_MS - 1);
  assert.equal(w.ctx.stopHint, 'Press Esc again to stop Claude.');
  t.mock.timers.tick(1);
  assert.equal(w.ctx.stopHint, null, 'the hint goes when the wait is over');
  assert.equal(w.said.textContent, '');
  w.escape();
  assert.deepEqual(w.interrupted, []);
  assert.equal(w.ctx.stopHint, 'Press Esc again to stop Claude.');
  t.mock.timers.tick(STOP_AGAIN_MS - 1);
  w.escape();
  assert.deepEqual(w.interrupted, ['contact-1'], 'just in time is in time');
});

test('Escape also honors mute while still interrupting', () => {
  const w = window({ enabled: false, state: 'waiting' });
  w.twice();
  assert.deepEqual(w.played, []);
  assert.deepEqual(w.interrupted, ['contact-1']);
});

test('Escape remains local to terminals, browser, overlays, settings, voice and message edits', () => {
  for (const surface of ['terminal', 'browser', 'overlay', 'settings', 'voice']) {
    const w = window();
    w.surfaces[surface] = true;
    w.twice();
    assert.deepEqual(w.played, [], surface);
    assert.deepEqual(w.interrupted, [], surface);
    assert.equal(w.ctx.stopHint, null, surface);
  }
  const w = window();
  w.composer.editing = true;
  w.twice();
  assert.equal(w.composer.editing, false, 'the first Esc calls the edit off');
  assert.deepEqual(w.interrupted, [], 'and the second is a first press');
  assert.equal(w.ctx.stopHint, 'Press Esc again to stop Claude.');
});

test('an Escape something else uses puts a first press away', () => {
  for (const surface of ['terminal', 'browser', 'overlay', 'settings', 'voice']) {
    const w = window();
    w.escape();
    w.surfaces[surface] = true;
    w.escape();
    assert.equal(w.ctx.stopHint, null, `${surface}: the hint goes`);
    w.surfaces[surface] = false;
    w.escape();
    assert.deepEqual(w.interrupted, [], surface);
    assert.equal(w.ctx.stopHint, 'Press Esc again to stop Claude.', `${surface}: a first press again`);
  }
  const editing = window();
  editing.escape();
  editing.composer.editing = true;
  editing.escape();
  editing.escape();
  assert.deepEqual(editing.interrupted, [], 'an Esc that called an edit off');
  // A popup's, a find bar's, a card's or a picture's Esc is theirs before the document hears of it.
  const taken = window();
  taken.escape();
  taken.escape({ taken: true });
  assert.equal(taken.ctx.stopHint, null);
  taken.escape();
  assert.deepEqual(taken.interrupted, [], 'an Esc kept from the document');
});

test('another key, or the window losing the focus, puts a first press away; Shift does not', () => {
  const typed = window();
  typed.escape();
  typed.key('a');
  assert.equal(typed.ctx.stopHint, null);
  typed.escape();
  assert.deepEqual(typed.interrupted, []);
  const shifted = window();
  shifted.escape();
  shifted.key('Shift');
  shifted.escape();
  assert.deepEqual(shifted.interrupted, ['contact-1'], 'a modifier on its own is no key of its own');
  const away = window();
  away.escape();
  away.blur();
  assert.equal(away.ctx.stopHint, null);
  assert.equal(away.said.textContent, '');
  away.escape();
  assert.deepEqual(away.interrupted, []);
});

test('an Escape an input method takes is its own, not a press', () => {
  const w = window();
  w.escape();
  w.escape({ isComposing: true });
  assert.deepEqual(w.interrupted, []);
  assert.equal(w.ctx.stopHint, null);
});

test('the agent going idle puts a first press away', () => {
  for (const state of ['online', 'offline']) {
    const w = window();
    w.escape();
    w.ctx.state = state;
    w.refreshPresence();
    assert.equal(w.ctx.stopHint, null, state);
    assert.equal(w.said.textContent, '', state);
    w.ctx.state = 'working';
    w.escape();
    assert.deepEqual(w.interrupted, [], `${state}: the next Esc is a first`);
  }
  const busy = window();
  busy.escape();
  busy.ctx.state = 'waiting';
  busy.refreshPresence();
  assert.equal(busy.ctx.stopHint, 'Press Esc again to stop Claude.', 'waiting for you is still at work');
  busy.escape();
  assert.deepEqual(busy.interrupted, ['contact-1']);
});

test('in a group, Esc twice stops everyone, also while a guest is the one speaking', () => {
  const w = window({
    participants: [
      { ...CLAUDE, state: 'online' },
      { ...CODEX, state: 'working' },
    ],
  });
  w.escape();
  assert.deepEqual(w.interrupted, []);
  assert.equal(w.ctx.stopHint, 'Press Esc again to stop everyone.');
  assert.equal(w.said.textContent, 'Press Esc again to stop everyone.');
  w.escape();
  assert.deepEqual(w.nudges, ['me']);
  assert.deepEqual(w.interrupted, ['contact-1'], 'the conversation, everyone in it');
});

test('Stop is still one click, with or without a first Esc waiting', async () => {
  const w = window();
  const stopped = w.stop();
  assert.deepEqual(w.interrupted, ['contact-1']);
  w.finish();
  await stopped;
  w.refreshPresence();
  w.ctx.state = 'working';
  w.escape();
  const again = w.stop();
  assert.deepEqual(w.interrupted, ['contact-1', 'contact-1']);
  w.finish();
  await again;
  w.refreshPresence();
  assert.equal(w.ctx.stopHint, null, 'stopped, it has nothing left to stop');
});

test('idle Stop and Escape, and Escape while connecting, stay silent', async () => {
  for (const state of ['online', 'offline']) {
    const w = window({ state });
    await w.stop();
    w.twice();
    assert.deepEqual(w.played, []);
    assert.deepEqual(w.interrupted, []);
    assert.equal(w.ctx.stopHint, null, `${state}: no hint`);
  }
  const w = window({ state: 'connecting' });
  w.twice();
  assert.deepEqual(w.played, []);
  assert.deepEqual(w.interrupted, []);
  assert.equal(w.ctx.stopHint, null);
});
