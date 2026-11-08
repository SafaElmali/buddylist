import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortcutKeys, shortcutProblem } from '../src/shared/shortcuts.js';
import {
  cleanVoiceSettings,
  DEFAULT_VOICE_KEY,
  DEFAULT_VOICE_SETTINGS,
  voiceSettings,
} from '../src/shared/voice-settings.js';

test('out of the box, a voice clip is F2, held down, and typed for you to send', () => {
  assert.deepEqual({ ...DEFAULT_VOICE_SETTINGS }, { voiceMode: 'hold', voiceSend: false });
  assert.equal(DEFAULT_VOICE_KEY, 'F2');
  for (const system of ['mac', 'windows', 'linux']) {
    const keys = shortcutKeys({}, system);
    assert.equal(keys.voice, 'F2', system);
    assert.equal(shortcutProblem(keys.voice, 'voice', keys), '', system);
  }
});

// ---- settings in and out ------------------------------------------------------------------------

test('settings with nothing about voice clips get the usual ones', () => {
  const usual = { voiceKey: 'F2', voiceMode: 'hold', voiceSend: false };
  assert.deepEqual(voiceSettings(undefined), usual);
  assert.deepEqual(voiceSettings(null), usual);
  assert.deepEqual(voiceSettings({ sounds: true }), usual);
  assert.deepEqual(voiceSettings({ shortcuts: { voice: 'Control+Space' }, voiceMode: 'press', voiceSend: true }), {
    voiceKey: 'Control+Space',
    voiceMode: 'press',
    voiceSend: true,
  });
  assert.deepEqual(voiceSettings({ voiceMode: 'sing' }), usual);
  // Sent or not is yes or no: anything else is the usual no.
  assert.deepEqual(voiceSettings({ voiceSend: 'yes' }), usual);
});

test('the keys are the ones kept with the other shortcuts, not a setting of their own', () => {
  assert.equal(voiceSettings({ voiceKey: 'Control+Space' }).voiceKey, 'F2');
  assert.equal(voiceSettings({ shortcuts: { changes: 'F2' } }).voiceKey, 'F2', 'another one is no business of this');
  // Keys that can't be a shortcut, kept by hand or by an older version, are not used.
  assert.equal(voiceSettings({ shortcuts: { voice: 'KeyV' } }).voiceKey, 'F2');
  assert.equal(voiceSettings({ shortcuts: { voice: 'Meta+KeyC' } }).voiceKey, 'F2');
});

test('a change is checked, and only what was asked for is changed', () => {
  assert.deepEqual(cleanVoiceSettings({ sounds: false }), {});
  assert.deepEqual(cleanVoiceSettings(undefined), {});
  assert.deepEqual(cleanVoiceSettings({ voiceMode: 'press' }), { voiceMode: 'press' });
  assert.deepEqual(cleanVoiceSettings({ voiceMode: 'hold', sounds: false }), { voiceMode: 'hold' });
  assert.deepEqual(cleanVoiceSettings({ voiceSend: true }), { voiceSend: true });
  assert.deepEqual(cleanVoiceSettings({ voiceSend: false }), { voiceSend: false });
  // The keys are changed as every shortcut is (see cleanShortcuts).
  assert.deepEqual(cleanVoiceSettings({ voiceKey: 'Alt+KeyV' }), {});
});

test('a way of recording that cannot be used is refused with the reason', () => {
  assert.throws(() => cleanVoiceSettings({ voiceMode: 'sing' }), /hold the shortcut or to press it/);
  assert.throws(() => cleanVoiceSettings({ voiceMode: '' }), /hold the shortcut or to press it/);
  assert.throws(() => cleanVoiceSettings({ voiceSend: 'yes' }), /sent or typed/);
});
