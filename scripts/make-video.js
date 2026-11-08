// Makes a feature video of the real app from a scene in scripts/video/scenes/: the app, in demo mode, is filmed
// while the scene works it, with a camera that follows what happens, then put together with a voice reading
// the scene's narration. See docs/feature-videos.md.
//
//   npm run video -- managers                          ->  dist/video/managers/
//   npm run video -- managers --voice kokoro:am_michael    in another voice (see scripts/video/voice.js)
//   npm run video -- managers --out /tmp/videos        somewhere else
//   npm run video -- managers --again                  put together again from the last take, without filming
//   npm run video -- managers --still 12.5             photographs of moments of the last take, to check a change
//   npm run video -- managers --draft                  quicker to make, at 30 frames a second
//   npm run video -- managers --voices qwen3:Aiden,kokoro:af_heart,elevenlabs   the same lines in each voice
//
// It makes:
//   <scene>.mp4        1920 by 1080, with the voice and a quiet bed of music, for YouTube
//   <scene>.srt        the narration's captions, timed to it
//   <scene>-voice.wav  the voice alone
//   <scene>-loop.mp4, -loop.webm, -loop.gif   a short silent loop of the scene's heart, for the changelog and the site
//
// The app's windows are filmed where nobody sees them: they are see-through and never take the focus, so it
// can run while you work. Needs ffmpeg, uv for a voice made on this Mac, and a browser for Playwright:
// npx playwright-core install chromium-headless-shell
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { film } from './video/film.js';
import { render, stills } from './video/render.js';
import { RATE, loudnessOf, parseVoice, readWav, speak, spokenText, track, writeWav } from './video/voice.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCENES = path.join(ROOT, 'scripts', 'video', 'scenes');
// Unless --voice says otherwise. Set BUDDYLIST_VIDEO_VOICE to use another every time.
const VOICE = process.env.BUDDYLIST_VIDEO_VOICE || 'qwen3:Aiden';
// The pause between two lines of a voice sample.
const SAMPLE_GAP = 0.45;

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const sceneName = args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));
const known = fs.readdirSync(SCENES).map((file) => file.replace(/\.js$/, ''));
if (!sceneName || !known.includes(sceneName)) {
  console.error(`Which scene? npm run video -- <${known.join('|')}> [--voice engine:voice] [--again] [--draft]`);
  process.exit(1);
}
const scene = await import(path.join(SCENES, `${sceneName}.js`));
const out = path.resolve(option('--out') ?? path.join(ROOT, 'dist', 'video', sceneName));
const takeDir = path.join(out, 'take');
fs.mkdirSync(out, { recursive: true });

/** The narration's lines as a voice is to say them. */
const lines = (ids) => ids.map((id) => ({ id, text: spokenText(scene.narration[id], scene.spoken) }));

if (option('--voices')) {
  // The same lines in each voice, one after the other, each file as loud as the others.
  const dir = path.join(out, 'voices');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of option('--voices').split(',')) {
    const voice = parseVoice(name);
    let said;
    try {
      said = await speak(lines(scene.sample), voice.name);
    } catch (error) {
      console.error(`${voice.name}: ${error.message}`);
      continue;
    }
    const clips = [];
    let at = 0.3;
    for (const id of scene.sample) {
      clips.push({ samples: readWav(said[id].file).samples, at });
      at += said[id].ms / 1000 + SAMPLE_GAP;
    }
    const raw = path.join(dir, 'raw.wav');
    writeWav(raw, RATE, track(clips, at + 0.3));
    const file = path.join(dir, `${voice.name.replace(/[^\w-]+/g, '-')}.wav`);
    loudnessOf(raw, file);
    fs.rmSync(raw);
    console.log(`${path.relative(process.cwd(), file)}  ${at.toFixed(1)}s  ${voice.model}  (${voice.licence})`);
  }
} else if (args.includes('--still')) {
  const take = JSON.parse(fs.readFileSync(path.join(takeDir, 'take.json'), 'utf8'));
  const times = args.flatMap((arg, i) => (arg === '--still' ? [Number(args[i + 1])] : []));
  for (const file of await stills({ take, takeDir, scene, out, times }))
    console.log(path.relative(process.cwd(), file));
} else {
  let take;
  if (args.includes('--again')) take = JSON.parse(fs.readFileSync(path.join(takeDir, 'take.json'), 'utf8'));
  else {
    const voice = option('--voice') ?? VOICE;
    const said = await speak(lines(Object.keys(scene.narration)), voice);
    take = await film({ root: ROOT, scene, sceneName, said, takeDir });
    take.voice = parseVoice(voice);
    fs.writeFileSync(path.join(takeDir, 'take.json'), JSON.stringify(take));
  }
  const made = await render({ take, takeDir, scene, sceneName, out, draft: args.includes('--draft') });
  for (const file of made)
    console.log(`${path.relative(process.cwd(), file)}  ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
}
