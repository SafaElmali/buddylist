// The promo clip's background music: a short, bright loop over C, G, A minor
// and F, made here from sine waves and a little noise, so there is no recording
// to license. The same length in gives the same sound out.

export const RATE = 44100;
const TAU = Math.PI * 2;
// The tempo to aim for. It gives way a little so the loop ends exactly where the outro starts.
const BPM = 104;
// When the clip doesn't say where its end card comes in.
const OUTRO_SECONDS = 4;

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// One bar each: the bass note, the three notes of the chord, and the two notes the tune holds.
const BARS = [
  { bass: 36, chord: [60, 64, 67], tune: [76, 79] },
  { bass: 43, chord: [59, 62, 67], tune: [74, 71] },
  { bass: 45, chord: [60, 64, 69], tune: [72, 76] },
  { bass: 41, chord: [60, 65, 69], tune: [69, 72] },
];
// The second time round, the tune answers itself.
const ANSWER = [
  [79, 76],
  [74, 79],
  [76, 72],
  [77, 81],
];
// The broken chord, an octave up, in eighth notes: indexes into the chord, 3 being its root again.
const PATTERN = [0, 1, 2, 1, 3, 2, 1, 2];

/** A small seeded random number generator, so the drums are the same on every run. */
function seeded(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- the instruments: each gives a note's sample at `t` seconds into it ------------------------

/** A mallet: bright when struck, then only the note itself. */
const pluck =
  (f, decay = 6) =>
  (t) =>
    Math.exp(-t * decay) *
    (Math.sin(TAU * f * t) +
      0.35 * Math.exp(-t * 9) * Math.sin(TAU * 2 * f * t) +
      0.15 * Math.exp(-t * 14) * Math.sin(TAU * 3 * f * t));

/** A soft held note, two voices a hair apart, that swells in and lets go slowly. */
const pad = (f, duration) => (t) =>
  Math.min(1, t / 0.35, (duration - t) / 0.4) *
  (Math.sin(TAU * f * t) + 0.5 * Math.sin(TAU * f * 1.004 * t) + 0.12 * Math.sin(TAU * 2 * f * t));

const bass = (f) => (t) => Math.exp(-t * 3.2) * (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * 2 * f * t));

/** A kick drum: a sine that falls from a thump to a hum. */
const kick = () => (t) => Math.exp(-t * 9) * Math.sin(TAU * (46 * t + (95 / 28) * (1 - Math.exp(-t * 28))));

/** Noise with its low end taken off: a hi-hat when short, a clap when longer. */
const hiss = (random, decay) => {
  let last = 0;
  return (t) => {
    const now = random() * 2 - 1;
    const sample = now - last;
    last = now;
    return Math.exp(-t * decay) * sample;
  };
};

/**
 * @param {object} opts
 * @param {number} opts.seconds    how long the clip is
 * @param {number} [opts.outroAt]  when its end card comes in: the loop stops there and a last chord rings out
 * @returns {{ left: Float32Array, right: Float32Array }}  samples between -1 and 1
 */
export function promoMusic({ seconds, outroAt = seconds - OUTRO_SECONDS }) {
  const length = Math.max(0, Math.round(seconds * RATE));
  const mix = { left: new Float32Array(length), right: new Float32Array(length) };
  // The broken chord and the tune get an echo; everything else is dry.
  const echoed = { left: new Float32Array(length), right: new Float32Array(length) };
  const random = seeded(2005);

  const loopEnd = Math.min(Math.max(outroAt, 0), seconds);
  const bars = Math.max(1, Math.round(loopEnd / (240 / BPM)));
  const bar = loopEnd / bars;
  const beat = bar / 4;

  /** Lay one note on a bus. `pan` runs from -1 (left) to 1 (right). */
  const add = (bus, at, duration, gain, pan, voice) => {
    const from = Math.round(at * RATE);
    const to = Math.min(length, from + Math.round(duration * RATE));
    const l = gain * Math.cos(((pan + 1) * Math.PI) / 4);
    const r = gain * Math.sin(((pan + 1) * Math.PI) / 4);
    for (let i = Math.max(0, from); i < to; i += 1) {
      const t = (i - from) / RATE;
      // A few milliseconds in and out, so no note starts or stops with a click.
      const edge = Math.min(1, t / 0.004, (duration - t) / 0.012);
      const sample = voice(t) * edge;
      bus.left[i] += sample * l;
      bus.right[i] += sample * r;
    }
  };

  for (let b = 0; b < bars; b += 1) {
    const at = b * bar;
    const { bass: low, chord, tune } = BARS[b % BARS.length];
    // The music arrives a layer at a time: chords, then the broken chord and bass, drums, the tune.
    for (const note of chord) add(mix, at, bar + 0.4, 0.085, 0, pad(hz(note), bar + 0.4));
    if (b >= 1) {
      PATTERN.forEach((step, i) => {
        const note = step === 3 ? chord[0] + 12 : chord[step];
        add(echoed, at + i * (beat / 2), beat * 1.6, 0.15, i % 2 ? 0.4 : -0.4, pluck(hz(note + 12)));
      });
      add(mix, at, beat * 1.8, 0.3, 0, bass(hz(low)));
      add(mix, at + beat * 2.5, beat * 1.3, 0.24, 0, bass(hz(low)));
    }
    if (b >= 2) {
      add(mix, at, 0.4, 0.5, 0, kick());
      add(mix, at + beat * 2, 0.4, 0.42, 0, kick());
      for (let i = 0; i < 8; i += 1) add(mix, at + i * (beat / 2), 0.06, i % 2 ? 0.05 : 0.028, 0.3, hiss(random, 90));
    }
    if (b >= 4) {
      add(mix, at + beat, 0.16, 0.085, -0.1, hiss(random, 34));
      add(mix, at + beat * 3, 0.16, 0.085, -0.1, hiss(random, 34));
      const notes = b % 8 >= 4 ? tune : ANSWER[b % BARS.length];
      notes.forEach((note, i) => add(echoed, at + i * beat * 2, beat * 2.4, 0.2, 0.15, pluck(hz(note), 3.2)));
    }
  }

  // The outro: home again, one chord rolled upward and left to ring.
  const rest = seconds - loopEnd;
  if (rest > 0.2) {
    for (const note of [48, 60, 64, 67]) add(mix, loopEnd, rest, 0.085, 0, pad(hz(note), rest));
    add(mix, loopEnd, rest, 0.3, 0, bass(hz(36)));
    add(mix, loopEnd, 0.4, 0.5, 0, kick());
    [60, 64, 67, 72, 76, 79].forEach((note, i) =>
      add(echoed, loopEnd + i * 0.07, rest, 0.17, i % 2 ? 0.35 : -0.35, pluck(hz(note), 1.6))
    );
  }

  // The echo: three eighth notes later, crossing from one side to the other as it fades.
  const delay = Math.round(beat * 0.75 * RATE);
  for (let i = 0; i < length; i += 1) {
    if (i >= delay) {
      echoed.left[i] += echoed.right[i - delay] * 0.34;
      echoed.right[i] += echoed.left[i - delay] * 0.34;
    }
    mix.left[i] += echoed.left[i];
    mix.right[i] += echoed.right[i];
  }

  // As loud as it goes without clipping, in gently and out slowly.
  let peak = 0;
  for (let i = 0; i < length; i += 1) peak = Math.max(peak, Math.abs(mix.left[i]), Math.abs(mix.right[i]));
  const fadeIn = 0.3 * RATE;
  const fadeOut = Math.min(2.4, seconds / 2) * RATE;
  for (let i = 0; i < length; i += 1) {
    const level = (0.89 / (peak || 1)) * Math.min(1, i / fadeIn, (length - 1 - i) / fadeOut);
    mix.left[i] *= level;
    mix.right[i] *= level;
  }
  return mix;
}

/**
 * The music as a 16-bit stereo WAV file.
 * @param {{ seconds: number, outroAt?: number }} opts
 * @returns {Buffer}
 */
export function promoMusicWav(opts) {
  const { left, right } = promoMusic(opts);
  const data = Buffer.alloc(left.length * 4);
  for (let i = 0; i < left.length; i += 1) {
    data.writeInt16LE(Math.round(left[i] * 32767), i * 4);
    data.writeInt16LE(Math.round(right[i] * 32767), i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16); // the format block's size
  header.writeUInt16LE(1, 20); // plain samples
  header.writeUInt16LE(2, 22); // stereo
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 4, 28); // bytes a second
  header.writeUInt16LE(4, 32); // bytes a frame
  header.writeUInt16LE(16, 34); // bits a sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
