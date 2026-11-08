// The voice of a feature video: each line of its narration, said by a voice model and kept as a WAV, with how
// long it takes to say. The film waits for each line to be said, so the voice sets the pace of the picture.
//
// A voice is named as engine:voice, such as qwen3:Aiden or kokoro:am_michael:
//
//   qwen3       Qwen3-TTS 1.7B CustomVoice, on this Mac (Apache-2.0). Its speakers include Aiden and Ryan.
//   kokoro      Kokoro 82M, on this Mac (Apache-2.0). Its voices include af_heart, am_michael and bf_emma.
//   elevenlabs  ElevenLabs' service, with the key in ELEVENLABS_API_KEY. The voice is a voice id.
//   none        no voice: each line takes as long as it would to say, for a quick look at the picture.
//
// The local models run with mlx-audio, through uv (scripts/video/speak.py). The first line they say downloads
// the model into the Hugging Face cache. Nothing of theirs goes in the repository. Each line said is kept in
// ~/.cache/buddylist-video, by its words and voice, so a line is only said again once it changes.
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEAK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'speak.py');
const CACHE = path.join(os.homedir(), '.cache', 'buddylist-video', 'voice');
/** The rate every line is kept at, mono and 16-bit, whichever model said it. */
export const RATE = 48000;
/** How fast a narrator talks, for a line no model says. */
const WORDS_A_SECOND = 2.6;

/** The engines, with what each says a line with, and what it is said with when the name gives no voice. */
export const ENGINES = {
  qwen3: {
    model: 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice',
    voice: 'Aiden',
    lang: 'English',
    instruct: 'A calm, friendly developer explaining a tool to a colleague. Natural pace, not an announcer.',
    licence: 'Apache-2.0',
  },
  kokoro: {
    model: 'mlx-community/Kokoro-82M-bf16',
    voice: 'am_michael',
    lang: 'a',
    // Kokoro reads its words out with misaki, which needs its English parts.
    needs: ['misaki[en]==0.9.4'],
    licence: 'Apache-2.0',
  },
  elevenlabs: {
    model: 'eleven_multilingual_v2',
    // George: a warm, steady narrator among ElevenLabs' own voices.
    voice: 'JBFqnCBsd6RMkjVDRZzb',
    licence: 'ElevenLabs terms: a paid plan for commercial use',
  },
  none: { model: '', voice: '', licence: '' },
};

/**
 * A voice by its name: engine:voice, or the engine alone for its usual voice.
 * @param {string} name
 */
export function parseVoice(name) {
  const [engine, ...rest] = String(name).split(':');
  const config = ENGINES[engine];
  if (!config) throw new Error(`No voice engine called “${engine}”: use ${Object.keys(ENGINES).join(', ')}.`);
  return {
    engine,
    ...config,
    voice: rest.join(':') || config.voice,
    name: `${engine}:${rest.join(':') || config.voice}`,
  };
}

/**
 * What a voice is to say for a caption's words: its accent marks gone, and the words it would say wrong said
 * the way it should, such as "buddylist" as "buddy list". Whole words only, in any letter case.
 * @param {string} text
 * @param {Record<string, string>} spoken
 */
export function spokenText(text, spoken = {}) {
  let said = text.replace(/\*\*/g, '');
  // Longest first, so "API v2" goes before "API".
  for (const word of Object.keys(spoken).sort((a, b) => b.length - a.length)) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    said = said.replace(new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'gi'), spoken[word]);
  }
  return said;
}

/** A mono 16-bit WAV's samples and rate. */
export function readWav(file) {
  const data = fs.readFileSync(file);
  let at = 12;
  let rate = 0;
  while (at + 8 <= data.length) {
    const id = data.toString('ascii', at, at + 4);
    const size = data.readUInt32LE(at + 4);
    if (id === 'fmt ') {
      if (data.readUInt16LE(at + 8) !== 1 || data.readUInt16LE(at + 10) !== 1 || data.readUInt16LE(at + 22) !== 16) {
        throw new Error(`${file} is not mono 16-bit PCM`);
      }
      rate = data.readUInt32LE(at + 12);
    }
    if (id === 'data') {
      const samples = new Int16Array(size / 2);
      for (let i = 0; i < samples.length; i += 1) samples[i] = data.readInt16LE(at + 8 + 2 * i);
      return { rate, samples };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error(`${file} has no samples`);
}

/** Writes mono 16-bit samples as a WAV. */
export function writeWav(file, rate, samples) {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write('RIFF', 0, 'ascii');
  data.writeUInt32LE(36 + samples.length * 2, 4);
  data.write('WAVEfmt ', 8, 'ascii');
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36, 'ascii');
  data.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) data.writeInt16LE(samples[i], 44 + 2 * i);
  fs.writeFileSync(file, data);
}

/**
 * One track of lines, each from the moment it is said: a later line said over an earlier one is added to it.
 * @param {{ samples: Int16Array, at: number }[]} clips  `at` in seconds
 * @param {number} seconds  the track's length
 * @param {number} rate
 */
export function track(clips, seconds, rate = RATE) {
  const mixed = new Float32Array(Math.ceil(seconds * rate));
  for (const { samples, at } of clips) {
    const start = Math.round(at * rate);
    for (let i = 0; i < samples.length && start + i < mixed.length; i += 1) {
      if (start + i >= 0) mixed[start + i] += samples[i];
    }
  }
  return Int16Array.from(mixed, (value) => Math.max(-32768, Math.min(32767, Math.round(value))));
}

/** A line as the cache keeps it: in the one format, without the silence a model leaves before and after it. */
function keep(from, to) {
  const trim = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.04';
  execFileSync('ffmpeg', [
    ...['-y', '-loglevel', 'error', '-i', from],
    ...['-af', `${trim},areverse,${trim},areverse`, '-ac', '1', '-ar', String(RATE), '-c:a', 'pcm_s16le', to],
  ]);
}

const keyOf = (voice, text) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify([voice.engine, voice.model, voice.voice, voice.lang, voice.instruct, text]))
    .digest('hex')
    .slice(0, 24);

/** The lines a model on this Mac still has to say, said in one go: the model loads once. */
function speakHere(voice, todo) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-voice-'));
  try {
    const job = path.join(dir, 'job.json');
    const lines = todo.map(({ text }, i) => ({ text, out: path.join(dir, `${i}.wav`) }));
    fs.writeFileSync(
      job,
      JSON.stringify({ model: voice.model, voice: voice.voice, lang: voice.lang, instruct: voice.instruct, lines })
    );
    const needs = (voice.needs ?? []).flatMap((need) => ['--with', need]);
    execFileSync('uv', ['run', '--quiet', '--python', '3.12', '--with', 'mlx-audio==0.5.7', ...needs, SPEAK, job], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    lines.forEach(({ out }, i) => keep(out, todo[i].file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The lines ElevenLabs still has to say, each with the words around it, for it to say them as one narration. */
async function speakElevenLabs(voice, todo, all) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new Error(
      'ElevenLabs needs ELEVENLABS_API_KEY: make a key at elevenlabs.io > Developers > API keys, and export it in your shell.'
    );
  }
  for (const line of todo) {
    const i = all.indexOf(line.text);
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.voice)}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({
          text: line.text,
          model_id: voice.model,
          seed: 7,
          voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
          ...(i > 0 && { previous_text: all[i - 1] }),
          ...(i >= 0 && i + 1 < all.length && { next_text: all[i + 1] }),
        }),
      }
    );
    if (!response.ok) throw new Error(`ElevenLabs said ${response.status}: ${await response.text()}`);
    const mp3 = `${line.file}.mp3`;
    fs.writeFileSync(mp3, Buffer.from(await response.arrayBuffer()));
    keep(mp3, line.file);
    fs.rmSync(mp3);
  }
}

/**
 * Each line of a narration said in a voice: where its WAV is, and how long it takes, in milliseconds.
 * @param {{ id: string, text: string }[]} lines  what each line says, as its voice is to say it
 * @param {string} name  the voice, such as qwen3:Aiden
 * @returns {Promise<Record<string, { text: string, file: string | null, ms: number }>>}
 */
export async function speak(lines, name) {
  const voice = parseVoice(name);
  if (voice.engine === 'none') {
    return Object.fromEntries(
      lines.map(({ id, text }) => [id, { text, file: null, ms: (text.split(/\s+/).length / WORDS_A_SECOND) * 1000 }])
    );
  }
  fs.mkdirSync(CACHE, { recursive: true });
  const said = lines.map((line) => ({ ...line, file: path.join(CACHE, `${keyOf(voice, line.text)}.wav`) }));
  const todo = said.filter((line) => !fs.existsSync(line.file));
  if (todo.length) {
    console.log(`${voice.name}: saying ${todo.length} of ${lines.length} lines`);
    if (voice.engine === 'elevenlabs') {
      await speakElevenLabs(
        voice,
        todo,
        lines.map((line) => line.text)
      );
    } else speakHere(voice, todo);
  }
  return Object.fromEntries(
    said.map(({ id, text, file }) => {
      const { rate, samples } = readWav(file);
      return [id, { text, file, ms: (samples.length / rate) * 1000 }];
    })
  );
}

/**
 * Makes a track as loud as narration on YouTube is, -16 LUFS, in one even step for the whole of it: measured
 * first, then set, so a quiet line stays quieter than a loud one.
 */
export function loudnessOf(from, to) {
  const target = 'I=-16:TP=-1.5:LRA=11';
  const { stderr: measured } = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-i', from, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-'],
    { encoding: 'utf8' }
  );
  // ffmpeg prints what it measured as a JSON object among its other lines.
  const json = JSON.parse(measured.match(/\{[^{}]*"input_i"[^{}]*\}/)[0]);
  const known = [
    `measured_I=${json.input_i}`,
    `measured_TP=${json.input_tp}`,
    `measured_LRA=${json.input_lra}`,
    `measured_thresh=${json.input_thresh}`,
    `offset=${json.target_offset}`,
  ].join(':');
  execFileSync('ffmpeg', [
    ...['-y', '-loglevel', 'error', '-i', from],
    ...['-af', `loudnorm=${target}:${known}:linear=true`, '-ar', String(RATE), '-c:a', 'pcm_s16le', to],
  ]);
}
