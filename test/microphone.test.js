import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Microphone, VoiceClips } from '../src/renderer/chat/voice.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const named = (name) => new DOMException('test failure', name);
const stream = () => {
  const track = {
    readyState: 'live',
    stop() {
      this.readyState = 'ended';
    },
  };
  return { track, getTracks: () => [track] };
};

function setup(t, { get, module, resume, closing } = {}) {
  const streams = [],
    contexts = [],
    captures = [];
  const replace = (name, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => (descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]));
  };
  replace('navigator', {
    mediaDevices: {
      getUserMedia: async (constraints) => {
        assert.deepEqual(constraints, { audio: true });
        const next = get ? await get() : stream();
        streams.push(next);
        return next;
      },
    },
  });
  replace(
    'AudioContext',
    class {
      state = 'running';
      sampleRate = 16000;
      audioWorklet = { addModule: async () => module?.() };
      source = {
        connect() {},
        disconnect() {
          this.disconnected = true;
        },
      };
      constructor() {
        contexts.push(this);
      }
      createMediaStreamSource() {
        return this.source;
      }
      async resume() {
        await resume?.();
      }
      async close() {
        await closing?.();
        this.state = 'closed';
      }
    }
  );
  replace(
    'AudioWorkletNode',
    class {
      port = {
        close() {
          this.closed = true;
        },
      };
      constructor() {
        captures.push(this);
      }
      disconnect() {
        this.disconnected = true;
      }
    }
  );
  const mic = new Microphone();
  t.after(() => mic.cancel());
  return { mic, streams, contexts, captures };
}

test('repeated starts share one capture; stop releases the graph and retry records', async (t) => {
  const { mic, streams, contexts, captures } = setup(t);
  const start = mic.start();
  assert.equal(mic.start(), start);
  await start;
  await mic.start();
  assert.equal(streams.length, 1);
  const lateMessage = captures[0].port.onmessage;
  lateMessage({ data: Float32Array.of(0.25, 0.5) });
  assert.deepEqual([...mic.stop().samples], [0.25, 0.5]);
  lateMessage({ data: Float32Array.of(1) });
  await settle();
  assert.equal(streams[0].track.readyState, 'ended');
  assert.equal(contexts[0].state, 'closed');
  assert.equal(contexts[0].source.disconnected, true);
  assert.equal(captures[0].port.closed, true);
  assert.equal(captures[0].port.onmessage, null);
  assert.equal(captures[0].disconnected, true);
  assert.equal(mic.stop().samples.length, 0);
  await mic.start();
  assert.equal(streams.length, 2);
  mic.cancel();
  assert.equal(streams[1].track.readyState, 'ended');
});

test('cancelled permission request releases a late stream without disturbing the retry', async (t) => {
  const old = deferred();
  let calls = 0;
  const { mic, contexts } = setup(t, { get: () => (++calls === 1 ? old.promise : stream()) });
  const start = mic.start();
  await settle();
  mic.cancel();
  await start;
  await mic.start();
  const late = stream();
  old.resolve(late);
  await settle();
  assert.equal(late.track.readyState, 'ended');
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].state, 'running');
});

for (const phase of ['module', 'resume']) {
  for (const reject of [false, true]) {
    test(`cancel during ${phase}, then late ${reject ? 'rejection' : 'completion'}, leaves no capture`, async (t) => {
      const pending = deferred();
      const { mic, streams, contexts, captures } = setup(t, { [phase]: () => pending.promise });
      const start = mic.start();
      await settle();
      mic.cancel();
      await start;
      if (reject) pending.reject(named('AbortError'));
      else pending.resolve();
      await settle();
      assert.equal(streams[0].track.readyState, 'ended');
      assert.equal(contexts[0].state, 'closed');
      assert.ok(captures.every((c) => c.port.closed));
    });
  }
}

test('a timeout reports once and stops a late stream; another attempt works', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred();
  let calls = 0;
  const { mic } = setup(t, { get: () => (++calls === 1 ? pending.promise : stream()) });
  const rejected = assert.rejects(mic.start(), /did not finish opening/);
  await settle();
  t.mock.timers.tick(10000);
  await rejected;
  await mic.start();
  const late = stream();
  pending.resolve(late);
  await settle();
  assert.equal(late.track.readyState, 'ended');
});

test('a missing worklet is a recorder error, releases capture and allows retry', async (t) => {
  let fail = true;
  const { mic, streams, contexts } = setup(t, {
    module: () => {
      if (fail) throw named('AbortError');
    },
  });
  await assert.rejects(mic.start(), (error) => {
    assert.equal(error.cause.name, 'AbortError');
    assert.match(error.message, /voice recorder could not start/);
    assert.doesNotMatch(error.message, /busy|other apps/);
    return true;
  });
  assert.equal(streams[0].track.readyState, 'ended');
  assert.equal(contexts[0].state, 'closed');
  fail = false;
  await mic.start();
  assert.equal(streams.length, 2);
});

for (const name of ['NotAllowedError', 'SecurityError', 'NotFoundError', 'NotReadableError', 'OverconstrainedError']) {
  test(`${name} preserves its cause and retry is possible`, async (t) => {
    let fail = true;
    const { mic } = setup(t, {
      get: () => {
        if (fail) throw named(name);
        return stream();
      },
    });
    await assert.rejects(mic.start(), (error) => error.cause.name === name);
    fail = false;
    await mic.start();
  });
}

test('retry waits for the previous audio context to close', async (t) => {
  const pending = deferred();
  const { mic, streams } = setup(t, { closing: () => pending.promise });
  await mic.start();
  mic.cancel();
  const next = mic.start();
  await settle();
  assert.equal(streams.length, 1);
  pending.resolve();
  await next;
  assert.equal(streams.length, 2);
});

for (const kind of ['track', 'processor']) {
  test(`${kind} failure ends recording once, preserves the draft and permits retry`, async (t) => {
    const { mic, streams, captures } = setup(t);
    let draft = 'Keep my draft';
    const errors = [],
      sent = [];
    const voice = new VoiceClips({
      microphone: mic,
      transcribe: async () => {
        throw new Error('should not transcribe');
      },
      insert: (text) => {
        draft += text;
      },
      send: (text) => sent.push(text),
      error: (error) => errors.push(error),
      status() {},
      settings: () => ({ voiceSend: true }),
    });
    t.after(() => voice.cancel());
    voice.press('toggle');
    voice.press('toggle');
    await settle();
    assert.equal(voice.state, 'recording');
    const failed = kind === 'track' ? streams[0].track.onended : captures[0].onprocessorerror;
    failed();
    failed();
    assert.equal(voice.state, 'idle');
    assert.equal(errors.length, 1);
    assert.equal(draft, 'Keep my draft');
    assert.deepEqual(sent, []);
    assert.equal(streams[0].track.readyState, 'ended');
    voice.press('toggle');
    await settle();
    assert.equal(voice.state, 'recording');
  });
}
