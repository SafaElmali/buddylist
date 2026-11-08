// "What starts this project?": the dialog that asks for the run command. It is
// asked once for a project, and every contact working on it uses the answer: a
// command, a few lines run one after the other, or a script file in the project.
import { api } from '../lib/api.js';
import { $, el, errorText, html } from '../lib/dom.js';
import { formDialog } from '../lib/dialog.js';

const IS_MAC = navigator.platform.toLowerCase().includes('mac');
/** What presses OK from the box, where Enter alone starts a new line. */
const OK_KEYS = IS_MAC ? '⌘↩' : 'Ctrl+Enter';

/**
 * The box's text with `line` in place of what is selected, on a line of its own. A script file
 * picked while all of it is selected, as it is when the dialog opens, takes the place of the guess;
 * picked on an empty line, it goes there.
 * @param {string} text
 * @param {number} start  where the selection starts
 * @param {number} end    where it ends; `start` when nothing is selected
 * @param {string} line
 * @returns {{ text: string, caret: number }}  `caret`: just after `line`
 */
export function onItsOwnLine(text, start, end, line) {
  const before = start > 0 && text[start - 1] !== '\n' ? '\n' : '';
  const after = end < text.length && text[end] !== '\n' ? '\n' : '';
  const put = `${before}${line}${after}`;
  return { text: text.slice(0, start) + put + text.slice(end), caret: start + before.length + line.length };
}

/**
 * @param {{ contactId: string, web?: boolean }} ctx  `web`: the browser preview, which has no files to pick
 * @param {{ project: string, command: string, suggestion: string }} known  the project's name, its command
 *   so far ('' the first time), and a guess from what is in the contact's folder
 * @returns {Promise<{ project: string, command: string } | null>}  the command as it was saved, or null
 */
export function runDialog(ctx, { project, command, suggestion }) {
  const first = !command;
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="run-form">
        <label
          ><span
            >${first ? html`What starts <b>${project}</b>?` : html`The command that starts <b>${project}</b>`}</span
          >
          <textarea
            name="command"
            rows="4"
            placeholder="${'npm install\nnpm run dev'}"
            spellcheck="false"
            autocomplete="off"
          ></textarea>
        </label>
        <div class="run-tools">
          ${ctx.web ? '' : html`<button class="btn" type="button">Choose file...</button>`}
          <span class="hint">${OK_KEYS} ${first ? 'runs it' : 'saves it'}</span>
        </div>
        <div class="hint">
          Every contact working on ${project} uses this. It runs in the contact's own folder, with a port of its own in
          <code>$PORT</code>. A line that fails stops the ones after it.
        </div>
        <div class="error" hidden></div>
      </form>`
    )
  );
  const box = /** @type {HTMLTextAreaElement} */ (form.elements.namedItem('command'));
  box.value = command || suggestion;

  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.isComposing) return;
    e.preventDefault();
    form.requestSubmit();
  });

  // The file is not run from where it was picked: its path from the contact's folder goes in the box.
  $('.run-tools .btn', form)?.addEventListener('click', async () => {
    const error = $('.error', form);
    error.hidden = true;
    try {
      const picked = await api.run.pickScript(ctx.contactId);
      if (picked) {
        const { text, caret } = onItsOwnLine(box.value, box.selectionStart, box.selectionEnd, picked);
        box.value = text;
        box.setSelectionRange(caret, caret);
      }
    } catch (err) {
      error.textContent = errorText(err);
      error.hidden = false;
    }
    box.focus();
  });

  const result = formDialog({
    title: first ? 'Run' : 'Run Command',
    form,
    ok: first ? 'Run' : 'OK',
    // The main process checks the command, and says why if it can't be used.
    save: () => api.run.setCommand(ctx.contactId, box.value),
  });

  setTimeout(() => {
    box.focus();
    box.select();
  });
  return result;
}
