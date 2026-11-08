// Who may use the app from another computer: a device paired with a code shown in Settings, or signed in
// with the remote password set there (see host.js). The password is kept only as a scrypt hash, in
// remote.json in the app's data folder, with whether remote access is on and the devices signed in
// (devices.js). Plain Node, with nothing of Electron's.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { DEVICE_MS } from './devices.js';

const scrypt = promisify(crypto.scrypt);

/** The file in the app's data folder that remote access is kept in. */
export const REMOTE_FILE = 'remote.json';
/** What remote.json is, as this version of the app writes it: 2 since a device has what it may do (see devices.js). */
export const REMOTE_VERSION = 2;
/** The cookie a signed-in browser has its session in. */
export const SESSION_COOKIE = 'buddylist_session';
/** The shortest password taken: a remote password stands for everything the agents can do. */
export const MIN_PASSWORD_LENGTH = 12;

// What it costs to check a password: about 50 ms, and 32 MB, each time.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 32 };
const scryptOptions = ({ N, r, p }) => ({ N, r, p, maxmem: 256 * N * r });

/**
 * @typedef {{ algorithm: 'scrypt', N: number, r: number, p: number, salt: string, hash: string }} PasswordHash
 */

/**
 * @param {string} password
 * @returns {Promise<PasswordHash>}
 */
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH)
    throw new Error(`A remote password has at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (password.length > 1024) throw new Error('A remote password has at most 1024 characters.');
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, SCRYPT.keylen, scryptOptions(SCRYPT));
  const { N, r, p } = SCRYPT;
  return { algorithm: 'scrypt', N, r, p, salt: salt.toString('base64'), hash: hash.toString('base64') };
}

/**
 * Whether a password is the one hashed. A hash that isn't one this file wrote matches nothing.
 * @param {unknown} password
 * @param {PasswordHash | null} stored
 */
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || !password || password.length > 1024) return false;
  if (stored?.algorithm !== 'scrypt' || typeof stored.salt !== 'string' || typeof stored.hash !== 'string')
    return false;
  const { N, r, p } = stored;
  // What the file asks for is bounded: a changed file must not have each try take seconds and gigabytes.
  if (N !== SCRYPT.N || r !== SCRYPT.r || p !== SCRYPT.p) return false;
  const expected = Buffer.from(stored.hash, 'base64');
  if (expected.length !== SCRYPT.keylen) return false;
  const salt = Buffer.from(stored.salt, 'base64');
  if (salt.length !== 16) return false;
  const actual = await scrypt(password.normalize('NFKC'), salt, expected.length, scryptOptions({ N, r, p }));
  return crypto.timingSafeEqual(actual, expected);
}

/**
 * What remote.json keeps.
 * @typedef {{ version: number, enabled: boolean, keepAwake: boolean, keepAwakeAsked: boolean,
 *   password: PasswordHash | null, devices: import('./devices.js').Device[],
 *   vapid: import('./web-push.js').VapidKeys | null, pushText: boolean, pushAwayOnly: boolean, setUp: boolean }} RemoteFile
 *   `version`: REMOTE_VERSION, once read. `enabled`: Settings turned remote access on.
 *   `keepAwake`: the computer doesn't sleep by itself meanwhile. `keepAwakeAsked`: the user said whether it should, in Settings.
 *   `setUp`: a phone has paired through Tailscale once, so Settings shows how it stands instead of the steps.
 *   `vapid`: the key pair phones' notifications are sent with, made the first time one turns them on (see push.js).
 *   `pushText`: notifications say what was said. `pushAwayOnly`: only while the user is away from this Mac
 */

/**
 * What remote.json has, brought up to this version's, with what it doesn't have as a first run has it: off, with no
 * password.
 * @param {string} userData
 * @returns {RemoteFile}
 */
export function readRemote(userData) {
  let kept = {};
  try {
    kept = JSON.parse(fs.readFileSync(path.join(userData, REMOTE_FILE), 'utf8')) ?? {};
  } catch {
    // None yet, or not one this app wrote: remote access is off.
  }
  let devices = Array.isArray(kept.devices) ? kept.devices : [];
  // v1 → v2: a device has what it may do. One paired before could do everything, and still may. A file an older
  // version wrote again has no version either: the levels this one gave are kept.
  if (!(kept.version >= 2))
    devices = devices.map((device) =>
      device && typeof device === 'object' && !('access' in device) ? { ...device, access: 'full' } : device
    );
  const keepAwakeAsked = kept.keepAwakeAsked === true;
  return {
    version: REMOTE_VERSION,
    enabled: kept.enabled === true,
    // Only once the user said so. Before it was asked, it was on unless turned off, and every remote.json written
    // kept it so: on without being asked is off.
    keepAwake: keepAwakeAsked && kept.keepAwake === true,
    keepAwakeAsked,
    password: kept.password ?? null,
    devices,
    // Set up before this was kept: a phone that came through Tailscale is signed in.
    setUp: kept.setUp === true || devices.some((device) => device?.via === 'tailscale'),
    vapid: typeof kept.vapid?.publicKey === 'string' && typeof kept.vapid.privateKey === 'string' ? kept.vapid : null,
    pushText: kept.pushText === true,
    pushAwayOnly: kept.pushAwayOnly !== false,
  };
}

/**
 * Keeps remote.json, readable only by the user. It is written whole, beside the old one, and then put in its
 * place: a computer that loses power meanwhile still has one or the other.
 * @param {string} userData
 * @param {RemoteFile} remote
 */
export function writeRemote(userData, remote) {
  fs.mkdirSync(userData, { recursive: true });
  const file = path.join(userData, REMOTE_FILE);
  const next = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(next, `${JSON.stringify(remote, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(next, 0o600);
  fs.renameSync(next, file);
}

/**
 * The session token a request comes with: in `Authorization: Bearer`, as a program sends it,
 * or in the session cookie, as a browser does.
 * @param {import('node:http').IncomingHttpHeaders} headers
 */
export function tokenOf(headers) {
  const bearer = /^Bearer ([\w-]+)$/.exec(headers.authorization || '');
  if (bearer) return bearer[1];
  return cookiesOf(headers.cookie)[SESSION_COOKIE] || '';
}

/** @param {string | undefined} header */
export function cookiesOf(header) {
  const cookies = {};
  for (const part of (header || '').split(';')) {
    const at = part.indexOf('=');
    const name = part.slice(0, Math.max(at, 0)).trim();
    if (name) cookies[name] = part.slice(at + 1).trim();
  }
  return cookies;
}

/**
 * The cookie a browser keeps its session in. Page scripts can't read it, and no other site's
 * page can have it sent. Over https (behind Tailscale Serve) it is only ever sent so.
 * @param {string} token  '' clears it
 * @param {{ secure: boolean, maxAgeMs?: number }} options
 */
export function sessionCookie(token, { secure, maxAgeMs = DEVICE_MS }) {
  const maxAge = token ? Math.floor(maxAgeMs / 1000) : 0;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

/** The names this computer answers to on its own, whatever else it is allowed to be called. */
export const LOOPBACK_NAMES = Object.freeze(['127.0.0.1', 'localhost', '[::1]']);

/** "Example.ts.net:443" -> "example.ts.net"; "[::1]:6767" -> "[::1]" */
export function hostnameOf(host) {
  const value = String(host || '').toLowerCase();
  return /^(\[[\da-f:]+\]|[a-z\d.-]+)(?::\d+)?$/.exec(value)?.[1] || '';
}

/**
 * Whether a request was meant for this app: its Host is one of the names it answers to. A page on
 * another site that has its own name point at this computer (DNS rebinding) is turned away by this.
 * @param {string | undefined} host  the request's Host header
 * @param {string[]} allowed  hostnames, lowercase, without ports
 */
export const allowedHost = (host, allowed) => Boolean(host) && allowed.includes(hostnameOf(host));

/**
 * Whether a browser's request comes from one of the app's own pages. A browser always says
 * where a page that opens a WebSocket or posts a form is from; a program may say nothing.
 * @param {string | undefined} origin
 * @param {string | undefined} host
 */
export function sameOrigin(origin, host, protocol) {
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    return (
      (protocol ? url.protocol === protocol : url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === origin &&
      url.host.toLowerCase() === host.toLowerCase()
    );
  } catch {
    return false;
  }
}

/** @param {string | undefined} address  a socket's remote address */
export const isLoopback = (address) =>
  address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' || /^127\./.test(address || '');

/**
 * How many wrong passwords, or codes, are let through before signing in waits: so many from one address, and so
 * many in all, within a while. A phone's address is its tailnet one, which Tailscale Serve says (see host.js).
 */
export class Attempts {
  /** @type {Map<string, number[]>} */
  #failures = new Map();
  #now;

  constructor({ perAddress = 5, total = 20, withinMs = 15 * 60 * 1000, now = Date.now } = {}) {
    this.perAddress = perAddress;
    this.total = total;
    this.withinMs = withinMs;
    this.#now = now;
  }

  /**
   * How long signing in from an address waits before it is tried again; 0 when it needn't.
   * @param {string} address
   */
  waitMs(address) {
    const now = this.#now();
    const recent = (key) => (this.#failures.get(key) || []).filter((at) => at > now - this.withinMs);
    const mine = recent(address);
    const all = recent('*');
    const over = mine.length >= this.perAddress ? mine : all.length >= this.total ? all : null;
    return over ? over[over.length - (over === mine ? this.perAddress : this.total)] + this.withinMs - now : 0;
  }

  /** @param {string} address */
  failed(address) {
    const now = this.#now();
    for (const [key, times] of this.#failures)
      if (times.every((at) => at <= now - this.withinMs)) this.#failures.delete(key);
    for (const key of [address, '*']) {
      const kept = (this.#failures.get(key) || []).filter((at) => at > now - this.withinMs);
      this.#failures.set(key, [...kept, now]);
    }
  }

  /**
   * Signed in: the address's wrong tries are forgotten, and the try counted before it was checked is given back.
   * @param {string} address
   */
  succeeded(address) {
    this.#failures.delete(address);
    this.#failures.get('*')?.pop();
  }

  /**
   * How many more wrong tries from an address are let through before it waits: fewer where they run out in all.
   * @param {string} address
   */
  triesLeft(address) {
    const left = (key, most) => most - this.#recent(key).length;
    return Math.max(0, Math.min(left(address, this.perAddress), left('*', this.total)));
  }

  /**
   * Who waits now, and until when: '*' for every address.
   * @returns {{ address: string, until: number }[]}
   */
  paused() {
    return [...this.#failures.keys()]
      .map((address) => {
        const recent = this.#recent(address);
        const most = address === '*' ? this.total : this.perAddress;
        return { address, until: recent.length >= most ? recent[recent.length - most] + this.withinMs : 0 };
      })
      .filter(({ until }) => until > 0)
      .sort((a, b) => (a.address === '*' ? -1 : b.address === '*' ? 1 : a.until - b.until));
  }

  /** Every wrong try forgotten, as a new code starts its own over. */
  reset() {
    this.#failures.clear();
  }

  /** @param {string} key */
  #recent(key) {
    const now = this.#now();
    return (this.#failures.get(key) || []).filter((at) => at > now - this.withinMs);
  }
}
