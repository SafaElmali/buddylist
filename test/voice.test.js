import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanTranscript, runProgram, Voice } from '../src/main/voice.js';
import { encodeWav } from '../src/renderer/chat/voice.js';

const dirs = [];
const tempDir = () => dirs[dirs.push(fs.mkdtempSync(path.join(os.tmpdir(), 'cm-voice-'))) - 1];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** One second of a quiet tone, as the windows record it. */
const clip = (seconds = 1) =>
  encodeWav(Float32Array.from({ length: seconds * 16000 }, (_, i) => Math.sin(i / 10) * 0.2));

/** What node's execFile reports when a program fails. */
const failure = (fields) => Object.assign(new Error('Command failed'), { killed: false, stderr: '' }, fields);

/**
 * A Voice in folders of its own, with a stand-in for whisper that records how it was run.
 * @param {object} [opts]
 * @param {string[]} [opts.models]  files to put in the whisper folder
 * @param {Record<string, string>} [opts.env]
 * @param {(call: { file: string, args: string[], timeoutMs: number }) => Promise<{ stdout: string, stderr?: string }> | { stdout: string, stderr?: string }} [opts.whisper]
 */
function setup({ models = ['ggml-base.en.bin'], env = {}, whisper = () => ({ stdout: ' Hello there.\n' }) } = {}) {
  const userData = tempDir();
  const tmpdir = tempDir();
  const modelDir = path.join(userData, 'whisper');
  if (models.length) fs.mkdirSync(modelDir);
  for (const name of models) fs.writeFileSync(path.join(modelDir, name), 'model');
  const calls = [];
  const run = async (file, args, { timeoutMs }) => {
    const call = { file, args, timeoutMs };
    // What whisper would find on disk while it runs.
    const wav = args[args.indexOf('-f') + 1];
    if (args.includes('-f')) {
      const { mode } = fs.statSync(wav);
      Object.assign(call, { wav, bytes: fs.readFileSync(wav), mode, folderMode: fs.statSync(path.dirname(wav)).mode });
    }
    calls.push(call);
    const result = await whisper(call);
    return { stderr: '', ...result };
  };
  return { voice: new Voice({ userData, env, run, tmpdir }), calls, userData, tmpdir, modelDir };
}

// ---- what whisper prints -----------------------------------------------------------------------

test('a transcript is trimmed down to one line of text', () => {
  assert.equal(cleanTranscript('\n Hello there.\n'), 'Hello there.');
  assert.equal(
    cleanTranscript(' Fix the   login\tbug,\n and then\r\n run the tests.\n\n'),
    'Fix the login bug, and then run the tests.'
  );
});

test("whisper's notes about sounds that aren't speech are left out", () => {
  for (const note of [
    '[BLANK_AUDIO]',
    '(silence)',
    '[ Silence ]',
    '[MUSIC]',
    '(keyboard clicking)',
    '♪',
    ' [BLANK_AUDIO]\n [BLANK_AUDIO]\n',
  ])
    assert.equal(cleanTranscript(` ${note}\n`), '', note);
  assert.equal(
    cleanTranscript(' [MUSIC] Open the README\n (coughs)\n and fix the typo. [BLANK_AUDIO]'),
    'Open the README and fix the typo.'
  );
});

test('nothing at all is an empty transcript', () => {
  assert.equal(cleanTranscript(''), '');
  assert.equal(cleanTranscript(undefined), '');
  assert.equal(cleanTranscript(' \n\t '), '');
});

// ---- running whisper ---------------------------------------------------------------------------

test('a clip is handed to whisper-cli as a private file, and its words come back', async () => {
  const wav = clip();
  const { voice, calls, modelDir, tmpdir } = setup({
    whisper: () => ({ stdout: '\n [BLANK_AUDIO]\n Hello from a voice clip.\n' }),
  });
  assert.equal(await voice.transcribe(wav), 'Hello from a voice clip.');

  const [call] = calls;
  assert.equal(call.file, 'whisper-cli');
  assert.deepEqual(call.args, [
    '-m',
    path.join(modelDir, 'ggml-base.en.bin'),
    '-f',
    call.wav,
    '-l',
    'auto',
    '-nt',
    '-np',
  ]);
  assert.equal(call.timeoutMs, 120000);
  assert.deepEqual(call.bytes, Buffer.from(wav), 'whisper reads exactly what was recorded');
  assert.ok(call.wav.startsWith(tmpdir + path.sep));
  if (process.platform !== 'win32') {
    assert.equal(call.mode & 0o777, 0o600, 'only you can read the recording');
    assert.equal(call.folderMode & 0o777, 0o700, 'in a folder only you can open');
  }
});

test('the recording is removed once whisper is done', async () => {
  const { voice, calls, tmpdir } = setup();
  await voice.transcribe(clip());
  assert.equal(calls.length, 1);
  assert.deepEqual(fs.readdirSync(tmpdir), []);
});

test('the recording is removed when whisper fails too', async () => {
  for (const problem of [failure({ code: 1 }), failure({ code: 'ENOENT' }), failure({ code: null, killed: true })]) {
    const { voice, calls, tmpdir } = setup({
      whisper: () => {
        throw problem;
      },
    });
    await assert.rejects(voice.transcribe(clip()));
    assert.ok(calls[0].bytes.length > 44, 'it was there while whisper ran');
    assert.deepEqual(fs.readdirSync(tmpdir), []);
  }
});

test('a view of the bytes works as well as the buffer itself', async () => {
  const { voice, calls } = setup();
  const wav = clip();
  assert.equal(await voice.transcribe(new Uint8Array(wav)), 'Hello there.');
  assert.equal(await voice.transcribe(Buffer.from(wav)), 'Hello there.');
  assert.deepEqual(calls[0].bytes, calls[1].bytes);
});

test('a clip with nothing in it is not worth running whisper for', async () => {
  const { voice, calls } = setup();
  assert.equal(await voice.transcribe(encodeWav(new Float32Array(0))), '');
  assert.equal(await voice.transcribe(encodeWav(new Float32Array(800))), '', 'a twentieth of a second');
  assert.equal(calls.length, 0);
});

test('silence comes back as an empty string', async () => {
  const { voice } = setup({ whisper: () => ({ stdout: ' [BLANK_AUDIO]\n' }) });
  assert.equal(await voice.transcribe(clip()), '');
});

test('anything that is not a 16 kHz mono 16-bit WAV is turned away', async () => {
  const { voice, calls, tmpdir } = setup();
  const stereo = Buffer.from(clip());
  stereo.writeUInt16LE(2, 22);
  const fast = Buffer.from(encodeWav(new Float32Array(48000), 48000));
  const huge = Buffer.concat([Buffer.from(clip()), Buffer.alloc(6 * 60 * 32000)]);
  for (const wav of [
    undefined,
    null,
    'RIFF',
    {},
    new ArrayBuffer(10),
    Buffer.from('not a recording at all, just some words'.repeat(4)),
    stereo,
    fast,
    huge,
  ])
    await assert.rejects(voice.transcribe(wav), /isn't a recording Whisper can read/);
  assert.equal(calls.length, 0);
  assert.deepEqual(fs.readdirSync(tmpdir), []);
});

// ---- finding whisper ---------------------------------------------------------------------------

test('BUDDYLIST_WHISPER_CLI names the whisper-cli to run', async () => {
  const { voice, calls } = setup({ env: { BUDDYLIST_WHISPER_CLI: '/opt/whisper/bin/whisper-cli' } });
  await voice.transcribe(clip());
  assert.equal(calls[0].file, '/opt/whisper/bin/whisper-cli');
});

test('a missing whisper-cli says how to install it', async () => {
  const { voice } = setup({
    whisper: () => {
      throw failure({ code: 'ENOENT' });
    },
  });
  await assert.rejects(voice.transcribe(clip()), {
    message:
      'Voice clips need whisper.cpp. Install it with "brew install whisper-cpp", or set BUDDYLIST_WHISPER_CLI to your whisper-cli.',
  });
});

test('a missing whisper-cli that you named yourself says so', async () => {
  const { voice } = setup({
    env: { BUDDYLIST_WHISPER_CLI: '/nowhere/whisper-cli' },
    whisper: () => {
      throw failure({ code: 'ENOENT' });
    },
  });
  await assert.rejects(voice.transcribe(clip()), {
    message: 'BUDDYLIST_WHISPER_CLI points to /nowhere/whisper-cli, but no program is there.',
  });
});

// ---- finding a model ---------------------------------------------------------------------------

test('the model is the ggml-*.bin file in the whisper folder', async () => {
  const { voice, calls, modelDir } = setup({
    models: ['README.txt', 'ggml-small.bin', 'for-tests-ggml-tiny.bin', 'ggml-notes.txt'],
  });
  await voice.transcribe(clip());
  assert.equal(calls[0].args[1], path.join(modelDir, 'ggml-small.bin'));
});

test('with several models, the first by name is used every time', async () => {
  const { voice, calls, modelDir } = setup({
    models: ['ggml-small.bin', 'ggml-large-v3-turbo.bin', 'ggml-base.en.bin'],
  });
  await voice.transcribe(clip());
  await voice.transcribe(clip());
  assert.deepEqual(
    calls.map((c) => c.args[1]),
    [path.join(modelDir, 'ggml-base.en.bin'), path.join(modelDir, 'ggml-base.en.bin')]
  );
});

test('BUDDYLIST_WHISPER_MODEL wins over the folder', async () => {
  const elsewhere = path.join(tempDir(), 'my-model.bin');
  fs.writeFileSync(elsewhere, 'model');
  const { voice, calls } = setup({ env: { BUDDYLIST_WHISPER_MODEL: elsewhere } });
  await voice.transcribe(clip());
  assert.equal(calls[0].args[1], elsewhere);
});

test('a model you named that is not there says so', async () => {
  const { voice, calls } = setup({ env: { BUDDYLIST_WHISPER_MODEL: '/nowhere/ggml-base.bin' } });
  await assert.rejects(voice.transcribe(clip()), {
    message: 'BUDDYLIST_WHISPER_MODEL points to /nowhere/ggml-base.bin, but no file is there.',
  });
  assert.equal(calls.length, 0);
});

test('no model says exactly where to put one, and makes the folder', async () => {
  const { voice, calls, modelDir, tmpdir } = setup({
    models: [],
    whisper: () => ({ stdout: 'whisper.cpp version: 1.9.1\n' }),
  });
  await assert.rejects(voice.transcribe(clip()), {
    message: `Voice clips need a Whisper model. To set one up, put a ggml-*.bin file, such as ggml-base.en.bin, in ${modelDir}.`,
  });
  assert.ok(fs.statSync(modelDir).isDirectory());
  assert.deepEqual(
    calls.map((c) => c.args),
    [['--version']],
    'whisper was only asked whether it is there'
  );
  assert.deepEqual(fs.readdirSync(tmpdir), [], 'the clip never touched the disk');
});

test('the folder is shown the way you would type it', async (t) => {
  const home = tempDir();
  t.mock.method(os, 'homedir', () => home);
  const userData = path.join(home, 'Library', 'Application Support', 'buddylist');
  const voice = new Voice({ userData, env: {}, run: async () => ({ stdout: '', stderr: '' }), tmpdir: tempDir() });
  await assert.rejects(voice.transcribe(clip()), {
    message: `Voice clips need a Whisper model. To set one up, put a ggml-*.bin file, such as ggml-base.en.bin, in ${path.join('~', 'Library', 'Application Support', 'buddylist', 'whisper')}.`,
  });
});

test('no model and no whisper-cli says both in one go', async () => {
  const { voice, modelDir } = setup({
    models: [],
    whisper: () => {
      throw failure({ code: 'ENOENT' });
    },
  });
  await assert.rejects(voice.transcribe(clip()), {
    message: `Voice clips need whisper.cpp and a Whisper model. Install whisper.cpp with "brew install whisper-cpp", then put a ggml-*.bin file, such as ggml-base.en.bin, in ${modelDir}.`,
  });
});

// ---- when whisper fails ------------------------------------------------------------------------

test('a failed run passes on what whisper complained about', async () => {
  const { voice } = setup({
    whisper: () => {
      throw failure({ code: 1, stderr: 'ggml_metal_init: ok\nerror: something broke\nwhisper_print_timings: 3 ms\n' });
    },
  });
  await assert.rejects(voice.transcribe(clip()), { message: 'Whisper stopped with an error: something broke.' });
});

test('a failed run with nothing to go on gives the exit code', async () => {
  const { voice } = setup({
    whisper: () => {
      throw failure({ code: 2, stderr: 'usage: whisper-cli [options] file0 file1 ...\n' });
    },
  });
  await assert.rejects(voice.transcribe(clip()), { message: 'Whisper stopped with an error (exit code 2).' });
});

test('a model whisper cannot load is named, in case the download was cut short', async () => {
  const { voice, modelDir } = setup({
    whisper: () => {
      throw failure({
        code: 3,
        stderr: 'whisper_init: failed to load model\nerror: failed to initialize whisper context\n',
      });
    },
  });
  await assert.rejects(voice.transcribe(clip()), {
    message: `Whisper couldn't load the model at ${path.join(modelDir, 'ggml-base.en.bin')}. The file may be incomplete: download it again.`,
  });
});

test('a run that takes too long is stopped and says so', async () => {
  const { voice } = setup({
    whisper: () => {
      throw failure({ code: null, killed: true, signal: 'SIGKILL' });
    },
  });
  await assert.rejects(voice.transcribe(clip()), {
    message: 'Whisper took longer than 2 minutes and was stopped. A smaller model is quicker.',
  });
});

test('a whisper-cli that cannot be started says why', async () => {
  const { voice } = setup({
    whisper: () => {
      throw Object.assign(new Error('spawn /opt/whisper-cli EACCES'), { code: 'EACCES' });
    },
  });
  await assert.rejects(voice.transcribe(clip()), {
    message: "Whisper couldn't be started: spawn /opt/whisper-cli EACCES.",
  });
});

test('a clip whisper could not read is an error even though it exits cleanly', async () => {
  const { voice } = setup({
    whisper: () => ({
      stdout: '',
      stderr: "read_audio_data: failed to read audio data\nerror: failed to read audio file 'clip.wav'\n",
    }),
  });
  await assert.rejects(voice.transcribe(clip()), {
    message: "Whisper couldn't transcribe that voice clip: failed to read audio file 'clip.wav'.",
  });
});

// ---- the real runner, with node standing in for whisper ----------------------------------------

test('the runner collects what a program prints', async () => {
  const result = await runProgram(
    process.execPath,
    ['-e', 'process.stdout.write("out"); process.stderr.write("err")'],
    { timeoutMs: 20000 }
  );
  assert.deepEqual(result, { stdout: 'out', stderr: 'err' });
});

test('the runner passes arguments as they are, with no shell in between', async () => {
  const tricky = '$(echo no) `echo no`; echo no | "quoted" \'single\'';
  const { stdout } = await runProgram(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', tricky], {
    timeoutMs: 20000,
  });
  assert.equal(stdout, tricky);
});

test('the runner reports a program that is not installed', async () => {
  await assert.rejects(runProgram(path.join(tempDir(), 'no-such-whisper-cli'), [], { timeoutMs: 20000 }), {
    code: 'ENOENT',
  });
});

test('the runner reports a failed exit, with what was printed', async () => {
  await assert.rejects(
    runProgram(process.execPath, ['-e', 'console.error("error: nope"); process.exit(3)'], { timeoutMs: 20000 }),
    {
      code: 3,
      killed: false,
      stderr: 'error: nope\n',
    }
  );
});

test('the runner stops a program that runs out of time', async () => {
  const started = Date.now();
  await assert.rejects(runProgram(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { timeoutMs: 300 }), {
    killed: true,
  });
  assert.ok(Date.now() - started < 10000);
});

test('a real program that is missing reads the same as the fake one', async () => {
  const userData = tempDir();
  fs.mkdirSync(path.join(userData, 'whisper'));
  fs.writeFileSync(path.join(userData, 'whisper', 'ggml-base.en.bin'), 'model');
  const cli = path.join(tempDir(), 'no-such-whisper-cli');
  const tmpdir = tempDir();
  const voice = new Voice({ userData, env: { BUDDYLIST_WHISPER_CLI: cli }, tmpdir });
  await assert.rejects(
    voice.transcribe(clip()),
    /^Error: BUDDYLIST_WHISPER_CLI points to .*no-such-whisper-cli, but no program is there\.$/
  );
  assert.deepEqual(fs.readdirSync(tmpdir), []);
});
