// Films the app in demo mode while a scene works it: each window it shows, over the DevTools protocol at twice
// its size, and when the pointer, the keys, the captions, the camera and the voice moved. That is the take,
// which render.js puts together. A scene (see scenes/) makes the app's data, sets things up off camera, then
// plays its part on camera with the Director.
//
// The app gets a home folder of its own under the system's temporary folder, so its paths read ~/code/shop and
// nothing of yours is in the picture. Its windows open where nobody sees them (see hide-windows.cjs).
/* global document, window */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import electronPath from 'electron';
import { _electron as electron } from 'playwright-core';
import { History } from '../../src/main/storage/history.js';
import { Store } from '../../src/main/storage/store.js';
import { makeCamera } from './camera.js';
import { MOST, VIEW, captionHtml } from './stage.js';

const HIDE = path.join(path.dirname(new URL(import.meta.url).pathname), 'hide-windows.cjs');
/** How long the title card is up before the windows come out. */
const TITLE_MS = 1500;
/** The breath after each line said, before the next can start. */
const LINE_GAP = 380;
/** How long the end card stays once the last line is said. */
const END_MS = 1200;
/** Desk the camera leaves around the windows in a wide shot, and around what it looks at closer in. */
const MARGIN = 36;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * What a scene's `prepare` is handed: where the app's home and data are, its store and history, and git and
 * a file writer that work in that home.
 * @typedef {{ home: string, data: string, store: Store, history: History,
 *   git: (cwd: string, ...args: string[]) => void, write: (file: string, text: string) => void }} Preparing
 */

/**
 * @typedef {import('./camera.js').Rect} Rect
 * @typedef {import('playwright-core').Page} Page
 * @typedef {import('playwright-core').Locator} Locator
 * @typedef {Page | Locator | Rect | 'wide'} Target
 */

/** What a scene works the app with, and what it says the film is to show. */
export class Director {
  /** @type {Page} the contact list */
  contacts;

  #app;
  #take;
  #said;
  // Until the film begins, everything happens at its start.
  #t0 = Infinity;
  #camera = makeCamera(VIEW, MOST);
  /** Each window by name: its page, its BrowserWindow's id, and how it is filmed. */
  #windows = new Map();
  #names = new Map();
  #pointer = { x: 600, y: 420 };
  /** The page the keys go to: the one last clicked. */
  #typing = null;
  #pending = new Set();
  /** The window in front, which looks it. */
  #active = null;
  #writing = new Set();
  /** What went wrong in something the scene didn't wait for. */
  #failed = null;
  /** The loop that keeps the windows' places, while the film goes on. */
  #watching = null;
  #stopped = false;

  constructor(app, take, said) {
    this.#app = app;
    this.#take = take;
    this.#said = said;
    take.pointer = { ...this.#pointer };
  }

  /** Milliseconds since the film began. */
  now() {
    return Math.max(0, Date.now() - this.#t0);
  }

  /** The film begins now. */
  start() {
    this.#t0 = Date.now();
  }

  wait(ms) {
    return sleep(ms);
  }

  /** Opens a contact's conversation window, off camera until it is shown. */
  async open(contactId) {
    const opened = this.#app.waitForEvent('window', { predicate: (page) => page.url().includes('chat.html') });
    await this.contacts.evaluate((id) => window.messenger.chat.open(id), contactId);
    const page = await opened;
    page.setDefaultTimeout(30000);
    await page.locator('#input').waitFor();
    await this.#quiet(page);
    return page;
  }

  /**
   * Puts a window on the desk, where `bounds` says, and films it from now on.
   * @param {Page | 'contacts'} which
   * @param {Rect} bounds  in the desk's points
   */
  async show(which, bounds) {
    const page = which === 'contacts' ? this.contacts : which;
    const handle = await this.#app.browserWindow(page);
    await handle.evaluate((win, b) => win.setBounds(b), {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    });
    if (this.#names.has(page)) return;
    const name = which === 'contacts' ? 'contacts' : `w${this.#windows.size}`;
    this.#names.set(page, name);
    const id = await handle.evaluate((win) => win.id);
    const record = { frames: [], bounds: [], shown: [{ at: this.now(), on: true }] };
    this.#take.windows[name] = record;
    const cdp = await page.context().newCDPSession(page);
    // It has the focus, as far as the page can tell: the caret blinks, and what is focused looks it.
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    fs.mkdirSync(path.join(this.#take.dir, name), { recursive: true });
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      const file = `${name}/${String(record.frames.length).padStart(5, '0')}.jpg`;
      record.frames.push({ file, t: metadata.timestamp * 1000, w: metadata.deviceWidth, h: metadata.deviceHeight });
      const written = fs.promises.writeFile(path.join(this.#take.dir, file), Buffer.from(data, 'base64'));
      this.#writing.add(written);
      written.finally(() => this.#writing.delete(written));
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92 });
    this.#windows.set(name, { page, id, cdp, record });
    await this.#looksActive(page, true);
    await this.#watch();
  }

  /** Brings a window to the front: it looks active, and the others don't. */
  front(page) {
    this.#active = page;
    const name = this.#names.get(page);
    const others = [...this.#windows.keys()].filter((other) => other !== name);
    this.#take.order.push({ at: this.now(), names: [...others, name] });
    for (const [other, { page: p }] of this.#windows) this.#later(this.#looksActive(p, other === name));
  }

  // ---- what the film says ----

  /**
   * Says a line of the narration from now on. Resolves once it is said, and the breath after it is over.
   * @param {string} id
   */
  say(id) {
    const line = this.#said[id];
    if (!line) throw new Error(`The narration has no line called “${id}”.`);
    this.#take.lines.push({ id, at: this.now(), ms: line.ms, file: line.file });
    return sleep(line.ms + LINE_GAP);
  }

  /** The caption in the band from now on: **these** words stand out. */
  caption(text) {
    this.#take.captions.push({ at: this.now(), html: captionHtml(text) });
  }

  /** Names this moment, such as where the loop starts. */
  mark(name) {
    this.#take.marks[name] = this.now();
  }

  /** The film's end card comes in now, and the film ends once `last` has, such as the last line said. */
  async end(last) {
    this.#take.end = this.now();
    await last;
    await sleep(END_MS);
    this.#take.duration = this.now();
  }

  /** Does something the film leaves out: what was on screen before it goes straight on to what is after. */
  async cut(doing) {
    const from = this.now();
    await doing();
    this.#take.cuts.push({ from, to: this.now() });
  }

  // ---- the camera ----

  /**
   * Moves the camera onto something: a window, a part of one, a rect of the desk, or the whole desk ('wide').
   * The moment it starts moving is now, also when it takes a moment to find where that is.
   * @param {Target} target
   * @param {{ ms?: number, pad?: number }} [how]
   */
  look(target, { ms = 1000, pad = 24 } = {}) {
    const at = this.now();
    return this.#later(
      (async () => {
        const wide = target === 'wide';
        const rect = wide ? this.#camera.pad(this.#area(), MARGIN) : this.#camera.pad(await this.rect(target), pad);
        this.#move(at, ms, rect, { room: wide ? MARGIN : 0 });
      })()
    );
  }

  /** Where something is on the desk: a window, a part of one, or the smallest rect around several parts. */
  async rect(...targets) {
    const rects = [];
    for (const target of targets) {
      if ('x' in target && 'width' in target) rects.push(target);
      else if (this.#names.has(target)) rects.push(this.#bounds(this.#names.get(target)));
      else {
        // Everything it matches.
        const { x, y } = this.#bounds(this.#names.get(target.page()));
        const boxes = (await Promise.all((await target.all()).map((one) => one.boundingBox()))).filter(Boolean);
        if (!boxes.length) throw new Error(`${target} is not on screen`);
        for (const box of boxes) rects.push({ x: x + box.x, y: y + box.y, width: box.width, height: box.height });
      }
    }
    return this.#camera.union(...rects);
  }

  // ---- the pointer and the keys ----

  /**
   * Glides the pointer, and the real mouse with it, to the middle of something or to a point of the desk.
   * Where it is heading out of the camera's view, the camera slides along to keep it in.
   * @param {Locator | { x: number, y: number }} target
   * @param {{ ms?: number, follow?: boolean }} [how]
   */
  async moveTo(target, { ms = 700, follow = true } = {}) {
    const to = await this.#point(target);
    const from = { ...this.#pointer };
    const t0 = this.now();
    this.#take.moves.push({ t0, t1: t0 + ms, from, to });
    if (follow) {
      const now = this.#camera.track(this.#take.camera)(t0 + ms);
      const slid = now && this.#camera.follow(now, to);
      if (slid) this.#move(t0, ms, slid, { shaped: true });
    }
    // The real mouse goes too, over the window it ends on, for what it points at to light up.
    const page = target.page?.() ?? null;
    const name = page && this.#names.get(page);
    if (page && name) {
      const { x, y } = this.#bounds(name);
      const steps = Math.max(1, Math.round(ms / 40));
      for (let i = 1; i <= steps; i += 1) {
        const p = this.#camera.ease(i / steps);
        await page.mouse.move(from.x + (to.x - from.x) * p - x, from.y + (to.y - from.y) * p - y);
        await sleep(ms / steps);
      }
    } else await sleep(ms);
    this.#pointer = to;
  }

  /**
   * Moves to something and clicks it. With `zoom`, the camera goes in on it as the pointer goes, as close as
   * `zoom` points of the desk across, and stays there.
   * @param {Locator} target
   * @param {{ ms?: number, zoom?: number, double?: boolean }} [how]
   */
  async click(target, { ms = 700, zoom, double = false } = {}) {
    await target.scrollIntoViewIfNeeded();
    if (zoom) {
      const point = await this.#point(target);
      const height = zoom / (VIEW.width / VIEW.height);
      this.#move(this.now(), ms + 250, { x: point.x - zoom / 2, y: point.y - height / 2, width: zoom, height });
    }
    await this.moveTo(target, { ms, follow: !zoom });
    const page = target.page();
    this.#take.clicks.push({ at: this.now(), ...this.#pointer });
    const { x, y } = this.#bounds(this.#names.get(page));
    await page.mouse.click(this.#pointer.x - x, this.#pointer.y - y, { clickCount: double ? 2 : 1, delay: 60 });
    this.#typing = page;
    await sleep(120);
  }

  /** Types into what was clicked last, a key at a time. */
  async type(text, { delay = 55 } = {}) {
    await this.#typing.keyboard.type(text, { delay });
  }

  /** Presses keys, and shows them on a keycap under the windows. */
  async press(keys, label) {
    this.#take.keys.push({ at: this.now(), label });
    await this.#typing.keyboard.press(keys);
  }

  // ---- inside ----

  /** Runs a promise the scene needn't wait for, and makes sure the film does. */
  #later(promise) {
    const kept = promise.catch((error) => {
      this.#failed ??= error;
    });
    this.#pending.add(kept);
    kept.finally(() => this.#pending.delete(kept));
    return kept;
  }

  /**
   * A camera move to a rect of the desk, in the picture's shape and kept over the windows: a wide shot has
   * `room` of desk around them, a closer one none.
   */
  #move(at, ms, rect, { shaped = false, room = 0 } = {}) {
    const area = this.#camera.pad(this.#area(), room);
    const fitted = this.#camera.within(shaped ? rect : this.#camera.shape(rect), area);
    this.#take.camera.push({ at, ms, rect: fitted });
  }

  async #point(target) {
    if ('x' in target && !('page' in target)) return target;
    const r = await this.rect(target);
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }

  /** Where a window is now. */
  #bounds(name) {
    const { bounds } = this.#take.windows[name];
    return bounds[bounds.length - 1];
  }

  /** The desk the windows on show cover. */
  #area() {
    return this.#camera.union(...[...this.#windows.keys()].map((name) => this.#bounds(name)));
  }

  /** Keeps each window's place on the desk as it moves and grows, from now until the film ends. */
  async #watch() {
    const poll = async () => {
      const ids = [...this.#windows.values()].map(({ id }) => id);
      const places = await this.#app.evaluate(
        ({ BrowserWindow }, list) =>
          list.map((id) => {
            const win = BrowserWindow.fromId(id);
            return win && !win.isDestroyed() ? win.getContentBounds() : null;
          }),
        ids
      );
      [...this.#windows.values()].forEach(({ record }, i) => {
        const place = places[i];
        const last = record.bounds[record.bounds.length - 1];
        const moved = !last || ['x', 'y', 'width', 'height'].some((key) => last[key] !== place?.[key]);
        if (place && moved) record.bounds.push({ at: this.now(), ...place });
      });
    };
    await poll();
    if (!this.#watching) {
      this.#watching = (async () => {
        while (!this.#stopped) {
          await poll().catch(() => {});
          await sleep(50);
        }
      })();
    }
  }

  /** Keeps a window's title bar as it would be with the focus, or without: the system's focus is elsewhere. */
  #looksActive(page, active) {
    return page.evaluate((on) => {
      const win = document.querySelector('.window');
      if (!win) return;
      window.filmActive = on;
      if (!window.filmWatch) {
        window.filmWatch = new window.MutationObserver(() => {
          if (win.classList.contains('inactive') === window.filmActive) win.classList.toggle('inactive');
        });
        window.filmWatch.observe(win, { attributes: true, attributeFilter: ['class'] });
      }
      win.classList.toggle('inactive', !on);
    }, active);
  }

  /**
   * What demo mode says about itself is no part of the app the film shows: in the page as it is, and in each
   * page the window loads from now on, as one does when it shows another conversation.
   */
  async #quiet(page) {
    await page.addInitScript(quietPage);
    await page.evaluate(quietPage);
    // A page loaded again has its title bar as the app draws it, with the focus elsewhere.
    page.on('domcontentloaded', () => this.#later(this.#looksActive(page, this.#active === page)));
  }

  /** Stops filming, and turns the take's times into the film's. Throws what went wrong while it filmed. */
  async finish() {
    await Promise.all(this.#pending);
    this.stop();
    await this.#watching;
    await Promise.all([...this.#windows.values()].map(({ cdp }) => cdp.send('Page.stopScreencast').catch(() => {})));
    await sleep(300);
    await Promise.all(this.#writing);
    for (const { record } of this.#windows.values()) {
      for (const frame of record.frames) {
        frame.at = Math.round(frame.t - this.#t0);
        delete frame.t;
      }
      record.frames.sort((a, b) => a.at - b.at);
    }
    if (this.#failed) throw this.#failed;
  }

  /** Stops keeping the windows' places. */
  stop() {
    this.#stopped = true;
  }

  /** The contact list, as the app opened it, before any scene runs. */
  async begin(contacts) {
    this.contacts = contacts;
    contacts.setDefaultTimeout(30000);
    await contacts.locator('.contact').first().waitFor();
    await this.#quiet(contacts);
  }
}

/** Hides demo mode's own sentences, and its badge, as they come. Runs in the app's pages. */
function quietPage() {
  const hide = () => {
    // A reply's last paragraph, and the notice under the first reply.
    for (const node of document.querySelectorAll('p, .notice')) {
      if (/^\s*(This is demo mode|Demo mode:)/i.test(node.textContent)) node.style.display = 'none';
    }
    // And the same where the app quotes what an agent said in a line of its own.
    const root = document.body ?? document.documentElement;
    if (root) {
      const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        const at = text.nodeValue.indexOf('This is demo mode');
        if (at > 0) text.nodeValue = text.nodeValue.slice(0, at).trimEnd();
      }
    }
    const badge = document.getElementById('demo-badge');
    if (badge) badge.style.display = 'none';
  };
  new window.MutationObserver(hide).observe(document, { childList: true, subtree: true, characterData: true });
  hide();
}

/**
 * Films a scene.
 * @returns {Promise<object>} the take
 */
export async function film({ root, scene, sceneName, said, takeDir }) {
  const work = path.join(fs.realpathSync(os.tmpdir()), 'buddylist-video', sceneName);
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(takeDir, { recursive: true, force: true });
  fs.mkdirSync(takeDir, { recursive: true });
  const home = path.join(work, 'home');
  const data = path.join(home, '.buddylist');
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const git = (cwd, ...args) =>
    execFileSync('git', ['-C', cwd, '-c', 'user.name=Sam', '-c', 'user.email=sam@example.com', ...args], {
      stdio: 'ignore',
      env: { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
    });
  const store = new Store(data, { defaultProvider: 'claude' });
  store.finishOnboarding();
  store.updateProfile({ name: 'Sam', status: 'online' });
  store.updateSettings({
    sounds: false,
    shareUsage: false,
    errorReports: false,
    autoAway: false,
    suggestReplies: false,
  });
  const history = new History(path.join(data, 'history'));
  const prepared = scene.prepare({ home, data, store, history, git, write });
  history.flush();

  const take = {
    dir: takeDir,
    title: scene.title,
    windows: {},
    order: [],
    moves: [],
    clicks: [],
    keys: [],
    captions: [],
    lines: [],
    camera: [],
    cuts: [],
    marks: {},
  };
  const env = { ...process.env, HOME: home, BUDDYLIST_DEMO: '1', BUDDYLIST_TEST: '1', BUDDYLIST_USER_DATA: data };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: electronPath,
    args: ['-r', HIDE, root, '--force-device-scale-factor=2', '--disable-renderer-backgrounding'],
    env,
    timeout: 60000,
  });
  const d = new Director(app, take, said);
  try {
    await d.begin(await app.firstWindow());
    const set = await scene.setup(d, prepared);
    await sleep(800);
    d.start();
    take.reveal = TITLE_MS;
    await sleep(TITLE_MS);
    await scene.play(d, { ...prepared, ...set });
    if (take.duration === undefined) throw new Error('The scene never called d.end().');
    await d.finish();
  } catch (error) {
    for (const [i, page] of app.windows().entries())
      await page.screenshot({ path: path.join(takeDir, `failed-${i}.png`) }).catch(() => {});
    throw error;
  } finally {
    d.stop();
    await app.close().catch(() => {});
  }
  take.camera.sort((a, b) => a.at - b.at);
  delete take.dir;
  return take;
}
