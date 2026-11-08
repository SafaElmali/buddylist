// Pairing a phone: Settings shows a code, as a QR code and typed out, and a phone that has it is signed in as a
// new device (see host.js). It is shown only on this computer, works once, and only for a few minutes: one that
// is guessed at too often stops working, and Settings offers a new one. A code pairs a phone with what Settings
// chose it may do (see routes.js).
import crypto from 'node:crypto';
import { accessOf } from '../../shared/remote-access.js';

/** How long a code works for. */
export const CODE_MS = 5 * 60 * 1000;
/** How many wrong codes cancel the one there is. */
export const WRONG_TRIES = 5;
/** Crockford's base32: no I, L, O or U, so nothing typed is mistaken for something else. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** 8 of them: 40 bits, with at most WRONG_TRIES guesses at each code. */
const LENGTH = 8;

/** What was typed, as a code: in capitals, without spaces or dashes, and the letters taken for digits as digits. */
export const normalCode = (typed) =>
  String(typed ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .slice(0, 64);

/** "K7QM29PX" -> "K7QM-29PX" */
export const shownCode = (code) => `${code.slice(0, 4)}-${code.slice(4)}`;

/**
 * Why there is no code: none was asked for, it was used, guessed at too often, or ran out.
 * @typedef {'' | 'used' | 'wrong' | 'expired'} Ended
 */

/**
 * Why a code typed or scanned didn't pair: not the one there is, or there is none since it was used, ran out, or was
 * cancelled (in Settings, after too many wrong ones, or never shown).
 * @typedef {'wrong' | 'used' | 'expired' | 'cancelled'} Refused
 */

export class PairingCode {
  #code = '';
  #expiresAt = 0;
  #wrong = 0;
  /** @type {Ended} */
  #ended = '';
  /** @type {import('../../shared/remote-access.js').AccessLevel} */
  #access = 'full';
  #now;
  #onChange;

  /** @param {{ now?: () => number, onChange?: () => void }} [options]  onChange: one stopped working by itself */
  constructor({ now = Date.now, onChange = () => {} } = {}) {
    this.#now = now;
    this.#onChange = onChange;
  }

  /**
   * A new code, in place of the one there was, for a phone that may do everything unless asked for less.
   * @param {{ access?: import('../../shared/remote-access.js').AccessLevel }} [options]
   */
  issue({ access = 'full' } = {}) {
    const bytes = crypto.randomBytes(LENGTH);
    this.#code = [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join('');
    this.#expiresAt = this.#now() + CODE_MS;
    this.#wrong = 0;
    this.#ended = '';
    this.#access = accessOf(access);
    return { code: this.#code, shown: shownCode(this.#code), expiresAt: this.#expiresAt };
  }

  /** What a phone paired with the code there is may do, or with the last one: it is still said once it is used. */
  access() {
    return this.#access;
  }

  /**
   * Whether a code typed or scanned is the one there is. Right, it is used up; wrong too often, it is cancelled.
   * @returns {'paired' | Refused}
   */
  redeem(typed) {
    if (!this.#active()) return this.#ended === 'used' || this.#ended === 'expired' ? this.#ended : 'cancelled';
    const given = Buffer.from(normalCode(typed));
    const expected = Buffer.from(this.#code);
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) {
      this.#end('used');
      return 'paired';
    }
    this.#wrong += 1;
    if (this.#wrong >= WRONG_TRIES) {
      this.#end('wrong');
      this.#onChange();
    }
    return 'wrong';
  }

  cancel() {
    if (this.#code) this.#end('');
  }

  /** How many more wrong codes the one there is takes before it is cancelled: none without one. */
  triesLeft() {
    return this.#active() ? WRONG_TRIES - this.#wrong : 0;
  }

  /** What Settings shows of it: never the code, which only the one who asked for it has. */
  state() {
    return { active: this.#active(), expiresAt: this.#active() ? this.#expiresAt : 0, ended: this.#ended };
  }

  #active() {
    if (this.#code && this.#expiresAt <= this.#now()) this.#end('expired');
    return Boolean(this.#code);
  }

  /** @param {Ended} why */
  #end(why) {
    this.#code = '';
    this.#expiresAt = 0;
    this.#wrong = 0;
    this.#ended = why;
  }
}
