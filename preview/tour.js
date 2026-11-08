// The tour: the preview plays itself. A drawn mouse pointer goes through the
// app's real windows the way a person would (sign in, open a conversation, ask
// for a fix, accept it, ask for a terminal, open the changes) while a balloon says
// what is happening. Nothing here reaches into the app: it clicks what is on
// screen and types into what is there. A click or a key of the visitor's ends it
// on the spot, and whatever it had opened is theirs to carry on with.

/** Thrown through the script to end it: the tour was stopped, or something it waited for never came. */
const OVER = Symbol('over');

const CONTACT = 'Claude (api)';
// "fix" is what makes the scripted contact ask to edit a file (see src/providers/demo/session.js).
const MESSAGE = 'the cart total is NaN, can you fix it? :)';
// "terminal" is what makes it ask the app for one, and what follows "running" is typed into it.
const TERMINAL = 'open a terminal running git status';

const HANDED_OVER = 'Your turn: this is the app’s real interface.';
const FINISHED = 'That is buddylist. Your turn: this is the app’s real interface.';

// How long a step waits for what it needs, counted in looks: a tab in the background runs its
// timers slowly, and is given the same number of looks, not the same time.
const LOOK_MS = 60;
const PATIENCE_MS = 9000;
// How long the last balloon stays once the pointer is gone.
const FAREWELL_MS = 6000;

/**
 * The tour, a step at a time. Each says its caption, then acts it out with what `Stage` can do.
 * A step whose `when` says no is left out, and not counted.
 * @type {{ caption: string, when?: () => boolean, play: (stage: Stage) => Promise<void> }[]}
 */
export const STEPS = [
  {
    caption: 'Your coding agents, as a buddy list from 2005. Sign in to see them.',
    when: () => Boolean(document.getElementById('cm-signin')),
    async play(stage) {
      await stage.pause(500);
      await stage.click(() => stage.find(null, '#cm-signin-go'));
    },
  },
  {
    // One step, so the pointer glances at the tags on its way to the contact instead of waiting there.
    caption: 'Each contact is an agent on a project, tagged with its pull request. Double-click one.',
    async play(stage) {
      await stage.point(() => stage.find('contacts', '.contact .pr-tags'));
      await stage.pause(1300);
      const name = () => stage.find('contacts', '.contact .name', CONTACT);
      await stage.point(name);
      // The first press chooses the row, which draws the list again: the second goes to the row as it is then.
      stage.fire(await name(), 'mousedown');
      await stage.pause(140);
      stage.fire(await name(), 'dblclick');
      // Its window is ready once the status bar under the conversation says so.
      await stage.find('chat', '#statusbar .status-text');
      await stage.pause(1500);
    },
  },
  {
    caption: 'Say what you want done, as you would to a colleague.',
    async play(stage) {
      const input = await stage.find('chat', '#input');
      await stage.point(input);
      await stage.write(input, MESSAGE);
      await stage.pause(350);
      await stage.click(() => stage.find('chat', '#send:not(:disabled)'));
    },
  },
  {
    caption: 'It asks before it changes a file, and shows you the change.',
    async play(stage) {
      const accept = () => stage.find('chat', '.invite.open a[data-d="allow"]');
      await accept();
      // Long enough to read the invitation, and for the window to stop shaking if it nudged.
      await stage.pause(2400);
      await stage.click(accept);
    },
  },
  {
    caption: 'Accepted: it makes the edit, runs the tests and says how it went.',
    async play(stage) {
      // Send is Stop while a turn runs.
      await stage.find('chat', '#send:not(.stop)', '', 20000);
      await stage.pause(2100);
    },
  },
  {
    caption: 'Ask for a terminal, with a command to run in it. It asks before it types one in.',
    async play(stage) {
      const input = await stage.find('chat', '#input');
      await stage.point(input);
      await stage.write(input, TERMINAL);
      await stage.pause(350);
      await stage.click(() => stage.find('chat', '#send:not(:disabled)'));
      const accept = () => stage.find('chat', '.invite.open a[data-d="allow"]');
      await accept();
      await stage.pause(2200);
      await stage.click(accept);
    },
  },
  {
    caption: 'It opens beside the conversation. In the app it is your own shell; here, a pretend one.',
    async play(stage) {
      await stage.until(() => stage.text('chat', '.terminal-tab .xterm-rows').includes('On branch'));
      // Beside what the shell printed, not on it.
      await stage.point(() => stage.find('chat', '.terminal-tab .xterm-screen'), { x: 0.8, y: 0.6 });
      await stage.pause(2600);
    },
  },
  {
    caption: 'The + opens the Changes tab: what is not committed yet. ▾ folds the terminal away.',
    async play(stage) {
      await stage.click(() => stage.find('chat', '.pane-add'));
      const entry = await stage.find('chat', '.popup .menu-item', 'Changes');
      stage.fire(entry, 'mouseenter');
      await stage.click(entry);
      await stage.find('chat', '.changes-list .change-row');
      await stage.pause(700);
      await stage.click(() => stage.find('chat', '.pane-fold[aria-expanded="true"]'));
      await stage.pause(900);
    },
  },
  {
    caption: 'There is the file it just edited. Click a row to read its diff.',
    async play(stage) {
      // Further down than a short list shows: it is scrolled to the top first, with room for its diff under it.
      const row = await stage.find('chat', '.changes-list .change-row', 'cart.js');
      const list = row.closest('.changes-list');
      const below = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
      list.scrollTo({ top: list.scrollTop + below, behavior: 'smooth' });
      await stage.pause(500);
      // In the row's empty middle, so the name stays readable.
      await stage.click(() => stage.find('chat', '.changes-list .change-row', 'cart.js'), { x: 0.45, y: 0.6 });
      await stage.find('chat', '.change.open pre.diff');
      await stage.pause(3000);
    },
  },
];

/** The stage the steps play on: the pointer, the balloon, and the windows on the desktop. */
class Stage {
  /** @param {{ over: boolean }} run  the playing of the tour this stage belongs to: once it is over, nothing acts */
  constructor(run) {
    this.run = run;
    this.desktop = document.getElementById('cm-desktop');
    this.cursor = document.getElementById('cm-tour-cursor');
    this.balloon = document.getElementById('cm-tour-caption');
    const { width, height } = this.desktop.getBoundingClientRect();
    /** Where the pointer is, from the desktop's top left corner. It comes in from the middle. */
    this.at = { x: width * 0.56, y: height * 0.62 };
  }

  /** Every wait ends here, and nothing happens after one that was cut short. */
  check() {
    if (this.run.over) throw OVER;
  }

  async pause(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    this.check();
  }

  /**
   * Waits until `test` answers with something, and gives that back. Gives up after `patience`.
   * @template T
   * @param {() => T} test
   * @param {number} [patience]
   * @returns {Promise<NonNullable<T>>}
   */
  async until(test, patience = PATIENCE_MS) {
    for (let waited = 0; waited <= patience; waited += LOOK_MS) {
      this.check();
      const found = test();
      if (found) return found;
      await this.pause(LOOK_MS);
    }
    throw OVER;
  }

  /** The page of a window on the desktop, or the desktop's own for `null`. None while it can't be reached. */
  page(kind) {
    if (!kind) return document;
    try {
      return this.desktop.querySelector(`.cm-${kind} iframe`)?.contentDocument ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Waits for something that is on screen in a window: the first match of `selector`, with `text` in it.
   * @param {'contacts' | 'chat' | null} kind  which window; null for the desktop itself
   * @returns {Promise<HTMLElement>}
   */
  find(kind, selector, text = '', patience = PATIENCE_MS) {
    return this.until(() => {
      const nodes = /** @type {HTMLElement[]} */ ([...(this.page(kind)?.querySelectorAll(selector) ?? [])]);
      return nodes.find((node) => node.getClientRects().length && node.textContent.includes(text));
    }, patience);
  }

  /** What `selector` reads in a window right now. Empty while it is not there. */
  text(kind, selector) {
    return this.page(kind)?.querySelector(selector)?.textContent ?? '';
  }

  /**
   * Where a part of `node` is on the desktop: just under its middle, where the pointer's arrow hides
   * the least of it, unless `spot` names another part.
   * @param {HTMLElement} node
   * @param {{ x: number, y: number }} [spot]  from its top left corner (0, 0) to its bottom right (1, 1)
   */
  place(node, spot = { x: 0.5, y: 0.6 }) {
    const rect = node.getBoundingClientRect();
    // What is in a window is measured from that window's corner. The desktop's own page can sit in a
    // frame too, on the landing page, and that frame's corner is not one the desktop is measured from.
    const inWindow = node.ownerDocument !== document;
    const frame = inWindow ? node.ownerDocument.defaultView.frameElement.getBoundingClientRect() : { left: 0, top: 0 };
    const stage = this.desktop.getBoundingClientRect();
    return {
      x: frame.left + rect.left + rect.width * spot.x - stage.left,
      y: frame.top + rect.top + rect.height * spot.y - stage.top,
    };
  }

  async glide(to) {
    const distance = Math.hypot(to.x - this.at.x, to.y - this.at.y);
    const ms = Math.round(Math.min(900, Math.max(260, distance * 1.5)));
    this.at = to;
    this.cursor.style.transitionDuration = `${ms}ms, 300ms`;
    this.cursor.style.transform = `translate(${to.x}px, ${to.y}px)`;
    await this.pause(ms + 60);
  }

  /**
   * What a step points at, as it is now. A step names it by how to find it wherever it can be
   * drawn again in the meantime: a contact list that heard of a change puts new rows where the
   * old ones were, and a row that is gone has no place on the screen.
   * @param {HTMLElement | (() => Promise<HTMLElement>)} target
   */
  async there(target) {
    const node = typeof target === 'function' ? await target() : target;
    // Named by itself and gone since: there is nothing left to point at.
    if (!node.isConnected) throw OVER;
    return node;
  }

  /**
   * Moves the pointer onto `target`. A window that grew or shook on the way is followed, and
   * so is a list that was drawn again.
   * @param {HTMLElement | (() => Promise<HTMLElement>)} target
   * @returns {Promise<HTMLElement>} what the pointer is on
   */
  async point(target, spot) {
    await this.glide(this.place(await this.there(target), spot));
    const node = await this.there(target);
    const now = this.place(node, spot);
    if (Math.hypot(now.x - this.at.x, now.y - this.at.y) > 3) await this.glide(now);
    return node;
  }

  /** Sends `node` an event of the mouse's, as its own window would. */
  fire(node, type) {
    this.check();
    const view = node.ownerDocument.defaultView;
    node.dispatchEvent(new view.MouseEvent(type, { bubbles: type !== 'mouseenter', cancelable: true, view }));
  }

  /** @param {HTMLElement | (() => Promise<HTMLElement>)} target */
  async click(target, spot) {
    await this.point(target, spot);
    await this.pause(180);
    const ring = document.createElement('div');
    ring.className = 'cm-tour-click';
    ring.style.left = `${this.at.x}px`;
    ring.style.top = `${this.at.y}px`;
    this.desktop.appendChild(ring);
    setTimeout(() => ring.remove(), 600);
    this.cursor.classList.add('pressing');
    await this.pause(110);
    this.cursor.classList.remove('pressing');
    (await this.there(target)).click();
    await this.pause(260);
  }

  /** Types into a text box a letter at a time, and tells it so, as typing does. */
  async write(box, text) {
    const view = box.ownerDocument.defaultView;
    for (const letter of text) {
      box.value += letter;
      box.dispatchEvent(new view.Event('input', { bubbles: true }));
      await this.pause(letter === ' ' ? 70 : 36 + Math.random() * 36);
    }
  }

  /**
   * Changes what the balloon says. `step` is where the tour is, for the small line under it;
   * without one, the tour is over and the balloon says goodbye.
   * @param {string} text
   * @param {string} [step]
   */
  say(text, step = '') {
    const [line, small] = this.balloon.children;
    this.balloon.hidden = false;
    this.balloon.classList.add('changing');
    setTimeout(() => {
      line.textContent = text;
      small.textContent = step;
      small.hidden = !step;
      this.balloon.classList.remove('changing');
      this.balloon.classList.add('on');
    }, 150);
  }

  showPointer() {
    this.cursor.hidden = false;
    this.cursor.style.transitionDuration = '0ms, 300ms';
    this.cursor.style.transform = `translate(${this.at.x}px, ${this.at.y}px)`;
    // Drawn where it starts before it is faded in.
    void this.cursor.offsetWidth;
    this.cursor.classList.add('on');
  }

  hidePointer() {
    this.cursor.classList.remove('on', 'pressing');
  }

  hideBalloon() {
    this.balloon.classList.remove('on');
  }
}

/** A lone Shift or ⌘ is on its way to something else, a shortcut of the browser's say. */
const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'];

/**
 * Whether an event is the visitor taking over. What the tour does itself is not trusted, and
 * is told apart by that. A finger that turns out to be scrolling the page never lifts as a tap.
 * @param {PointerEvent | KeyboardEvent} event
 */
export function takesOver(event) {
  if (!event.isTrusted) return false;
  if (event.type === 'keydown') return !MODIFIERS.includes(/** @type {KeyboardEvent} */ (event).key);
  const touch = /** @type {PointerEvent} */ (event).pointerType === 'touch';
  return event.type === (touch ? 'pointerup' : 'pointerdown');
}

export class Tour {
  /** @type {{ over: boolean, stage: Stage, watching: AbortController, windows: MutationObserver } | null} what is playing */
  #run = null;
  #farewell = 0;

  /**
   * @param {object} opts
   * @param {() => void} opts.prepare  puts the demo back to how it starts out, before the tour plays
   * @param {() => boolean} opts.wide  whether the desktop has room for windows side by side
   * @param {(state: 'playing' | 'stopped' | 'finished') => void} [opts.onState]
   */
  constructor({ prepare, wide, onState = () => {} }) {
    this.prepare = prepare;
    this.wide = wide;
    this.onState = onState;
  }

  get running() {
    return Boolean(this.#run);
  }

  /** Whether the tour can reach into the windows. A page opened from a file can't: each of them is a stranger to it. */
  get reachable() {
    return window.origin !== 'null';
  }

  /** Whether the tour can play right now: it also needs room for windows side by side. */
  get available() {
    return this.reachable && this.wide();
  }

  /**
   * Plays once the desktop is mostly on screen: a page that embeds the preview can show it
   * further down. Not for someone who asked for less motion, and not once they have
   * clicked or typed here themselves.
   */
  startWhenSeen() {
    if (!this.available || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // The tour hides the welcome note as it starts, so shown while it waits, the note would
    // only be there until the page is scrolled to it. It comes back for whoever gets there first.
    const note = document.getElementById('cm-note');
    note.hidden = true;
    const waiting = new AbortController();
    const { signal } = waiting;
    const seen = new IntersectionObserver(
      (entries) => {
        if (signal.aborted || entries.at(-1).intersectionRatio < 0.5) return;
        waiting.abort();
        this.start();
      },
      { threshold: 0.5 }
    );
    signal.addEventListener('abort', () => seen.disconnect());
    const takeOver = (event) => {
      if (!event.isTrusted) return;
      waiting.abort();
      note.hidden = false;
    };
    for (const type of ['pointerdown', 'keydown']) {
      window.addEventListener(type, takeOver, { capture: true, signal });
    }
    seen.observe(document.getElementById('cm-desktop'));
  }

  /** Plays the tour from the start. Asked for while it plays, it starts over. */
  async start() {
    if (!this.available) return;
    this.stop();
    clearTimeout(this.#farewell);
    this.prepare();
    document.getElementById('cm-note').hidden = true;

    const run = { over: false, stage: null, watching: new AbortController(), windows: null };
    run.stage = new Stage(run);
    this.#run = run;
    // The windows read this (see bridge.js): while it is set, none of them takes the keyboard.
    window.__cmTouring = true;
    this.#watch(run);
    this.onState('playing');

    const { stage } = run;
    const steps = STEPS.filter((step) => !step.when || step.when());
    stage.showPointer();
    try {
      for (const [i, step] of steps.entries()) {
        stage.say(step.caption, `Tour, ${i + 1} of ${steps.length}. Click anywhere to take over.`);
        await step.play(stage);
      }
      this.#end(run, FINISHED, 'finished');
    } catch (problem) {
      // Stopped, or a step waited in vain: either way it ends quietly, and the visitor has the floor.
      if (problem !== OVER) console.warn('The tour ended early:', problem);
      this.#end(run, HANDED_OVER, 'stopped');
    }
  }

  /** Ends the tour where it is. What it opened stays open. */
  stop() {
    if (this.#run) this.#end(this.#run, HANDED_OVER, 'stopped');
  }

  /** @param {'stopped' | 'finished'} state */
  #end(run, goodbye, state) {
    // A run that was stopped also ends its script, which lands here a second time.
    if (run !== this.#run) return;
    run.over = true;
    this.#run = null;
    window.__cmTouring = false;
    run.watching.abort();
    run.windows.disconnect();
    run.stage.hidePointer();
    run.stage.say(goodbye);
    this.#farewell = setTimeout(() => run.stage.hideBalloon(), state === 'finished' ? FAREWELL_MS : FAREWELL_MS - 2000);
    this.onState(state);
  }

  /** Listens for the visitor on the desktop and in every window, the ones that open later too. */
  #watch(run) {
    const { signal } = run.watching;
    const handOver = (event) => takesOver(event) && this.#end(run, HANDED_OVER, 'stopped');
    const listen = (view) => {
      for (const type of ['pointerdown', 'pointerup', 'keydown']) {
        view.addEventListener(type, handOver, { capture: true, signal });
      }
    };
    const listenIn = (iframe) => {
      const hear = () => {
        try {
          listen(iframe.contentWindow);
        } catch {
          // Out of reach: its clicks can't be heard, and the tour won't get far in it either.
        }
      };
      hear();
      // A window still loading gets another page, which has to be listened to again.
      iframe.addEventListener('load', hear, { signal });
    };
    listen(window);
    const desktop = document.getElementById('cm-desktop');
    for (const iframe of desktop.querySelectorAll('iframe')) listenIn(iframe);
    run.windows = new MutationObserver((changes) => {
      for (const node of changes.flatMap((change) => [...change.addedNodes])) {
        const iframe = /** @type {Element} */ (node).querySelector?.('iframe');
        if (iframe) listenIn(iframe);
      }
    });
    run.windows.observe(desktop, { childList: true });
  }
}
