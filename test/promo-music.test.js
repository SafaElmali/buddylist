import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promoMusic, promoMusicWav, RATE } from '../scripts/promo-music.js';

const loudest = ({ left, right }, from = 0, to = left.length) => {
  let peak = 0;
  for (let i = Math.max(0, from); i < Math.min(left.length, to); i += 1) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  return peak;
};

test('the music is as long as the clip, in stereo', () => {
  const { left, right } = promoMusic({ seconds: 12.5, outroAt: 9 });
  assert.equal(left.length, Math.round(12.5 * RATE));
  assert.equal(right.length, left.length);
});

test('it is loud without ever clipping, and never produces a broken sample', () => {
  const music = promoMusic({ seconds: 20, outroAt: 16 });
  const peak = loudest(music);
  assert.ok(peak > 0.85 && peak <= 0.9, `the peak is ${peak}`);
  assert.equal(music.left.every(Number.isFinite) && music.right.every(Number.isFinite), true);
});

test('it comes in gently and has died away by the end', () => {
  const seconds = 20;
  const music = promoMusic({ seconds, outroAt: 16 });
  assert.ok(loudest(music, 0, 0.01 * RATE) < 0.02);
  assert.ok(loudest(music, (seconds - 0.02) * RATE) < 0.01);
  // Still sounding well into the outro: the last chord rings under the end card.
  assert.ok(loudest(music, 17 * RATE, 18 * RATE) > 0.05);
});

test('the loop and the outro meet where the end card comes in', () => {
  // The kick that opens the outro is the loudest thing around it.
  const music = promoMusic({ seconds: 20, outroAt: 15.3 });
  const around = loudest(music, 15.3 * RATE, 15.4 * RATE);
  assert.ok(around > loudest(music, 15.0 * RATE, 15.25 * RATE), 'no downbeat where the outro starts');
});

test('the same clip always gets the same music', () => {
  const a = promoMusicWav({ seconds: 6, outroAt: 4 });
  const b = promoMusicWav({ seconds: 6, outroAt: 4 });
  assert.equal(a.equals(b), true);
});

test('a clip too short for an outro is still music, and no clip is no samples', () => {
  assert.ok(loudest(promoMusic({ seconds: 3 })) > 0.5);
  assert.equal(promoMusic({ seconds: 0 }).left.length, 0);
});

test('the WAV file says what it holds: 16-bit stereo at 44.1 kHz', () => {
  const wav = promoMusicWav({ seconds: 2, outroAt: 1 });
  const samples = Math.round(2 * RATE);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 16), 'WAVEfmt ');
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 2);
  assert.equal(wav.readUInt32LE(24), RATE);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.toString('ascii', 36, 40), 'data');
  assert.equal(wav.readUInt32LE(40), samples * 4);
  assert.equal(wav.length, 44 + samples * 4);
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
});
