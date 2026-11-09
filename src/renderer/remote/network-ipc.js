// What stands in for Electron in a browser that uses the app from another computer (see
// src/main/remote/). The preload runs unchanged on top of it, so the phone app gets the same
// `window.messenger` as a window: its requests go over a WebSocket, and its events come back
// over it.
//
// A link is a browser tab's own to open, in a new tab. How the connection is, the page hears as a
// CONNECTION event on its window, to say so. Back after a drop, it hears "connected" again and draws itself anew
// (see main.js): nothing is reloaded. Signed out, it goes to the sign-in page, which is told why.
//
// An open socket is no proof that the Mac is there: one that went to sleep, or a network gone from under the
// phone, can leave it open and silent. So the Mac is asked whether it is there (app:version, which it answers at
// once) once it has been quiet for a while, when a request waits on it, and as the phone comes back to the page.
// A connection that doesn't answer in time is taken for lost: what waited on it fails, saying why, and it is tried
// again.
//
// What the phone may do (see src/main/remote/routes.js) the page hears as an ACCESS event on its window, as the
// computer changes it in Settings, and with a request it refused for it.
import { EVENTS, REQUESTS } from '../../shared/ipc-channels.js';
import { ACCESS_LEVELS } from '../../shared/remote-access.js';
import { refusedText } from '../phone/access.js';
import { yourComputer } from '../phone/host.js';

/** How long to wait before trying to reach the app again, the more so the more often it failed. */
const retryMs = (failures) => Math.min(1000 * 2 ** failures, 10_000);

/** How long the Mac may be quiet, while the page is seen, before it is asked whether it is there. */
export const QUIET_MS = 9_000;
/** How long a request may wait without a word from the Mac before it is asked whether it is there. */
export const WAIT_MS = 2_000;
/** How long it has to answer that: then the connection is taken for lost. */
export const ANSWER_MS = 5_000;
/** As long, as the phone comes back to the page: away, it may have lost the connection without hearing it. */
export const WAKE_MS = 3_000;
/** How long a connection may take to open. */
export const OPEN_MS = 10_000;
/** How often the sign-in is renewed, besides each time the page opens: as the phone comes back to it. */
const RENEW_MS = 24 * 60 * 60 * 1000;

/** What the window hears when the connection opens ("connected"), or was lost and is tried again ("reconnecting"). */
export const CONNECTION = 'buddylist:connection';
/** What the page says on its window to have a lost connection tried again at once, as a Retry button does. */
export const RETRY = 'buddylist:retry';
/**
 * What the page says on its window as it signs this phone out itself (detail true), and should that fail (false):
 * meanwhile the connection closing is no news of a sign-out on the Mac, and the page goes to the sign-in page itself.
 */
export const SIGNING_OUT = 'buddylist:signing-out';

/** What the window hears when what the phone may do changes: 'full', 'answer' or 'read' (see phone/access.js). */
export const ACCESS = 'buddylist:access';

/**
 * What a failed request's `error.code` says of it. NOT_SENT: it never left the phone (the connection was down), so
 * asking again is safe. UNCONFIRMED: it was sent and no answer came, so the Mac may have it, or still get it once it
 * is back: an answer or a message isn't simply asked again. NOT_ALLOWED: the computer refused it, as what the phone
 * may do doesn't take it (NOT_ALLOWED in src/main/remote/routes.js).
 */
export const NOT_SENT = 'not-sent';
export const UNCONFIRMED = 'unconfirmed';
export const NOT_ALLOWED = 'not-allowed';
/** What a request that never left says. */
const NOT_SENT_TEXT = 'Reconnecting to buddylist. Try again once connected.';
/** What an answer or a message that left, with no word back, says, naming the computer as the app does. */
const unconfirmedText = () => `Not confirmed yet. Y${yourComputer().slice(1)} may still get this once it’s back.`;
/** What a read that left, with no word back, says: reading again is harmless. */
export const noAnswer = () => `No answer from ${yourComputer()}. It may be asleep. Try again.`;
const lostText = () => 'The connection to buddylist was lost.';
/** What changes something on the Mac: one sent twice could do it twice. */
const WRITES = new Set([
  REQUESTS.chatSend,
  REQUESTS.chatSendNow,
  REQUESTS.chatRespond,
  REQUESTS.chatInterrupt,
  REQUESTS.chatCancel,
  REQUESTS.chatUseCredits,
  REQUESTS.chatSwitchAccount,
]);
/**
 * The contact list, put together from what the Mac sends a page that takes it as patches (see host.js): whole first,
 * then the contacts that changed or came, the ids of those that went, and the order where it changed.
 * @param {{ id: string }[] | null} list  the last whole list, or null before one came
 * @param {{ set?: { id: string }[], removed?: string[], order?: string[] }} patch
 * @returns {{ id: string }[] | null}  null with no list to put it on
 */
export function patched(list, { set = [], removed = [], order }) {
  if (!list) return null;
  const byId = new Map(list.map((view) => [view.id, view]));
  for (const id of removed) byId.delete(id);
  for (const view of set) byId.set(view.id, view);
  const ids = order ?? list.map(({ id }) => id).filter((id) => byId.has(id));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/** A failed request's error, with its code (see NOT_SENT). */
const failure = (message, code) => Object.assign(new Error(message), { code });

/** How the app closes a connection whose device was signed out, or has to sign in again (see websocket.js). */
const SIGNED_OUT = 1008;
/** Why the sign-in page is shown, by the reason the app closed with (see host.js): else the sign-in ran out. */
const WHY = { 'Signed out': 'signed-out' };

/** A timer. Where node runs this, it keeps nothing running by itself. */
const later = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return timer;
};

/**
 * @param {Window & typeof globalThis} win
 * @returns {{ contextBridge: object, ipcRenderer: object, webUtils: object }}
 */
export function networkElectron(win) {
  const { location } = win;
  /** @type {Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void, channel?: string, args?: unknown[], message?: string, sent?: boolean }>} */
  const pending = new Map();
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();
  /** What was asked before the connection was open, by id: sent once it is. */
  let waiting = [];
  let nextId = 0;
  let failures = 0;
  let socket = null;
  let signedOut = false;
  /** Whether the page signs this phone out itself, and goes to the sign-in page by itself. */
  let leaving = false;
  let renewedAt = 0;
  /** The contact list as this connection told it last: what its patches are put on. */
  let contacts = null;
  // What the connection waits for: to open, a quiet spell to end, an answer, the next try.
  let opening = null;
  let quiet = null;
  let asking = null;
  let answering = null;
  let retrying = null;
  // Also on <html>, as data-connection, for a page to read whenever it draws: it may load after the news.
  const status = (state) => {
    const root = win.document?.documentElement;
    if (root) root.dataset.connection = state;
    win.dispatchEvent(new win.CustomEvent(CONNECTION, { detail: state }));
  };
  /** What the phone may do, as the computer said: a level there isn't is not passed on. */
  const accessIs = (level) => {
    if (ACCESS_LEVELS.includes(level)) win.dispatchEvent(new win.CustomEvent(ACCESS, { detail: level }));
  };
  const isOpen = () => socket?.readyState === win.WebSocket.OPEN;
  const seen = () => win.document?.visibilityState !== 'hidden';

  const answeredHere = {
    'shell:open-external': (url) => {
      if (/^https?:\/\//i.test(String(url))) win.open(String(url), '_blank', 'noopener,noreferrer');
    },
  };

  /**
   * Signed out on the Mac, or the sign-in ran out: there is nothing to come back to but the sign-in page. It is told
   * why, and the conversation this was, to open once signed in again.
   * @param {'signed-out' | 'expired'} why
   */
  const signIn = (why) => {
    if (signedOut) return;
    signedOut = true;
    if (leaving) return;
    const then = /^#\/c\/[^/]+$/.test(location.hash ?? '') ? location.hash : '';
    location.assign(`/login?${new URLSearchParams({ why, ...(then && { then }) })}`);
  };

  /** The sign-in renewed, as the page is used: false once it has ended, and the page signs in again. */
  const renew = async () => {
    try {
      const { status: code } = await win.fetch('/api/session', { cache: 'no-store' });
      if (code === 401) signIn('expired');
      else if (code >= 200 && code < 300) renewedAt = Date.now();
    } catch {
      // Not there now: renewed as the Mac is reached again.
    }
    return !signedOut;
  };

  /** Asks the Mac whether it is there: without a word from it within `ms`, the connection is taken for lost. */
  const ask = (ms) => {
    clearTimeout(asking);
    asking = null;
    if (!isOpen() || answering) return;
    const id = ++nextId;
    pending.set(id, { resolve: () => {}, reject: () => {}, sent: true });
    socket.send(JSON.stringify({ kind: 'request', id, channel: REQUESTS.appVersion, args: [] }));
    answering = later(giveUp, ms);
  };
  /** A quiet spell starts: should it last, the Mac is asked. Nothing is asked of it while nobody looks. */
  const quietFrom = () => {
    clearTimeout(quiet);
    quiet = isOpen() && seen() ? later(() => ask(ANSWER_MS), QUIET_MS) : null;
  };
  /** A word from the Mac, whichever: it is there. */
  const heard = () => {
    clearTimeout(asking);
    clearTimeout(answering);
    asking = answering = null;
    quietFrom();
  };

  /** The connection is gone, or taken for gone: what waits on it fails, and it is tried again. */
  const lost = (why, { code, reason } = {}) => {
    for (const timer of [opening, quiet, asking, answering, retrying]) clearTimeout(timer);
    opening = quiet = asking = answering = retrying = null;
    socket = null;
    for (const call of pending.values())
      if (!call.sent) call.reject(failure(NOT_SENT_TEXT, NOT_SENT));
      else call.reject(failure(WRITES.has(call.channel) ? unconfirmedText() : why(), UNCONFIRMED));
    pending.clear();
    waiting = [];
    if (code === SIGNED_OUT) return signIn(WHY[reason] ?? 'expired');
    if (signedOut) return;
    status('reconnecting');
    failures += 1;
    retrying = later(reconnect, retryMs(failures - 1));
  };
  /** A socket that doesn't open, or a Mac that doesn't answer on it, is let go. */
  const giveUp = () => {
    const silent = socket;
    lost(noAnswer);
    silent?.close();
  };

  const connect = () => {
    // The contact list as patches: a dozen contacts are a dozen kilobytes each time one of them changes.
    const own = new win.WebSocket(
      `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/socket?patches=contacts`
    );
    socket = own;
    contacts = null;
    opening = later(giveUp, OPEN_MS);
    // What a socket that was let go says late is not heard.
    const its = (handler) => (event) => (socket === own ? handler(event) : undefined);
    own.addEventListener(
      'open',
      its(() => {
        clearTimeout(opening);
        opening = null;
        failures = 0;
        status('connected');
        if (!seen()) tellSeen(false);
        for (const id of waiting) {
          const call = pending.get(id);
          if (!call) continue;
          own.send(call.message);
          call.sent = true;
        }
        waiting = [];
        heard();
        if (pending.size) asking = later(() => ask(ANSWER_MS), WAIT_MS);
      })
    );
    own.addEventListener(
      'message',
      its(({ data }) => {
        heard();
        let message;
        try {
          message = JSON.parse(data);
        } catch {
          return;
        }
        if (message.kind === 'response') {
          const call = pending.get(message.id);
          pending.delete(message.id);
          // Refused for what the phone may do: said in its own words, and the page follows what it may do now.
          if (message.code === NOT_ALLOWED) {
            accessIs(message.access);
            call?.reject(
              failure(refusedText(message.access, call?.channel, /** @type {any} */ (call?.args?.[2])), NOT_ALLOWED)
            );
          } else if (message.error !== undefined) call?.reject(new Error(message.error));
          else call?.resolve(message.result);
        } else if (message.kind === 'access') {
          accessIs(message.access);
        } else if (message.kind === 'event') {
          let { payload } = message;
          if (message.channel === EVENTS.contactsChanged) {
            payload = message.patch ? patched(contacts, message.patch) : payload;
            if (!payload) return;
            contacts = payload;
          }
          for (const listener of listeners.get(message.channel) || []) listener({}, payload);
        }
      })
    );
    own.addEventListener(
      'close',
      its((event) => lost(lostText, event))
    );
  };
  // A session that ended (the app restarted, or it ran out) signs in again first.
  const reconnect = async () => {
    retrying = null;
    if (await renew()) connect();
  };
  /** Tried again now, not after the pause between tries: as the phone comes back, or a Retry is tapped. */
  const retryNow = () => {
    if (!retrying) return;
    clearTimeout(retrying);
    reconnect();
  };

  /** Tells the Mac whether the page is seen: hidden, it holds the news for every window until it is back. */
  const tellSeen = (visible) => (isOpen() ? socket.send(JSON.stringify({ kind: 'visible', visible })) : undefined);

  /** The phone back on the page: the Mac is asked at once whether it is still there, or tried again now. */
  const wake = () => {
    if (signedOut) return;
    if (Date.now() - renewedAt >= RENEW_MS) renew();
    if (retrying) return retryNow();
    quietFrom();
    ask(WAKE_MS);
  };
  const { document } = win;
  if (document) {
    // Hidden, nothing is asked of the Mac, and no answer is waited for: a phone may stop the page's clock meanwhile,
    // and its timers go off late. Back on the page, the Mac is asked again.
    document.addEventListener('visibilitychange', () => {
      tellSeen(seen());
      if (seen()) return wake();
      for (const timer of [quiet, asking, answering]) clearTimeout(timer);
      quiet = asking = answering = null;
    });
    // Back from the back-forward cache; a page that just loaded was just answered.
    win.addEventListener('pageshow', ({ persisted }) => (persisted ? wake() : undefined));
    win.addEventListener('online', wake);
    win.addEventListener('offline', () => ask(WAKE_MS));
    win.addEventListener(RETRY, retryNow);
    win.addEventListener(SIGNING_OUT, ({ detail }) => (leaving = Boolean(detail)));
  }

  const invoke = (channel, ...args) => {
    if (Object.hasOwn(answeredHere, channel)) return Promise.resolve(answeredHere[channel](...args) ?? null);
    if (failures > 0 || signedOut) return Promise.reject(failure(NOT_SENT_TEXT, NOT_SENT));
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const message = JSON.stringify({ kind: 'request', id, channel, args });
      const sent = isOpen();
      pending.set(id, { resolve, reject, channel, args, message, sent });
      if (sent) socket.send(message);
      else waiting.push(id);
      // Not answered at once: the Mac is asked whether it is there, so a card isn't left waiting on nobody.
      if (!asking && !answering) asking = later(() => ask(ANSWER_MS), WAIT_MS);
    });
  };

  renew();
  connect();
  return {
    contextBridge: {
      exposeInMainWorld: (name, api) => {
        win[name] = api;
      },
    },
    ipcRenderer: {
      invoke,
      // The preload's invokeNow reads `value` at once and hands it to Promise.resolve: a promise there is
      // waited for. A network can't answer at once, and the page waits for its answer either way.
      sendSync: (channel, ...args) => ({ value: invoke(channel, ...args) }),
      on: (channel, listener) => {
        if (!listeners.has(channel)) listeners.set(channel, new Set());
        listeners.get(channel).add(listener);
      },
      removeListener: (channel, listener) => listeners.get(channel)?.delete(listener),
    },
    // A file dropped in a browser has no path on the app's computer.
    webUtils: { getPathForFile: () => '' },
  };
}
