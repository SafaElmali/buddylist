// What the open line of a service in Settings > Services offers when its program was not found where the app looked:
// to install it, with the command to copy, or to choose where it is, with what finds it in a terminal, and where the
// app looked. The welcome wizard's line offers the same, in fewer words (see onboarding/pages.js).
import { copyFrom, el, html } from '../lib/dom.js';
import { findCommand, lookedIn } from '../onboarding/setup.js';
import { button, row } from './controls.js';

/**
 * @param {import('../../providers/setup.js').Setup} setup  one that is missing, and was looked for by its name
 * @param {{ choose: () => void }} actions  `choose`: Choose executable..., as Use a different installation has it
 * @returns {HTMLElement[]}  the two ways forward, side by side, then where it looked
 */
export function missingHelp({ note, installCommand, looked }, { choose }) {
  const install = el('<div><b>Install it</b></div>');
  if (installCommand) {
    const copy = button('Copy', () => copyFrom(copy, installCommand));
    install.append(
      row(el(html`<code class="st-mono st-install-command">${installCommand}</code>`), copy),
      el('<p class="st-hint">Then press Check again.</p>')
    );
  } else {
    install.append(el(html`<p class="st-hint">${note}</p>`));
  }
  const installed = el('<div><b>Already installed?</b></div>');
  installed.append(
    row(button('Choose executable...', choose)),
    el(html`<p class="st-hint">Run <code>${findCommand(looked)}</code> in a terminal to find it.</p>`)
  );
  const ways = el('<div class="st-service-missing"></div>');
  ways.append(install, installed);
  const where = el(
    html`<p class="st-hint st-service-looked">
      ${lookedIn(looked)}:<span class="st-mono">${looked.folders.join('  ·  ')}</span>
    </p>`
  );
  return [ways, where];
}
