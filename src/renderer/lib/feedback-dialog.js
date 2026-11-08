// "Send Feedback": feedback, a bug or a feature request for the people who make the app,
// with a screenshot if it helps. The main process sends it on.
import { api } from './api.js';
import { el, html } from './dom.js';
import { busyLine, formDialog, infoDialog, messageBody } from './dialog.js';
import {
  EMAIL_MAX,
  FEEDBACK_KINDS,
  MESSAGE_MAX,
  PROBLEMS,
  SCREENSHOT_TYPES,
  screenshotProblem,
} from '../../shared/feedback.js';

const TITLE = 'Send Feedback';

export async function feedbackDialog() {
  // What a report says about where it comes from, for the person to read before sending it.
  const details = await api.feedback.details();
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="feedback-form">
        <fieldset class="choices">
          <legend>What would you like to send?</legend>
          ${FEEDBACK_KINDS.map(
            ({ id, label }) =>
              html`<label class="choice"><input type="radio" name="kind" value="${id}" />${label}</label>`
          )}
        </fieldset>
        <label
          >Message
          <textarea name="message" rows="6" maxlength="${MESSAGE_MAX}" required></textarea>
        </label>
        <label
          >Your email address (optional)
          <input type="text" name="email" maxlength="${EMAIL_MAX}" spellcheck="false" placeholder="you@example.com" />
        </label>
        <div class="hint">Only used to answer you.</div>
        <label
          >Screenshot (optional)
          <span class="row">
            <input type="text" name="picture" readonly tabindex="-1" placeholder="Browse, or paste a picture" />
            <button class="btn" type="button" name="browse">Browse...</button>
          </span>
        </label>
        <input type="file" name="file" accept="${Object.keys(SCREENSHOT_TYPES).join(',')}" hidden />
        <label class="choice"><input type="checkbox" name="system" checked />Include my app version and system</label>
        <div class="hint">${details}</div>
        ${busyLine('Sending...')}
        <div class="error" hidden></div>
      </form>`
    )
  );
  const { kind, message, email, picture, browse, file, system } = /** @type {any} */ (form.elements);
  const error = /** @type {HTMLElement} */ (form.querySelector('.error'));
  kind.value = FEEDBACK_KINDS[0].id;

  /** @type {File | null} */
  let screenshot = null;
  const attach = (chosen) => {
    const problem = screenshotProblem(chosen);
    error.textContent = problem ? PROBLEMS[problem] : '';
    error.hidden = !problem;
    if (problem) return;
    screenshot = chosen;
    // A pasted picture has no name worth showing.
    picture.value = chosen ? chosen.name || 'Pasted picture' : '';
    browse.textContent = chosen ? 'Remove' : 'Browse...';
  };

  // The one button picks a picture, and takes the picked one away again.
  browse.addEventListener('click', () => (screenshot ? attach(null) : file.click()));
  file.addEventListener('change', () => {
    if (file.files[0]) attach(file.files[0]);
    // Picking the same file again after removing it has to count as a change.
    file.value = '';
  });
  // A screenshot is usually on the clipboard, not in a file.
  form.addEventListener('paste', (e) => {
    const pasted = [...(e.clipboardData?.files || [])].find((each) => each.type.startsWith('image/'));
    if (!pasted) return;
    e.preventDefault();
    attach(pasted);
  });

  const result = formDialog({
    title: TITLE,
    form,
    ok: 'Send',
    save: async () => {
      await api.feedback.send({
        kind: kind.value,
        message: message.value,
        email: email.value,
        system: system.checked,
        screenshot: screenshot && { type: screenshot.type, bytes: await screenshot.arrayBuffer() },
      });
      return true;
    },
  });
  setTimeout(() => message.focus());
  if (await result) await infoDialog(TITLE, messageBody('Thank you. Your message has been sent.'));
}
