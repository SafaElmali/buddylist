import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

test('bundled sounds match the unmodified MSN Messenger 7.5.0324 recordings', () => {
  // Extracted from the unpatched installer in Escargot's archive (see README).
  const originals = {
    'online.wav': '29154a6c903806f64add4fba458e832bea7a3fa99a8a448b9e5adec6b64e1134',
    'type.wav': 'd24453f373120494869999f55b3ab667d0f39f88c78b8e167ea4c76e9f1c6426',
    'nudge.wav': '47d6ed07eba503e0f0bd5ed3e2635d046576ceedcda72f3cf8672a87b93c0ec4',
  };
  for (const [file, hash] of Object.entries(originals)) {
    const audio = readFileSync(new URL(`../src/renderer/sounds/${file}`, import.meta.url));
    assert.equal(createHash('sha256').update(audio).digest('hex'), hash, file);
  }
});

const present = new Set();
const requested = [];
const played = [];
const instances = [];
let synths = 0;
let audioWorks = true;

class FakeAudio extends EventTarget {
  constructor(src) {
    super();
    this.src = src;
    this.currentTime = 7;
    this.volume = 1;
    this.playbackRate = 1;
    this.paused = true;
    requested.push(src);
    instances.push(this);
  }
  async play() {
    this.paused = false;
    await Promise.resolve(); // The browser waits for the recording to load.
    if (this.paused) throw new DOMException('Playback stopped', 'AbortError');
    if (!present.has(this.src) || !audioWorks) throw new Error('Audio unavailable');
    played.push({ src: this.src, from: this.currentTime });
  }
  pause() {
    this.paused = true;
  }
}

globalThis.Audio = FakeAudio;
globalThis.AudioContext = class {
  constructor() {
    synths += 1;
    throw new Error('Notifications must use their original recordings');
  }
};

let run = 0;
async function load(files = []) {
  present.clear();
  for (const file of files) present.add(`sounds/${file}`);
  run += 1;
  const { sounds } = await import(`../src/renderer/lib/sounds.js?run=${run}`);
  return sounds;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  delete globalThis.__CLAUDE_MESSENGER_SYNTH_ONLY__;
  requested.length = 0;
  played.length = 0;
  instances.length = 0;
  synths = 0;
  audioWorks = true;
});

test('the old synth-only flag cannot replace the three classic recordings', async () => {
  globalThis.__CLAUDE_MESSENGER_SYNTH_ONLY__ = true;
  try {
    const sounds = await load(['type.wav', 'nudge.wav', 'online.wav']);
    for (const name of ['message', 'nudge', 'online']) sounds.play(name);
    await settle();
    assert.deepEqual(
      played.map((p) => p.src),
      ['sounds/type.wav', 'sounds/nudge.wav', 'sounds/online.wav']
    );
    assert.equal(synths, 0);
    assert.ok(instances.every((audio) => audio.volume === 1 && audio.playbackRate === 1));
  } finally {
    delete globalThis.__CLAUDE_MESSENGER_SYNTH_ONLY__;
  }
});

test('play starts immediately and lets the browser buffer the recording', async () => {
  const sounds = await load(['online.wav']);
  assert.deepEqual(requested, [], 'unused recordings are not loaded');
  sounds.play('online');
  assert.deepEqual(requested, ['sounds/online.wav']);
  assert.equal(instances[0].paused, false, 'play is called without first awaiting a load event');
  await settle();
  assert.deepEqual(played, [{ src: 'sounds/online.wav', from: 0 }]);
});

test('a recording is reused and restarted from the beginning', async () => {
  const sounds = await load(['nudge.wav']);
  sounds.play('nudge');
  await settle();
  instances[0].currentTime = 0.5;
  sounds.play('nudge');
  await settle();
  assert.equal(instances.length, 1);
  assert.deepEqual(
    played.map((p) => p.from),
    [0, 0]
  );
});

test('a failed recording stays silent and is retried next time', async () => {
  const sounds = await load(['nudge.wav']);
  sounds.play('message');
  await settle();
  assert.equal(played.length, 0);
  assert.equal(synths, 0);
  present.add('sounds/type.wav');
  sounds.play('message');
  sounds.play('nudge');
  await settle();
  assert.deepEqual(
    played.map((p) => p.src),
    ['sounds/type.wav', 'sounds/nudge.wav']
  );
  assert.equal(requested.filter((src) => src === 'sounds/type.wav').length, 2);
});

test('sending and unknown sounds do not request or synthesize audio', async () => {
  const sounds = await load(['type.wav', 'nudge.wav', 'online.wav', 'send.wav']);
  for (const name of ['send', 'fanfare', 'constructor']) sounds.play(name);
  await settle();
  assert.deepEqual(requested, []);
  assert.equal(played.length + synths, 0);
});

test('muting stops buffered and playing notifications and blocks new ones', async () => {
  const sounds = await load(['type.wav', 'online.wav']);
  sounds.play('message');
  sounds.setEnabled(false);
  sounds.play('online');
  await settle();
  assert.equal(played.length + synths, 0);
  assert.ok(instances.every((audio) => audio.paused));
  sounds.setEnabled(true);
  sounds.play('message');
  await settle();
  assert.equal(played.length, 1);
  sounds.setEnabled(false);
  assert.ok(instances.every((audio) => audio.paused));
});

test('an unavailable audio device fails quietly and can recover', async () => {
  const sounds = await load(['type.wav']);
  audioWorks = false;
  sounds.play('message');
  await settle();
  assert.equal(played.length + synths, 0);
  audioWorks = true;
  sounds.play('message');
  await settle();
  assert.equal(played.length, 1);
});
