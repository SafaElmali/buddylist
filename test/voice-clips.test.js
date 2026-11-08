import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeWav,
  formatElapsed,
  joinSamples,
  MAX_CLIP_MS,
  microphoneProblem,
  MIN_CLIP_MS,
  noMicrophone,
  resample,
  SAMPLE_RATE,
  VoiceClips,
} from '../src/renderer/chat/voice.js';

// ---- the WAV file -------------------------------------------------------------------------------

const tag = (wav, at, length = 4) => String.fromCharCode(...new Uint8Array(wav, at, length));
const pcm = (wav) => new Int16Array(wav.slice(44));

test('a WAV starts with the header whisper expects: 16 kHz, one channel, 16 bits', () => {
  const wav = encodeWav(new Float32Array(16000));
  const view = new DataView(wav);
  assert.equal(wav.byteLength, 44 + 32000);
  assert.equal(tag(wav, 0), 'RIFF');
  assert.equal(view.getUint32(4, true), wav.byteLength - 8, 'the size of everything after it');
  assert.equal(tag(wav, 8, 8), 'WAVEfmt ');
  assert.equal(view.getUint32(16, true), 16);
  assert.equal(view.getUint16(20, true), 1, 'PCM');
  assert.equal(view.getUint16(22, true), 1, 'one channel');
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(28, true), 32000, 'bytes a second');
  assert.equal(view.getUint16(32, true), 2, 'bytes a sample');
  assert.equal(view.getUint16(34, true), 16, 'bits a sample');
  assert.equal(tag(wav, 36), 'data');
  assert.equal(view.getUint32(40, true), 32000);
});

test('a WAV is as long as its samples, two bytes each', () => {
  for (const count of [1, 7, 480, 16000 * 3]) {
    const wav = encodeWav(new Float32Array(count));
    assert.equal(wav.byteLength, 44 + count * 2);
    assert.equal(new DataView(wav).getUint32(40, true), count * 2);
  }
});

test('a WAV can say it has another rate', () => {
  const view = new DataView(encodeWav(new Float32Array(10), 44100));
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint32(28, true), 88200);
});

test('samples become 16-bit numbers, little end first', () => {
  const wav = encodeWav(Float32Array.of(0, 1, -1, 0.5, -0.5, 0.25));
  assert.deepEqual([...pcm(wav)], [0, 32767, -32768, 16384, -16384, 8192]);
  assert.deepEqual([...new Uint8Array(wav, 46, 2)], [0xff, 0x7f]);
});

test('anything louder than the loudest sample is clipped, not wrapped around', () => {
  const wav = encodeWav(Float32Array.of(1.0001, 1.5, 40, -1.0001, -1.5, -40, Infinity, -Infinity));
  assert.deepEqual([...pcm(wav)], [32767, 32767, 32767, -32768, -32768, -32768, 32767, -32768]);
});

test('a sample that is not a number is silence', () => {
  assert.deepEqual([...pcm(encodeWav(Float32Array.of(0.5, NaN, -0.5)))], [16384, 0, -16384]);
});

test('no samples make a WAV that is only its header', () => {
  const wav = encodeWav(new Float32Array(0));
  assert.equal(wav.byteLength, 44);
  assert.equal(new DataView(wav).getUint32(4, true), 36);
  assert.equal(new DataView(wav).getUint32(40, true), 0);
});

// ---- resampling ---------------------------------------------------------------------------------

const sine = (hz, rate, seconds) =>
  Float32Array.from({ length: rate * seconds }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate));
/** How often a tone goes through zero each second: twice its pitch. */
const crossings = (samples, rate) => {
  let count = 0;
  for (let i = 1; i < samples.length; i += 1) if (samples[i - 1] < 0 !== samples[i] < 0) count += 1;
  return (count * rate) / samples.length;
};

test('a recording already at 16 kHz is left alone', () => {
  const samples = Float32Array.of(0.1, 0.2, 0.3);
  assert.equal(resample(samples, 16000), samples);
  assert.equal(resample(samples, 48000, 48000), samples);
});

test('an empty recording stays empty at any rate', () => {
  assert.equal(resample(new Float32Array(0), 48000).length, 0);
  assert.equal(resample(new Float32Array(0), 8000).length, 0);
  assert.equal(resample(Float32Array.of(0.5), 48000).length, 0, 'too short to make one sample');
});

test('48 kHz comes down to 16 kHz by averaging every three samples', () => {
  const out = resample(Float32Array.of(0, 0.3, 0.6, 1, 1, 1, -0.2, -0.4, -0.6), 48000);
  assert.equal(out.length, 3);
  for (const [i, want] of [0.3, 1, -0.4].entries()) assert.ok(Math.abs(out[i] - want) < 1e-6, `sample ${i}`);
});

test('a second of sound is a second of sound at any rate', () => {
  for (const rate of [8000, 11025, 22050, 32000, 44100, 48000, 96000])
    assert.equal(resample(new Float32Array(rate), rate).length, SAMPLE_RATE, `${rate} Hz`);
  assert.equal(resample(new Float32Array(44100 * 2.5), 44100).length, 40000);
});

test('a steady level stays the same level, with nothing out of range', () => {
  for (const rate of [8000, 22050, 44100, 48000]) {
    const out = resample(new Float32Array(rate).fill(0.25), rate);
    assert.ok(
      out.every((s) => Math.abs(s - 0.25) < 1e-6),
      `${rate} Hz`
    );
  }
});

test('a tone keeps its pitch on the way down', () => {
  for (const rate of [44100, 48000]) {
    const out = resample(sine(440, rate, 1), rate);
    assert.ok(Math.abs(crossings(out, SAMPLE_RATE) - 880) < 4, `${rate} Hz`);
    const peak = out.reduce((max, s) => Math.max(max, Math.abs(s)), 0);
    assert.ok(peak > 0.95 && peak <= 1, `as loud as before (${peak})`);
  }
});

test('8 kHz comes up to 16 kHz with new samples halfway between the old ones', () => {
  const out = resample(Float32Array.of(0, 1, 0, -1), 8000);
  assert.deepEqual([...out], [0, 0.5, 1, 0.5, 0, -0.5, -1, -1]);
  assert.ok(Math.abs(crossings(resample(sine(440, 8000, 1), 8000), SAMPLE_RATE) - 880) < 4);
});

test('the blocks from the microphone join up in order', () => {
  assert.deepEqual([...joinSamples([Float32Array.of(1, 2), new Float32Array(0), Float32Array.of(3)])], [1, 2, 3]);
  assert.equal(joinSamples([]).length, 0);
});

// ---- small things -------------------------------------------------------------------------------

test('the time a clip has been going reads as minutes and seconds', () => {
  assert.equal(formatElapsed(0), '0:00');
  assert.equal(formatElapsed(7000), '0:07');
  assert.equal(formatElapsed(6998), '0:07', 'a clock that ticks a touch early');
  assert.equal(formatElapsed(61000), '1:01');
  assert.equal(formatElapsed(MAX_CLIP_MS), '2:00');
});

test('a microphone that will not start is explained in a sentence', () => {
  const named = (name, message = '') => Object.assign(new Error(message), { name });
  assert.match(
    microphoneProblem(named('NotAllowedError', 'Permission denied')),
    /Microphone access is not allowed.*permissions.*restricted/
  );
  assert.match(microphoneProblem(named('TimeoutError')), /did not finish opening.*permission prompt/);
  assert.match(microphoneProblem(named('NotFoundError')), /No microphone was found.*Connect or enable/);
  assert.match(microphoneProblem(named('NotReadableError')), /could not be opened.*selected input/);
  assert.match(microphoneProblem(named('OverconstrainedError')), /does not support.*settings/);
  assert.match(microphoneProblem(named('SecurityError')), /not allowed/);
  assert.match(microphoneProblem(named('NotSupportedError')), /not available here/);
  assert.match(microphoneProblem(named('AbortError'), 'recorder'), /voice recorder.*Help > Send feedback/);
  assert.doesNotMatch(microphoneProblem(named('AbortError')), /busy|other apps/);
  assert.equal(
    microphoneProblem(named('InvalidStateError', 'the audio went away')),
    "The microphone couldn't be started: the audio went away."
  );
});

test('Mac desktop permission recovery names privacy settings and the required restart', (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { platform: 'MacIntel', userAgent: 'Electron/44' },
  });
  t.after(() => Object.defineProperty(globalThis, 'navigator', previous));
  assert.match(
    microphoneProblem({ name: 'NotAllowedError' }),
    /System Settings > Privacy & Security > Microphone.*restart buddylist/
  );
});

// ---- hold to talk -------------------------------------------------------------------------------

const settle = () => new Promise((resolve) => setImmediate(resolve));
const second = () => new Float32Array(SAMPLE_RATE).fill(0.5);

/** A microphone that hears whatever you tell it to, and keeps a log of what was asked of it. */
function fakeMicrophone({ samples = second(), sampleRate = SAMPLE_RATE, opens = () => Promise.resolve() } = {}) {
  const log = [];
  return {
    log,
    start: () => (log.push('start'), opens()),
    stop: () => (log.push('stop'), { samples, sampleRate }),
    cancel: () => log.push('cancel'),
  };
}

/** A VoiceClips with everything around it faked, and a clock you move by hand. */
function setup(t, { microphone = fakeMicrophone(), transcribe = async () => 'Hello there.', settings = {} } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const seen = { statuses: [], inserted: [], sent: [], errors: [], clips: [] };
  const voice = new VoiceClips({
    microphone,
    transcribe: (wav) => (seen.clips.push(wav), transcribe(wav)),
    insert: (text) => seen.inserted.push(text),
    send: (text) => seen.sent.push(text),
    error: (text) => seen.errors.push(text),
    status: (status) => seen.statuses.push(status),
    // Read every time they are needed, so a test can change them halfway.
    settings: () => settings,
  });
  return {
    voice,
    settings,
    microphone,
    ...seen,
    wait: (ms) => t.mock.timers.tick(ms),
    status: () => seen.statuses.at(-1),
    /** Press, and give the microphone the moment it needs to open. */
    hold: async (how = 'key') => {
      voice.press(how);
      await settle();
    },
  };
}

/** A key event. `name` is the key and its place on the keyboard, as it is for F2 and Escape. */
const key = (name, fields = {}) => {
  const event = {
    key: name,
    code: name,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    prevented: false,
    preventDefault: () => (event.prevented = true),
    ...fields,
  };
  return event;
};

const RECORDING = "Recording a voice clip... release F2 when you're done.";

beforeEach(() => {
  // No dialog is open unless a test says so.
  globalThis.document = { querySelector: () => null };
});

test('holding, talking and letting go puts the words in the message box', async (t) => {
  const { voice, microphone, clips, inserted, errors, statuses, wait } = setup(t);
  voice.press('key');
  assert.equal(voice.state, 'opening');
  await settle();
  assert.equal(voice.state, 'recording');
  for (const ms of [1000, 1000, 400]) wait(ms);
  voice.release('key');
  assert.equal(voice.state, 'transcribing');
  await settle();

  assert.deepEqual(inserted, ['Hello there.']);
  assert.deepEqual(errors, []);
  assert.deepEqual(microphone.log, ['start', 'stop'], 'the microphone is closed again');
  assert.equal(voice.state, 'idle');
  assert.deepEqual(statuses, [
    { text: 'Waiting for the microphone...' },
    { text: RECORDING, time: '0:00' },
    { text: RECORDING, time: '0:01' },
    { text: RECORDING, time: '0:02' },
    { text: 'Transcribing your voice clip...' },
    null,
  ]);
  assert.equal(clips.length, 1);
  assert.equal(clips[0].byteLength, 44 + SAMPLE_RATE * 2, 'one second, as a 16 kHz WAV');
  assert.equal(new Int16Array(clips[0].slice(44))[0], 16384);
});

test('a recording at another rate is brought to 16 kHz before it is sent', async (t) => {
  const microphone = fakeMicrophone({ samples: new Float32Array(48000 * 2).fill(0.5), sampleRate: 48000 });
  const { voice, clips, hold, wait } = setup(t, { microphone });
  await hold('button');
  wait(2000);
  voice.release('button');
  await settle();
  const view = new DataView(clips[0]);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(clips[0].byteLength, 44 + 2 * SAMPLE_RATE * 2, 'still two seconds long');
});

test('a tap is not a clip', async (t) => {
  const { voice, microphone, clips, inserted, errors, status, hold, wait } = setup(t);
  await hold();
  wait(MIN_CLIP_MS - 1);
  voice.release('key');
  await settle();
  assert.equal(voice.state, 'idle');
  assert.deepEqual(microphone.log, ['start', 'cancel']);
  assert.deepEqual([clips, inserted, errors], [[], [], []]);
  assert.deepEqual(status(), { text: 'Hold F2 or the Voice Clip button while you talk.' });
  wait(4000);
  assert.equal(status(), null, 'the reminder goes away again');
});

test('holding for a third of a second is long enough', async (t) => {
  const { voice, inserted, hold, wait } = setup(t);
  await hold();
  wait(MIN_CLIP_MS);
  voice.release('key');
  await settle();
  assert.deepEqual(inserted, ['Hello there.']);
});

test('the clock starts when the microphone is open, not when you press', async (t) => {
  let open;
  const microphone = fakeMicrophone({ opens: () => new Promise((resolve) => (open = resolve)) });
  const { voice, status, wait } = setup(t, { microphone });
  voice.press('key');
  wait(2500);
  assert.equal(voice.state, 'opening');
  assert.deepEqual(status(), { text: 'Waiting for the microphone...' });
  open();
  await settle();
  assert.deepEqual(status(), { text: RECORDING, time: '0:00' });
  wait(1000);
  assert.deepEqual(status(), { text: RECORDING, time: '0:01' });
  assert.equal(voice.state, 'recording');
});

test('letting go before the microphone is open records nothing, and says so', async (t) => {
  let open;
  const microphone = fakeMicrophone({ opens: () => new Promise((resolve) => (open = resolve)) });
  const { voice, clips, errors, status, wait } = setup(t, { microphone });
  voice.press('key');
  wait(1500);
  voice.release('key');
  assert.equal(voice.state, 'idle');
  assert.deepEqual(microphone.log, ['start', 'cancel']);
  assert.deepEqual(status(), { text: 'The microphone was not ready yet. Hold F2 again.' });

  // It opens after all: too late to matter.
  open();
  await settle();
  assert.equal(voice.state, 'idle');
  assert.deepEqual([clips, errors], [[], []]);
});

test('a clip ends by itself after two minutes of recording', async (t) => {
  const { voice, microphone, clips, inserted, statuses, status, hold, wait } = setup(t);
  await hold();
  wait(MAX_CLIP_MS - 1);
  assert.equal(voice.state, 'recording');
  assert.equal(status().time, '2:00');
  wait(1);
  assert.equal(voice.state, 'transcribing');
  assert.deepEqual(status(), { text: 'Voice clips stop after 2 minutes. Transcribing yours...' });
  await settle();
  assert.deepEqual(inserted, ['Hello there.']);

  // Letting go of the key afterwards is not a second clip.
  const before = statuses.length;
  voice.release('key');
  wait(MAX_CLIP_MS);
  await settle();
  assert.equal(clips.length, 1);
  assert.deepEqual(microphone.log, ['start', 'stop']);
  assert.equal(statuses.length, before, 'and the clock has stopped');
});

test('F2 starts a clip and letting go of it ends the clip', async (t) => {
  const { voice, inserted, wait } = setup(t);
  const down = key('F2');
  assert.equal(voice.keyDown(down), true);
  assert.ok(down.prevented);
  await settle();
  assert.equal(voice.state, 'recording');
  wait(1000);
  voice.keyUp(key('Shift'));
  assert.equal(voice.state, 'recording', 'other keys do not end it');
  voice.keyUp(key('F2'));
  await settle();
  assert.deepEqual(inserted, ['Hello there.']);
});

test('a held key repeating itself does not start over', async (t) => {
  const { voice, microphone, clips, wait } = setup(t);
  voice.keyDown(key('F2'));
  assert.equal(voice.keyDown(key('F2', { repeat: true })), true, 'even before the microphone is open');
  await settle();
  for (let i = 0; i < 30; i += 1) {
    wait(33);
    assert.equal(voice.keyDown(key('F2', { repeat: true })), true);
  }
  assert.deepEqual(microphone.log, ['start']);
  assert.equal(voice.state, 'recording');
  voice.keyUp(key('F2'));
  await settle();
  assert.equal(clips.length, 1);
});

test('Esc throws the clip away, and is not passed on as a nudge', async (t) => {
  const { voice, microphone, clips, inserted, status, wait } = setup(t);
  voice.keyDown(key('F2'));
  await settle();
  wait(1500);
  const esc = key('Escape');
  assert.equal(voice.keyDown(esc), true, 'the key was used up');
  assert.ok(esc.prevented);
  assert.equal(voice.state, 'idle');
  assert.deepEqual(microphone.log, ['start', 'cancel']);
  assert.deepEqual(status(), { text: 'Voice clip cancelled.' });

  voice.keyUp(key('F2'));
  await settle();
  assert.deepEqual([clips, inserted], [[], []]);
});

test('Esc also gives up a clip whose microphone is still opening', (t) => {
  const microphone = fakeMicrophone({ opens: () => new Promise(() => {}) });
  const { voice, status } = setup(t, { microphone });
  voice.keyDown(key('F2'));
  assert.equal(voice.keyDown(key('Escape')), true);
  assert.equal(voice.state, 'idle');
  assert.deepEqual(microphone.log, ['start', 'cancel']);
  assert.deepEqual(status(), { text: 'Voice clip cancelled.' });
});

test('Esc is left alone when no clip is being made', async (t) => {
  const { voice, hold, wait } = setup(t, { transcribe: () => new Promise(() => {}) });
  const idle = key('Escape');
  assert.equal(voice.keyDown(idle), false);
  assert.equal(idle.prevented, false);
  assert.equal(voice.keyDown(key('Enter')), false);

  await hold();
  wait(1000);
  voice.release('key');
  assert.equal(voice.state, 'transcribing');
  assert.equal(voice.keyDown(key('Escape')), false, 'nor while the words are on their way');
});

test('F2 does nothing while a dialog is open', (t) => {
  const { voice, microphone } = setup(t);
  globalThis.document = { querySelector: (selector) => (selector === '.modal' ? {} : null) };
  assert.equal(voice.keyDown(key('F2')), true);
  assert.equal(voice.state, 'idle');
  assert.deepEqual(microphone.log, []);
});

test('only what started a clip can end it by letting go', async (t) => {
  const { voice, clips, status, hold, wait } = setup(t);
  await hold('button');
  assert.equal(status().text, "Recording a voice clip... let go of the button when you're done.");
  wait(1000);
  voice.keyDown(key('F2'));
  voice.keyUp(key('F2'));
  assert.equal(voice.state, 'recording', 'F2 does not end a clip the button started');
  voice.release('button');
  await settle();
  assert.equal(clips.length, 1);
});

test('a second clip has to wait for the first one', async (t) => {
  let finish;
  const { voice, microphone, inserted, hold, wait } = setup(t, {
    transcribe: () => new Promise((resolve) => (finish = resolve)),
  });
  await hold();
  wait(1000);
  voice.release('key');
  await settle();
  voice.press('key');
  voice.keyDown(key('F2'));
  assert.equal(voice.state, 'transcribing');
  assert.deepEqual(microphone.log, ['start', 'stop']);

  finish('First clip.');
  await settle();
  assert.deepEqual(inserted, ['First clip.']);
  await hold();
  assert.equal(voice.state, 'recording', 'and then it is ready again');
});

test('losing the window while recording gives the clip up, but not one already on its way', async (t) => {
  let finish;
  const { voice, microphone, inserted, hold, wait } = setup(t, {
    transcribe: () => new Promise((resolve) => (finish = resolve)),
  });
  await hold();
  wait(1000);
  voice.cancel();
  assert.equal(voice.state, 'idle');
  assert.deepEqual(microphone.log, ['start', 'cancel']);

  await hold();
  wait(1000);
  voice.release('key');
  await settle();
  voice.cancel();
  assert.equal(voice.state, 'transcribing');
  finish('Still here.');
  await settle();
  assert.deepEqual(inserted, ['Still here.']);
});

test('a silent clip puts nothing in the message box', async (t) => {
  const { voice, inserted, errors, status, hold, wait } = setup(t, { transcribe: async () => '' });
  await hold();
  wait(1000);
  voice.release('key');
  await settle();
  assert.deepEqual([inserted, errors], [[], []]);
  assert.deepEqual(status(), { text: 'That voice clip was silent.' });
  wait(4000);
  assert.equal(status(), null);
});

test('what went wrong with whisper is shown as it was said', async (t) => {
  const { voice, microphone, inserted, errors, status, hold, wait } = setup(t, {
    transcribe: async () => {
      throw new Error("Error invoking remote method 'voice:transcribe': Error: Voice clips need a Whisper model.");
    },
  });
  await hold();
  wait(1000);
  voice.release('key');
  await settle();
  assert.deepEqual(errors, ['Voice clips need a Whisper model.']);
  assert.deepEqual(inserted, []);
  assert.equal(voice.state, 'idle');
  assert.equal(status(), null);
  assert.deepEqual(microphone.log, ['start', 'stop', 'cancel']);
});

test('a microphone that will not open says so at once, while you are still holding', async (t) => {
  const microphone = fakeMicrophone({ opens: () => Promise.reject(new Error('The microphone is blocked.')) });
  const { voice, clips, errors, status, hold } = setup(t, { microphone });
  await hold();
  assert.deepEqual(errors, ['The microphone is blocked.']);
  assert.equal(voice.state, 'idle');
  assert.equal(status(), null);

  voice.release('key');
  await settle();
  assert.deepEqual(errors, ['The microphone is blocked.'], 'said once');
  assert.deepEqual(clips, []);
});

test('a microphone that fails for a clip you gave up says nothing', async (t) => {
  let fail;
  const microphone = fakeMicrophone({ opens: () => new Promise((_, reject) => (fail = reject)) });
  const { voice, clips, errors, wait } = setup(t, { microphone });
  voice.press('key');
  wait(1000);
  voice.cancel();
  fail(new Error('No microphone was found.'));
  await settle();
  assert.deepEqual([errors, clips], [[], []]);
  assert.equal(voice.state, 'idle');
});

test('a microphone still opening for a clip you gave up cannot spoil the next one', async (t) => {
  const opens = [];
  const microphone = fakeMicrophone({ opens: () => new Promise((resolve, reject) => opens.push({ resolve, reject })) });
  const { voice, errors, inserted, status, wait } = setup(t, { microphone });
  voice.press('key');
  voice.cancel();
  voice.press('key');
  opens[0].resolve();
  await settle();
  assert.equal(voice.state, 'opening', 'the first microphone opening is not the second one');
  opens[1].resolve();
  await settle();
  assert.equal(voice.state, 'recording');
  assert.equal(status().time, '0:00');
  wait(1000);
  voice.release('key');
  await settle();
  assert.deepEqual([errors, inserted], [[], ['Hello there.']]);
});

test('from the menu, a clip records until F2 is pressed', async (t) => {
  const { voice, clips, status, wait } = setup(t);
  voice.toggle();
  await settle();
  assert.equal(status().text, "Recording a voice clip... press F2 when you're done.");
  assert.equal(voice.held, true);
  wait(3000);
  voice.keyDown(key('F2'));
  assert.equal(voice.state, 'transcribing');
  assert.equal(voice.held, false);
  voice.keyUp(key('F2'));
  await settle();
  assert.equal(clips.length, 1);

  voice.toggle();
  await settle();
  wait(1000);
  voice.toggle();
  await settle();
  assert.equal(clips.length, 2, 'or until the menu is used again');
});

test('the preview’s stand-in microphone hears nothing and never fails', async (t) => {
  const { voice, clips, inserted, hold, wait } = setup(t, {
    microphone: noMicrophone,
    transcribe: async () => 'A sample sentence.',
  });
  await hold('button');
  assert.equal(voice.state, 'recording');
  wait(1000);
  voice.release('button');
  await settle();
  assert.equal(clips[0].byteLength, 44);
  assert.deepEqual(inserted, ['A sample sentence.']);
});

// ---- the button ---------------------------------------------------------------------------------

/** Just enough of a button and a window for attach() to wire up. */
function fakeButton() {
  const classes = new Set();
  const button = Object.assign(new EventTarget(), {
    captured: [],
    classes,
    classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) },
    setPointerCapture: (id) => button.captured.push(id),
  });
  globalThis.window = new EventTarget();
  return button;
}
const pointer = (type, fields = {}) =>
  Object.assign(new Event(type, { cancelable: true }), { button: 0, pointerId: 7, ...fields });

test('the button records for as long as it is held down', async (t) => {
  const { voice, inserted, status, wait } = setup(t);
  const button = fakeButton();
  voice.attach(button);

  const mousedown = new Event('mousedown', { cancelable: true });
  button.dispatchEvent(mousedown);
  assert.ok(mousedown.defaultPrevented, 'the cursor stays in the message box');

  button.dispatchEvent(pointer('pointerdown'));
  assert.deepEqual(button.captured, [7]);
  assert.deepEqual([...button.classes], ['opening']);
  await settle();
  assert.equal(voice.state, 'recording');
  assert.deepEqual([...button.classes], ['recording']);
  assert.equal(status().text, "Recording a voice clip... let go of the button when you're done.");
  wait(1200);
  button.dispatchEvent(pointer('pointerup'));
  assert.deepEqual([...button.classes], ['transcribing']);
  await settle();
  assert.deepEqual(inserted, ['Hello there.']);
  assert.deepEqual([...button.classes], []);
});

test('only the main mouse button records', (t) => {
  const { voice } = setup(t);
  const button = fakeButton();
  voice.attach(button);
  button.dispatchEvent(pointer('pointerdown', { button: 2 }));
  assert.equal(voice.state, 'idle');
});

test('another pointer cannot restart or finish the held clip, and lost capture permits retry', async (t) => {
  const { voice, microphone, wait } = setup(t);
  const button = fakeButton();
  voice.attach(button);
  button.dispatchEvent(pointer('pointerdown'));
  await settle();
  button.dispatchEvent(pointer('pointerdown', { pointerId: 8, isPrimary: false }));
  button.dispatchEvent(pointer('pointerup', { pointerId: 8 }));
  button.dispatchEvent(pointer('lostpointercapture', { pointerId: 8 }));
  assert.equal(voice.state, 'recording');
  assert.deepEqual(microphone.log, ['start']);
  wait(1000);
  button.dispatchEvent(pointer('lostpointercapture'));
  assert.equal(voice.state, 'idle');
  button.dispatchEvent(pointer('pointerdown'));
  await settle();
  assert.equal(voice.state, 'recording');
  assert.deepEqual(microphone.log, ['start', 'cancel', 'start']);
});

test('keyboard activation toggles the button and page exit cancels even a toggled clip', async (t) => {
  const { voice, clips, wait } = setup(t);
  const button = fakeButton();
  voice.attach(button);
  button.dispatchEvent(Object.assign(new Event('click'), { detail: 0 }));
  await settle();
  assert.equal(voice.state, 'recording');
  wait(1000);
  button.dispatchEvent(Object.assign(new Event('click'), { detail: 0 }));
  await settle();
  assert.equal(voice.state, 'idle');
  assert.equal(clips.length, 1);
  voice.toggle();
  await settle();
  globalThis.window.dispatchEvent(new Event('pagehide'));
  assert.equal(voice.state, 'idle');
  assert.equal(clips.length, 1);
});

test('the window losing focus, or the press being taken away, gives the clip up', async (t) => {
  const { voice, microphone, wait } = setup(t);
  const button = fakeButton();
  voice.attach(button);

  button.dispatchEvent(pointer('pointerdown'));
  await settle();
  wait(1000);
  globalThis.window.dispatchEvent(new Event('blur'));
  assert.equal(voice.state, 'idle');
  assert.deepEqual([...button.classes], []);

  button.dispatchEvent(pointer('pointerdown'));
  await settle();
  wait(1000);
  button.dispatchEvent(pointer('pointercancel'));
  assert.equal(voice.state, 'idle');
  assert.deepEqual(microphone.log, ['start', 'cancel', 'start', 'cancel']);
});

test('letting go of F2 anywhere in the window ends its clip', async (t) => {
  const { voice, inserted, wait } = setup(t);
  voice.attach(fakeButton());
  voice.keyDown(key('F2'));
  await settle();
  wait(1000);
  globalThis.window.dispatchEvent(Object.assign(new Event('keyup'), { key: 'F2', code: 'F2' }));
  await settle();
  assert.deepEqual(inserted, ['Hello there.']);
});

test('a click on the button ends a clip that was started from the menu', async (t) => {
  const { voice, clips, wait } = setup(t);
  const button = fakeButton();
  voice.attach(button);
  voice.toggle();
  await settle();
  wait(1000);
  button.dispatchEvent(pointer('pointerdown'));
  assert.equal(voice.state, 'transcribing');
  button.dispatchEvent(pointer('pointerup'));
  await settle();
  assert.equal(clips.length, 1);
});

// ---- another shortcut, and pressing instead of holding ------------------------------------------

test('another shortcut records, and F2 no longer does', async (t) => {
  const { voice, inserted, status, wait } = setup(t, { settings: { shortcuts: { voice: 'Control+Alt+KeyV' } } });
  assert.equal(voice.keyDown(key('F2')), false);
  assert.equal(voice.keyDown(key('v', { code: 'KeyV' })), false, 'the key without its modifiers is just typing');
  assert.equal(voice.state, 'idle');

  const down = key('√', { code: 'KeyV', ctrlKey: true, altKey: true });
  assert.equal(voice.keyDown(down), true);
  assert.ok(down.prevented, 'so the key types nothing');
  await settle();
  assert.equal(status().text, "Recording a voice clip... release Ctrl+Alt+V when you're done.");
  wait(1000);
  voice.keyUp(key('F2'));
  assert.equal(voice.state, 'recording');
  voice.keyUp(key('v', { code: 'KeyV' }));
  await settle();
  assert.deepEqual(inserted, ['Hello there.']);
});

test('letting go of a modifier of the shortcut ends a held clip too', async (t) => {
  const { voice, clips, wait } = setup(t, { settings: { shortcuts: { voice: 'Shift+Meta+KeyR' } } });
  voice.keyDown(key('R', { code: 'KeyR', metaKey: true, shiftKey: true }));
  await settle();
  wait(1000);
  voice.keyUp(key('Alt', { code: 'AltLeft' }));
  assert.equal(voice.state, 'recording', 'a modifier it does not use is not part of it');
  voice.keyUp(key('Meta', { code: 'MetaLeft' }));
  assert.equal(voice.state, 'transcribing');
  await settle();
  assert.equal(clips.length, 1);
});

test('the shortcut is named the Mac way on a Mac', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const statuses = [];
  const voice = new VoiceClips({
    microphone: fakeMicrophone(),
    transcribe: async () => '',
    insert: () => {},
    error: () => {},
    status: (status) => statuses.push(status),
    settings: () => ({ shortcuts: { voice: 'Control+Alt+KeyV' } }),
    mac: true,
  });
  voice.keyDown(key('√', { code: 'KeyV', ctrlKey: true, altKey: true }));
  await settle();
  assert.equal(statuses.at(-1).text, "Recording a voice clip... release ⌃⌥V when you're done.");
  voice.cancel();
});

test('set to be pressed, one press starts a clip and the next one ends it', async (t) => {
  const { voice, microphone, inserted, status, wait } = setup(t, { settings: { voiceMode: 'press' } });
  assert.equal(voice.keyDown(key('F2')), true);
  await settle();
  assert.equal(voice.state, 'recording');
  assert.equal(status().text, "Recording a voice clip... press F2 when you're done.");
  voice.keyUp(key('F2'));
  wait(5000);
  assert.equal(voice.state, 'recording', 'letting go of the key changes nothing');
  assert.equal(voice.keyDown(key('F2', { repeat: true })), true);
  assert.equal(voice.state, 'recording', 'nor does the key repeating itself');

  voice.keyDown(key('F2'));
  assert.equal(voice.state, 'transcribing');
  voice.keyUp(key('F2'));
  await settle();
  assert.deepEqual(inserted, ['Hello there.']);
  assert.deepEqual(microphone.log, ['start', 'stop']);
});

test('set to be pressed, the button is clicked on and clicked off', async (t) => {
  const { voice, clips, wait } = setup(t, { settings: { voiceMode: 'press' } });
  const button = fakeButton();
  voice.attach(button);
  assert.equal(button.title, 'Click to record a voice clip (F2)');

  button.dispatchEvent(pointer('pointerdown'));
  await settle();
  button.dispatchEvent(pointer('pointerup'));
  wait(2000);
  assert.equal(voice.state, 'recording', 'letting go of the button does not end it');
  voice.keyDown(key('F2'));
  await settle();
  assert.equal(clips.length, 1, 'the shortcut ends a clip the button started');

  button.dispatchEvent(pointer('pointerdown'));
  await settle();
  button.dispatchEvent(pointer('pointerup'));
  wait(1000);
  button.dispatchEvent(pointer('pointerdown'));
  await settle();
  assert.equal(clips.length, 2, 'and so does a second click');
});

test('a clip that was switched on carries on while you look at another window', async (t) => {
  const { voice, clips, wait } = setup(t, { settings: { voiceMode: 'press' } });
  voice.attach(fakeButton());
  voice.keyDown(key('F2'));
  await settle();
  wait(1000);
  globalThis.window.dispatchEvent(new Event('blur'));
  assert.equal(voice.state, 'recording');
  wait(1000);
  voice.keyDown(key('F2'));
  await settle();
  assert.equal(clips.length, 1);
});

test('Esc throws away a clip that was switched on, and it still stops after two minutes', async (t) => {
  const { voice, clips, inserted, status, wait } = setup(t, { settings: { voiceMode: 'press' } });
  voice.keyDown(key('F2'));
  await settle();
  wait(1000);
  assert.equal(voice.keyDown(key('Escape')), true);
  assert.equal(voice.state, 'idle');
  assert.deepEqual(status(), { text: 'Voice clip cancelled.' });
  assert.equal(clips.length, 0);

  voice.keyDown(key('F2'));
  await settle();
  wait(MAX_CLIP_MS);
  assert.equal(voice.state, 'transcribing');
  await settle();
  assert.deepEqual(inserted, ['Hello there.']);
});

test('pressing twice in a hurry is not a clip, and the remark does not talk about holding', async (t) => {
  const { voice, clips, status, wait } = setup(t, { settings: { voiceMode: 'press' } });
  voice.keyDown(key('F2'));
  await settle();
  wait(MIN_CLIP_MS - 1);
  voice.keyDown(key('F2'));
  assert.equal(voice.state, 'idle');
  assert.deepEqual(status(), { text: 'That was too quick to be a voice clip.' });
  assert.equal(clips.length, 0);
});

test('a second press before the microphone is open says to press again', (t) => {
  const { voice, status, wait } = setup(t, {
    microphone: fakeMicrophone({ opens: () => new Promise(() => {}) }),
    settings: { voiceMode: 'press', shortcuts: { voice: 'F5' } },
  });
  voice.keyDown(key('F5'));
  wait(1000);
  voice.keyDown(key('F5'));
  assert.deepEqual(status(), { text: 'The microphone was not ready yet. Press F5 again.' });
});

test('the settings are read when they are needed, so a change counts from the next press', async (t) => {
  const { voice, settings, clips, wait } = setup(t);
  const button = fakeButton();
  voice.attach(button);
  assert.equal(button.title, 'Hold to record a voice clip (F2)');

  voice.keyDown(key('F2'));
  await settle();
  wait(1000);
  // Changed while a clip is being held: that clip still ends the way it started.
  Object.assign(settings, { shortcuts: { voice: 'F6' }, voiceMode: 'press' });
  voice.refresh();
  assert.equal(button.title, 'Click to record a voice clip (F6)');
  voice.keyUp(key('F2'));
  assert.equal(voice.state, 'recording', 'F2 is no longer the shortcut');
  voice.cancel();

  voice.keyDown(key('F6'));
  await settle();
  voice.keyUp(key('F6'));
  wait(1000);
  assert.equal(voice.state, 'recording');
  voice.keyDown(key('F6'));
  await settle();
  assert.equal(clips.length, 1);
});

// ---- sent as soon as it is there ---------------------------------------------------------------

test('a clip is typed into the message box unless the settings say it is sent', async (t) => {
  const { voice, inserted, sent, hold, wait } = setup(t);
  await hold();
  wait(1000);
  voice.release('key');
  await settle();
  assert.deepEqual(inserted, ['Hello there.']);
  assert.deepEqual(sent, []);
});

test('with "send as soon as I stop talking" on, the words are sent and not typed', async (t) => {
  const { voice, inserted, sent, status, hold, wait } = setup(t, { settings: { voiceSend: true } });
  await hold();
  wait(1000);
  voice.release('key');
  await settle();
  assert.deepEqual(sent, ['Hello there.']);
  assert.deepEqual(inserted, []);
  assert.equal(voice.state, 'idle');
  assert.equal(status(), null);
});

test('a clip that is sent is sent however it was made: the button, a press, or the two minutes running out', async (t) => {
  const { voice, sent, hold, wait } = setup(t, { settings: { voiceSend: true } });
  await hold('button');
  wait(1000);
  voice.release('button');
  await settle();

  voice.toggle();
  await settle();
  wait(1000);
  voice.toggle();
  await settle();

  await hold();
  wait(MAX_CLIP_MS);
  await settle();
  assert.deepEqual(sent, ['Hello there.', 'Hello there.', 'Hello there.']);
});

test('a silent clip sends nothing, and neither does one that could not be transcribed', async (t) => {
  let answer = async () => '';
  const { voice, sent, inserted, errors, status, hold, wait } = setup(t, {
    settings: { voiceSend: true },
    transcribe: () => answer(),
  });
  await hold();
  wait(1000);
  voice.release('key');
  await settle();
  assert.equal(status().text, 'That voice clip was silent.');

  answer = async () => {
    throw new Error('whisper-cli is not installed.');
  };
  await hold();
  wait(1000);
  voice.release('key');
  await settle();
  assert.deepEqual(sent, []);
  assert.deepEqual(inserted, []);
  assert.equal(errors.length, 1);
});

test('sent or typed is decided when the words are there, so a change made while talking counts', async (t) => {
  const { voice, settings, inserted, sent, hold, wait } = setup(t);
  await hold();
  wait(1000);
  settings.voiceSend = true;
  voice.release('key');
  await settle();
  assert.deepEqual(sent, ['Hello there.']);
  assert.deepEqual(inserted, []);
});

test('a window with nothing to send a clip with types it, whatever the settings say', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const inserted = [];
  const voice = new VoiceClips({
    microphone: fakeMicrophone(),
    transcribe: async () => 'Hello there.',
    insert: (text) => inserted.push(text),
    error: () => {},
    status: () => {},
    settings: () => ({ voiceSend: true }),
  });
  voice.press('key');
  await settle();
  t.mock.timers.tick(1000);
  voice.release('key');
  await settle();
  assert.deepEqual(inserted, ['Hello there.']);
});
