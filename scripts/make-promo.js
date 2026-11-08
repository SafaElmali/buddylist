// Films the promo clip for the + on a contact: another agent on the same
// project, in a git worktree of its own.
//
//   npm run promo   ->  dist/promo/worktree.mp4
//
// The picture is the browser preview, driven the way make-screenshot.js drives
// it and filmed over the DevTools protocol. The script adds a camera (a
// transform on the desktop), a drawn mouse pointer and the captions; the app's
// own windows are as they are. The sound is the app's own samples, laid where
// the preview played them, over the music promo-music.js makes.
//
// Needs ffmpeg, and a browser for Playwright: npx playwright-core install chromium-headless-shell
// The functions handed to page.evaluate and addInitScript run in the browser.
/* global document, window, HTMLMediaElement */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
// The film is of the web preview; importing its build script runs it.
import './build-web-preview.js';
import { promoMusicWav } from './promo-music.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = path.join(ROOT, 'dist', 'web-preview');
const SOUNDS = path.join(ROOT, 'src', 'renderer', 'sounds');
const OUT_DIR = path.join(ROOT, 'dist', 'promo');
const FRAMES = path.join(OUT_DIR, 'frames');
const OUT = path.join(OUT_DIR, 'worktree.mp4');
const ORIGIN = 'http://preview.localhost';

const FRAME = { width: 1920, height: 1080 };
const FPS = 30;
const BRANCH = 'fix-login';
const FROM = 'Claude (website)';
const ADDED = `Claude (${BRANCH})`;
// Sounds whose cause is in the picture. The hello toast that follows signing in is not.
// Each with how much louder it is made: the sign-in recording is a quiet one.
const HEARD = { 'online.wav': 2, 'nudge.wav': 1 };
// How loud the music is next to them: present, but behind.
const MUSIC_LEVEL = 0.7;

// The preview's windows are sized for a small screen, so the camera stays close:
// the contact list fills the left half, or the list and a conversation fill the frame.
const STAGE = `
  #cm-root { transform-origin: 0 0; transition: transform 1.1s cubic-bezier(0.65, 0, 0.35, 1); }
  body[data-shot='list'] #cm-root { transform: scale(2.55); }
  body[data-shot='card'] #cm-root { transform: translate(0, -250px) scale(2.55); }
  body[data-shot='desk'] #cm-root { transform: scale(1.5); }

  #promo-panel {
    position: fixed; top: 0; right: 0; bottom: 0; width: 1020px; z-index: 200000;
    box-sizing: border-box; padding: 0 104px;
    display: flex; flex-direction: column; justify-content: center;
    background: linear-gradient(158deg, #082f96 0%, #1259dc 52%, #3f97f6 100%);
    box-shadow: -20px 0 70px rgba(0, 20, 70, 0.5);
    color: #fff; font-family: 'Trebuchet MS', Tahoma, sans-serif;
    transition: width 1.1s cubic-bezier(0.65, 0, 0.35, 1), padding 1.1s cubic-bezier(0.65, 0, 0.35, 1);
  }
  body[data-shot='desk'] #promo-panel { width: 440px; padding: 0 46px; }
  .promo-brand {
    position: absolute; top: 72px; left: 104px; display: flex; align-items: center; gap: 18px;
    font-size: 34px; font-weight: bold; white-space: nowrap; transition: left 1.1s, font-size 1.1s;
  }
  .promo-brand svg { width: 50px; height: 50px; flex: none; }
  body[data-shot='desk'] .promo-brand { left: 46px; font-size: 27px; }
  .promo-text { transition: opacity 0.3s ease, transform 0.3s ease; white-space: pre-line; }
  .promo-text.out { opacity: 0; transform: translateY(20px); }
  .promo-head {
    font-size: 96px; font-weight: bold; line-height: 1.06; letter-spacing: -1.5px;
    text-shadow: 0 4px 0 rgba(4, 20, 90, 0.5);
  }
  .promo-sub { margin-top: 30px; font-size: 39px; line-height: 1.32; color: #d3e4ff; }
  .promo-text.small .promo-head { font-size: 55px; letter-spacing: -0.5px; text-shadow: 0 3px 0 rgba(4, 20, 90, 0.5); }
  .promo-text.small .promo-sub { margin-top: 22px; font-size: 30px; }
  .promo-sub code { font: 600 31px ui-monospace, Menlo, monospace; color: #fff; overflow-wrap: anywhere; }

  #promo-cursor {
    position: fixed; left: 0; top: 0; width: 46px; height: 46px; z-index: 300000; pointer-events: none;
    filter: drop-shadow(2px 4px 4px rgba(0, 0, 0, 0.4));
  }
  .promo-click {
    position: fixed; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; z-index: 299999;
    box-sizing: border-box; border: 5px solid #fff; box-shadow: 0 0 0 3px rgba(18, 89, 220, 0.85);
    pointer-events: none; animation: promo-click 0.5s ease-out forwards;
  }
  @keyframes promo-click { to { transform: scale(4.4); opacity: 0; } }

  #promo-end {
    position: fixed; inset: 0; z-index: 400000; opacity: 0; transition: opacity 0.7s ease; pointer-events: none;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px;
    background: linear-gradient(158deg, #082f96 0%, #1259dc 52%, #3f97f6 100%);
    color: #fff; font-family: 'Trebuchet MS', Tahoma, sans-serif; text-align: center;
  }
  #promo-end.on { opacity: 1; }
  #promo-end svg { width: 150px; height: 150px; }
  #promo-end h1 { margin: 6px 0 0; font-size: 104px; letter-spacing: -2px; text-shadow: 0 4px 0 rgba(4, 20, 90, 0.5); }
  #promo-end p { margin: 0; font-size: 48px; color: #d3e4ff; }
  #promo-end span {
    margin-top: 34px; padding: 16px 38px; border-radius: 999px; background: rgba(255, 255, 255, 0.16);
    font: 600 36px ui-monospace, Menlo, monospace;
  }
`;

const POINTER = `<svg id="promo-cursor" viewBox="0 0 23 23" aria-hidden="true"><path d="M2 1.5v17.2l4.5-4.1 2.9 6.6 2.9-1.3-2.9-6.4h6.2z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: FRAME });

// Headless there is nothing to hear, so note what the windows play, and when.
const played = [];
await context.exposeBinding('__promoSound', (_source, src) =>
  played.push({ file: path.basename(src), at: Date.now() })
);
await context.addInitScript(() => {
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    window.__promoSound?.(this.currentSrc || this.src);
    return play.apply(this, args);
  };
});

const page = await context.newPage();
// The preview's windows only talk to each other over http, so answer from disk.
await page.route(`${ORIGIN}/**`, (route) =>
  route.fulfill({ path: path.join(DEMO, new URL(route.request().url()).pathname) })
);
await page.goto(`${ORIGIN}/index.html`);
await page.locator('#cm-note-close').click();

// ---- the stage: camera, caption panel, pointer --------------------------------------------------
await page.addStyleTag({ content: STAGE });
await page.evaluate((pointer) => {
  const mark = document.querySelector('#cm-tray-app svg').outerHTML;
  document.body.dataset.shot = 'list';
  document.body.insertAdjacentHTML(
    'beforeend',
    `<aside id="promo-panel">
       <div class="promo-brand">${mark}<span>buddylist</span></div>
       <div class="promo-text"><div class="promo-head"></div><div class="promo-sub"></div></div>
     </aside>
     <section id="promo-end">${mark}<h1>buddylist</h1><p>One repo. Many agents. No collisions.</p>
       <span>github.com/SafaElmali/buddylist</span></section>
     ${pointer}`
  );
}, POINTER);

/** Change the caption. `sub` may hold <code>; both are written here, never taken from the page. */
async function say(head, sub = '', { small = false } = {}) {
  await page.evaluate(
    async ([head, sub, small]) => {
      const text = document.querySelector('.promo-text');
      text.classList.add('out');
      await new Promise((resolve) => setTimeout(resolve, 300));
      text.classList.toggle('small', small);
      text.querySelector('.promo-head').textContent = head;
      text.querySelector('.promo-sub').innerHTML = sub;
      text.classList.remove('out');
    },
    [head, sub, small]
  );
}

/** Move the camera. The picture has settled once this returns. */
async function shot(name) {
  await page.evaluate((name) => {
    document.body.dataset.shot = name;
  }, name);
  await sleep(1200);
}

const pointer = { x: 1180, y: 860 };
const drawPointer = () =>
  page.evaluate(({ x, y }) => {
    document.getElementById('promo-cursor').style.transform = `translate(${x}px, ${y}px)`;
  }, pointer);

/** Glide the pointer, and the real mouse under it, to a point or to the middle of an element. */
async function moveTo(target, ms = 700) {
  const box = 'x' in target ? null : await target.boundingBox();
  const to = box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : target;
  const from = { ...pointer };
  const started = Date.now();
  for (;;) {
    const t = Math.min(1, (Date.now() - started) / ms);
    pointer.x = from.x + (to.x - from.x) * ease(t);
    pointer.y = from.y + (to.y - from.y) * ease(t);
    await Promise.all([page.mouse.move(pointer.x, pointer.y), drawPointer()]);
    if (t === 1) break;
  }
}

async function click() {
  await page.evaluate(({ x, y }) => {
    const ring = document.createElement('div');
    ring.className = 'promo-click';
    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
    document.body.appendChild(ring);
    setTimeout(() => ring.remove(), 600);
  }, pointer);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
}

// ---- film ------------------------------------------------------------------------------------------
const frames = [];
const cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  const file = path.join(FRAMES, `${String(frames.length).padStart(5, '0')}.jpg`);
  frames.push({ file, at: metadata.timestamp * 1000 });
  fs.writeFile(file, Buffer.from(data, 'base64'), () => {});
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});

const list = page.frameLocator('.cm-contacts iframe');
const row = (name) => list.locator('.contact', { hasText: name });
const dialog = list.locator('.dialog');

await drawPointer();
await say('buddylist', 'Chat with your coding agents like it’s 2005.');
await sleep(400);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 96, maxWidth: FRAME.width, maxHeight: FRAME.height });
const began = Date.now();
await sleep(700);

// Sign in: the sound everybody remembers, and the contact list.
await moveTo(page.locator('#cm-signin-go'), 800);
await sleep(150);
await click();
await row(FROM).waitFor();
await sleep(1300);

await say('One repo.\nTwo agents?', 'Without one undoing the other’s work.');
await moveTo(row(FROM).locator('.name'), 900);
// Selecting the contact keeps its hover card out of the way.
await click();
await sleep(1100);

// The + is its project's: it is there once the project's line is pointed at.
const project = list.locator('.group-header', { hasText: new RegExp(`^\\s*${FROM.match(/\((.+)\)/)[1]} \\(`) });
await say('Click +', 'on the project that’s already there.');
await moveTo(project.locator('span').first(), 600);
await moveTo(project.locator('.contact-add'), 500);
await sleep(650);
await click();
await dialog.waitFor();
await sleep(700);

await say('Name a branch.', 'Service, model and mode come along.');
await sleep(400);
await page.keyboard.type(BRANCH, { delay: 120 });
await sleep(1100);

await say('Press Enter.');
await sleep(700);
await page.keyboard.press('Enter');
await dialog.waitFor({ state: 'detached' });
await row(ADDED).waitFor();
await sleep(800);

// Pull back: its conversation opened next to the list.
const chat = page.frameLocator('.cm-chat iframe');
await Promise.all([shot('desk'), say('A new agent,\nin its own\ngit worktree.', '', { small: true })]);
await sleep(900);

await moveTo(chat.locator('#input'), 750);
await click();
await page.keyboard.type('fix the login redirect and add a test for it (Y)', { delay: 38 });
await sleep(350);
await say('Same repo.\nSeparate\nbranches.', 'Nobody steps on anybody’s files.', { small: true });
await page.keyboard.press('Enter');
// Back to the contact list, so the new agent has to nudge for attention.
await moveTo({ x: 255, y: 800 }, 380);
await click();
await chat.getByText('Always allow').waitFor();
await sleep(2300);

// Close in on the new contact and rest on it: its card names the branch.
await Promise.all([
  shot('card'),
  say('Its own branch.\nIts own folder.', `<code>~/.buddylist/worktrees/website/${BRANCH}</code>`),
]);
await moveTo(row(ADDED).locator('.name'), 900);
await list.locator('.contact-card', { hasText: BRANCH }).waitFor();
await sleep(2700);

const outroAt = Date.now();
await page.evaluate(() => document.getElementById('promo-end').classList.add('on'));
await sleep(3800);
const ended = Date.now();
await cdp.send('Page.stopScreencast');
await sleep(300);
await browser.close();

// ---- cut: the frames at the pace they were filmed, and the sounds where they were played -------------
const shown = frames.filter((frame) => frame.at >= began && frame.at <= ended);
const lines = ['ffconcat version 1.0'];
shown.forEach((frame, i) => {
  const until = shown[i + 1]?.at ?? ended;
  lines.push(`file '${frame.file}'`, `duration ${((until - frame.at) / 1000).toFixed(4)}`);
});
// The concat reader only honours a last duration when the file is named once more.
lines.push(`file '${shown.at(-1).file}'`);
const cuts = path.join(OUT_DIR, 'frames.txt');
fs.writeFileSync(cuts, lines.join('\n'));

const start = shown[0].at;
const seconds = ((ended - start) / 1000).toFixed(2);
// The music's loop ends as the end card comes in, and its last chord rings under it.
const music = path.join(OUT_DIR, 'music.wav');
fs.writeFileSync(music, promoMusicWav({ seconds: Number(seconds), outroAt: (outroAt - start) / 1000 }));

const heard = played.filter((sound) => sound.file in HEARD && sound.at >= began && sound.at <= ended);
const inputs = ['-i', music, ...heard.flatMap((sound) => ['-i', path.join(SOUNDS, sound.file)])];
const delayed = heard.map(
  (sound, i) =>
    `[${i + 2}:a]volume=${HEARD[sound.file]},adelay=${Math.max(0, Math.round(sound.at - start))}:all=1[a${i}]`
);
const together = heard.length > 1 ? `amix=inputs=${heard.length}:normalize=0,` : '';
// The music steps back for as long as one of the app's sounds is playing.
const mix = heard.length
  ? [
      ...delayed,
      `${heard.map((_sound, i) => `[a${i}]`).join('')}${together}apad,asplit[app][key]`,
      `[1:a]volume=${MUSIC_LEVEL}[music]`,
      '[music][key]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=450[under]',
      '[under][app]amix=inputs=2:normalize=0,alimiter=limit=0.95[a]',
    ]
  : [`[1:a]volume=${MUSIC_LEVEL}[a]`];

execFileSync(
  'ffmpeg',
  [
    ...['-y', '-loglevel', 'error'],
    ...['-f', 'concat', '-safe', '0', '-i', cuts],
    ...inputs,
    ...['-filter_complex', [`[0:v]fps=${FPS},format=yuv420p[v]`, ...mix].join(';')],
    ...['-map', '[v]', '-map', '[a]', '-t', seconds],
    ...['-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-c:a', 'aac', '-b:a', '160k'],
    ...['-movflags', '+faststart', OUT],
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] }
);
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.rmSync(cuts);
fs.rmSync(music);

const megabytes = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
console.log(`dist/promo/worktree.mp4 (${seconds}s, ${shown.length} frames, ${megabytes} MB)`);
console.log(
  `sounds: ${heard.map((s) => `${s.file} at ${((s.at - start) / 1000).toFixed(1)}s`).join(', ') || 'none'}, over music`
);
