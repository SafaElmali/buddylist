// Tiny DOM helpers. `html` is a tagged template that escapes everything you
// interpolate unless you wrap it in raw(), so view code stays XSS-safe.

const RAW = Symbol('raw');

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/** Mark trusted markup (icons, sanitized Markdown) so html`` won't escape it. */
export const raw = (markup) => ({ [RAW]: String(markup ?? '') });

function toMarkup(value) {
  if (value == null || value === false) return '';
  if (Array.isArray(value)) return value.map(toMarkup).join('');
  if (typeof value === 'object' && RAW in value) return value[RAW];
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += toMarkup(value) + strings[i + 1];
  });
  return raw(out);
}

// A plain string passed to el() is markup written in our own code;
// anything containing outside data must go through html``.
const markupOf = (value) => (typeof value === 'string' ? value : toMarkup(value));

/** Build one element from a markup literal or html`` result. */
export function el(markup) {
  const template = document.createElement('template');
  template.innerHTML = markupOf(markup).trim();
  return /** @type {HTMLElement} */ (template.content.firstElementChild);
}

export const $ = (selector, root = document) => /** @type {HTMLElement} */ (root.querySelector(selector));
export const $$ = (selector, root = document) => /** @type {HTMLElement[]} */ ([...root.querySelectorAll(selector)]);

/** Strip Electron's "Error invoking remote method" prefix from IPC errors. */
export const errorText = (err) =>
  String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
