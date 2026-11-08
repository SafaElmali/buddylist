// Voice clips: hold F2 or the Voice Clip button, talk, and let go. What you
// said is turned into text on this computer and put in the message box, so
// you can fix it before you send it. The shortcut can be changed, and it can
// be pressed once to start and again to stop instead of held (View > Voice clips in a conversation).
import { errorText } from '../lib/dom.js';
import { matchesShortcut, releasesShortcut, shortcutLabel } from '../../shared/shortcuts.js';
import { voiceSettings } from '../../shared/voice-settings.js';

/** What whisper.cpp wants: 16 kHz, one channel, 16 bits a sample. */
export const SAMPLE_RATE = 16000;
/** A press shorter than this is a slip of the finger, not a clip. */
export const MIN_CLIP_MS = 300;
/** A clip ends by itself after two minutes. */
export const MAX_CLIP_MS = 2 * 60 * 1000;
/** How long a passing remark stays in the status bar. */
const HINT_MS = 4000;
/** A microphone that hasn't opened by now isn't going to. */
const OPEN_TIMEOUT_MS = 10000;
// Next to chat.html, like its other scripts. A worklet has to be a file of its own.
const WORKLET = 'chat/voice-worklet.js';

// ---- the recording as numbers ----------------------------------------------------------------

/** Joins the blocks the microphone delivered into one run of samples. */
export function joinSamples(chunks) {
  const all = new Float32Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  return all;
}

/**
 * Changes how many samples a second a recording has. Going down, each new sample is the
 * average of the ones it replaces; going up, it lies on the line between its neighbours.
 * @param {Float32Array} samples
 * @param {number} fromRate
 * @param {number} [toRate]
 */
export function resample(samples, fromRate, toRate = SAMPLE_RATE) {
  if (fromRate === toRate || !samples.length) return samples;
  const step = fromRate / toRate;
  const out = new Float32Array(Math.round(samples.length / step));
  for (let i = 0; i < out.length; i += 1) {
    if (step > 1) {
      const start = Math.floor(i * step);
      const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * step)));
      let sum = 0;
      for (let j = start; j < end; j += 1) sum += samples[j];
      out[i] = sum / (end - start);
    } else {
      const left = Math.floor(i * step);
      const right = Math.min(left + 1, samples.length - 1);
      out[i] = samples[left] + (samples[right] - samples[left]) * (i * step - left);
    }
  }
  return out;
}

/**
 * A recording as a WAV file: 16-bit PCM, one channel.
 * @param {Float32Array} samples  each from -1 to 1; anything louder is clipped
 * @param {number} [sampleRate]
 * @returns {ArrayBuffer}
 */
export function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const bytes = samples.length * 2;
  const view = new DataView(new ArrayBuffer(44 + bytes));
  const tag = (at, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i));
  };
  tag(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  tag(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); // the format block's own length
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // one channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes a second
  view.setUint16(32, 2, true); // bytes a sample
  view.setUint16(34, 16, true); // bits a sample
  tag(36, 'data');
  view.setUint32(40, bytes, true);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i] || 0));
    view.setInt16(44 + i * 2, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), true);
  }
  return view.buffer;
}

/** 7000 -> "0:07", to the nearest second. */
export function formatElapsed(ms) {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// ---- the microphone ----------------------------------------------------------------------------

/**
 * Why the microphone wouldn't start, as a sentence for the conversation.
 * @param {any} err  what getUserMedia or the audio graph threw
 */
export function microphoneProblem(err, stage = 'capture') {
  const onMac = globalThis.navigator?.platform?.toLowerCase().includes('mac');
  const desktop = globalThis.navigator?.userAgent?.includes('Electron/');
  const settings =
    onMac && desktop
      ? 'System Settings > Privacy & Security > Microphone'
      : desktop
        ? 'your system microphone privacy settings'
        : 'your browser’s site permissions and system microphone settings';
  if (stage === 'recorder')
    return 'The voice recorder could not start. Restart buddylist and try again. If it still fails, check for an update or use Help > Send feedback.';
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return `Microphone access is not allowed. Check ${settings}. If access is restricted, ask your administrator. After changing access, restart ${desktop ? 'buddylist' : 'the browser'} and try again.`;
    case 'TimeoutError':
      return `The microphone did not finish opening. Check for a permission prompt and ${settings}, then try again.`;
    case 'NotFoundError':
      return 'No microphone was found. Connect or enable an input device in your system sound settings, then try again.';
    case 'OverconstrainedError':
      return 'The microphone does not support the requested recording settings. Choose another system input device, then try again.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The microphone could not be opened. Check the selected input in your system sound settings, reconnect it if needed, then try again.';
    case 'NotSupportedError':
      return 'Microphone recording is not available here. Use the desktop app or a browser that supports microphone access on a secure connection.';
    default:
      return `The microphone couldn't be started: ${err?.message || err}.`;
  }
}

/** Lets go of everything a recording was holding. Safe to call twice. */
function close(session) {
  session.closed = true;
  session.finish?.();
  for (const track of session.stream?.getTracks() || []) {
    track.onended = null;
    track.stop();
  }
  session.source?.disconnect();
  if (session.capture) {
    session.capture.onprocessorerror = null;
    session.capture.port.onmessage = null;
    session.capture.port.close();
    session.capture.disconnect();
  }
  if (!session.closing && session.context && session.context.state !== 'closed')
    session.closing = session.context.close().catch(() => {});
  return session.closing;
}

function audioContext() {
  // Running the audio at whisper's rate lets the browser do the resampling.
  try {
    return new AudioContext({ sampleRate: SAMPLE_RATE });
  } catch {
    return new AudioContext(); // a rate it won't run at: resample() evens it out afterwards
  }
}

/**
 * What a recording comes from. The real one is the Microphone below.
 * @typedef {object} ClipSource
 * @property {(failed?: (error: Error) => void) => Promise<void>} start  rejects with a sentence to show; reports interrupted recordings
 * @property {() => { samples: Float32Array, sampleRate: number }} stop
 * @property {() => void} cancel
 */

/**
 * The microphone, open only while a clip is being recorded.
 * @implements {ClipSource}
 */
export class Microphone {
  #session = null;
  #closing = Promise.resolve();

  /** Opens the microphone and starts keeping what it hears. */
  start(failed = () => {}) {
    if (this.#session) return this.#session.opening;
    const session = { stream: null, context: null, chunks: [], closed: false, stage: 'capture' };
    this.#session = session;
    session.opening = this.#start(session, failed);
    return session.opening;
  }

  async #start(session, failed) {
    let tooLate;
    try {
      // The system can leave the request hanging, for one when it never gets to ask you.
      await Promise.race([
        this.#open(session, failed),
        new Promise((resolve) => {
          session.finish = resolve;
        }),
        new Promise((_, reject) => {
          tooLate = setTimeout(() => reject(new DOMException('', 'TimeoutError')), OPEN_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      if (session.closed) return;
      this.#close(session);
      throw new Error(microphoneProblem(err, session.stage), { cause: err });
    } finally {
      clearTimeout(tooLate);
    }
  }

  #close(session) {
    this.#closing = Promise.resolve(close(session));
    if (this.#session === session) this.#session = null;
  }

  async #open(session, failed) {
    await this.#closing;
    if (session.closed) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('', 'NotSupportedError');
    session.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // You let go, or the window lost focus, while the microphone was still opening.
    if (session.closed) return close(session);
    const interrupted = (message) => {
      if (session.closed) return;
      this.#close(session);
      failed(new Error(message));
    };
    for (const track of session.stream.getTracks())
      track.onended = () =>
        interrupted(
          'The microphone disconnected or access ended. Check your input device and microphone permissions, then record again.'
        );
    session.stage = 'recorder';
    session.context = audioContext();
    await session.context.audioWorklet.addModule(WORKLET);
    if (session.closed) return close(session);
    const capture = (session.capture = new AudioWorkletNode(session.context, 'voice-capture', {
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: 'explicit',
    }));
    capture.port.onmessage = (e) => {
      if (!session.closed) session.chunks.push(e.data);
    };
    capture.onprocessorerror = () =>
      interrupted(
        'The voice recorder stopped unexpectedly. Try recording again. If it keeps happening, restart buddylist.'
      );
    session.source = session.context.createMediaStreamSource(session.stream);
    session.source.connect(capture);
    await session.context.resume();
    if (session.closed) return close(session);
  }

  /** Closes the microphone and hands over what it heard. */
  stop() {
    const session = this.#session;
    if (!session) return { samples: new Float32Array(0), sampleRate: SAMPLE_RATE };
    const sampleRate = session.context?.sampleRate || SAMPLE_RATE;
    this.#close(session);
    const samples = joinSamples(session.chunks);
    session.chunks = [];
    return { samples, sampleRate };
  }

  /** Closes the microphone and forgets what it heard. */
  cancel() {
    if (this.#session) {
      this.#session.chunks = [];
      this.#close(this.#session);
    }
  }
}

/**
 * The browser preview's stand-in: it never opens a microphone and hears nothing.
 * The preview answers every clip with a sample sentence instead.
 * @type {ClipSource}
 */
export const noMicrophone = {
  start: async () => {},
  stop: () => ({ samples: new Float32Array(0), sampleRate: SAMPLE_RATE }),
  cancel() {},
};

// ---- hold to talk, or press to talk ------------------------------------------------------------

/**
 * How a clip was started, which decides what ends it:
 *  - `key`: the shortcut is held down, and letting go ends the clip
 *  - `button`: the Voice Clip button is held down, and letting go ends the clip
 *  - `toggle`: it was switched on (by a press of the shortcut or the button when
 *    they are set to be pressed, or from the menu) and is switched off the same way
 * @typedef {'key' | 'button' | 'toggle'} ClipStart
 */

/**
 * What the status bar says while a clip is recorded or transcribed.
 * @typedef {{ text: string, time?: string }} VoiceStatus
 */

export class VoiceClips {
  /**
   * 'opening' is the moment between pressing and the microphone being ready.
   * @type {'idle' | 'opening' | 'recording' | 'transcribing'}
   */
  state = 'idle';
  /** @type {ClipStart} */
  #how = 'key';
  #pressedAt = 0;
  #startedAt = 0;
  /** The press being handled, so a microphone that opens late knows it is no longer wanted. */
  #press = null;
  #clock = null;
  #limit = null;
  #hint = null;
  /** @type {HTMLElement | null} */
  #button = null;

  /**
   * @param {object} deps
   * @param {ClipSource} deps.microphone
   * @param {(wav: ArrayBuffer) => Promise<string>} deps.transcribe  the words in a recording
   * @param {(text: string) => void} deps.insert  puts the words in the message box
   * @param {(text: string) => void} [deps.send]  sends the words as a message, when the settings say a clip
   *   is sent as soon as it is there. Without it they are put in the message box whatever the settings say
   * @param {(text: string) => void} deps.error  says what went wrong, in the conversation
   * @param {(status: VoiceStatus | null) => void} deps.status  null puts the usual status back
   * @param {() => object} [deps.settings]  the app's settings as they are right now: the shortcut, whether it
   *   is held or pressed and whether a clip is sent
   * @param {boolean} [deps.mac]  name the shortcut the way a Mac does
   */
  constructor(deps) {
    this.deps = deps;
  }

  /** The shortcut, how it is used, and what to call it. */
  #settings() {
    const { voiceKey, voiceMode, voiceSend } = voiceSettings(this.deps.settings?.());
    return {
      key: voiceKey,
      pressed: voiceMode === 'press',
      sent: voiceSend,
      label: shortcutLabel(voiceKey, this.deps.mac),
    };
  }

  /** Whether a clip is being made: the microphone is opening or recording. */
  get held() {
    return this.state === 'opening' || this.state === 'recording';
  }

  /**
   * Start a clip.
   * @param {ClipStart} how  what will end it
   */
  press(how) {
    if (this.state !== 'idle') return;
    this.state = 'opening';
    this.#how = how;
    this.#pressedAt = Date.now();
    const press = (this.#press = {});
    this.#show('Waiting for the microphone...');
    const failed = (err) => {
      if (this.#press === press) this.#fail(err);
    };
    this.deps.microphone.start(failed).then(() => {
      if (this.#press === press) this.#record();
    }, failed);
  }

  /** The microphone is open: from here on it counts. */
  #record() {
    this.state = 'recording';
    this.#startedAt = Date.now();
    this.#clock = setInterval(() => this.#show(), 1000);
    this.#limit = setTimeout(() => this.#transcribe({ full: true }), MAX_CLIP_MS);
    this.#show();
  }

  /** Let go. Only ends a clip that was started the same way. */
  release(how) {
    if (this.held && this.#how === how) this.#end();
  }

  /** Switch a clip on, or end the one being recorded: the menu, and a shortcut that is pressed, not held. */
  toggle() {
    if (this.held) this.#end();
    else this.press('toggle');
  }

  /** Throw away the clip being made. */
  cancel(remark = '') {
    if (!this.held) return;
    this.deps.microphone.cancel();
    this.#rest(remark);
  }

  #end() {
    const { label } = this.#settings();
    const toggled = this.#how === 'toggle';
    if (Date.now() - this.#pressedAt < MIN_CLIP_MS) {
      this.cancel(
        toggled ? 'That was too quick to be a voice clip.' : `Hold ${label} or the Voice Clip button while you talk.`
      );
    } else if (this.state === 'opening') {
      this.cancel(`The microphone was not ready yet. ${toggled ? 'Press' : 'Hold'} ${label} again.`);
    } else this.#transcribe();
  }

  /** What ends the clip being made, for the status bar. */
  #whenDone() {
    const { label } = this.#settings();
    if (this.#how === 'key') return `release ${label} when you're done`;
    if (this.#how === 'button') return "let go of the button when you're done";
    return `press ${label} when you're done`;
  }

  async #transcribe({ full = false } = {}) {
    const { microphone, transcribe, insert, send } = this.deps;
    this.state = 'transcribing';
    this.#show(full ? 'Voice clips stop after 2 minutes. Transcribing yours...' : 'Transcribing your voice clip...');
    try {
      const { samples, sampleRate } = microphone.stop();
      const text = await transcribe(encodeWav(resample(samples, sampleRate)));
      // Sent or typed is decided when the words are there: the setting may have changed while you talked.
      if (text) (this.#settings().sent && send ? send : insert)(text);
      this.#rest(text ? '' : 'That voice clip was silent.');
    } catch (err) {
      this.#fail(err);
    }
  }

  #fail(err) {
    this.deps.microphone.cancel();
    this.#rest();
    this.deps.error(errorText(err));
  }

  /** Back to waiting for the next clip, with a passing remark in the status bar if there is one. */
  #rest(remark = '') {
    this.state = 'idle';
    this.#press = null;
    this.#show(remark);
    if (remark) this.#hint = setTimeout(() => this.deps.status(null), HINT_MS);
  }

  /** Makes the button and the status bar match what is going on. */
  #show(text = '') {
    const recording = this.state === 'recording';
    if (!recording) {
      clearInterval(this.#clock);
      clearTimeout(this.#limit);
    }
    clearTimeout(this.#hint);
    for (const state of ['opening', 'recording', 'transcribing'])
      this.#button?.classList.toggle(state, this.state === state);
    if (recording)
      this.deps.status({
        text: `Recording a voice clip... ${this.#whenDone()}.`,
        time: formatElapsed(Date.now() - this.#startedAt),
      });
    else this.deps.status(text ? { text } : null);
  }

  // ---- the keyboard and the button -----------------------------------------------------------

  /**
   * The shortcut starts a clip (and ends one that was switched on); Esc throws away the one being made.
   * @param {KeyboardEvent} e
   * @returns {boolean} true when the key was meant for a voice clip
   */
  keyDown(e) {
    const { key, pressed } = this.#settings();
    if (matchesShortcut(e, key)) {
      e.preventDefault();
      // Holding a key down repeats it, and a dialog in front has the floor.
      if (e.repeat || document.querySelector('.modal')) return true;
      if (this.held && this.#how === 'toggle') this.#end();
      else this.press(pressed ? 'toggle' : 'key');
      return true;
    }
    if (e.key === 'Escape' && this.held) {
      e.preventDefault();
      this.cancel('Voice clip cancelled.');
      return true;
    }
    return false;
  }

  /** @param {KeyboardEvent} e */
  keyUp(e) {
    if (releasesShortcut(e, this.#settings().key)) this.release('key');
  }

  /** The settings changed: say on the button how it works now. */
  refresh() {
    if (!this.#button) return;
    const { pressed, label } = this.#settings();
    this.#button.title = `${pressed ? 'Click' : 'Hold'} to record a voice clip (${label})`;
  }

  /**
   * Makes `button` record for as long as it is held down (or switch a clip on
   * and off, when the shortcut is set to be pressed), and gives up a held clip
   * when the window loses focus.
   * @param {HTMLElement} button
   */
  attach(button) {
    this.#button = button;
    this.refresh();
    // Keeps the cursor in the message box, where the words will go.
    button.addEventListener('mousedown', (e) => e.preventDefault());
    let pointer = null;
    button.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.isPrimary === false || pointer !== null) return;
      pointer = e.pointerId;
      button.setPointerCapture(e.pointerId); // so letting go anywhere still counts
      if (this.held && this.#how === 'toggle') this.#end();
      else this.press(this.#settings().pressed ? 'toggle' : 'button');
    });
    button.addEventListener('pointerup', (e) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      this.release('button');
    });
    const lostPointer = (e) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      if (this.#how === 'button') this.cancel();
    };
    button.addEventListener('pointercancel', lostPointer);
    button.addEventListener('lostpointercapture', lostPointer);
    // Keyboard and assistive activation have no pointerdown/up pair.
    button.addEventListener('click', (e) => {
      if (e.detail === 0) this.toggle();
    });
    window.addEventListener('keyup', (e) => this.keyUp(e));
    // A key or button held down can't be let go of in another window, so that clip is given up.
    // One that was switched on carries on: you can look something up while you talk.
    window.addEventListener('blur', () => {
      pointer = null;
      if (this.#how !== 'toggle') this.cancel();
    });
    window.addEventListener('pagehide', () => this.cancel());
  }
}
