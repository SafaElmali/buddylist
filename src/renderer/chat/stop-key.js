// Esc stops whoever is at work only when it comes twice: one stray Esc, as to put something away, stops nobody.
// The first says in the status bar that a second one would, and a second one while it says so stops them, as
// one Esc did before. Whatever else has the keyboard in between puts the first one away: an Esc that closes a
// popup, calls an edit off or drops a voice clip, any other key, the window losing the focus, or the work being
// over. The Stop button and the menus stop them in one click, as ever.

/** How long a first Esc waits for the second, in milliseconds. Then the next one is a first again. */
export const STOP_AGAIN_MS = 2000;

/** Keys held for another, not pressed for themselves: Shift on its way to ⇧Esc puts nothing away. */
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'Fn']);

export class StopKey {
  /** The first press, while it waits for the second. */
  #timer = null;
  /** The key going down now is that second press, should it come through to the stop. */
  #second = false;

  /**
   * @param {(pending: boolean) => void} changed  a first press came, or was put away: the status bar says so
   * @param {number} [wait]
   */
  constructor(changed, wait = STOP_AGAIN_MS) {
    this.changed = changed;
    this.wait = wait;
  }

  /** A first press waits for the second. */
  get pending() {
    return this.#timer !== null;
  }

  /**
   * Every key, before anything in the window has it. A held key's repeats are the press it started, and
   * change nothing. An Esc that puts a word an input method was making together away is the input method's.
   * @param {KeyboardEvent} e
   */
  heard(e) {
    if (e.repeat || MODIFIERS.has(e.key)) return;
    const second = e.key === 'Escape' && !e.isComposing && this.pending;
    this.reset();
    this.#second = second;
  }

  /**
   * An Esc came through to the stop, with nothing else in the window taking it.
   * @param {KeyboardEvent} e
   * @returns {boolean}  true for the second press, which stops them. The first waits for it
   */
  press(e) {
    if (e.repeat || e.isComposing) return false;
    if (this.#second) {
      this.#second = false;
      return true;
    }
    clearTimeout(this.#timer ?? undefined);
    this.#timer = setTimeout(() => this.reset(), this.wait);
    this.changed(true);
    return false;
  }

  /** The next Esc is a first again. */
  reset() {
    this.#second = false;
    if (this.#timer === null) return;
    clearTimeout(this.#timer);
    this.#timer = null;
    this.changed(false);
  }
}
