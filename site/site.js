// The landing page's moving parts: the live demo, what arrives as you scroll and the
// small windows that play a scene by themselves. Nothing here is needed to read the
// page. Without scripts everything is simply there, and with prefers-reduced-motion
// the scenes show how they end instead of playing.

// What the page counts by name. Its links are counted there, as the other pages' are.
import { count } from './site-counts.js';
import { configureDownloads } from './site-downloads.js';

configureDownloads(document, navigator);

const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// ---- the live demo -----------------------------------------------------------------------
// The demo needs room for two windows side by side, so only wide screens offer it, in the
// film's place. It loads the first time someone asks for it.
const screen = $('#screen');
const wide = window.matchMedia('(min-width: 960px)');

/** The demo, asked to show itself around until someone clicks in it. */
function demoFrame() {
  const iframe = document.createElement('iframe');
  iframe.src = 'demo/index.html#tour';
  iframe.title = 'buddylist live demo';
  iframe.allow = 'autoplay';
  return iframe;
}

function loadDemo() {
  if ($('iframe', screen)) return;
  screen.replaceChildren(demoFrame());
  document.documentElement.classList.add('demo-live');
}

const tellDemo = (message) => $('iframe', screen)?.contentWindow.postMessage(message, window.location.origin);

/** Marks which of two keys is the one in effect: the demo's look, the professional look's time of day. */
const press = (keys, chosen) => keys.forEach((key) => key.setAttribute('aria-pressed', String(key === chosen)));
const lookKeys = $$('[data-look]');

// The demo says when its tour is playing, and when it ended or someone took over. It also says
// how its windows look, whether the keys under it or its own Tools menu changed that.
window.addEventListener('message', (event) => {
  if (event.source !== $('iframe', screen)?.contentWindow) return;
  const { buddylistTour: state, buddylistLook: look } = event.data ?? {};
  if (typeof state === 'string') document.documentElement.classList.toggle('demo-touring', state === 'playing');
  if (typeof look === 'string')
    press(
      lookKeys,
      lookKeys.find((key) => key.dataset.look === look)
    );
});

// Asked to start while it plays or after it ended, the demo starts over from the beginning.
$('#replay').addEventListener('click', () => tellDemo({ buddylistTour: 'start' }));

// The demo in the messenger look or the professional one: the same windows either way.
for (const key of lookKeys) key.addEventListener('click', () => tellDemo({ buddylistLook: key.dataset.look }));

// ---- the 30-second tour ------------------------------------------------------------------
// The film plays muted once most of it is on screen, as browsers allow, and stops when it
// is not. Sound on starts it over with sound. Wide screens get it at full size. Without
// scripts it is a plain video with its own controls; with prefers-reduced-motion it waits
// for a click.
const film = $('[data-film]');
if (film) {
  const video = $('video', film);
  const sound = $('[data-film-sound]', film);
  const start = $('[data-film-play]', film);
  video.controls = false;
  video.src = wide.matches ? 'promo.mp4?v=hero-platforms-20261018' : 'promo-720.mp4?v=hero-platforms-20261018';
  sound.hidden = false;

  const hear = (on) => {
    video.muted = !on;
    sound.setAttribute('aria-pressed', String(on));
    $('span', sound).textContent = on ? 'Sound off' : 'Sound on';
  };
  const roll = () => video.play().catch(() => {});
  // A visitor who starts it with sound is counted, by which button they did it with.
  sound.addEventListener('click', () => {
    if (video.muted) {
      video.currentTime = 0;
      count('tour played', { from: 'sound' });
    }
    hear(video.muted);
    roll();
  });
  start.addEventListener('click', () => {
    count('tour played', { from: 'play' });
    hear(true);
    roll();
  });
  video.addEventListener('click', () => (video.paused ? roll() : video.pause()));
  video.addEventListener('play', () => (start.hidden = true));
  video.addEventListener('pause', () => (start.hidden = !still));

  if (still) start.hidden = false;
  else {
    new IntersectionObserver(([entry]) => (entry.isIntersecting ? roll() : video.pause()), {
      threshold: 0.5,
    }).observe(video);
  }
}

// ---- the film or the demo ----------------------------------------------------------------
// Wide screens switch between the two. Narrow ones keep the film, with a link under it to the
// demo on a page of its own, and so does a page without scripts.
const monitor = $('#demo');
const views = $$('[data-tour-view]');
const viewSwitch = $('[data-tour-switch]');
const filmNote = $('[data-film-note]');

function showView(name) {
  const demo = name === 'demo' && wide.matches;
  if (demo) {
    loadDemo();
    $('video', film).pause();
  }
  monitor.hidden = !demo;
  film.hidden = demo;
  press(
    views,
    views.find((view) => (view.dataset.tourView === 'demo') === demo)
  );
}

const fitView = () => {
  viewSwitch.hidden = !wide.matches;
  filmNote.hidden = wide.matches;
  if (!wide.matches) showView('film');
};
for (const view of views) view.addEventListener('click', () => showView(view.dataset.tourView));
fitView();
wide.addEventListener('change', fitView);

// ---- sounds and nudges ---------------------------------------------------------------------
// The demo's own recordings. A browser only plays them after a click, and these are all clicks.
const sounds = new Map();

function play(name) {
  if (!sounds.has(name)) sounds.set(name, new Audio(`demo/sounds/${name}.wav`));
  const audio = sounds.get(name);
  audio.currentTime = 0;
  // On a phone the demo's files are still there; a browser that won't play one says nothing.
  audio.play().catch(() => {});
  return audio;
}

/** Shake something the way the app shakes a window, with the sound that goes with it. */
function nudge(target) {
  if (!target) return;
  target.classList.remove('nudged');
  void target.offsetWidth;
  target.classList.add('nudged');
  play('nudge');
}

// A [data-nudge] button shakes what its value names.
document.addEventListener('click', (event) => {
  const nudger = event.target.closest('[data-nudge]');
  if (nudger) nudge($(nudger.dataset.nudge));
});

// ---- arriving as you scroll ------------------------------------------------------------------
// Children of a [data-stagger] arrive one after the other; its value is how many share a row.
for (const group of $$('[data-stagger]')) {
  const perRow = Number(group.dataset.stagger) || Infinity;
  [...group.children].forEach((child, i) => child.style.setProperty('--i', i % perRow));
}

const arrivals = new IntersectionObserver(
  (entries) => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      arrivals.unobserve(target);
      target.classList.add('in');
      // The slow transition is for arriving. Once here, the element answers the mouse at once.
      const turn = Number(target.style.getPropertyValue('--i')) || 0;
      setTimeout(() => target.removeAttribute('data-reveal'), 900 + turn * 80);
    }
  },
  { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
);
for (const element of $$('[data-reveal]')) arrivals.observe(element);

// ---- the top bar ---------------------------------------------------------------------------
const bar = $('#bar');
const toTop = $('.to-top');
const onScroll = () => {
  bar.classList.toggle('scrolled', window.scrollY > 8);
  // The way back up shows once the first screen is behind you.
  toTop.classList.toggle('shown', window.scrollY > window.innerHeight);
};
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

// The section in the middle of the window is the one the bar points at. Links to other pages have none.
const links = new Map($$('.bar nav a[href^="#"]').map((link) => [link.getAttribute('href').slice(1), link]));
const sections = new IntersectionObserver(
  (entries) => {
    for (const { target, isIntersecting } of entries) links.get(target.id)?.classList.toggle('here', isIntersecting);
  },
  { rootMargin: '-45% 0px -50% 0px' }
);
for (const id of links.keys()) sections.observe(document.getElementById(id));

// ---- the hero's look ---------------------------------------------------------------------------
// The app in the professional look, and a switch to the messenger one, which puts the 2005 desktop
// behind the hero too. Without scripts there is no switch, and the professional look stays.
const hero = $('[data-hero]');
const heroKeys = $$('[data-hero-look]', hero);
const HERO_NOTES = {
  professional: 'Same app, same buttons. The 2005 look is one click away.',
  messenger: 'Same app, same buttons. Just more fun.',
};

function showHeroLook(look) {
  hero.classList.toggle('messenger', look === 'messenger');
  for (const shot of $$('[data-hero-shot]', hero)) shot.hidden = shot.dataset.heroShot !== look;
  $('[data-hero-note]', hero).textContent = HERO_NOTES[look];
  press(
    heroKeys,
    heroKeys.find((key) => key.dataset.heroLook === look)
  );
}

$('[data-hero-switch]', hero).hidden = false;
// Which look visitors switch the hero to is counted: it says how many come for the 2005 one.
for (const key of heroKeys) {
  key.addEventListener('click', () => {
    if (key.getAttribute('aria-pressed') !== 'true') count('look switched', { look: key.dataset.heroLook });
    showHeroLook(key.dataset.heroLook);
  });
}

// ---- scenes ------------------------------------------------------------------------------
// A scene is one of the small windows: it plays while it is on screen, over and over,
// and starts from the beginning when it comes back.
const STOPPED = Symbol('stopped');

/** Waits, unless the scene has left the screen in the meantime. */
const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(STOPPED);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(STOPPED);
      },
      { once: true }
    );
  });

async function type(target, text, signal, pace = 34) {
  for (const letter of text) {
    target.append(letter);
    await sleep(pace + Math.random() * pace, signal);
  }
}

/**
 * @param {string} name  the scene's data-scene
 * @param {(scene: HTMLElement) => { reset: () => void, play: (signal: AbortSignal) => Promise<void>, finish: () => void }} build
 */
function scene(name, build) {
  const root = $(`[data-scene="${name}"]`);
  if (!root) return;
  const { reset, play, finish } = build(root);
  if (still) return finish();
  let running = null;
  const loop = async (signal) => {
    try {
      for (;;) {
        reset();
        await sleep(600, signal);
        await play(signal);
        await sleep(4500, signal);
      }
    } catch (error) {
      if (error !== STOPPED) throw error;
    }
  };
  new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting === Boolean(running)) return;
      if (running) running.abort();
      running = entry.isIntersecting ? new AbortController() : null;
      if (running) loop(running.signal);
    },
    { threshold: 0.3 }
  ).observe(root);
}

// The contact list: a contact works, waits for you, opens a pull request, and its checks pass.
scene('list', (root) => {
  const row = (name) => $(`[data-row="${name}"]`, root);
  const toast = $('[data-toast]', root);
  const codex = row('codex-api');
  const claude = row('claude-msn');
  const waiting = $('[data-waiting]', root);
  const count = $('[data-count]', root);
  const home = codex.previousElementSibling;

  // Waiting for you holds a contact while it waits for an approval, at the top of the list, and
  // its row says which project it is from. Once you answer, it goes back under its project.
  const waits = (yes) => {
    waiting.hidden = !yes;
    (yes ? waiting : home).after(codex);
    count.textContent = yes ? '1' : '2';
  };

  const status = (contact, state, line = '') => {
    $('.bud use', contact).setAttribute('href', `#b-${state}`);
    $('.line', contact).textContent = line;
  };
  const tags = (contact, ...kinds) => {
    for (const tag of $$('.tag', contact)) tag.hidden = !kinds.includes(tag.dataset.kind);
  };
  const hot = (contact) => {
    for (const other of $$('.row', root)) other.classList.toggle('hot', other === contact);
  };

  const reset = () => {
    hot(null);
    toast.classList.remove('on');
    waits(false);
    status(codex, 'online', '- ~/projects/api');
    tags(codex);
    tags(claude, 'running');
  };

  return {
    reset,
    async play(signal) {
      await sleep(700, signal);
      hot(codex);
      status(codex, 'busy', '- Running npm test');
      await sleep(2300, signal);
      status(codex, 'away', '- api');
      waits(true);
      await sleep(2500, signal);
      waits(false);
      status(codex, 'busy', '- Editing src/retry.js');
      await sleep(2000, signal);
      // With a pull request, the row says how it stands instead.
      status(codex, 'online');
      tags(codex, 'running');
      await sleep(2400, signal);
      tags(codex, 'passed');
      toast.classList.add('on');
      await sleep(2600, signal);
      hot(claude);
      tags(claude, 'failing');
      await sleep(2200, signal);
      hot(null);
      toast.classList.remove('on');
    },
    finish() {
      reset();
      status(codex, 'online');
      tags(codex, 'passed');
      tags(claude, 'failing');
    },
  };
});

/**
 * A conversation: its lines appear in turn. A line with data-type is typed into the message
 * box first, data-typing says who is writing while it is waited for, data-by whose turn it is,
 * and data-fx names what else happens once it is there.
 * @param {HTMLElement} root
 * @param {Record<string, { run: (line: HTMLElement, signal: AbortSignal) => Promise<void> | void, undo: () => void, done: () => void }>} effects
 * @param {{ mention?: (input: HTMLElement, name: string, signal: AbortSignal) => Promise<void>, turn?: (who: string | null) => void }} [company]
 *   in a conversation with several agents: how an @mention is typed, and who is at work
 */
function conversation(root, effects = {}, { mention, turn = () => {} } = {}) {
  const log = $('[data-log]', root);
  const lines = $$('.msg', log);
  const says = $('[data-status]', root);
  const input = $('[data-input]', root);
  const send = $('[data-send]', root);

  const show = (line) => {
    line.classList.add('on');
    log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
  };

  async function yours(line, signal) {
    if (!input) return sleep(700, signal);
    turn(null);
    for (const part of $('[data-text]', line).childNodes) {
      const name = part.classList?.contains('at') && part.textContent;
      await (name && mention
        ? mention(input, name, signal)
        : type(input, part.textContent.replace(/\s+/g, ' '), signal));
    }
    send.classList.add('ready');
    await sleep(380, signal);
    send.classList.add('press');
    await sleep(170, signal);
    send.classList.remove('ready', 'press');
    input.textContent = '';
  }

  async function theirs(line, signal) {
    if (line.dataset.by) turn(line.dataset.by);
    const who = line.dataset.typing;
    if (who) says.textContent = `${who} is typing a message...`;
    await sleep(Number(line.dataset.wait) || 800, signal);
    if (who) says.textContent = '';
  }

  return {
    reset() {
      for (const line of lines) line.classList.remove('on');
      for (const effect of Object.values(effects)) effect.undo();
      log.scrollTop = 0;
      says.textContent = '';
      if (input) input.textContent = '';
      send?.classList.remove('ready', 'press');
      turn(null);
    },
    async play(signal) {
      for (const line of lines) {
        await (line.hasAttribute('data-type') ? yours(line, signal) : theirs(line, signal));
        show(line);
        await effects[line.dataset.fx]?.run(line, signal);
      }
      turn(null);
    },
    finish() {
      for (const line of lines) line.classList.add('on');
      for (const effect of Object.values(effects)) effect.done();
    },
  };
}

/**
 * The agent's to-do list under the newest line. A line with data-todo moves it on once it has
 * arrived: to the step it names, the ones before it done, or "away" once the agent has stopped.
 * Under the list, what the agent is doing on that step (its data-doing) and for how long, as the
 * app's line under the newest one counts it up.
 * @param {HTMLElement} root
 */
function todoList(root) {
  const list = $('[data-todos]', root);
  const log = $('[data-log]', root);
  const items = $$('li', list);
  const doing = $('[data-doing-line]', list);
  let ticking = 0;
  const stop = () => clearInterval(ticking);

  const at = (step) => {
    items.forEach((item, i) => {
      item.className = i < step ? 'completed' : i === step ? 'in_progress' : 'pending';
    });
    stop();
    const item = items[step];
    doing.hidden = !item;
    if (!item) return;
    $('[data-doing-text]', doing).textContent = item.dataset.doing;
    const since = Date.now();
    const showTime = () => {
      const seconds = Math.floor((Date.now() - since) / 1000);
      $('[data-time]', doing).textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    };
    showTime();
    ticking = setInterval(showTime, 1000);
  };

  return {
    run(line, signal) {
      signal.addEventListener('abort', stop, { once: true });
      const step = line.dataset.todo;
      list.hidden = step === 'away';
      if (list.hidden) return stop();
      at(Number(step));
      log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
    },
    undo() {
      stop();
      list.hidden = true;
    },
    // A list that is all done is put away once its agent stops, as the scene ends.
    done: () => (list.hidden = true),
  };
}

// The agent's to-do list keeps up with it, and an invitation waits for an answer, then Accept is clicked.
scene('chat', (root) => {
  const invitation = $('.invite', root);
  const accept = $('[data-accept]', root);
  const says = $('[data-status]', root);
  return conversation(root, {
    todo: todoList(root),
    invite: {
      async run(_line, signal) {
        says.textContent = 'Claude (api) is waiting for you to accept or decline.';
        await sleep(1900, signal);
        accept.classList.add('press');
        await sleep(420, signal);
        invitation.classList.add('accepted');
        says.textContent = '';
      },
      undo() {
        accept.classList.remove('press');
        invitation.classList.remove('accepted');
      },
      done: () => invitation.classList.add('accepted'),
    },
  });
});

// A group chat: you mention two of them, the list of names opening as you type each @. Claude
// runs an effort check whose levels show up on the badges, and they work in turn, each one's
// buddy Busy while it does, until Codex hands over to Gemini.
scene('group', (root) => {
  const picked = { claude: 'High', codex: 'Low' };
  const badges = Object.fromEntries(
    Object.keys(picked).map((who) => {
      const badge = $(`[data-effort="${who}"]`, root);
      return [who, { badge, own: badge.textContent }];
    })
  );
  const pick = () => {
    for (const [who, level] of Object.entries(picked)) {
      badges[who].badge.textContent = level;
      badges[who].badge.classList.add('picked');
    }
  };

  const list = $('[data-mentions]', root);
  const names = $$('[data-pick]', list);
  /** The names that start with what is typed after the @, the first of them chosen. */
  const offer = (typed) => {
    const matches = names.filter((name) => name.dataset.pick.toLowerCase().startsWith(typed.toLowerCase()));
    for (const name of names) {
      name.hidden = !matches.includes(name);
      name.classList.toggle('hot', name === matches[0]);
      name.classList.remove('press');
    }
  };

  /** "@Co" is typed, the list offers Codex, and Tab writes the name out. */
  async function mention(input, text, signal) {
    const name = text.slice(1);
    let typed = '';
    input.append('@');
    offer(typed);
    list.classList.add('open');
    // Long enough on the bare @ to see that everyone is on offer.
    await sleep(380, signal);
    for (const letter of name.slice(0, 2)) {
      await sleep(150 + Math.random() * 60, signal);
      input.append(letter);
      offer((typed += letter));
    }
    await sleep(420, signal);
    $('.hot', list).classList.add('press');
    await sleep(170, signal);
    input.append(name.slice(2));
    list.classList.remove('open');
  }

  /** Whoever's turn it is shows as Busy, in the To line and the list on the right. */
  const turn = (who) => {
    for (const bud of $$('[data-bud]', root)) {
      $('use', bud).setAttribute('href', `#b-${bud.dataset.bud === who ? 'busy' : 'online'}`);
    }
    for (const person of $$('[data-person]', root)) person.classList.toggle('working', person.dataset.person === who);
  };

  const { reset, play, finish } = conversation(
    root,
    {
      effort: {
        run: pick,
        undo() {
          for (const { badge, own } of Object.values(badges)) {
            badge.textContent = own;
            badge.classList.remove('picked');
          }
        },
        done: pick,
      },
    },
    { mention, turn }
  );
  return {
    reset() {
      list.classList.remove('open');
      reset();
    },
    play,
    finish,
  };
});

// ---- beside the conversation: what to look at above, what runs below -----------------------
// The tabs above are real ones. They take turns with the terminal below while the window is on
// screen, until you pick one.
const TERMINAL = [
  ['', '> api@2.4.0 test', 'dim', 350],
  ['', '> node --test', 'dim', 80],
  ['', '', '', 500],
  ['✔ ', 'retries a request that was told to slow down (12ms)', 'ok', 340],
  ['✔ ', 'waits as long as Retry-After says (4ms)', 'ok', 300],
  ['✔ ', 'never waits longer than 30 seconds (3ms)', 'ok', 300],
  ['✔ ', 'gives up after five tries (9ms)', 'ok', 320],
  ['', '', '', 260],
  ['ℹ ', 'tests 42', 'dim', 60],
  ['ℹ ', 'pass 42', 'ok', 60],
  ['ℹ ', 'fail 0', 'dim', 60],
];

function besideTheConversation() {
  const root = $('[data-scene="pane"]');
  if (!root) return;
  const tabs = $$('[role="tab"]', root);
  const cards = $$('[data-show-tab]');
  const term = $('[data-term]', root);
  const below = $('[data-low-tab]', root).closest('.half');
  const span = (text, kind) => Object.assign(document.createElement('span'), { textContent: text, className: kind });
  const prompt = () => [span('api ', 'pr'), span('fix/rate-limits ', 'dim'), '$ '];
  const cursor = () => span('', 'block');
  // The terminal is short: like a real one, it keeps its last line in sight.
  const print = (...parts) => {
    term.append(...parts);
    term.scrollTop = term.scrollHeight;
  };

  /** Whatever the terminal is doing, while it is the one being shown. */
  let typing = null;

  async function runTests(signal) {
    term.replaceChildren(...prompt(), cursor());
    await sleep(700, signal);
    const command = span('', '');
    term.lastChild.before(command);
    await type(command, 'npm test', signal, 60);
    await sleep(300, signal);
    term.lastChild.remove();
    for (const [mark, text, kind, wait] of TERMINAL) {
      await sleep(wait, signal);
      print('\n', span(mark + text, kind));
    }
    await sleep(300, signal);
    print('\n\n', ...prompt(), cursor());
  }

  function printTests() {
    term.replaceChildren(...prompt(), 'npm test');
    for (const [mark, text, kind] of TERMINAL) term.append('\n', span(mark + text, kind));
    print('\n\n', ...prompt(), cursor());
  }

  /** Shows a tab above, or with "terminal" plays the tests in the one below. */
  function select(name) {
    // Cut short, the tests are shown as they end: the terminal stays in sight below.
    if (typing) {
      typing.abort();
      typing = null;
      printTests();
    }
    const low = name === 'terminal';
    below.classList.toggle('lit', low);
    for (const card of cards) card.classList.toggle('active', card.dataset.showTab === name);
    if (low) {
      if (still) return;
      typing = new AbortController();
      runTests(typing.signal).catch((error) => {
        if (error !== STOPPED) throw error;
      });
      return;
    }
    for (const tab of tabs) {
      const on = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      $(`[data-panel="${tab.dataset.tab}"]`, root).hidden = !on;
    }
  }

  /** Taking turns stops for good once someone has chosen a tab. */
  let turns = null;
  let chosen = false;
  const choose = (name) => {
    chosen = true;
    turns?.abort();
    select(name);
  };

  for (const tab of tabs) tab.addEventListener('click', () => choose(tab.dataset.tab));
  for (const card of cards) card.addEventListener('click', () => choose(card.dataset.showTab));
  $('[role="tablist"]', root).addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    const next = tabs[(tabs.indexOf(document.activeElement) + step + tabs.length) % tabs.length];
    next.focus();
    choose(next.dataset.tab);
  });

  printTests();
  select('plan');
  if (still) return;

  const takeTurns = async (signal) => {
    try {
      for (;;) {
        for (const [name, time] of [
          ['plan', 4200],
          ['changes', 5200],
          ['browser', 4000],
          ['helpers', 4200],
          ['session', 4200],
          ['terminal', 7600],
        ]) {
          select(name);
          await sleep(time, signal);
        }
      }
    } catch (error) {
      if (error !== STOPPED) throw error;
    }
  };
  new IntersectionObserver(
    ([entry]) => {
      if (chosen || entry.isIntersecting === Boolean(turns)) return;
      if (turns) turns.abort();
      turns = entry.isIntersecting ? new AbortController() : null;
      if (turns) takeTurns(turns.signal);
    },
    { threshold: 0.3 }
  ).observe(root);
}
besideTheConversation();

// ---- two looks -------------------------------------------------------------------------------
// The group chat's window in both looks: a copy of it wears the professional one right of the
// line, and the line follows a drag, a click or the arrow keys. Day and Night are that look's.
const compare = $('[data-compare]');
if (compare) {
  const professional = $('[data-compare-pro]', compare);
  const window = $('.win', professional);
  // The same window as the messenger draws it, which is the markup without the professional look.
  const copy = window.cloneNode(true);
  copy.classList.remove('look-pro', 'day');
  $('[data-compare-messenger]', compare).append(copy);

  const range = $('[data-compare-range]', compare);
  const split = (percent) => {
    compare.style.setProperty('--split', `${percent}%`);
    range.value = percent;
  };
  range.addEventListener('input', () => split(Number(range.value)));
  const follow = (event) => {
    const box = compare.getBoundingClientRect();
    split(Math.round(Math.min(100, Math.max(0, ((event.clientX - box.left) / box.width) * 100))));
  };
  compare.addEventListener('pointerdown', (event) => {
    compare.setPointerCapture(event.pointerId);
    follow(event);
  });
  compare.addEventListener('pointermove', (event) => {
    if (compare.hasPointerCapture(event.pointerId)) follow(event);
  });

  const times = $$('[data-pro-theme]');
  for (const key of times) {
    key.addEventListener('click', () => {
      const day = key.dataset.proTheme === 'day';
      window.classList.toggle('day', day);
      professional.classList.toggle('day', day);
      press(times, key);
    });
  }
}

// ---- feedback: a form at the end of the page -------------------------------------------------
// Only this script says the report comes from the page, so the Worker turns down the form sent
// without it: that is how bots post it. With it the answer arrives under the form, a picture
// that is too large never leaves, and the browser's name can go along for whoever has to find the bug.
function feedbackForm() {
  const form = $('#feedback-form');
  const note = $('.feedback-note', form);
  const send = $('button[type="submit"]', form);
  const picture = form.elements.screenshot;
  const system = $('[data-system]', form);
  system.hidden = false;

  const say = (text, state) => {
    form.classList.remove('failed', 'sent');
    if (state) form.classList.add(state);
    note.textContent = text;
  };
  const tooLarge = () => picture.files[0]?.size > Number(picture.dataset.max);

  picture.addEventListener('change', () => (tooLarge() ? say(picture.dataset.tooLarge, 'failed') : say('')));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (tooLarge()) return say(picture.dataset.tooLarge, 'failed');
    const report = new FormData(form);
    report.set('from', 'page');
    if ($('input', system).checked) report.set('system', navigator.userAgent);
    send.disabled = true;
    say('Sending...');
    try {
      const response = await fetch(form.action, { method: 'POST', body: report });
      if (response.ok) {
        // Only what kind of report it was: the report itself is the Worker's alone.
        count('feedback sent', { kind: report.get('kind') });
        form.reset();
        say('Thank you. Your message has been sent.', 'sent');
      } else {
        // The Worker says what is wrong in the form's own words.
        const { message } = await response.json().catch(() => ({}));
        say(message || 'Something went wrong. Please try again.', 'failed');
      }
    } catch {
      say("Couldn't send it. Check your connection and try again.", 'failed');
    }
    send.disabled = false;
  });
}
feedbackForm();
