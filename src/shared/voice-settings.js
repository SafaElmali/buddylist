// How a voice clip is started: whether you hold its shortcut while you talk or
// press it once to start and again to stop. And what becomes of its words: typed
// into the message box, or sent at once. The shortcut itself is one of the app's
// (see shortcuts.js), kept and checked with the others.

import { defaultShortcut, shortcutKeys } from './shortcuts.js';

/** @typedef {'hold' | 'press'} VoiceMode */
/**
 * What the settings keep about voice clips.
 * @typedef {Object} VoiceSettings
 * @property {VoiceMode} voiceMode
 * @property {boolean} voiceSend  send a clip's words as a message as soon as they are there, instead of
 *   typing them into the message box for you to send
 */

/** @type {Readonly<VoiceSettings>} */
export const DEFAULT_VOICE_SETTINGS = Object.freeze({ voiceMode: 'hold', voiceSend: false });
export const VOICE_MODES = Object.freeze(['hold', 'press']);

/** The keys a voice clip starts with: the same on every keyboard. */
export const DEFAULT_VOICE_KEY = defaultShortcut('voice', 'mac');

/**
 * The voice clip settings in `settings`, with the usual ones wherever it has none, and the keys
 * that record one.
 * @param {(Partial<VoiceSettings> & { shortcuts?: Record<string, string> }) | null | undefined} settings
 * @returns {VoiceSettings & { voiceKey: string }}
 */
export function voiceSettings(settings) {
  return {
    // It starts as F2 on every keyboard, so any keyboard's will do.
    voiceKey: shortcutKeys(settings, 'mac').voice,
    voiceMode: VOICE_MODES.includes(settings?.voiceMode) ? settings.voiceMode : DEFAULT_VOICE_SETTINGS.voiceMode,
    voiceSend: typeof settings?.voiceSend === 'boolean' ? settings.voiceSend : DEFAULT_VOICE_SETTINGS.voiceSend,
  };
}

/**
 * The voice clip settings a window asked to change, checked. Its shortcut is checked with the others
 * (see cleanShortcuts).
 * @param {Partial<VoiceSettings> | null | undefined} patch
 * @returns {Partial<VoiceSettings>} only what `patch` had
 * @throws {Error} with a sentence for the window to show, when a choice can't be used
 */
export function cleanVoiceSettings(patch) {
  /** @type {Partial<VoiceSettings>} */
  const clean = {};
  if (patch?.voiceMode !== undefined) {
    if (!VOICE_MODES.includes(patch.voiceMode)) throw new Error('Choose to hold the shortcut or to press it.');
    clean.voiceMode = patch.voiceMode;
  }
  if (patch?.voiceSend !== undefined) {
    if (typeof patch.voiceSend !== 'boolean') throw new Error('Choose whether a voice clip is sent or typed.');
    clean.voiceSend = patch.voiceSend;
  }
  return clean;
}
