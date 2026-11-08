// Voice clips: a recording from a conversation window, turned into text by
// whisper.cpp on this computer. The audio never leaves it.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { types } from 'node:util';

const SAMPLE_RATE = 16000;
const HEADER_BYTES = 44;
// The windows stop recording after two minutes; anything much bigger isn't one of their clips.
const MAX_CLIP_BYTES = HEADER_BYTES + 5 * 60 * SAMPLE_RATE * 2;
// whisper.cpp ignores anything shorter than a tenth of a second.
const MIN_AUDIO_BYTES = (SAMPLE_RATE / 10) * 2;
const TIMEOUT_MS = 2 * 60 * 1000;
const PROBE_TIMEOUT_MS = 20 * 1000;

/**
 * Runs a program without a shell and collects what it prints.
 * Rejects with an error that has `code` ('ENOENT' when the program isn't there, the exit
 * code when it failed), `killed` (true when it ran out of time) and `stderr`.
 * @typedef {(file: string, args: string[], opts: { timeoutMs: number }) => Promise<{ stdout: string, stderr: string }>} Runner
 */

/** @type {Runner} */
export function runProgram(file, args, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, killSignal: 'SIGKILL', windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr }));
      else resolve({ stdout, stderr });
    });
  });
}

/**
 * What whisper printed, as one line of plain text. It writes the sounds that aren't speech
 * as notes in brackets, such as [BLANK_AUDIO], [MUSIC] or (silence): those are left out.
 * @param {string} output
 */
export function cleanTranscript(output) {
  return String(output || '')
    .replace(/\[[^\]\n]*\]|\([^)\n]*\)|♪/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const exists = (file) =>
  fs.access(file).then(
    () => true,
    () => false
  );

/** A path the way you'd type it: ~/Library/… instead of /Users/you/Library/…. */
function tilde(file) {
  const home = os.homedir();
  return file.startsWith(home + path.sep) ? `~${file.slice(home.length)}` : file;
}

/** The last thing whisper complained about, if anything. */
const complaint = (stderr) => [...String(stderr || '').matchAll(/^error: (.+)$/gm)].pop()?.[1].trim() || '';

/**
 * The recording as bytes, once it is known to be what the windows record:
 * a 16 kHz, one-channel, 16-bit PCM WAV.
 * @param {unknown} wav
 */
function clipBytes(wav) {
  const data = types.isAnyArrayBuffer(wav)
    ? Buffer.from(wav)
    : ArrayBuffer.isView(wav)
      ? Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength)
      : null;
  const isClip =
    data &&
    data.length >= HEADER_BYTES &&
    data.length <= MAX_CLIP_BYTES &&
    data.toString('latin1', 0, 4) === 'RIFF' &&
    data.toString('latin1', 8, 16) === 'WAVEfmt ' &&
    data.readUInt16LE(20) === 1 && // PCM
    data.readUInt16LE(22) === 1 && // one channel
    data.readUInt32LE(24) === SAMPLE_RATE &&
    data.readUInt16LE(34) === 16 && // bits a sample
    data.toString('latin1', 36, 40) === 'data';
  if (!isClip) throw new Error("That voice clip isn't a recording Whisper can read.");
  return data;
}

export class Voice {
  /**
   * @param {object} opts
   * @param {string} opts.userData  the app's data folder
   * @param {Record<string, string | undefined>} [opts.env]  where the two overrides are read from
   * @param {Runner} [opts.run]  runs whisper; tests pass a fake
   * @param {string} [opts.tmpdir]  where the recording is kept while whisper reads it
   */
  constructor({ userData, env = process.env, run = runProgram, tmpdir = os.tmpdir() }) {
    this.userData = userData;
    this.env = env;
    this.run = run;
    this.tmpdir = tmpdir;
    /** Where you put a model: any ggml-*.bin file. */
    this.modelDir = path.join(userData, 'whisper');
  }

  /**
   * @param {ArrayBuffer} wav  16 kHz mono 16-bit PCM WAV
   * @returns {Promise<string>} what was said, or '' when nothing was; rejects with a sentence the window can show
   */
  async transcribe(wav) {
    const clip = clipBytes(wav);
    if (clip.length - HEADER_BYTES < MIN_AUDIO_BYTES) return '';
    // whisper.cpp isn't bundled: the app runs the `whisper-cli` you installed.
    // BUDDYLIST_WHISPER_CLI points it at a different one.
    const cli = this.env.BUDDYLIST_WHISPER_CLI || 'whisper-cli';
    const model = await this.#model(cli);
    // A folder only you can open, removed again whatever happens.
    const dir = await fs.mkdtemp(path.join(this.tmpdir, 'buddylist-voice-'));
    try {
      const file = path.join(dir, 'clip.wav');
      await fs.writeFile(file, clip, { mode: 0o600 });
      // Any language, and nothing on stdout but the words: no timestamps, no progress.
      return cleanTranscript(await this.#whisper(cli, ['-m', model, '-f', file, '-l', 'auto', '-nt', '-np'], model));
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** The model to use: the one BUDDYLIST_WHISPER_MODEL names, or the first by name in the whisper folder. */
  async #model(cli) {
    const named = this.env.BUDDYLIST_WHISPER_MODEL;
    if (named) {
      if (await exists(named)) return named;
      throw new Error(`BUDDYLIST_WHISPER_MODEL points to ${tilde(named)}, but no file is there.`);
    }
    const names = await fs.readdir(this.modelDir).catch(() => []);
    const [first] = names.filter((name) => /^ggml-.+\.bin$/i.test(name)).sort();
    if (first) return path.join(this.modelDir, first);

    // Nothing to work with yet. Make the folder so it is there to drop a model into,
    // and say everything that is missing in one go.
    await fs.mkdir(this.modelDir, { recursive: true }).catch(() => {});
    const where = `put a ggml-*.bin file, such as ggml-base.en.bin, in ${tilde(this.modelDir)}`;
    throw new Error(
      (await this.#installed(cli))
        ? `Voice clips need a Whisper model. To set one up, ${where}.`
        : `Voice clips need whisper.cpp and a Whisper model. Install whisper.cpp with "brew install whisper-cpp", then ${where}.`
    );
  }

  /** Whether whisper is there to run at all. */
  async #installed(cli) {
    try {
      await this.run(cli, ['--version'], { timeoutMs: PROBE_TIMEOUT_MS });
      return true;
    } catch (err) {
      return err?.code !== 'ENOENT';
    }
  }

  /** Runs whisper and returns what it printed, or throws a sentence about what went wrong. */
  async #whisper(cli, args, model) {
    let result;
    try {
      result = await this.run(cli, args, { timeoutMs: TIMEOUT_MS });
    } catch (err) {
      throw new Error(this.#whyItFailed(err, cli, model), { cause: err });
    }
    // A clip it can't read is only a complaint, not a failed exit.
    const said = complaint(result.stderr);
    if (said && !result.stdout.trim()) throw new Error(`Whisper couldn't transcribe that voice clip: ${said}.`);
    return result.stdout;
  }

  /** @param {any} err  what the runner rejected with */
  #whyItFailed(err, cli, model) {
    if (err?.code === 'ENOENT')
      return this.env.BUDDYLIST_WHISPER_CLI
        ? `BUDDYLIST_WHISPER_CLI points to ${tilde(cli)}, but no program is there.`
        : 'Voice clips need whisper.cpp. Install it with "brew install whisper-cpp", or set BUDDYLIST_WHISPER_CLI to your whisper-cli.';
    if (typeof err?.code === 'string') return `Whisper couldn't be started: ${err.message}.`;
    if (err?.killed) return 'Whisper took longer than 2 minutes and was stopped. A smaller model is quicker.';
    const said = complaint(err?.stderr);
    if (/failed to initialize whisper context/.test(said))
      return `Whisper couldn't load the model at ${tilde(model)}. The file may be incomplete: download it again.`;
    return `Whisper stopped with an error${said ? `: ${said}` : ` (exit code ${err?.code})`}.`;
  }
}
