import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ENGINES, parseVoice, readWav, spokenText, track, writeWav } from '../scripts/video/voice.js';

test('a voice is named by its engine, and its voice where it is not the usual one', () => {
  assert.deepEqual(
    { ...parseVoice('qwen3:Ryan'), instruct: undefined },
    { ...ENGINES.qwen3, instruct: undefined, engine: 'qwen3', voice: 'Ryan', name: 'qwen3:Ryan' }
  );
  assert.equal(parseVoice('kokoro').name, 'kokoro:am_michael');
  assert.equal(parseVoice('elevenlabs').voice, ENGINES.elevenlabs.voice);
  assert.equal(parseVoice('none').engine, 'none');
  assert.throws(() => parseVoice('xtts:anyone'), /No voice engine called “xtts”/);
});

test('the voice says what it would say wrong the way it should, and no accent marks', () => {
  const spoken = { buddylist: 'buddy list', API: 'A P I', 'API v2': 'A P I version two' };
  assert.equal(spokenText('**buddylist** keeps them on one list.', spoken), 'buddy list keeps them on one list.');
  assert.equal(spokenText('Buddylist, buddylist.dev', spoken), 'buddy list, buddy list.dev');
  // Longest first, and whole words only.
  assert.equal(spokenText('API v2 and the API', spoken), 'A P I version two and the A P I');
  assert.equal(spokenText('APIs', spoken), 'APIs');
  assert.equal(spokenText('the my-buddylist folder', spoken), 'the my-buddylist folder');
});

test('a WAV written is read back as it was', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-voice-'));
  const file = path.join(dir, 'line.wav');
  const samples = Int16Array.from([0, 1, -1, 32767, -32768, 1234]);
  writeWav(file, 48000, samples);
  assert.deepEqual(readWav(file), { rate: 48000, samples });
  fs.rmSync(dir, { recursive: true });
});

test('a WAV that is not mono 16-bit is refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-voice-'));
  const file = path.join(dir, 'stereo.wav');
  writeWav(file, 48000, Int16Array.from([1, 2]));
  const data = fs.readFileSync(file);
  data.writeUInt16LE(2, 22);
  fs.writeFileSync(file, data);
  assert.throws(() => readWav(file), /not mono 16-bit PCM/);
  fs.rmSync(dir, { recursive: true });
});

test('lines are laid on one track where they are said, and add up where they meet', () => {
  const mixed = track(
    [
      { samples: Int16Array.from([100, 100, 100]), at: 0.001 },
      { samples: Int16Array.from([50, 50]), at: 0.002 },
      // Past the end: cut off there.
      { samples: Int16Array.from([7, 7, 7]), at: 0.004 },
    ],
    0.005,
    1000
  );
  assert.deepEqual([...mixed], [0, 100, 150, 150, 7]);
  // Too loud together: held at the most a sample can be.
  const loud = track(
    [
      { samples: Int16Array.from([30000]), at: 0 },
      { samples: Int16Array.from([30000]), at: 0 },
    ],
    0.001,
    1000
  );
  assert.deepEqual([...loud], [32767]);
});
