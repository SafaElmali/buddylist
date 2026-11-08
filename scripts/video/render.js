// Puts a take together (see film.js): the stage drawn frame by frame in headless Chromium and encoded with
// ffmpeg, under the voice and a quiet bed of music; the captions file; the voice alone; and the silent loop.
/* global window */
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { promoMusicWav } from '../promo-music.js';
import { makeCamera } from './camera.js';
import { BAND, FRAME, MOST, VIEW, stage, stageHtml } from './stage.js';
import { srt, timeline } from './timeline.js';
import { RATE, loudnessOf, readWav, track, writeWav } from './voice.js';

/** The music under the voice: about 14 dB down, a bed, not a tune to listen to. */
const MUSIC_LEVEL = 0.2;
/** The silent loop: as wide as the changelog shows it, and as small as a GIF for it can be. */
const LOOP = {
  width: 1280,
  crossfade: 0.6,
  gif: [960, 15],
  smaller: [
    [800, 12],
    [640, 12],
    [560, 10],
  ],
};
const GIF_MOST = 5 * 1000 * 1000;
// The browser's JPEGs are full range; a video player expects the TV range of BT.709.
const TV = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
const TO_TV = 'scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p';

const ffmpeg = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);

/** The stage's page, at a moment of the take on each call. */
async function openStage(take, takeDir) {
  fs.writeFileSync(path.join(takeDir, 'stage.html'), stageHtml(take));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: FRAME });
  page.on('pageerror', (error) => console.error(error));
  await page.goto(pathToFileURL(path.join(takeDir, 'stage.html')).href);
  await page.evaluate(stage, { take, frame: FRAME, band: BAND, view: VIEW, most: MOST, camera: makeCamera.toString() });
  const cdp = await page.context().newCDPSession(page);
  const photograph = async (ms, format = 'jpeg') => {
    await page.evaluate((at) => window.seek(at), ms);
    const { data } = await cdp.send('Page.captureScreenshot', { format, quality: 95, optimizeForSpeed: true });
    return Buffer.from(data, 'base64');
  };
  return { photograph, close: () => browser.close() };
}

/** Photographs of moments of the take, in seconds of the film, as PNGs. */
export async function stills({ take, takeDir, out, times }) {
  const { toTake } = timeline(take);
  const { photograph, close } = await openStage(take, takeDir);
  const files = [];
  for (const t of times) {
    const file = path.join(out, `still-${t.toFixed(2)}.png`);
    fs.writeFileSync(file, await photograph(toTake(t), 'png'));
    files.push(file);
  }
  await close();
  return files;
}

/** The narration's lines, in seconds of the film. */
function linesOf(take, scene) {
  const { toFilm } = timeline(take);
  return take.lines.map((line) => ({
    ...line,
    at: toFilm(line.at),
    end: toFilm(line.at + line.ms),
    text: scene.narration[line.id],
  }));
}

/**
 * A loop of part of the film, without sound: its last moments fade into its first, so it runs on with no seam.
 * @returns {string[]} the files made
 */
function loopOf(film, { from, to }, base) {
  const length = to - from;
  const x = LOOP.crossfade;
  const seam =
    `[0:v]fps=30,scale=${LOOP.width}:-2:flags=lanczos,split[a][b];` +
    `[a]trim=start=${x}:end=${length},setpts=PTS-STARTPTS[main];[b]trim=start=0:end=${x},setpts=PTS-STARTPTS[head];` +
    `[main][head]xfade=transition=fade:duration=${x}:offset=${(length - 2 * x).toFixed(3)},format=yuv420p[v]`;
  const mp4 = `${base}-loop.mp4`;
  ffmpeg(
    ...['-ss', from.toFixed(3), '-t', length.toFixed(3), '-i', film, '-filter_complex', seam, '-map', '[v]', '-an'],
    ...['-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-profile:v', 'high', ...TV, '-movflags', '+faststart', mp4]
  );
  const webm = `${base}-loop.webm`;
  ffmpeg('-i', mp4, '-an', '-c:v', 'libvpx-vp9', '-crf', '36', '-b:v', '0', '-row-mt', '1', webm);
  // The GIF as big as it can be within what a changelog page should load.
  const gif = `${base}-loop.gif`;
  for (const [width, fps] of [LOOP.gif, ...LOOP.smaller]) {
    ffmpeg(
      ...['-i', mp4, '-filter_complex'],
      `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];` +
        '[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
      gif
    );
    if (fs.statSync(gif).size <= GIF_MOST) break;
  }
  return [mp4, webm, gif];
}

/**
 * Puts the film together.
 * @returns {Promise<string[]>} the files made
 */
export async function render({ take, takeDir, scene, sceneName, out, draft = false }) {
  const fps = draft ? 30 : 60;
  const { duration, toTake, toFilm } = timeline(take);
  const base = path.join(out, sceneName);
  const made = [];

  // The voice alone: each line where it was said, then as loud as narration on YouTube is.
  const lines = linesOf(take, scene);
  const said = lines.filter((line) => line.file);
  const voice = `${base}-voice.wav`;
  if (said.length) {
    const raw = path.join(takeDir, 'voice-raw.wav');
    writeWav(
      raw,
      RATE,
      track(
        said.map((line) => ({ samples: readWav(line.file).samples, at: line.at })),
        duration
      )
    );
    loudnessOf(raw, voice);
    fs.rmSync(raw);
    made.push(voice);
  }
  fs.writeFileSync(`${base}.srt`, srt(lines));
  made.push(`${base}.srt`);

  // The film: frames from the stage, the voice and the music.
  const music = path.join(takeDir, 'music.wav');
  fs.writeFileSync(music, promoMusicWav({ seconds: duration, outroAt: toFilm(take.end) }));
  const audio = said.length
    ? [
        '-i',
        voice,
        '-i',
        music,
        '-filter_complex',
        // The voice in the middle of the music's stereo, and nothing louder than -1 dB once they are together.
        `[1:a]aformat=channel_layouts=stereo[v];[2:a]volume=${MUSIC_LEVEL}[m];` +
          `[v][m]amix=inputs=2:normalize=0,alimiter=limit=0.89:level=false[a]`,
      ]
    : ['-i', music, '-filter_complex', `[1:a]volume=${MUSIC_LEVEL}[a]`];
  const film = `${base}.mp4`;
  const encoder = spawn(
    'ffmpeg',
    [
      ...['-y', '-loglevel', 'error'],
      ...['-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', ...audio],
      ...['-map', '0:v', '-map', '[a]', '-vf', TO_TV, '-t', duration.toFixed(3)],
      ...['-c:v', 'libx264', '-preset', draft ? 'veryfast' : 'slow', '-crf', draft ? '23' : '17', '-profile:v', 'high'],
      ...TV,
      ...['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', film],
    ],
    { stdio: ['pipe', 'ignore', 'inherit'] }
  );
  const done = once(encoder, 'close');
  const { photograph, close } = await openStage(take, takeDir);
  const frames = Math.round(duration * fps);
  const started = Date.now();
  for (let i = 0; i < frames; i += 1) {
    if (!encoder.stdin.write(await photograph(toTake(i / fps)))) await once(encoder.stdin, 'drain');
    if (i % (fps * 5) === 0) process.stdout.write(`\r${Math.round((i / frames) * 100)}% `);
  }
  encoder.stdin.end();
  const [code] = await done;
  await close();
  fs.rmSync(music);
  if (code !== 0) throw new Error(`ffmpeg stopped with code ${code}`);
  process.stdout.write(
    `\r${duration.toFixed(1)}s, ${frames} frames in ${((Date.now() - started) / 60000).toFixed(1)} min\n`
  );
  made.unshift(film);

  const { 'loop-from': from, 'loop-to': to } = take.marks;
  if (from !== undefined && to !== undefined) made.push(...loopOf(film, { from: toFilm(from), to: toFilm(to) }, base));
  return made;
}
