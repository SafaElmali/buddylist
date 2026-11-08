import { test } from 'node:test';
import assert from 'node:assert/strict';
// Notification sample loading is tested separately; these tests cover Wink audio.
const { sounds } = await import('../src/renderer/lib/sounds.js');

function setup(t, { reject = false } = {}) {
  const original = globalThis.Audio;
  const files = [];
  globalThis.Audio = class extends EventTarget {
    constructor(src) {
      super();
      this.src = src;
      this.paused = true;
      this.loads = 0;
      files.push(this);
    }
    play() {
      this.paused = false;
      return reject ? Promise.reject(new Error('Audio unavailable')) : Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
    removeAttribute(name) {
      if (name === 'src') this.src = '';
    }
    load() {
      this.loads += 1;
    }
  };
  sounds.setEnabled(true);
  t.after(() => {
    sounds.setEnabled(false);
    if (original === undefined) delete globalThis.Audio;
    else globalThis.Audio = original;
  });
  return files;
}

test('wink sound plays once and its stop function releases playback', (t) => {
  const files = setup(t);
  const stop = sounds.playFile('pack://winks/heart.wav');
  assert.equal(files[0].src, 'pack://winks/heart.wav');
  assert.equal(files[0].paused, false);
  stop();
  stop();
  assert.equal(files[0].paused, true);
  assert.equal(files[0].src, '');
  assert.equal(files[0].loads, 1, 'stopping twice is safe');
});

test('turning off Sounds stops playing winks and prevents new audio', (t) => {
  const files = setup(t);
  sounds.playFile('pack://winks/heart.wav');
  sounds.playFile('pack://winks/kiss.wav');
  sounds.setEnabled(false);
  assert.ok(files.every((audio) => audio.paused && !audio.src));
  sounds.playFile('pack://winks/knock.wav')();
  assert.equal(files.length, 2);
  sounds.setEnabled(true);
  assert.ok(
    files.every((audio) => audio.paused),
    'unmuting does not restart old winks'
  );
  sounds.playFile('pack://winks/knock.wav');
  assert.equal(files.length, 3);
  assert.equal(files[2].paused, false);
});

test('ended or missing audio is released without breaking the animation', (t) => {
  const files = setup(t);
  for (const event of ['ended', 'error']) {
    sounds.playFile('pack://winks/heart.wav');
    const audio = files.at(-1);
    audio.dispatchEvent(new Event(event));
    assert.equal(audio.paused, true);
    assert.equal(audio.src, '');
  }
});

test('blocked or unsupported audio fails quietly', async (t) => {
  const files = setup(t, { reject: true });
  const stop = sounds.playFile('pack://winks/heart.wav');
  await Promise.resolve();
  assert.equal(files[0].paused, true);
  assert.equal(files[0].src, '');
  assert.doesNotThrow(stop);
});
