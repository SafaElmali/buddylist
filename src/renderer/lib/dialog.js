// XP-style dialogs drawn inside the window (instead of native alert/confirm).
import { el, errorText, escapeHtml, html, raw } from './dom.js';
import { isMenuOpen } from './menu.js';

// The dialogs that are open, the newest last: one can open over another, as
// the models of a service do over "Add a Contact".
let open = [];

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {HTMLElement} opts.body
 * @param {{ label: string, value: any, default?: boolean }[]} opts.buttons
 * @param {any} [opts.dismissValue]  what Escape / clicking outside returns
 * @returns {{ node: HTMLElement, result: Promise<any>, close: (value: any) => void }}
 */
export function openDialog({ title, body, buttons, dismissValue = null }) {
  const node = el(
    html`<div class="modal">
      <div class="dialog" role="dialog" aria-label="${title}">
        <div class="dialog-title titlebar-like">${title}</div>
        <div class="dialog-body"></div>
        <div class="buttons"></div>
      </div>
    </div>`
  );
  // The buttons sit below the body, not in it: a body too tall for the window scrolls, and they stay in sight.
  const bodyBox = node.querySelector('.dialog-body');
  bodyBox.appendChild(body);
  const row = node.querySelector('.buttons');
  // Cut off, the body says so with a line over the buttons. A part folded open or shut, or a smaller window,
  // can change that.
  const observer =
    globalThis.ResizeObserver &&
    new ResizeObserver(() =>
      node.querySelector('.dialog').classList.toggle('scrolls', bodyBox.scrollHeight > bodyBox.clientHeight)
    );
  observer?.observe(bodyBox);
  observer?.observe(body);

  let resolve;
  const result = new Promise((r) => {
    resolve = r;
  });
  const close = (value) => {
    observer?.disconnect();
    node.remove();
    open = open.filter((dialog) => dialog !== node);
    document.removeEventListener('keydown', onKey, true);
    resolve(value);
  };
  const onKey = (e) => {
    // While an input method puts a word together, Escape belongs to it.
    if (e.isComposing) return;
    // Escape closes one thing: a list open over the dialog, such as the models,
    // before the dialog, and the dialog on top before the one under it. One put aside hears nothing.
    if (e.key === 'Escape' && !isMenuOpen() && open.at(-1) === node && !node.hidden) {
      e.preventDefault();
      e.stopPropagation();
      close(dismissValue);
    }
  };
  for (const button of buttons) {
    const b = el(
      `<button class="btn${button.default ? ' default' : ''}" type="button">${escapeHtml(button.label)}</button>`
    );
    b.addEventListener('click', () => close(button.value));
    row.appendChild(b);
  }
  node.addEventListener('mousedown', (e) => {
    // A child dialog can finish between two clicks. The second click belongs to that child, not this backdrop.
    if (e.target === node && e.detail < 2) close(dismissValue);
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(node);
  open.push(node);
  // Without scrolling to it: a form taller than its window opens at its top, not at its buttons.
  (row.querySelector('.btn.default') || row.lastElementChild)?.focus({ preventScroll: true });
  return { node, result, close };
}

/**
 * Takes the dialogs in sight out of it, for Settings drawn over the window they are in (see settings/main.js),
 * such as Add a Contact's, whose Edit teams... opens it. They stay open as they are, with what was typed in them.
 * @returns {() => void}  gives them back, with the focus on the top one's default button until something else takes it
 */
export function putDialogsAside() {
  const aside = [...document.body.querySelectorAll('.modal:not([hidden])')];
  for (const node of aside) node.hidden = true;
  return () => {
    // One closed meanwhile, such as by its flow being called off, is gone.
    const back = aside.filter((node) => node.isConnected);
    for (const node of back) node.hidden = false;
    back.at(-1)?.querySelector('.buttons .btn.default')?.focus({ preventScroll: true });
  };
}

let forms = 0;

// Most saves are over before anyone could read that they are going on.
const BUSY_AFTER_MS = 300;

/**
 * The line a form shows while its OK takes long: a bar that keeps moving and what is going on.
 * `formDialog` shows and hides it; the form may change its `.busy-text` as the work goes on.
 * @param {string} text
 */
export const busyLine = (text) =>
  html`<div class="busy" hidden><span class="busy-bar"></span><span class="busy-text">${text}</span></div>`;

/** A message as a dialog shows it, line breaks kept. */
export const messageBody = (message) =>
  el(html`<p class="dialog-message">${raw(escapeHtml(message).replace(/\n/g, '<br>'))}</p>`);

/**
 * A dialog around a form with OK and Cancel. OK runs `save`, and the dialog
 * closes with what it returns. If `save` throws, the message is shown in the
 * form's `.error` and the dialog stays open, as it does if `save` returns
 * nothing. A form with a `busyLine` shows it while `save` takes long.
 * @param {object} opts
 * @param {string} opts.title
 * @param {HTMLFormElement} opts.form
 * @param {(signal: AbortSignal) => any} opts.save  `signal` is aborted when the dialog is closed with Cancel,
 *   Escape or a click outside it before `save` is done: whatever it started is called off
 * @param {string} [opts.ok]  what the OK button says
 * @param {AbortSignal} [opts.signal]  closes a form when its owning flow is cancelled or replaced
 * @returns {Promise<any>} what `save` returned, or null if the user cancelled
 */
export function formDialog({ title, form, save, ok = 'OK', signal }) {
  if (signal?.aborted) return Promise.resolve(null);
  const error = /** @type {HTMLElement} */ (form.querySelector('.error'));
  const busy = /** @type {HTMLElement | null} */ (form.querySelector('.busy'));
  const dialog = openDialog({
    title,
    body: form,
    buttons: [
      { label: ok, value: 'ok', default: true },
      { label: 'Cancel', value: null },
    ],
  });

  // OK validates before closing, so it submits the form instead. As the form's
  // own submit button it is also what Enter presses from any of the fields.
  const okButton = dialog.node.querySelector('.btn.default');
  const replacement = /** @type {HTMLButtonElement} */ (okButton.cloneNode(true));
  form.id ||= `form-${++forms}`;
  replacement.type = 'submit';
  replacement.setAttribute('form', form.id);
  // Likewise, a fast child save must not turn the second click into a submission of its parent form.
  replacement.addEventListener('click', (e) => {
    if (e.detail > 1) e.preventDefault();
  });
  okButton.replaceWith(replacement);
  // It takes the focus the button it replaces had, until the form puts it on a field of its own.
  replacement.focus({ preventScroll: true });

  /** @type {AbortController | null} calls off the save going on */
  let saving = null;
  let closed = false;
  const cancel = () => dialog.close(null);
  signal?.addEventListener('abort', cancel, { once: true });
  // Closed by the user while saving: what the save started is not wanted. Closed by the save itself, there is
  // nothing left to call off.
  dialog.result.then(() => {
    closed = true;
    saving?.abort();
    signal?.removeEventListener('abort', cancel);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Saving can take a moment, and a second OK must not save twice.
    if (saving || closed || signal?.aborted) return;
    saving = new AbortController();
    replacement.disabled = true;
    error.hidden = true;
    const slow = busy && setTimeout(() => (busy.hidden = false), BUSY_AFTER_MS);
    try {
      const saved = await save(saving.signal);
      if (saved !== undefined) dialog.close(saved);
    } catch (err) {
      error.textContent = errorText(err);
      error.hidden = false;
    } finally {
      clearTimeout(slow);
      if (busy) busy.hidden = true;
      saving = null;
      replacement.disabled = false;
    }
  });
  return dialog.result;
}

/** A yes/no question. Resolves true for OK. */
export function confirmDialog(message, { title = 'buddylist', ok = 'OK', cancel = 'Cancel' } = {}) {
  return openDialog({
    title,
    body: messageBody(message),
    buttons: [
      { label: ok, value: true, default: true },
      { label: cancel, value: false },
    ],
    dismissValue: false,
  }).result;
}

/** A message with an OK button. */
export function infoDialog(title, body) {
  return openDialog({ title, body, buttons: [{ label: 'OK', value: true, default: true }], dismissValue: true }).result;
}
