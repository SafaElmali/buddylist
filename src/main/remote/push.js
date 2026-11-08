// Notifications on a phone, from what the Mac tells the user of a conversation (notifier.js): an agent needs them,
// finished, or ran into a problem. A device signed in that turned them on in the phone app has a subscription
// (devices.js), and each note goes to all of them through their browsers' push services (web-push.js). By default
// only while the user is away from this Mac, and saying only who and what kind: Settings can add what was said. A
// permission comes with Decline on a phone that may answer, which its service worker offers where the phone shows
// buttons on a notification (Android), and which declines it through /api/decline (see host.js).
import { REQUESTS } from '../../shared/ipc-channels.js';
import { allows } from './routes.js';
import { sendPush, subscriptionOf } from './web-push.js';

/**
 * What a note is about, as the Mac's own notes say (see Conversations): a request it waits on, its turn over, or
 * an error.
 * @typedef {'permission' | 'question' | 'plan' | 'finished' | 'error'} NoteKind
 */

/**
 * A note as the Mac shows it, with whose and what kind it is. `requestId`: the permission it is about, to decline.
 * @typedef {{ title: string, body: string, avatar: string, urgent?: boolean, kind?: NoteKind, name?: string,
 *   requestId?: string }} Note
 */

/**
 * What a phone is sent, which the phone app's service worker shows (src/renderer/phone/sw.js). `decline`: the
 * permission it may decline from the notification, where the phone may answer it.
 * @typedef {{ title: string, body: string, tag: string, url: string, badge: number,
 *   decline?: { contactId: string, requestId: string } }} PushNote
 */

/**
 * Each kind's notification: its title, what to do about it where the text would be, and whether it wakes a phone
 * that saves its battery.
 */
export const KINDS = Object.freeze({
  permission: { title: (name) => `${name} needs your permission`, hint: 'Open to allow or decline.', urgency: 'high' },
  question: { title: (name) => `${name} has a question`, hint: 'Open to answer.', urgency: 'high' },
  plan: { title: (name) => `${name} has a plan for you`, hint: 'Open to approve or decline.', urgency: 'high' },
  finished: { title: (name) => `${name} finished`, hint: 'Open to read the reply.', urgency: 'normal' },
  error: { title: (name) => `${name} ran into a problem`, hint: 'Open to see what happened.', urgency: 'normal' },
});

/** What a phone is sent when it asks for a test: that notifications reach it. */
export const TEST_NOTE = Object.freeze({
  title: 'This is a test',
  body: 'Notifications from buddylist reach this phone.',
  tag: 'buddylist',
  url: '/',
});

/** The first note a phone is sent, as it turns notifications on: that they work. */
export const WELCOME = Object.freeze({
  title: 'Notifications are on',
  body: 'buddylist tells you here when an agent needs you, finishes or runs into a problem.',
  tag: 'buddylist',
  url: '/',
});

/**
 * What a phone is sent of a note: who and what kind, and what was said only when Settings says so. Its tag keeps
 * one notification a conversation, the newest, and tapping it opens that conversation. A permission names itself to
 * decline, for a phone that may answer it: never to allow, as the note doesn't say what would be allowed.
 * @param {{ id: string, name: string }} contact
 * @param {Note} note
 * @param {{ text?: boolean, badge?: number, decline?: boolean }} [options]  `badge`: how many wait for the user.
 *   `decline`: the phone may answer
 * @returns {PushNote | null}  null for a note of no kind a phone is told of
 */
export function pushNote(contact, note, { text = false, badge = 0, decline = false } = {}) {
  const kind = note.kind && KINDS[note.kind];
  if (!kind) return null;
  return {
    title: kind.title(note.name || contact.name),
    body: (text && note.body) || kind.hint,
    tag: contact.id,
    url: `/#/c/${encodeURIComponent(contact.id)}`,
    badge,
    ...(decline &&
      note.kind === 'permission' &&
      note.requestId && { decline: { contactId: contact.id, requestId: note.requestId } }),
  };
}

/** Whether a phone may decline a permission: what its access lets it answer (see routes.js). */
const mayDecline = (access) => allows(access, REQUESTS.chatRespond, [null, null, { decision: 'deny' }]);

/**
 * Whether a note goes to the phones. With "Only when I'm away from this Mac", only then. Without it always, but for
 * the conversation the user is looking at on the Mac.
 * @param {{ awayOnly: boolean, away: boolean, focused: boolean }} now
 */
export const shouldPush = ({ awayOnly, away, focused }) => (awayOnly ? away : away || !focused);

const ok = (status) => status >= 200 && status < 300;

export class PhonePush {
  /**
   * @param {object} deps
   * @param {import('./devices.js').Devices} deps.devices
   * @param {() => import('./web-push.js').VapidKeys} deps.keys  the app's own, made the first time they are asked for
   * @param {() => { text: boolean, awayOnly: boolean }} deps.settings  as Settings > Remote access has them
   * @param {() => boolean} [deps.away]  the user is away from this Mac: it is locked, or unused for a while
   * @param {() => number} [deps.waiting]  how many wait for the user, for the number on the phone app's icon
   * @param {() => void} [deps.onChange]  a device's notifications went off by themselves, or began or stopped failing
   * @param {string} [deps.testOrigin]  a fake push service on this computer, for a check run (see web-push.js)
   * @param {string} [deps.noun]  what this computer is called, as the phone says it (see hostNoun)
   * @param {typeof sendPush} [deps.send]
   * @param {Pick<Console, 'warn'>} [deps.log]
   * @param {() => number} [deps.now]
   */
  constructor({
    devices,
    keys,
    settings,
    away = () => false,
    waiting = () => 0,
    onChange = () => {},
    testOrigin = '',
    noun = 'computer',
    send = sendPush,
    log = console,
    now = Date.now,
  }) {
    this.devices = devices;
    this.keys = keys;
    this.settings = settings;
    this.away = away;
    this.waiting = waiting;
    this.onChange = onChange;
    this.testOrigin = testOrigin;
    this.noun = noun;
    this.send = send;
    this.log = log;
    this.now = now;
  }

  /**
   * The last note a device's push service didn't take, since the last it did: by device id, until the app quits.
   * @type {Map<string, { at: number, reason: string }>}
   */
  #failures = new Map();

  /** The key a browser subscribes with: the app's public key. */
  publicKey() {
    return this.keys().publicKey;
  }

  /** @param {string} deviceId */
  isOn(deviceId) {
    return this.devices.subscribed().some((device) => device.id === deviceId);
  }

  /**
   * Where a device's notifications go, as its browser subscribed: '' without. The phone app holds it up to its own
   * subscription, to find one this computer has and the browser has no more, or the other way round.
   * @param {string} deviceId
   */
  endpoint(deviceId) {
    return this.devices.subscribed().find((device) => device.id === deviceId)?.push.endpoint ?? '';
  }

  /**
   * The last note a device's push service didn't take, and why, since the last it did; null for none.
   * @param {string} deviceId
   */
  failure(deviceId) {
    return this.#failures.get(deviceId) ?? null;
  }

  /**
   * A device turned notifications on: its subscription is kept, and a first note says they work. When it isn't a
   * subscription to a push service, or the push service won't take the note, they stay off and this says why.
   * @param {string} deviceId
   * @param {unknown} value  what the phone app posted: PushSubscription.toJSON()
   * @param {{ welcome?: boolean }} [options]  without the first note: the browser only renewed its subscription
   */
  async subscribe(deviceId, value, { welcome = true } = {}) {
    const push = subscriptionOf(value, { testOrigin: this.testOrigin });
    if (!push) throw new Error('That is not a subscription to a push service buddylist sends to.');
    if (!this.devices.setPush(deviceId, push)) throw new Error('Sign in again first.');
    if (!welcome) return;
    let answer;
    try {
      answer = await this.#send(deviceId, push, { ...WELCOME, badge: this.waiting() }, 'normal');
    } catch (error) {
      this.#forget(deviceId, push);
      throw new Error(`Your ${this.noun} couldn’t reach the push service: ${error.message}`, { cause: error });
    }
    if (!ok(answer.status)) {
      this.#forget(deviceId, push);
      throw new Error(`The push service refused the first notification (${answer.status}). Try again.`);
    }
  }

  /** @param {string} deviceId */
  unsubscribe(deviceId) {
    this.devices.setPush(deviceId, null);
    this.#failed(deviceId, null);
  }

  /**
   * Sends a device a note to see that notifications reach it. Throws why not: they're off, or the push service
   * didn't take it.
   * @param {string} deviceId
   */
  async test(deviceId) {
    const device = this.devices.subscribed().find((one) => one.id === deviceId);
    if (!device?.push) throw new Error('Turn notifications on first.');
    const { status } = await this.#tried(deviceId, device.push, { ...TEST_NOTE, badge: this.waiting() }, 'high');
    if (status === 404 || status === 410)
      throw new Error('The push service no longer has this phone’s subscription. Turn notifications on again.');
    const failure = this.failure(deviceId);
    if (failure) throw new Error(failure.reason);
  }

  /**
   * A note the Mac shows the user, for every phone with notifications on, when it should go (see shouldPush).
   * @param {{ id: string, name: string }} contact
   * @param {Note} note
   * @param {{ focused?: boolean }} [now]  whether the user is looking at that conversation on the Mac
   */
  notify(contact, note, { focused = false } = {}) {
    const phones = this.devices.subscribed();
    if (!phones.length) return;
    const { text, awayOnly } = this.settings();
    if (!shouldPush({ awayOnly, away: this.away(), focused })) return;
    const badge = this.waiting();
    if (!pushNote(contact, note)) return;
    const { urgency } = KINDS[/** @type {NoteKind} */ (note.kind)];
    for (const { id, name, push, access } of phones)
      this.#tried(id, push, pushNote(contact, note, { text, badge, decline: mayDecline(access) }), urgency).then(
        ({ status, text: said, error }) => {
          if (error) this.log.warn(`Remote access: a notification for ${name} wasn't sent:`, error.message);
          else if (!ok(status) && status !== 404 && status !== 410)
            this.log.warn(`Remote access: the push service refused a notification for ${name} (${status}).`, said);
        }
      );
  }

  /**
   * Sends one note, keeping whether it went as the device's last failure: never throws, an error is in the answer.
   * @returns {Promise<{ status: number, text: string, error?: Error }>}
   */
  async #tried(deviceId, push, payload, urgency) {
    try {
      const answer = await this.#send(deviceId, push, payload, urgency);
      const gone = answer.status === 404 || answer.status === 410;
      this.#failed(deviceId, ok(answer.status) || gone ? null : `The push service refused it (${answer.status}).`);
      return answer;
    } catch (error) {
      const failed = error instanceof Error ? error : new Error(String(error));
      this.#failed(deviceId, `It couldn’t be sent: ${failed.message.replace(/[\s.]+$/, '')}.`);
      return { status: 0, text: '', error: failed };
    }
  }

  /** Keeps a device's last failure, or forgets it for null, telling Settings where that changes what it shows. */
  #failed(deviceId, reason) {
    const before = this.#failures.get(deviceId);
    if (reason) this.#failures.set(deviceId, { at: this.now(), reason });
    else this.#failures.delete(deviceId);
    if (before?.reason !== (reason || undefined)) this.onChange();
  }

  /**
   * Sends one note. A subscription its push service no longer has (404, 410) is forgotten: the browser unsubscribed,
   * or the app was removed from the phone.
   */
  async #send(deviceId, push, payload, urgency) {
    const answer = await this.send(push, payload, { vapid: this.keys(), urgency, testOrigin: this.testOrigin });
    if (answer.status === 404 || answer.status === 410) this.#forget(deviceId, push);
    return answer;
  }

  /** Forgets a device's subscription, unless it has a new one by now. */
  #forget(deviceId, push) {
    const now = this.devices.subscribed().find((device) => device.id === deviceId);
    if (now?.push.endpoint !== push.endpoint) return;
    this.devices.setPush(deviceId, null);
    this.onChange();
  }
}
