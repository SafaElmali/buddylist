// The phones and browsers signed in to the app from elsewhere (see host.js): each is a device, with a random
// token in a cookie that page scripts can't read. Only a hash of the token is kept, in remote.json, so a
// device stays signed in when the app restarts, until it is signed out in Settings or goes unused for a while.
// One that turned notifications on keeps its push subscription here too, and loses it as it is signed out. Each has
// what it may do: everything, answer and stop, or only look (see routes.js), chosen as it paired.
import crypto from 'node:crypto';
import { accessOf } from '../../shared/remote-access.js';

/** How long a device stays signed in without being used. Each use starts it again. */
export const DEVICE_MS = 30 * 24 * 60 * 60 * 1000;
/** How often being used is written down: every request is, but not every one is saved. */
const SAVE_EVERY_MS = 60 * 1000;

/**
 * How a device reaches the app: through Tailscale Serve on this computer, or from this computer itself.
 * @typedef {'tailscale' | 'local'} Via
 */

/**
 * A device as remote.json keeps it. `push`: where its notifications go, once it turned them on (see web-push.js).
 * `access`: what it may do from the phone app.
 * @typedef {{ id: string, tokenHash: string, name: string, via: Via, address: string, login: string,
 *   access: import('../../shared/remote-access.js').AccessLevel, createdAt: number, lastSeenAt: number,
 *   push?: import('./web-push.js').Subscription }} Device
 */

/**
 * A device as Settings lists it: without its token's hash or its subscription, only whether it has one.
 * @typedef {Omit<Device, 'tokenHash' | 'push'> & { expiresAt: number, notifications: boolean }} DeviceView
 */

/** Where a request came from, as the device list says it. */
export const placeOf = ({ via, address, login }) => ({
  via: via === 'tailscale' ? 'tailscale' : 'local',
  address: String(address || '').slice(0, 64),
  login: String(login || '').slice(0, 128),
});

export class Devices {
  /** @type {Map<string, Device>} token hash -> device */
  #devices = new Map();
  #save;
  #now;
  #lasts;
  #savedAt = 0;

  /**
   * @param {object} [options]
   * @param {Device[]} [options.devices]  as remote.json had them: one with a level there isn't, or none, may only read
   * @param {(devices: Device[]) => void} [options.save]  keeps them, as they are now
   * @param {() => number} [options.now]
   * @param {number} [options.lasts]
   */
  constructor({ devices = [], save = () => {}, now = Date.now, lasts = DEVICE_MS } = {}) {
    this.#save = save;
    this.#now = now;
    this.#lasts = lasts;
    for (const device of Array.isArray(devices) ? devices : [])
      if (typeof device?.tokenHash === 'string' && typeof device.id === 'string')
        this.#devices.set(device.tokenHash, {
          ...device,
          ...placeOf(device),
          name: String(device.name || 'A device'),
          access: accessOf(device.access),
        });
    this.#forgetExpired();
  }

  /**
   * Signs a new device in. What it is called and where it came from are only for the list in Settings. It may do
   * everything unless it paired with a code for less (see pairing.js).
   * @param {{ name: string, via: Via, address?: string, login?: string,
   *   access?: import('../../shared/remote-access.js').AccessLevel }} device
   * @returns {{ token: string, device: DeviceView }}
   */
  start({ name, access = 'full', ...place }) {
    this.#forgetExpired();
    const token = crypto.randomBytes(32).toString('base64url');
    const now = this.#now();
    const device = {
      id: crypto.randomBytes(9).toString('base64url'),
      tokenHash: digest(token),
      name: String(name || 'A device').slice(0, 80),
      ...placeOf(place),
      access: accessOf(access),
      createdAt: now,
      lastSeenAt: now,
    };
    this.#devices.set(device.tokenHash, device);
    this.#write();
    return { token, device: this.#view(device) };
  }

  /** @param {unknown} token */
  valid(token) {
    return this.remainingMs(token) > 0;
  }

  /** Time left before a device has to sign in again, unless it is used before then. */
  remainingMs(token) {
    const device = this.#of(token);
    return device ? device.lastSeenAt + this.#lasts - this.#now() : 0;
  }

  /** The device a token is, or null. @param {unknown} token @returns {DeviceView | null} */
  find(token) {
    const device = this.#of(token);
    return device ? this.#view(device) : null;
  }

  /**
   * A device was used just now, from where it says: it stays signed in for another while. Written down
   * at once when it came from somewhere else, and otherwise once in a while.
   * @param {unknown} token
   * @param {{ via: Via, address?: string, login?: string }} [place]
   */
  seen(token, place) {
    const device = this.#of(token);
    if (!device) return;
    const now = this.#now();
    const moved =
      place &&
      Object.entries(placeOf(place)).some(([key, value]) => device[/** @type {keyof Device} */ (key)] !== value);
    device.lastSeenAt = now;
    if (place) Object.assign(device, placeOf(place));
    if (moved || now - this.#savedAt >= SAVE_EVERY_MS) this.#write();
  }

  /** Signs out the device a token is. @param {unknown} token */
  end(token) {
    if (typeof token === 'string' && this.#devices.delete(digest(token))) this.#write();
  }

  /** Signs out a device by its id. @returns {boolean} whether there was one */
  remove(id) {
    for (const [key, device] of this.#devices)
      if (device.id === id) {
        this.#devices.delete(key);
        this.#write();
        return true;
      }
    return false;
  }

  /**
   * What a device may do from now on, as Settings says.
   * @param {string} id
   * @param {unknown} access
   * @returns {boolean} whether there is such a device, and such a level
   */
  setAccess(id, access) {
    const device = [...this.#devices.values()].find((one) => one.id === id);
    if (!device || accessOf(access) !== access) return false;
    device.access = /** @type {import('../../shared/remote-access.js').AccessLevel} */ (access);
    this.#write();
    return true;
  }

  /**
   * Where a device's notifications go, or null to stop them. A browser has one subscription: a device signed in
   * again with it takes it from the one it was before.
   * @param {string} id
   * @param {import('./web-push.js').Subscription | null} push
   * @returns {boolean} whether there is such a device
   */
  setPush(id, push) {
    const device = [...this.#devices.values()].find((one) => one.id === id);
    if (!device) return false;
    for (const other of this.#devices.values())
      if (other !== device && push && other.push?.endpoint === push.endpoint) delete other.push;
    if (push) device.push = push;
    else delete device.push;
    this.#write();
    return true;
  }

  /**
   * The devices signed in that have notifications on, with where each goes, and what each may do.
   * @returns {{ id: string, name: string, push: import('./web-push.js').Subscription,
   *   access: import('../../shared/remote-access.js').AccessLevel }[]}
   */
  subscribed() {
    this.#forgetExpired();
    return [...this.#devices.values()]
      .filter((device) => device.push)
      .map(({ id, name, push, access }) => ({
        id,
        name,
        push: /** @type {import('./web-push.js').Subscription} */ (push),
        access,
      }));
  }

  /** Signs out every device. */
  clear() {
    if (!this.#devices.size) return;
    this.#devices.clear();
    this.#write();
  }

  /** @returns {DeviceView[]} the devices signed in, the one used last first */
  list() {
    this.#forgetExpired();
    return [...this.#devices.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt).map((device) => this.#view(device));
  }

  /** @param {unknown} token */
  #of(token) {
    if (typeof token !== 'string' || !token) return null;
    const device = this.#devices.get(digest(token));
    if (!device) return null;
    if (device.lastSeenAt + this.#lasts > this.#now()) return device;
    this.#devices.delete(device.tokenHash);
    this.#write();
    return null;
  }

  #forgetExpired() {
    const before = this.#devices.size;
    for (const [key, device] of this.#devices)
      if (device.lastSeenAt + this.#lasts <= this.#now()) this.#devices.delete(key);
    if (this.#devices.size !== before) this.#write();
  }

  /** @param {Device} device @returns {DeviceView} */
  #view({ tokenHash: _hash, push, ...device }) {
    return { ...device, notifications: Boolean(push), expiresAt: device.lastSeenAt + this.#lasts };
  }

  #write() {
    this.#savedAt = this.#now();
    this.#save([...this.#devices.values()].map((device) => ({ ...device })));
  }
}

const digest = (token) => crypto.createHash('sha256').update(token).digest('base64');

/**
 * What a device is called in the list, from what its browser says it is: "iPhone · Safari". One added to the
 * home screen is a device of its own, with storage of its own, and says so.
 * @param {string | undefined} userAgent
 * @param {{ installed?: boolean }} [options]
 */
export function deviceName(userAgent, { installed = false } = {}) {
  const agent = String(userAgent || '');
  const system =
    [
      [/iPhone/, 'iPhone'],
      [/iPad/, 'iPad'],
      [/Android/, 'Android'],
      [/Macintosh|Mac OS X/, 'Mac'],
      [/Windows/, 'Windows'],
      [/CrOS/, 'Chromebook'],
      [/Linux/, 'Linux'],
    ].find(([pattern]) => pattern.test(agent))?.[1] || 'A device';
  // Every browser on an iPhone says Safari, and Chrome is in Edge's and Opera's.
  const browser =
    [
      [/EdgA?\/|EdgiOS\//, 'Edge'],
      [/OPR\/|OPiOS\//, 'Opera'],
      [/Firefox\/|FxiOS\//, 'Firefox'],
      [/CriOS\/|Chrome\//, 'Chrome'],
      [/Safari\//, 'Safari'],
    ].find(([pattern]) => pattern.test(agent))?.[1] || '';
  return [system, installed ? 'Home Screen' : browser].filter(Boolean).join(' · ');
}
