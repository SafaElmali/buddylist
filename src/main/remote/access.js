// Settings > Remote access: using the app from a phone, anywhere, through Tailscale. This turns the host on and
// off as Settings says (host.js), keeps the password and the devices signed in (remote.json, devices.js), shows a
// code to pair a phone with (pairing.js), and keeps an eye on Tailscale (tailscale.js): it says the address a
// phone opens, sets Serve up when asked to, and stops everything if Funnel puts the app on the public internet.
// While it is on, what the Mac tells the user goes to the phones that turned notifications on too (push.js).
import os from 'node:os';
import { ACCESS_LEVELS, hostNoun, shortName } from '../../shared/remote-access.js';
import { Attempts, hashPassword, readRemote, writeRemote } from './auth.js';
import { Devices } from './devices.js';
import { DEFAULT_PORT, RemoteHost } from './host.js';
import { PairingCode } from './pairing.js';
import { PhonePush } from './push.js';
import { commandLine, serveArgs, Tailscale } from './tailscale.js';
import { vapidKeys } from './web-push.js';

/** How often Tailscale is looked at while remote access is on: Funnel turned on is stopped within this. */
export const CHECK_EVERY_MS = 60 * 1000;
/** A request that says it came through Funnel has Tailscale asked whether it is on: no more often than this. */
export const FUNNEL_LOOK_MS = 10 * 1000;

/**
 * The port the app answers on: 6767, or another for a test run (BUDDYLIST_REMOTE_PORT, 0 for any free one).
 * @param {NodeJS.ProcessEnv} env
 */
export function remotePort(env) {
  const port = Number(env.BUDDYLIST_REMOTE_PORT ?? DEFAULT_PORT);
  return Number.isInteger(port) && port >= 0 && port < 65536 ? port : DEFAULT_PORT;
}

/**
 * A level Settings asked for, as one there is: anything else is a mistake, said as such.
 * @param {unknown} access
 */
function levelOf(access) {
  if (!ACCESS_LEVELS.includes(/** @type {any} */ (access)))
    throw new Error(`${String(access)} is not a level of access.`);
  return /** @type {import('../../shared/remote-access.js').AccessLevel} */ (access);
}

/** Why it won't run beside Funnel, and the command that turns Funnel off for it. */
const funnelOff = (httpsPort) =>
  `Tailscale Funnel puts buddylist on the public internet. Turn it off with \`tailscale funnel --https=${httpsPort} off\`, then turn remote access on again.`;

/**
 * What Settings shows.
 * @typedef {{
 *   enabled: boolean, running: boolean, error: string, keepAwake: boolean, keepAwakeAsked: boolean,
 *   hasPassword: boolean, setUp: boolean,
 *   pushText: boolean, pushAwayOnly: boolean, port: number, local: string, address: string,
 *   tailscale: import('./tailscale.js').TailscaleState & { command: string, busy: boolean, output: string, checked: boolean },
 *   pairing: { active: boolean, expiresAt: number, ended: string },
 *   signInPause: { address: string, until: number }[],
 *   devices: (import('./devices.js').DeviceView & { connected: boolean,
 *     pushFailure: { at: number, reason: string } | null })[],
 * }} RemoteView
 *   `signInPause`: where the password waits after too many wrong ones, and until when: '*' for every device.
 *   `address`: what a phone opens, once Tailscale Serve passes it on; '' until then. `local`: this computer's own
 */

export class RemoteAccess {
  /** @type {RemoteHost | null} */
  #host = null;
  /** @type {import('./auth.js').RemoteFile} */
  #file;
  #devices;
  #pairing;
  #push;
  #attempts = new Attempts();
  /** Wrong codes, counted apart from passwords: a new code starts them over. */
  #codeAttempts = new Attempts();
  /** @type {import('./tailscale.js').TailscaleState & { checked: boolean }} */
  #tailscale = {
    state: 'missing',
    reason: '',
    hostname: '',
    login: '',
    phones: [],
    certificates: false,
    serving: null,
    funnel: false,
    httpsPort: 443,
    taken: [],
    serveReason: '',
    checked: false,
  };
  /** What the last Serve command printed. */
  #output = '';
  /** Why it isn't running though it is on, or why it went off by itself. */
  #error = '';
  #requests = new Map();
  /** @type {ReturnType<typeof setInterval> | null} */
  #checking = null;
  #awake = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} Settings is told again when a pause on the password ends. */
  #pauseEnds;
  /** When a request that said it came through Funnel last had Tailscale asked. */
  #funnelLookedAt = -Infinity;

  /**
   * @param {object} deps
   * @param {string} deps.userData  where remote.json is
   * @param {number} deps.port
   * @param {Omit<ConstructorParameters<typeof RemoteHost>[0], 'passwordHash' | 'devices' | 'pairing' | 'port'>} deps.host
   *   what the host is made with, beside what this keeps
   * @param {Tailscale} [deps.tailscale]
   * @param {{ start: () => void, stop: () => void }} [deps.keepAwake]  stops the computer sleeping by itself
   * @param {(view: RemoteView) => void} [deps.onChange]  for Settings, in every window
   * @param {(device: import('./devices.js').DeviceView) => void} [deps.onSignIn]  a new device was signed in
   * @param {{ read?: typeof readRemote, write?: typeof writeRemote }} [deps.storage]
   * @param {Pick<ConstructorParameters<typeof PhonePush>[0], 'away' | 'waiting' | 'testOrigin' | 'send'>} [deps.push]
   *   whether the user is away from this Mac, and how many wait for them, for phones' notifications
   * @param {NodeJS.Platform} [deps.platform]  what this computer is, as the phone app names it: a Mac, a PC
   * @param {string} [deps.computerName]  its own name, for where it has none on the tailnet
   * @param {() => number} [deps.now]
   */
  constructor({
    userData,
    port,
    host,
    tailscale = new Tailscale(),
    keepAwake = { start() {}, stop() {} },
    onChange = () => {},
    onSignIn = () => {},
    storage = {},
    push = {},
    platform = process.platform,
    computerName = os.hostname(),
    now = Date.now,
  }) {
    this.userData = userData;
    this.port = port;
    this.hostDeps = host;
    this.tailscale = tailscale;
    this.keepAwake = keepAwake;
    this.onChange = onChange;
    this.onSignIn = onSignIn;
    this.read = storage.read ?? readRemote;
    this.write = storage.write ?? writeRemote;
    this.log = host.log ?? console;
    this.platform = platform;
    this.computerName = computerName;
    this.now = now;
    this.#file = this.read(userData);
    this.#devices = new Devices({
      devices: this.#file.devices,
      save: (devices) => this.#save({ devices }),
      now,
    });
    this.#pairing = new PairingCode({ now, onChange: () => this.#changed() });
    this.#push = new PhonePush({
      ...push,
      devices: this.#devices,
      keys: () => this.#file.vapid ?? this.#save({ vapid: vapidKeys() }).vapid,
      settings: () => ({ text: this.#file.pushText, awayOnly: this.#file.pushAwayOnly }),
      noun: hostNoun(platform),
      onChange: () => this.#changed(),
      log: this.log,
    });
  }

  /**
   * Starts, once the app's handlers are there, if it was on when the app last quit.
   * @param {Map<string, Function>} requests  the app's handlers, by channel (see ipc.js)
   */
  async begin(requests) {
    this.#requests = requests;
    if (!this.#file.enabled) return;
    await this.#start().catch((error) => {
      this.#error = error.message;
      this.log.error('Remote access could not start:', error.message);
    });
    this.#changed();
  }

  /** @returns {RemoteView} */
  view() {
    const connected = this.#host?.connected() ?? new Set();
    const { serving } = this.#tailscale;
    return {
      enabled: this.#file.enabled,
      running: Boolean(this.#host),
      error: this.#error,
      keepAwake: this.#file.keepAwake,
      keepAwakeAsked: this.#file.keepAwakeAsked,
      hasPassword: Boolean(this.#file.password),
      setUp: this.#file.setUp === true,
      pushText: this.#file.pushText,
      pushAwayOnly: this.#file.pushAwayOnly,
      port: this.#host?.port ?? this.port,
      local: `http://127.0.0.1:${this.#host?.port ?? this.port}`,
      address: serving && !this.#tailscale.funnel ? serving.url : '',
      tailscale: {
        ...this.#tailscale,
        command: commandLine(serveArgs(this.port, this.#tailscale.httpsPort)),
        busy: this.tailscale.busy(),
        output: this.#output,
      },
      pairing: this.#pairing.state(),
      signInPause: this.#attempts.paused(),
      devices: this.#devices.list().map((device) => ({
        ...device,
        connected: connected.has(device.id),
        pushFailure: this.#push.failure(device.id),
      })),
    };
  }

  /**
   * Turns remote access on or off, keeping the computer awake meanwhile where the user said so, and what phones'
   * notifications say and when. On needs a password, and Tailscale without Funnel; a port another program has is
   * said as the reason it isn't running.
   * @param {{ enabled?: unknown, keepAwake?: unknown, pushText?: unknown, pushAwayOnly?: unknown }} patch
   */
  async update(patch) {
    if (typeof patch?.keepAwake === 'boolean') this.#save({ keepAwake: patch.keepAwake, keepAwakeAsked: true });
    if (typeof patch?.pushText === 'boolean') this.#save({ pushText: patch.pushText });
    if (typeof patch?.pushAwayOnly === 'boolean') this.#save({ pushAwayOnly: patch.pushAwayOnly });
    // On again where it is on but isn't running, as with a port that was in use: it tries again.
    if (patch?.enabled === true && !this.#host) {
      if (!this.#file.password) throw new Error('Set a password first.');
      await this.#look();
      if (this.#tailscale.funnel) throw new Error(funnelOff(this.#tailscale.httpsPort));
      this.#save({ enabled: true });
      this.#error = '';
      await this.#start().catch((error) => {
        this.#error = error.message;
      });
    } else if (patch?.enabled === false) {
      this.#save({ enabled: false });
      this.#error = '';
      this.#stop();
    }
    this.#stayAwake();
    return this.#changed();
  }

  /**
   * Sets the password a browser signs in with where it can't scan the code. Every device signed in is signed
   * out with it, unless asked not to.
   * @param {unknown} password
   * @param {{ signOutAll?: unknown }} [options]
   */
  async setPassword(password, { signOutAll = true } = {}) {
    this.#save({ password: await hashPassword(/** @type {string} */ (password)) });
    if (signOutAll !== false) this.signOut();
    return this.#changed();
  }

  /**
   * A new code to pair a phone with, in place of the one there was, and the address its QR code opens. Until
   * Tailscale Serve gives it an https address there is no QR code: a phone can't open this Mac's own address, and
   * the code is only for a browser on this Mac, typed in. The phone it pairs may do what `access` says: everything,
   * unless Settings chose less.
   * @param {{ access?: unknown }} [options]
   */
  pair({ access = 'full' } = {}) {
    if (!this.#host) throw new Error('Turn remote access on first.');
    const level = levelOf(access);
    const code = this.#pairing.issue({ access: level });
    // A phone that typed the last one wrong too often pairs with this one at once.
    this.#codeAttempts.reset();
    const { address } = this.#changed();
    return { ...code, access: level, url: address ? `${address}/pair#${code.code}` : '' };
  }

  /**
   * What a device may do from now on, as Settings says: saved, and its pages told at once (see host.js). A device
   * there isn't changes nothing.
   * @param {string} id
   * @param {unknown} access
   */
  setAccess(id, access) {
    const level = levelOf(access);
    if (!this.#devices.setAccess(String(id), level)) return this.view();
    this.log.log(`Remote access: a device is set to ${level} access.`);
    this.#host?.accessChanged(String(id));
    return this.#changed();
  }

  /** Stops the code Settings shows from working. */
  cancelPairing() {
    this.#pairing.cancel();
    return this.#changed();
  }

  /**
   * Signs a device out, and closes its pages: every device, without an id, and the code shown stops working too,
   * as signing out all is what is done about a phone that shouldn't be signed in.
   * @param {string} [id]
   */
  signOut(id) {
    if (id === undefined) {
      this.#devices.clear();
      this.#pairing.cancel();
    } else if (!this.#devices.remove(String(id))) return this.view();
    this.#host?.signedOut(id);
    return this.#changed();
  }

  /**
   * What Settings asks of Tailscale: to look again, to set Serve up with its one command, to stop setting it up,
   * or to stop Serve passing its address on to the app.
   * @param {'check' | 'serve' | 'cancel' | 'stop'} what
   */
  async tailscaleDo(what) {
    if (what === 'stop' && this.#tailscale.serving) {
      this.#output = (await this.tailscale.stopServing(this.#tailscale.serving.httpsPort)).output;
    } else if (what === 'serve' && this.#tailscale.httpsPort) {
      // With every port it could use served for something else, there is nothing to run: Settings says why.
      this.#output = '';
      const asked = this.tailscale.serve(this.port, this.#tailscale.httpsPort, (output) => {
        this.#output = output;
        this.#changed();
      });
      this.#changed();
      const { output } = await asked;
      this.#output = output;
    } else if (what === 'cancel') {
      this.tailscale.cancel();
    }
    await this.#look();
    return this.#changed();
  }

  /** Stops answering: the app quits. */
  close() {
    clearTimeout(this.#pauseEnds);
    this.#stop();
    this.tailscale.cancel();
  }

  // What the windows and Conversations tell, passed on to the pages while the host is on (see host.js).

  broadcast(channel, payload) {
    this.#host?.broadcast(channel, payload);
  }

  userMessage(contactId, entry, sender) {
    this.#host?.userMessage(contactId, entry, sender);
  }

  /**
   * What the Mac tells the user of a conversation (notifier.js), for the phones with notifications on.
   * @param {{ id: string, name: string }} contact
   * @param {import('./push.js').Note} note
   * @param {{ focused?: boolean }} [now]
   */
  notify(contact, note, now) {
    if (this.#host) this.#push.notify(contact, note, now);
  }

  /** @param {import('../windows/chat-windows.js').ChatWindows} chats */
  alongside(chats) {
    return {
      send: (contactId, event) => {
        chats.send(contactId, event);
        this.#host?.sessionEvent(contactId, event);
      },
      isFocused: (contactId) => chats.isFocused(contactId),
    };
  }

  async #start() {
    if (this.#host) return;
    await this.#look();
    // However it is started, as on again when the app opens: never beside Funnel.
    if (this.#tailscale.funnel) throw new Error(funnelOff(this.#tailscale.httpsPort));
    const host = new RemoteHost({
      ...this.hostDeps,
      passwordHash: () => this.#file.password,
      devices: this.#devices,
      pairing: this.#pairing,
      push: this.#push,
      attempts: this.#attempts,
      codeAttempts: this.#codeAttempts,
      port: this.port,
      hostnames: () => (this.#tailscale.hostname ? [this.#tailscale.hostname] : []),
      computer: () => ({
        name: shortName(this.#tailscale.hostname) || shortName(this.computerName),
        noun: hostNoun(this.platform),
      }),
      onSignIn: (device) => {
        // The first phone through Tailscale: setting it up is done, and stays done though devices sign out.
        if (device.via === 'tailscale' && !this.#file.setUp) this.#save({ setUp: true });
        this.onSignIn(device);
        this.#changed();
      },
      onDevices: () => this.#changed(),
      onAttempt: () => {
        this.#changed();
        this.#tellWhenPauseEnds();
      },
      onFunnel: () => this.#funnelSaid(),
    });
    // The handlers as they are when a request comes, not when it started: turned on before the app handed them over
    // (see begin), it would refuse everything until a restart.
    await host.start({ get: (channel) => this.#requests.get(channel) });
    this.#host = host;
    this.#stayAwake();
    // Funnel turned on later, and a new name, are seen within a minute.
    this.#checking = setInterval(() => this.#look().then(() => this.#changed()), CHECK_EVERY_MS);
    this.#checking.unref?.();
  }

  #stop() {
    clearInterval(this.#checking ?? undefined);
    this.#checking = null;
    this.#pairing.cancel();
    this.#host?.close();
    this.#host = null;
    this.#stayAwake();
  }

  /** Reads how Tailscale stands. Funnel found while the host is on turns it off. */
  async #look() {
    const state = await this.tailscale.check(this.port).catch(() => null);
    if (state) this.#tailscale = { ...state, checked: true };
    if (this.#tailscale.funnel && this.#host) this.#funnelFound();
  }

  /**
   * A request said it came through Funnel. Anyone who reaches the app can say so: it was refused, and Tailscale is
   * asked whether Funnel is on, which stops everything only where it is (see #look). Asked once in a while at most.
   */
  #funnelSaid() {
    if (this.now() - this.#funnelLookedAt < FUNNEL_LOOK_MS) return;
    this.#funnelLookedAt = this.now();
    this.#look().then(() => this.#changed());
  }

  /** Funnel: anyone on the internet could reach the sign-in page. Everything stops, and every device signs in again. */
  #funnelFound() {
    if (!this.#host) return;
    this.log.warn('Remote access: Tailscale Funnel exposes it to the public internet. Turning it off.');
    this.#save({ enabled: false });
    this.#stop();
    this.#devices.clear();
    this.#error = funnelOff(this.#tailscale.serving?.httpsPort ?? 443);
    this.#changed();
  }

  /** Settings says the password waits, until when: it is told again once the first pause is over. */
  #tellWhenPauseEnds() {
    clearTimeout(this.#pauseEnds);
    const next = Math.min(...this.#attempts.paused().map(({ until }) => until));
    if (!Number.isFinite(next)) return;
    this.#pauseEnds = setTimeout(
      () => {
        this.#changed();
        this.#tellWhenPauseEnds();
      },
      Math.max(0, next - Date.now()) + 50
    );
    this.#pauseEnds.unref?.();
  }

  #stayAwake() {
    const awake = Boolean(this.#host) && this.#file.keepAwake;
    if (awake === this.#awake) return;
    this.#awake = awake;
    if (awake) this.keepAwake.start();
    else this.keepAwake.stop();
  }

  /** @param {Partial<import('./auth.js').RemoteFile>} patch */
  #save(patch) {
    this.#file = { ...this.#file, ...patch };
    this.write(this.userData, this.#file);
    return this.#file;
  }

  #changed() {
    const view = this.view();
    this.onChange(view);
    return view;
  }
}
