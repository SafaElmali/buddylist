// Using the app from a phone or another computer, while Settings > Remote access has it on (see access.js).
//
// The app answers on 127.0.0.1:6767, so only this computer reaches it: Tailscale Serve, with its https
// address on the user's tailnet, is how a phone does (see tailscale.js). Every page and request needs a
// signed-in device first: one paired with the code Settings shows, or signed in with the remote password
// set there (see pairing.js, devices.js). A signed-in browser is given the phone app (see web.js), which asks
// over a WebSocket what a window asks over IPC, and is answered by the same handlers (see routes.js for which).
// It turns notifications on and off at /api/push (see push.js), with its service worker at /sw.js, which declines a
// permission from its notification at /api/decline.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { EVENTS, REQUESTS } from '../../shared/ipc-channels.js';
import { paletteOf } from '../../shared/theme.js';
import {
  allowedHost,
  Attempts,
  isLoopback,
  LOOPBACK_NAMES,
  sameOrigin,
  sessionCookie,
  tokenOf,
  verifyPassword,
} from './auth.js';
import { deviceName } from './devices.js';
import { allows, BROADCAST, heard, NOT_ALLOWED, remoteEvent, route, SentOnce } from './routes.js';
import {
  contentSecurityPolicy,
  contentType,
  Delivery,
  inPhoneBuild,
  messengerScript,
  MESSENGER_SCRIPT,
  PALETTES,
  phoneFiles,
  PHONE_PAGE,
  phonePage,
  phonePalettes,
  servedFile,
  SERVICE_WORKER,
  signInPage,
} from './web.js';
import { acceptConnection, CLOSE, isHandshake } from './websocket.js';

export const DEFAULT_PORT = 6767;
/** Only this computer: Tailscale Serve, on it, passes on what comes from the tailnet. */
const ADDRESS = '127.0.0.1';
/** The most pages open at once. */
const MAX_CLIENTS = 32;
/** How often a page hears news for every window at most, such as the contact list while agents work: the latest. */
const NEWS_EVERY_MS = 1000;
/** The longest sign-in request read. */
const MAX_LOGIN_BYTES = 4096;
/** The longest push subscription read: its address, and two keys. */
const MAX_SUBSCRIPTION_BYTES = 4096;
/** The longest Decline read: a conversation's id and a request's. */
const MAX_DECLINE_BYTES = 1024;
/** The sign-in page, and the addresses that lead to it: a QR code opens /pair, with its code after the #. */
const SIGN_IN_PAGE = '/src/renderer/remote/login.html';
const SIGN_IN = new Set(['/login', '/pair']);
/**
 * What a browser may load before it signed in: the sign-in page, and what a home screen asks for to add the phone
 * app, which is asked for without the cookie: its manifest and icons.
 */
const PUBLIC = new Set([
  '/src/renderer/remote/login.js',
  '/src/renderer/remote/login.css',
  '/src/renderer/phone/manifest.webmanifest',
  '/src/renderer/phone/icons/apple-touch-icon.png',
  '/src/renderer/phone/icons/icon-192.png',
  '/src/renderer/phone/icons/icon-512.png',
]);
/** What Tailscale Serve adds to a request from Funnel, which is from anywhere on the internet. */
const FUNNEL_HEADER = 'tailscale-funnel-request';
/**
 * What the sign-in page is led to with, of the address that led there: where to go once signed in (a conversation,
 * "#/c/<id>"), and why it is there again ("signed-out"). The page checks both (see login.js).
 */
const SIGN_IN_PARAMS = ['then', 'why'];

/** "?then=…&why=…": what of an address goes on to the sign-in page, each short. */
function signInQuery(searchParams) {
  const kept = new URLSearchParams();
  for (const name of SIGN_IN_PARAMS) {
    const value = searchParams.get(name);
    if (value && value.length <= 256) kept.set(name, value);
  }
  const query = kept.toString();
  return query ? `?${query}` : '';
}

/** One page in a browser, signed in, over its WebSocket. */
class Client {
  /** @type {string | null} the conversation it shows */
  #watching = null;
  /** @type {Set<() => void>} */
  #onClosed = new Set();
  /** News for every window not sent yet, the latest of each kind; while the page is hidden, it waits here. */
  #news = new Map();
  /** @type {Map<string, { at: number, text: string }>} what of each kind was sent last, and when */
  #sent = new Map();
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  #later = new Map();
  #visible = true;
  /** @type {Map<string, string> | null} the contacts it was sent last, by id, as sent: what a patch is made from */
  #contacts = null;
  /** @type {string[]} */
  #order = [];

  /**
   * @param {import('./websocket.js').WebSocketConnection} connection
   * @param {Pick<Console, 'error'>} log
   * @param {{ everyMs: number, patches: boolean }} news  how often it hears news for every window at most, and
   *   whether it takes the contact list as patches (it asked with ?patches=contacts)
   */
  constructor(connection, log, token, devices, { everyMs, patches }) {
    this.connection = connection;
    this.log = log;
    this.token = token;
    this.devices = devices;
    this.everyMs = everyMs;
    this.patches = patches;
    this.deviceId = devices.find(token)?.id ?? '';
    this.#expireLater();
    // What a handler is given for the window that asked: news for that window comes to this page.
    this.event = {
      remote: true,
      sender: {
        isDestroyed: () => connection.closed,
        send: (channel, payload) => this.send(channel, payload),
        once: (name, listener) => name === 'destroyed' && this.#onClosed.add(listener),
        getURL: () => '',
      },
    };
  }

  /** What its device may do now, as Settings last said: read only once it is signed out. */
  get access() {
    return this.devices.find(this.token)?.access ?? 'read';
  }

  /** Its device may do something else now: the page is told at once, to offer what it may. */
  accessChanged() {
    if (!this.authorized()) return;
    try {
      this.connection.send(JSON.stringify({ kind: 'access', access: this.access }));
    } catch (error) {
      this.log.error('Remote access: a change of access couldn’t be sent:', error);
    }
  }

  /** News of a conversation says nothing of whose it is: a page hears of the one it read last, and of no other. */
  watch(contactId) {
    this.#watching = contactId;
  }

  watches(contactId) {
    return this.#watching === contactId;
  }

  /** Closes the connection once its device has gone unused too long: used meanwhile, it waits longer. */
  #expireLater() {
    clearTimeout(this.expiry);
    // A timer can't wait longer than about 24 days.
    this.expiry = setTimeout(
      () => (this.authorized() ? this.#expireLater() : undefined),
      Math.min(this.devices.remainingMs(this.token), 2 ** 31 - 1)
    );
    this.expiry.unref?.();
  }

  authorized() {
    if (this.connection.closed) return false;
    if (this.devices.valid(this.token)) return true;
    this.connection.close(CLOSE.policy, 'Sign in again');
    return false;
  }

  /** News for the page. Told from wherever the app tells its windows, so nothing here may throw back there. */
  send(channel, payload) {
    this.#event({ channel, payload });
  }

  /**
   * News for every window, as this page hears it: at once where it heard none of the kind for a while, else the
   * latest once the while is over, and only what is new. A page that said it is hidden hears it when it is back.
   */
  news(channel, payload) {
    this.#news.set(channel, payload);
    this.#flush(channel);
  }

  /** @param {boolean} seen  the page is on screen */
  visible(seen) {
    this.#visible = seen;
    if (seen) for (const channel of [...this.#news.keys()]) this.#flush(channel);
  }

  #flush(channel) {
    if (!this.#visible || this.#later.has(channel) || !this.#news.has(channel)) return;
    const wait = (this.#sent.get(channel)?.at ?? -Infinity) + this.everyMs - Date.now();
    if (wait > 0) {
      const later = setTimeout(() => {
        this.#later.delete(channel);
        this.#flush(channel);
      }, wait);
      later.unref?.();
      this.#later.set(channel, later);
      return;
    }
    const payload = this.#news.get(channel);
    this.#news.delete(channel);
    const text = JSON.stringify(payload);
    if (text === this.#sent.get(channel)?.text) return;
    this.#sent.set(channel, { at: Date.now(), text });
    if (channel === EVENTS.contactsChanged && this.patches && Array.isArray(payload)) this.#contactsChanged(payload);
    else this.send(channel, payload);
  }

  /**
   * The contact list to a page that takes patches: whole the first time, then only the contacts that changed or
   * came, the ids of those that went, and the order where it changed.
   * @param {{ id: string }[]} views
   */
  #contactsChanged(views) {
    const before = this.#contacts;
    const order = views.map(({ id }) => id);
    this.#contacts = new Map(views.map((view) => [view.id, JSON.stringify(view)]));
    const reordered = order.length !== this.#order.length || order.some((id, at) => id !== this.#order[at]);
    this.#order = order;
    if (!before) return this.send(EVENTS.contactsChanged, views);
    const patch = {
      set: views.filter(({ id }) => before.get(id) !== this.#contacts?.get(id)),
      removed: [...before.keys()].filter((id) => !this.#contacts?.has(id)),
      ...(reordered && { order }),
    };
    this.#event({ channel: EVENTS.contactsChanged, patch });
  }

  #event(message) {
    if (!this.authorized()) return;
    try {
      this.connection.send(JSON.stringify({ kind: 'event', ...message }));
    } catch (error) {
      this.log.error(`Remote access: ${message.channel} couldn't be sent:`, error);
    }
  }

  answer(id, answer) {
    let text;
    try {
      text = JSON.stringify({ kind: 'response', id, ...answer });
    } catch {
      text = JSON.stringify({ kind: 'response', id, error: "The answer can't be sent over the network." });
    }
    if (this.authorized()) this.connection.send(text);
  }

  closed() {
    clearTimeout(this.expiry);
    for (const later of this.#later.values()) clearTimeout(later);
    for (const listener of this.#onClosed) listener();
  }
}

export class RemoteHost {
  /** @type {Set<Client>} */
  #clients = new Set();
  #devices;
  #pairing;
  #push;
  #attempts;
  #codeAttempts;
  /** The messages pages sent lately, by their own ids: one sent again isn't said twice. */
  #sent = new SentOnce();
  #server = null;
  #delivery = new Delivery();
  /** @type {ReturnType<typeof phoneFiles> | null} what the phone app's page is made with (see phonePage) */
  #phone = null;

  /** @type {Map<string, Function>} the app's handlers, by channel (see ipc.js) */
  requests = new Map();

  /**
   * @param {object} deps
   * @param {() => object} deps.settings  the app's settings: the palette the phone app opens in
   * @param {{ resolve: (kind: string, file: string, options?: object) => string | null }} deps.pack
   * @param {() => import('./auth.js').PasswordHash | null} deps.passwordHash
   * @param {import('./devices.js').Devices} deps.devices  the devices signed in
   * @param {import('./pairing.js').PairingCode} deps.pairing  the code Settings shows, to pair a phone with
   * @param {Pick<import('./push.js').PhonePush, 'publicKey' | 'isOn' | 'subscribe' | 'unsubscribe'>} deps.push
   *   the devices' notifications
   * @param {string} deps.root  the app's folder, which the phone app is served from
   * @param {string} deps.preload  the preload's file
   * @param {number} deps.port  0 for any that is free, as tests have it
   * @param {() => string[]} [deps.hostnames]  the other names it is reached by, lowercase: "mac.tailnet-name.ts.net"
   * @param {() => import('./routes.js').HostInfo} [deps.computer]  this computer, as the phone app names it
   * @param {(contactId: string, requestId: string) => boolean} [deps.asks]  whether a conversation still waits on a
   *   request, for a Decline from a notification (see Conversations.asks)
   * @param {Attempts} [deps.attempts]  wrong passwords so far, kept while the app runs
   * @param {Attempts} [deps.codeAttempts]  wrong codes so far, counted apart: a new code starts them over
   * @param {(device: import('./devices.js').DeviceView) => void} [deps.onSignIn]  a device was signed in
   * @param {() => void} [deps.onDevices]  a device was signed out, or its pages came or went
   * @param {() => void} [deps.onAttempt]  a wrong password was tried: signing in may wait now
   * @param {number} [deps.newsEveryMs]  how often a page hears news for every window at most
   * @param {() => void} [deps.onFunnel]  a request said it came from the public internet, through Tailscale Funnel.
   *   Anyone could say so: it is refused, and the one told asks Tailscale before believing it
   * @param {Pick<Console, 'log' | 'warn' | 'error'>} [deps.log]
   */
  constructor({
    settings,
    pack,
    passwordHash,
    devices,
    pairing,
    push,
    root,
    preload,
    port,
    hostnames = () => [],
    computer = () => ({ name: '', noun: 'computer' }),
    asks = () => false,
    attempts = new Attempts(),
    codeAttempts = new Attempts(),
    onSignIn = () => {},
    onDevices = () => {},
    onAttempt = () => {},
    onFunnel = () => {},
    newsEveryMs = NEWS_EVERY_MS,
    log = console,
  }) {
    this.newsEveryMs = newsEveryMs;
    this.#devices = devices;
    this.#pairing = pairing;
    this.#push = push;
    this.#attempts = attempts;
    this.#codeAttempts = codeAttempts;
    this.settings = settings;
    this.pack = pack;
    this.passwordHash = passwordHash;
    this.root = root;
    this.preload = preload;
    this.listenPort = port;
    this.otherNames = hostnames;
    this.computer = computer;
    this.asks = asks;
    this.onSignIn = onSignIn;
    this.onDevices = onDevices;
    this.onAttempt = onAttempt;
    this.onFunnel = onFunnel;
    this.log = log;
  }

  /** The names it answers to: this computer's own, and the ones Tailscale gives it. */
  get hostnames() {
    return [...LOOPBACK_NAMES, ...this.otherNames()];
  }

  /**
   * Starts answering, once the app's handlers are there. A port another program has is an error, said as such.
   * @param {Pick<Map<string, Function>, 'get'>} requests  the app's handlers, by channel (see ipc.js)
   */
  async start(requests) {
    this.requests = requests;
    const server = http.createServer((request, response) => {
      this.#answer(request, response).catch((error) => {
        this.log.error('Remote request:', error);
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    });
    server.on('upgrade', (request, socket, head) => this.#upgrade(request, socket, head));
    await new Promise((resolve, reject) => {
      server.once('error', (error) =>
        reject(
          error?.code === 'EADDRINUSE'
            ? new Error(`Port ${this.listenPort} is in use by another program. Quit it, then turn this on again.`)
            : error
        )
      );
      server.listen(this.listenPort, ADDRESS, resolve);
    });
    this.#server = server;
    const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
    this.port = port;
    this.log.log(`Remote access: http://${ADDRESS}:${port}/`);
  }

  close() {
    for (const client of this.#clients) client.connection.close(CLOSE.goingAway);
    this.#server?.close();
    this.#server?.closeAllConnections?.();
    this.#server = null;
  }

  /** The devices that have a page open now, by id. */
  connected() {
    return new Set([...this.#clients].map((client) => client.deviceId));
  }

  /**
   * Closes the pages of a device that was signed out: all of them, without an id.
   * @param {string} [deviceId]
   */
  signedOut(deviceId) {
    for (const client of this.#clients)
      if (deviceId === undefined || client.deviceId === deviceId) client.connection.close(CLOSE.policy, 'Signed out');
  }

  /**
   * A device may do something else now, as Settings says: its pages are told, and asked of as it may from now on.
   * @param {string} deviceId
   */
  accessChanged(deviceId) {
    for (const client of this.#clients) if (client.deviceId === deviceId) client.accessChanged();
  }

  /** News for every page, of the kinds a browser hears, as it hears them (see BROADCAST). */
  broadcast(channel, payload) {
    if (!BROADCAST.has(channel)) return;
    const news = heard(channel, payload);
    for (const client of this.#clients) client.news(channel, news);
  }

  /** What happened in a conversation, for the pages that show it: without its pictures (see remoteEvent). */
  sessionEvent(contactId, event) {
    const watching = [...this.#clients].filter((client) => client.watches(contactId));
    if (!watching.length) return;
    const heard = remoteEvent(event);
    for (const client of watching) client.send(EVENTS.sessionEvent, heard);
  }

  /** The sender already drew its own message; every other viewer needs it too. */
  userMessage(contactId, entry, sender) {
    const watching = [...this.#clients].filter((client) => client.event.sender !== sender && client.watches(contactId));
    if (!watching.length) return;
    const heard = remoteEvent({ type: 'user-message', entry });
    for (const client of watching) client.send(EVENTS.sessionEvent, heard);
  }

  /**
   * The conversation windows, with the pages that show a conversation beside them: what
   * Conversations tells what it does (see conversations.js).
   * @param {import('../windows/chat-windows.js').ChatWindows} chats
   */
  alongside(chats) {
    return {
      send: (contactId, event) => {
        chats.send(contactId, event);
        this.sessionEvent(contactId, event);
      },
      isFocused: (contactId) => chats.isFocused(contactId),
    };
  }

  /** Whether a request is meant for this app and signed in. */
  #signedIn(request) {
    return this.#devices.valid(tokenOf(request.headers));
  }

  /** Over https, behind Tailscale Serve on this computer, which says so. */
  #secure(request) {
    return isLoopback(request.socket.remoteAddress) && request.headers['x-forwarded-proto'] === 'https';
  }

  /**
   * Where a request came from, for the list of devices and for counting wrong tries: the tailnet address and login
   * Tailscale Serve says it passed it on from, or this computer. Only said by a program on this computer, which is
   * all that reaches it. Serve's is the last address: one before it is whatever the phone said itself.
   * @returns {{ via: import('./devices.js').Via, address: string, login: string }}
   */
  #place(request) {
    const forwarded = String(request.headers['x-forwarded-for'] || '')
      .split(',')
      .at(-1)
      .trim();
    if (isLoopback(request.socket.remoteAddress) && forwarded)
      return { via: 'tailscale', address: forwarded, login: headerText(request.headers['tailscale-user-login']) };
    return { via: 'local', address: String(request.socket.remoteAddress || '').replace(/^::ffff:/, ''), login: '' };
  }

  /**
   * A new device, signed in, that may do what `access` says: its cookie is the answer.
   * @param {import('../../shared/remote-access.js').AccessLevel} access
   */
  #signIn(request, response, headers, installed, access) {
    const { token, device } = this.#devices.start({
      name: deviceName(request.headers['user-agent'], { installed: installed === true }),
      access,
      ...this.#place(request),
    });
    this.log.log(`Remote access: ${device.name} signed in (${device.via} ${device.address}, ${device.access}).`);
    this.onSignIn(device);
    response.writeHead(204, { ...headers, 'set-cookie': sessionCookie(token, { secure: this.#secure(request) }) });
    response.end();
  }

  async #answer(request, response) {
    const { host = '' } = request.headers;
    // Answered before everything stops: stopping closes every connection, this one too.
    if (request.headers[FUNNEL_HEADER] && isLoopback(request.socket.remoteAddress)) {
      response.once('finish', () => this.onFunnel());
      return plain(response, 403, 'buddylist is not on the public internet.');
    }
    if (!allowedHost(host, this.hostnames)) return plain(response, 421, 'Not a name this buddylist answers to.');
    const { pathname, searchParams } = new URL(request.url || '/', 'http://buddylist');
    const headers = {
      'content-security-policy': contentSecurityPolicy(host),
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy': 'same-origin',
      'cache-control': 'no-store',
    };

    if (
      request.method !== 'GET' &&
      request.method !== 'HEAD' &&
      request.headers.origin &&
      !sameOrigin(request.headers.origin, host, this.#secure(request) ? 'https:' : 'http:')
    )
      return plain(response, 403, 'Not from here.');

    if (pathname === '/api/login' && request.method === 'POST') return this.#login(request, response, headers);
    if (pathname === '/api/pair' && request.method === 'POST') return this.#pair(request, response, headers);
    if (pathname === '/api/logout' && request.method === 'POST') {
      const token = tokenOf(request.headers);
      const device = this.#devices.find(token);
      this.#devices.end(token);
      for (const client of this.#clients)
        if (client.token === token) client.connection.close(CLOSE.policy, 'Signed out');
      if (device) this.onDevices();
      response.writeHead(204, { ...headers, 'set-cookie': sessionCookie('', { secure: this.#secure(request) }) });
      return response.end();
    }
    if (pathname === '/api/push') return this.#notifications(request, response, headers);
    if (pathname === '/api/push/test') return this.#testNote(request, response, headers);
    if (pathname === '/api/decline') return this.#decline(request, response, headers);
    if (request.method !== 'GET' && request.method !== 'HEAD') return plain(response, 405, 'Not here.');
    // A browser keeps what is after the # through the redirect: the code a QR code has stays with the page.
    if (SIGN_IN.has(pathname)) return redirect(response, `${SIGN_IN_PAGE}${signInQuery(searchParams)}`);
    if (pathname === SIGN_IN_PAGE)
      return this.#delivery.text(request, response, headers, {
        type: contentType(SIGN_IN_PAGE),
        text: signInPage(fs.readFileSync(path.join(this.root, SIGN_IN_PAGE), 'utf8'), this.computer().noun),
        cache: false,
      });
    if (PUBLIC.has(pathname)) return this.#file(request, response, headers, servedFile(this.root, pathname));
    // At the top, so that it is the whole app's: a worker's scope is the folder it is in. Code, and no one's data,
    // so it is there for a browser that looks for a new one without its cookie.
    if (pathname === '/sw.js') return this.#file(request, response, headers, servedFile(this.root, SERVICE_WORKER));

    const signedIn = this.#signedIn(request);
    // Asked as a page opens: the cookie it has lasts as long again.
    if (pathname === '/api/session') {
      if (!signedIn) return plain(response, 401, '');
      const token = tokenOf(request.headers);
      this.#devices.seen(token, this.#place(request));
      response.writeHead(204, {
        ...headers,
        ...(!/^Bearer /.test(request.headers.authorization || '') && {
          'set-cookie': sessionCookie(token, { secure: this.#secure(request) }),
        }),
      });
      return response.end();
    }
    if (!signedIn) {
      if (pathname === '/') return redirect(response, `/login${signInQuery(searchParams)}`);
      return plain(response, 401, 'Sign in first.');
    }
    if (pathname === '/') {
      this.#phone ??= phoneFiles(this.root);
      const page = phonePage(
        fs.readFileSync(path.join(this.root, PHONE_PAGE), 'utf8'),
        paletteOf(this.settings().theme),
        this.#phone
      );
      return this.#delivery.text(request, response, headers, {
        type: contentType(PHONE_PAGE),
        text: page,
        cache: false,
      });
    }
    if (pathname === MESSENGER_SCRIPT) {
      const script = messengerScript(fs.readFileSync(this.preload, 'utf8'));
      return this.#delivery.text(request, response, headers, {
        type: 'text/javascript; charset=utf-8',
        text: script,
        cache: true,
      });
    }
    if (pathname.startsWith('/pack/')) {
      const [kind = '', file = ''] = pathname.slice('/pack/'.length).split('/');
      let name = '';
      try {
        name = decodeURIComponent(file);
      } catch {
        // Not a name any file has.
      }
      return this.#file(request, response, headers, this.pack.resolve(kind, name, { allowAudio: true }));
    }
    const file = servedFile(this.root, pathname);
    // The phone is always in the professional look: its half of the palettes.
    if (pathname === PALETTES && file)
      return this.#delivery.file(request, response, headers, file, {
        body: phonePalettes(fs.readFileSync(file, 'utf8')),
      });
    return this.#file(request, response, headers, file, { forGood: inPhoneBuild(pathname) });
  }

  /**
   * A signed-in device's notifications: GET says whether they are on, with the key to subscribe with, where they go
   * (the browser's endpoint, '' when off) and the last note that didn't (`failure`: { at, reason } or null); POST
   * turns them on with the browser's subscription, and DELETE off.
   */
  async #notifications(request, response, headers) {
    const token = tokenOf(request.headers);
    const device = this.#signedIn(request) ? this.#devices.find(token) : null;
    if (!device) return plain(response, 401, 'Sign in first.');
    if (request.method === 'GET') {
      response.writeHead(200, { ...headers, 'content-type': 'application/json' });
      return response.end(
        JSON.stringify({
          publicKey: this.#push.publicKey(),
          on: this.#push.isOn(device.id),
          endpoint: this.#push.endpoint(device.id),
          failure: this.#push.failure(device.id),
        })
      );
    }
    if (request.method === 'DELETE') {
      this.#push.unsubscribe(device.id);
      this.onDevices();
      response.writeHead(204, headers);
      return response.end();
    }
    if (request.method !== 'POST') return plain(response, 405, 'Not here.');
    const body = await readJson(request, response, MAX_SUBSCRIPTION_BYTES);
    if (!body) return;
    try {
      await this.#push.subscribe(device.id, body, { welcome: body.renewed !== true });
    } catch (error) {
      return plain(response, 400, error instanceof Error ? error.message : String(error));
    } finally {
      this.onDevices();
    }
    response.writeHead(204, headers);
    response.end();
  }

  /**
   * A signed-in device asks for a test note: 204 once its push service took it, 409 with notifications off, and 502
   * saying why where the push service didn't take it.
   */
  async #testNote(request, response, headers) {
    const device = this.#signedIn(request) ? this.#devices.find(tokenOf(request.headers)) : null;
    if (!device) return plain(response, 401, 'Sign in first.');
    if (request.method !== 'POST') return plain(response, 405, 'Not here.');
    if (!this.#push.isOn(device.id)) return plain(response, 409, 'Turn notifications on first.');
    try {
      await this.#push.test(device.id);
    } catch (error) {
      return plain(response, 502, error instanceof Error ? error.message : String(error));
    } finally {
      this.onDevices();
    }
    response.writeHead(204, headers);
    response.end();
  }

  /**
   * A device declines a permission from its notification (Decline, in sw.js), as Decline on its card does: 204 once
   * declined; 409 `{ reason: 'answered' }` where it was answered already, from anywhere, or went away; 403
   * `{ reason: 'not-allowed', access }` where its access doesn't let it answer; 401 signed out; 400 for no request.
   */
  async #decline(request, response, headers) {
    const token = tokenOf(request.headers);
    const device = this.#signedIn(request) ? this.#devices.find(token) : null;
    if (!device) return plain(response, 401, 'Sign in first.');
    if (request.method !== 'POST') return plain(response, 405, 'Not here.');
    const body = await readJson(request, response, MAX_DECLINE_BYTES);
    if (!body) return;
    const { contactId, requestId } = body;
    if (![contactId, requestId].every((id) => typeof id === 'string' && id && id.length <= 256))
      return plain(response, 400, 'Which request?');
    const args = [contactId, requestId, { decision: 'deny' }];
    if (!allows(device.access, REQUESTS.chatRespond, args))
      return json(response, 403, { reason: NOT_ALLOWED, access: device.access }, headers);
    if (!this.asks(contactId, requestId)) return json(response, 409, { reason: 'answered' }, headers);
    this.#devices.seen(token, this.#place(request));
    // As a page of this device would answer it: through the same handler, counted the same way.
    const client = {
      deviceId: device.id,
      access: device.access,
      event: { remote: true, sender: { isDestroyed: () => true, send() {}, once() {}, getURL: () => '' } },
      watch() {},
    };
    await route({ requests: this.requests, client, channel: REQUESTS.chatRespond, args });
    response.writeHead(204, headers);
    response.end();
  }

  /**
   * A file, with its validator, compressed where it is text (see Delivery).
   * @param {{ forGood?: boolean }} [how]  a file of the phone app's bundle, kept for good
   */
  #file(request, response, headers, file, how = {}) {
    if (!file) return plain(response, 404, 'Not here.');
    return this.#delivery.file(request, response, headers, file, how);
  }

  /**
   * What a sign-in posted, once it may be tried: JSON, within the limits on wrong tries from where it came, and with
   * one try counted already. Null once it was answered instead: a wait says how long, in seconds.
   * @param {Attempts} attempts  the passwords', or the codes'
   * @returns {Promise<Record<string, unknown> | null>}
   */
  async #attempt(request, response, headers, attempts, address) {
    const wait = () => {
      const waitMs = attempts.waitMs(address);
      if (waitMs <= 0) return false;
      const retryAfterSeconds = Math.ceil(waitMs / 1000);
      json(response, 429, { retryAfterSeconds }, { ...headers, 'retry-after': String(retryAfterSeconds) });
      return true;
    };
    if (wait()) return null;
    const body = await readJson(request, response, MAX_LOGIN_BYTES);
    if (!body) return null;
    // Reserve a try before awaiting scrypt: simultaneous requests must obey the same limit.
    if (wait()) return null;
    attempts.failed(address);
    return body;
  }

  async #login(request, response, headers) {
    const { address } = this.#place(request);
    const body = await this.#attempt(request, response, headers, this.#attempts, address);
    if (!body) return;
    if (!(await verifyPassword(body.password, this.passwordHash()))) {
      this.log.warn(`Remote access: a wrong password from ${address}.`);
      this.onAttempt();
      return json(response, 401, { reason: 'wrong', triesLeft: this.#attempts.triesLeft(address) }, headers);
    }
    this.#attempts.succeeded(address);
    // The password stands for everything the agents can do: a browser signed in with it may do everything.
    this.#signIn(request, response, headers, body.installed, 'full');
  }

  /** A phone with the code Settings shows. One wrong too often is cancelled (see pairing.js). */
  async #pair(request, response, headers) {
    const { address } = this.#place(request);
    const body = await this.#attempt(request, response, headers, this.#codeAttempts, address);
    if (!body) return;
    const said = this.#pairing.redeem(body.code);
    if (said !== 'paired') {
      this.log.warn(`Remote access: a code that didn't pair (${said}) from ${address}.`);
      const left = this.#codeAttempts.triesLeft(address);
      const triesLeft = said === 'wrong' ? Math.min(left, this.#pairing.triesLeft()) : left;
      return json(response, 401, { reason: said, triesLeft }, headers);
    }
    this.#codeAttempts.succeeded(address);
    this.#signIn(request, response, headers, body.installed, this.#pairing.access());
  }

  #upgrade(request, socket, head) {
    const refuse = (status, text, then) => {
      socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, then);
    };
    const { host, origin } = request.headers;
    let pathname;
    let searchParams;
    try {
      ({ pathname, searchParams } = new URL(request.url || '/', 'http://buddylist'));
    } catch {
      return refuse(400, 'Bad Request');
    }
    if (pathname !== '/api/socket' || !isHandshake(request)) return refuse(400, 'Bad Request');
    if (!allowedHost(host, this.hostnames)) return refuse(421, 'Misdirected Request');
    // A browser's page says where it is from, and has to be one of the app's own. A program sends a token instead.
    if (
      origin
        ? !sameOrigin(origin, host, this.#secure(request) ? 'https:' : 'http:')
        : !/^Bearer /.test(request.headers.authorization || '')
    )
      return refuse(403, 'Forbidden');
    if (request.headers[FUNNEL_HEADER] && isLoopback(request.socket.remoteAddress))
      return refuse(403, 'Forbidden', () => this.onFunnel());
    if (!this.#signedIn(request)) return refuse(401, 'Unauthorized');
    if (this.#clients.size >= MAX_CLIENTS) return refuse(503, 'Service Unavailable');

    const token = tokenOf(request.headers);
    this.#devices.seen(token, this.#place(request));
    const connection = acceptConnection(request, socket, head, {
      onMessage: (text) => this.#request(client, text).catch((error) => this.log.error('Remote request:', error)),
      onClose: () => {
        this.#clients.delete(client);
        client.closed();
        this.onDevices();
      },
    });
    const client = new Client(connection, this.log, token, this.#devices, {
      everyMs: this.newsEveryMs,
      patches: searchParams.get('patches') === 'contacts',
    });
    this.#clients.add(client);
    this.onDevices();
  }

  async #request(client, text) {
    if (!client.authorized()) return;
    this.#devices.seen(client.token);
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return client.connection.close(CLOSE.unsupported, 'Not JSON');
    }
    // The page says whether it is on screen: hidden, it hears no news for every window until it is back.
    if (message?.kind === 'visible') return client.visible(message.visible !== false);
    if (message?.kind !== 'request' || !Number.isInteger(message.id)) return;
    const { id, channel, args } = message;
    try {
      const host = this.computer();
      const sent = this.#sent;
      client.answer(id, { result: await route({ requests: this.requests, client, channel, args, host, sent }) });
    } catch (error) {
      // Refused for what its device may do: the code and the level go with it, for the page to say and to follow.
      const refused = error?.code === NOT_ALLOWED && { code: NOT_ALLOWED, access: error.access };
      client.answer(id, { error: error instanceof Error ? error.message : String(error), ...refused });
    }
  }
}

/**
 * A request's JSON object, read up to `maxBytes`: or null once it was answered with why not.
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function readJson(request, response, maxBytes) {
  // Only JSON: another site's page can't post it without asking first, which isn't answered.
  if (!/^application\/json\b/.test(request.headers['content-type'] || '')) {
    plain(response, 415, 'JSON only.');
    return null;
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      plain(response, 413, 'Too long.');
      return null;
    }
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    body = null;
  }
  if (!body || typeof body !== 'object') {
    plain(response, 400, 'Not JSON.');
    return null;
  }
  return body;
}

function json(response, status, body, headers) {
  response.writeHead(status, { ...headers, 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function plain(response, status, text) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  response.end(text);
}

function redirect(response, location) {
  response.writeHead(302, { location, 'cache-control': 'no-store' });
  response.end();
}

/** A header Tailscale may have encoded, as RFC 2047 does a name that isn't ASCII: "=?utf-8?q?Zo=C3=AB?=". */
export function headerText(value) {
  const text = String(value || '').slice(0, 256);
  const encoded = /^=\?utf-8\?q\?(.*)\?=$/i.exec(text);
  if (!encoded) return text;
  try {
    return decodeURIComponent(encoded[1].replace(/_/g, ' ').replace(/=([\da-f]{2})/gi, '%$1'));
  } catch {
    return text;
  }
}
