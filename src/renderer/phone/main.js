// The phone app: buddylist from a phone, or another computer, through Settings > Remote access on the Mac (see
// src/main/remote/host.js). Home lists who waits for you (home.js); a conversation is a tap away (conversation.js),
// at #/c/<contact id>, so the browser's Back goes back. It asks the app what a window asks, with the same
// `window.messenger` (see src/renderer/remote/network-ipc.js), and says how its connection is (connection.js).
import { api } from '../lib/api.js';
import { setPack } from '../lib/pack.js';
import { ACCESS, CONNECTION, SIGNING_OUT } from '../remote/network-ipc.js';
import { paletteNamed, paletteOf } from '../../shared/theme.js';
import { setAccess } from './access.js';
import { ConnectionBanner, macName, notStarted, startingAgain } from './connection.js';
import { Home } from './home.js';
import { host, setHost } from './host.js';
import { followKeyboard } from './keyboard.js';
import { Notifications, showBadge } from './notifications.js';

const screen = /** @type {HTMLElement} */ (document.getElementById('screen'));
const connection = /** @type {HTMLElement} */ (document.getElementById('connection'));

// The keyboard takes the bottom of a phone's screen: the app is as tall as what is left of it.
followKeyboard();

// How the connection is, in the banner once the app has started: until then, the screen itself says so. Home's
// "● Mac" reads it from <html> (see phone.css).
// The computer by the name the app gave it last (host.js), else as the phone reaches it.
const nameNow = () => host.name || macName(location.hostname);
const name = nameNow();
const banner = new ConnectionBanner(connection, name);
let started = false;
addEventListener(CONNECTION, ({ detail }) => (started ? banner.heard(detail) : undefined));

/** What Home is drawn from, asked of the app until it answers: meanwhile the screen says why not, with Retry. */
async function start() {
  for (;;) {
    try {
      const [init, pack] = await Promise.all([api.app.init(), api.pack.list()]);
      return { init, pack };
    } catch (error) {
      await notStarted(screen, { error, name });
      startingAgain(screen, name);
    }
  }
}

const { init, pack } = await start();
setHost(init.host);
// What this phone may do: everything, unless the computer set it to less (see access.js).
setAccess(init.access);
banner.name = nameNow();
started = true;
setPack(pack);
let contacts = init.contacts;
showBadge(contacts);
// The page has the colours of the palette it opened in (see phonePage in src/main/remote/web.js): another one, as the
// theme changes on the Mac meanwhile, has them from the palettes' file, asked for then.
const opened = document.documentElement.dataset.palette;
const showPalette = (settings) => {
  const palette = paletteNamed(paletteOf(settings?.theme));
  if (palette !== opened && !document.getElementById('palettes'))
    document.head.append(
      Object.assign(document.createElement('link'), {
        id: 'palettes',
        rel: 'stylesheet',
        href: '/src/renderer/styles/palettes.css',
      })
    );
  document.documentElement.dataset.palette = palette;
};
showPalette(init.settings);

async function signOut() {
  // The Mac closes this phone's connection as it signs it out: no news of a sign-out on the Mac (network-ipc.js).
  const signingOut = (detail) => dispatchEvent(new CustomEvent(SIGNING_OUT, { detail }));
  signingOut(true);
  try {
    await notifications.forget();
    const response = await fetch('/api/logout', { method: 'POST' });
    if (!response.ok) throw new Error('Sign out failed');
    location.replace('/login');
  } catch {
    signingOut(false);
    banner.say('Could not sign out. Try again.');
  }
}

// A conversation's screen, with Markdown, highlighting and pictures, is loaded the first time one opens, and
// meanwhile once Home is drawn: Home needs a quarter of the code.
/** @type {Promise<typeof import('./conversation.js')> | null} */
let conversationModule = null;
const conversations = () => (conversationModule ??= import('./conversation.js'));

/** @type {Home | import('./conversation.js').ConversationScreen | null} */
let current = null;
const notifications = new Notifications(() => (current instanceof Home ? current.notificationsChanged() : undefined));
async function route() {
  current?.close();
  current = null;
  const contactId = /^#\/c\/(.+)$/.exec(location.hash)?.[1];
  if (!contactId) {
    current = new Home(screen, { contacts, signOut, notifications });
    return;
  }
  const { hash } = location;
  let ConversationScreen;
  try {
    ({ ConversationScreen } = await conversations());
  } catch {
    conversationModule = null;
    return banner.say('Couldn’t open the conversation. Check the connection and try again.');
  }
  // Gone on meanwhile, to Home or another conversation, which drew itself.
  if (location.hash !== hash) return;
  current = new ConversationScreen(screen, { contactId: decodeURIComponent(contactId), contacts });
}
addEventListener('hashchange', route);
route();
// The service worker keeps the app for the next launch with the Mac out of reach (sw.js), on every phone: not only
// on one with notifications, which registers it too.
navigator.serviceWorker?.register('/sw.js').catch(() => {});
(globalThis.requestIdleCallback ?? ((load) => setTimeout(load, 1000)))(() => conversations().catch(() => {}));
notifications.start();
// A notification tapped while the app is open: the service worker says which conversation it is about.
navigator.serviceWorker?.addEventListener('message', ({ data }) => {
  if (data?.type === 'open' && typeof data.hash === 'string') location.hash = data.hash;
});

// Back after a drop, what happened meanwhile wasn't heard: the app is asked again for what Home is drawn from, and
// the screen is drawn anew where the phone is, with what it keeps of its own (drafts.js). Nothing is reloaded.
let dropped = false;
addEventListener(CONNECTION, ({ detail }) => {
  if (detail === 'reconnecting') dropped = true;
  else if (dropped) {
    dropped = false;
    drawAgain();
  }
});
async function drawAgain() {
  let fresh;
  try {
    fresh = await api.app.init();
  } catch {
    // Lost again: drawn once it is back.
    return;
  }
  setHost(fresh.host);
  setAccess(fresh.access);
  banner.name = nameNow();
  contacts = fresh.contacts;
  showBadge(contacts);
  showPalette(fresh.settings);
  // Home stays where it was scrolled to; a conversation keeps its place itself.
  const home = screen.querySelector('#home')?.scrollTop;
  route();
  const list = screen.querySelector('#home');
  if (list && home) list.scrollTop = home;
}

api.on.contacts((views) => {
  contacts = views;
  showBadge(views);
  current?.contactsChanged(views);
});
api.on.settings(showPalette);
// Changed in Settings on the computer: the screen offers what this phone may do now, where it is.
addEventListener(ACCESS, ({ detail }) => {
  setAccess(detail);
  current?.accessChanged();
});
api.on.session((event) => (current && !(current instanceof Home) ? current.heard(event) : undefined));
