// "Voice Clips": which keys record one, whether you hold them or press them, and
// whether what you said is sent at once. The keys are one of the app's shortcuts,
// checked against the others as Settings > Shortcuts checks them.
import { api } from './api.js';
import { el, html } from './dom.js';
import { formDialog } from './dialog.js';
import { shortcutKeys, shortcutLabel, shortcutOf, shortcutProblem, systemOf } from '../../shared/shortcuts.js';
import { DEFAULT_VOICE_KEY, voiceSettings } from '../../shared/voice-settings.js';

const IS_MAC = navigator.platform.toLowerCase().includes('mac');
const SYSTEM = systemOf(navigator.platform);

/**
 * @param {object} settings  the app's settings, as they are now
 * @returns {Promise<object | null>} the saved settings, or null
 */
export function voiceDialog(settings) {
  const current = voiceSettings(settings);
  const keys = shortcutKeys(settings, SYSTEM);
  let { voiceKey } = current;
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="voice-form">
        <label
          >Shortcut
          <span class="row">
            <input class="shortcut-box" type="text" name="shortcut" readonly spellcheck="false" />
            <button class="btn danger" type="button" name="reset">
              Use ${shortcutLabel(DEFAULT_VOICE_KEY, IS_MAC)}
            </button>
          </span>
        </label>
        <div class="hint">Click the box, then press the keys you want to use.</div>
        <fieldset class="choices">
          <legend>To record a voice clip</legend>
          <label class="choice"><input type="radio" name="mode" value="hold" />Hold the shortcut while you talk</label>
          <label class="choice"
            ><input type="radio" name="mode" value="press" />Press it once to start, and again to stop</label
          >
        </fieldset>
        <label class="choice"><input type="checkbox" name="send" />Send the message as soon as I stop talking</label>
        <div class="hint">Without this, what you said is typed into the message box for you to send.</div>
        <div class="error" hidden></div>
      </form>`
    )
  );
  const { shortcut, reset, mode, send } = /** @type {any} */ (form.elements);
  const error = /** @type {HTMLElement} */ (form.querySelector('.error'));
  mode.value = current.voiceMode;
  send.checked = current.voiceSend;

  const choose = (pressed) => {
    const problem = shortcutProblem(pressed, 'voice', keys);
    error.textContent = problem;
    error.hidden = !problem;
    if (problem) return;
    voiceKey = pressed;
    shortcut.value = shortcutLabel(voiceKey, IS_MAC);
  };
  choose(voiceKey);

  shortcut.addEventListener('keydown', (e) => {
    // Tab, Enter and Esc keep their usual jobs in a dialog.
    if (['Tab', 'Enter', 'Escape'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const pressed = shortcutOf(e);
    // Nothing to show while only Ctrl, Alt, Shift or Command are down.
    if (pressed) choose(pressed);
  });
  reset.addEventListener('click', () => {
    choose(DEFAULT_VOICE_KEY);
    shortcut.focus();
  });

  const result = formDialog({
    title: 'Voice Clips',
    form,
    // The main process checks the choice again, and says why if it can't be used.
    save: () =>
      api.app.updateSettings({ shortcuts: { voice: voiceKey }, voiceMode: mode.value, voiceSend: send.checked }),
  });
  setTimeout(() => shortcut.focus());
  return result;
}
