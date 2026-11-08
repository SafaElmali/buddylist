// What the Settings pages are made of: a heading with a few words under it, a
// switch, a box to type in, a list you add to, and a list whose lines open their
// settings. Each one says what it was changed to as soon as it was: there is no
// OK to press.
import { el, html, raw } from '../lib/dom.js';

// An eye, for showing a value that is kept out of sight. Drawn here: no other window has one.
const EYE =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>';
const CROSS =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const CHEVRON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const PLUS =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
let listFieldId = 0;

/**
 * A part of a page: a heading, what it is about, and its controls.
 * @param {string} title
 * @param {unknown} hint  a few words, or html`` for ones with code in them; '' for none
 * @param {...(HTMLElement | null | false)} controls
 */
export function group(title, hint, ...controls) {
  const node = el(html`<section class="st-group"><h2>${title}</h2></section>`);
  if (hint) node.append(el(html`<p class="st-hint">${hint}</p>`));
  node.append(...controls.filter(Boolean));
  return node;
}

/**
 * A part of a page with a button beside its heading, such as the one that adds to the list under it:
 * it is in reach however long the list gets.
 * @param {string} title
 * @param {unknown} hint
 * @param {HTMLElement} action
 * @param {...(HTMLElement | null | false)} controls
 */
export function groupWithButton(title, hint, action, ...controls) {
  const node = group(title, hint, ...controls);
  const heading = node.querySelector('h2');
  const head = el('<div class="st-group-head"></div>');
  heading.replaceWith(head);
  head.append(heading, action);
  return node;
}

/**
 * A box or a list with what it is above it.
 * @param {string} label
 * @param {HTMLElement} control
 */
export function field(label, control) {
  const node = el(html`<label class="st-field"><span class="st-field-label">${label}</span></label>`);
  node.append(control);
  return node;
}

/**
 * A drop-down of our own, as the dialogs have (see lib/combo.js), with what it is above it: a button that opens a
 * list, such as a service's with each one's picture, or a model's, which can be searched and typed into. What is
 * picked is kept in a hidden field, as a select would keep it, and saved as it is picked.
 * @template {(...args: any[]) => void} Show
 * @param {string} label  also what a screen reader calls it
 * @param {object} opts
 * @param {string} opts.value
 * @param {string} opts.kind  what is picked, such as 'service', 'model' or 'effort': the button's class, `${kind}-combo`
 * @param {(button: HTMLButtonElement, input: HTMLInputElement) => Show} opts.make  makes the button the way to pick,
 *   as servicePicker, modelPicker and effortPicker do. It is in its field by then, which it may hide
 * @param {(value: string) => void} [opts.onSave]
 * @returns {{ node: HTMLElement, input: HTMLInputElement, show: Show }}  `show`: what `make` answered, which shows the
 *   pick again
 */
export function pickerField(label, { value, kind, make, onSave }) {
  const input = /** @type {HTMLInputElement} */ (el('<input type="hidden" />'));
  input.value = value ?? '';
  const button = /** @type {HTMLButtonElement} */ (
    el(html`<button type="button" class="combo ${kind}-combo" aria-haspopup="menu" aria-label="${label}"></button>`)
  );
  const node = field(label, row(input, button));
  const show = make(button, input);
  if (onSave) input.addEventListener('change', () => onSave(input.value));
  return { node, input, show };
}

/** Fields next to each other, as many to a line as there is room for. @param {...(HTMLElement | null | false)} items */
export function fields(...items) {
  const node = el('<div class="st-fields"></div>');
  node.append(...items.filter(Boolean));
  return node;
}

/**
 * Lines that each say how something is set, such as a project's scripts, and turn to the page that sets it.
 * @param {{ label: string, value: string, go: () => void }[]} lines
 */
export function pageLinks(lines) {
  const node = el('<div class="st-links"></div>');
  for (const { label, value, go } of lines) {
    const line = el(
      html`<button class="st-link" type="button">
        <b class="st-link-name">${label}</b><span class="st-link-value" title="${value}">${value}</span>${raw(CHEVRON)}
      </button>`
    );
    line.addEventListener('click', go);
    node.append(line);
  }
  return node;
}

/**
 * A list of things that each have a few settings, such as roles: a line for each, with its name and a few
 * words on how it is set up, that opens its settings under it. One is open at a time, so the list stays
 * short however many there are. Esc closes the one that is open, from anywhere in it, before it closes
 * Settings.
 * @template {{ id: string }} T
 * @param {object} opts
 * @param {() => T[]} opts.items  as they are now: asked again each time the list is drawn
 * @param {(item: T) => string} opts.name
 * @param {(item: T) => string} opts.summary
 * @param {(item: T, line: { label: () => void, redraw: () => void }) => (HTMLElement | null | false)[]} opts.settings
 *   drawn when it is opened. `label` says its name and summary again after a change, and `redraw` draws its
 *   settings again, such as for another service.
 * @param {string} opts.empty  what stands there while there are none
 * @param {(item: T) => void} [opts.remove]  takes one out of `items`: an × at the end of each line
 * @param {(item: T) => void} [opts.closed]  one that was open was closed, before the list is drawn again
 * @param {(item: T) => HTMLElement} [opts.aside]  a control at the end of each line, beside its head, such as a
 *   switch that turns it on or off: it is used without opening the line
 */
export function foldList({ items, name, summary, settings, empty, remove, closed, aside }) {
  const node = el(
    html`<div class="st-fold-list">
      <p class="st-list-empty">${empty}</p>
      <div class="st-folds"></div>
    </div>`
  );
  const none = /** @type {HTMLElement} */ (node.querySelector('.st-list-empty'));
  const list = /** @type {HTMLElement} */ (node.querySelector('.st-folds'));
  let open = '';
  /** Each line's head, by what it is of: the one that was clicked is focused again once it is drawn anew. */
  let heads = new Map();
  /** What says each line's name and summary again, by what it is of. */
  let labels = new Map();

  /** Opens one line, or none, and draws the list again. @param {string} id */
  function openLine(id) {
    const was = open;
    open = id;
    if (was && was !== id) {
      const item = items().find((one) => one.id === was);
      if (item) closed?.(item);
    }
    draw();
  }

  /** @param {T} item */
  function line(item) {
    const isOpen = item.id === open;
    const entry = el(
      html`<div class="st-fold${isOpen ? ' open' : ''}">
        <button class="st-fold-head" type="button" aria-expanded="${String(isOpen)}">
          ${raw(CHEVRON)}<span class="st-fold-text"
            ><b class="st-fold-name"></b><span class="st-fold-summary"></span
          ></span>
        </button>
      </div>`
    );
    const head = /** @type {HTMLButtonElement} */ (entry.querySelector('.st-fold-head'));
    const label = () => {
      const named = /** @type {HTMLElement} */ (head.querySelector('.st-fold-name'));
      const words = /** @type {HTMLElement} */ (head.querySelector('.st-fold-summary'));
      // In a narrow window a summary, or a name in a list you add to, loses its end: pointing at it says it whole.
      named.textContent = named.title = name(item);
      words.textContent = words.title = summary(item);
    };
    label();
    head.addEventListener('click', () => {
      openLine(isOpen ? '' : item.id);
      heads.get(item.id)?.focus();
    });
    heads.set(item.id, head);
    labels.set(item.id, label);
    // Beside the head rather than in it, as the × is: a button can't hold another control.
    if (aside) {
      const control = aside(item);
      control.classList.add('st-fold-aside');
      entry.append(control);
    }
    if (remove) {
      // Beside the head rather than in it: a button can't hold another.
      const cross = el(
        html`<button class="st-icon remove danger" type="button" title="Remove" aria-label="Remove">
          ${raw(CROSS)}
        </button>`
      );
      cross.addEventListener('click', () => {
        const at = items().indexOf(item);
        if (isOpen) open = '';
        remove(item);
        draw();
        // The line that took its place is in focus, or the one before it at the end of the list.
        const left = items();
        heads.get((left[at] ?? left[at - 1])?.id)?.focus();
      });
      entry.append(cross);
    }
    if (isOpen) {
      const body = el('<div class="st-fold-body"></div>');
      body.append(...settings(item, { label, redraw: () => entry.replaceWith(line(item)) }).filter(Boolean));
      entry.append(body);
    }
    return entry;
  }

  function draw() {
    const all = items();
    heads = new Map();
    labels = new Map();
    list.replaceChildren(...all.map(line));
    list.hidden = !all.length;
    none.hidden = all.length > 0 || !empty;
  }

  list.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented || !open) return;
    const target = /** @type {HTMLElement} */ (e.target);
    if (!target.closest('.st-fold.open')) return;
    e.preventDefault();
    e.stopPropagation();
    const id = open;
    // A box says what was typed in it as it is left, which a box that is only taken away does not.
    target.blur();
    openLine('');
    heads.get(id)?.focus();
  });

  draw();
  return {
    node,
    draw,
    /** Says every line's name and summary again, such as once a service says how it stands, leaving what is open as it is. */
    relabel: () => labels.forEach((say) => say()),
    /**
     * Opens one, such as one that was just added.
     * @param {string} id
     * @returns {HTMLElement | null} its settings
     */
    show(id) {
      openLine(id);
      return heads.get(id)?.parentElement.querySelector('.st-fold-body') ?? null;
    },
  };
}

/**
 * A switch.
 * @param {object} opts
 * @param {string} opts.label
 * @param {unknown} [opts.hint]
 * @param {string} [opts.warning]  what turning it on costs
 * @param {boolean} opts.checked
 * @param {(on: boolean) => void} opts.onChange
 */
export function toggle({ label, hint = '', warning = '', checked, onChange }) {
  const role = document.documentElement.dataset.look === 'professional' ? 'switch' : 'checkbox';
  const node = el(
    html`<section class="st-group">
      <label class="st-toggle"
        ><input type="checkbox" role="${role}" /><span
          ><b>${label}</b>${hint ? html`<p class="st-hint">${hint}</p>` : ''}${
            warning ? html`<p class="st-warning">${warning}</p>` : ''
          }</span
        ></label
      >
    </section>`
  );
  const box = /** @type {HTMLInputElement} */ (node.querySelector('input'));
  box.checked = Boolean(checked);
  box.addEventListener('change', () => onChange(box.checked));
  return node;
}

/**
 * One line to type in. It is saved when you leave it, or press Enter.
 * @param {object} opts
 * @param {string} opts.value
 * @param {string} [opts.placeholder]
 * @param {string} [opts.label]  what a screen reader calls it
 * @param {boolean} [opts.mono]  for a path or a name a program reads
 * @param {number} [opts.maxlength]
 * @param {(value: string) => void} opts.onSave
 * @param {(value: string) => void} [opts.onInput]  as it is typed
 */
export function textBox({ value, placeholder = '', label = '', mono = false, maxlength, onSave, onInput }) {
  const input = /** @type {HTMLInputElement} */ (
    el(html`<input class="input${mono ? ' st-mono' : ''}" type="text" spellcheck="false" autocomplete="off" />`)
  );
  input.value = value ?? '';
  input.placeholder = placeholder;
  if (label) input.setAttribute('aria-label', label);
  if (maxlength) input.maxLength = maxlength;
  input.addEventListener('change', () => onSave(input.value));
  if (onInput) input.addEventListener('input', () => onInput(input.value));
  return input;
}

/**
 * Several lines to type in: a script, or instructions. Saved when you leave it.
 * @param {object} opts
 * @param {string} opts.value
 * @param {string} [opts.placeholder]
 * @param {string} [opts.label]
 * @param {number} [opts.rows]
 * @param {boolean} [opts.prose]  words, not commands: they wrap
 * @param {(value: string) => void} opts.onSave
 */
export function codeBox({ value, placeholder = '', label = '', rows = 4, prose = false, onSave }) {
  const box = /** @type {HTMLTextAreaElement} */ (
    el(
      html`<textarea class="input st-code${prose ? ' prose' : ''}" spellcheck="${prose ? 'true' : 'false'}"></textarea>`
    )
  );
  box.value = value ?? '';
  box.rows = rows;
  box.placeholder = placeholder;
  if (label) box.setAttribute('aria-label', label);
  box.addEventListener('change', () => onSave(box.value));
  return box;
}

/**
 * One of a few to pick.
 * @param {object} opts
 * @param {string} opts.value
 * @param {{ value: string, label: string }[]} opts.options
 * @param {string} [opts.label]
 * @param {(value: string) => void} opts.onSave
 */
export function choice({ value, options, label = '', onSave }) {
  const select = /** @type {HTMLSelectElement} */ (el('<select class="input"></select>'));
  for (const option of options) select.append(new Option(option.label, option.value));
  // What was picked before may be gone by now. It stays picked until something else is.
  if (value && !options.some((option) => option.value === value)) select.append(new Option(value, value));
  select.value = value;
  if (label) select.setAttribute('aria-label', label);
  select.addEventListener('change', () => onSave(select.value));
  return select;
}

/**
 * A choice that is better seen than read, such as how the windows look: a picture of each, with its name
 * under it, as many to a line as there is room for. The one in use is pressed.
 * @param {object} opts
 * @param {string} opts.value
 * @param {{ value: string, label: string, picture: unknown }[]} opts.options  `picture`: html`` of its <img>s
 * @param {string} opts.label  what is chosen, for a screen reader
 * @param {(value: string) => void} opts.onSave
 */
export function pictureChoice({ value, options, label, onSave }) {
  const node = el(
    html`<div class="st-pictures" role="group" aria-label="${label}">
      ${options.map(
        (option) =>
          html`<button class="st-picture" type="button" data-value="${option.value}" aria-pressed="false">
            <span class="st-picture-frame">${option.picture}</span>
            <span class="st-picture-name">${option.label}</span>
          </button>`
      )}
    </div>`
  );
  const buttons = /** @type {HTMLButtonElement[]} */ ([...node.querySelectorAll('.st-picture')]);
  const press = (picked) => {
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.value === picked));
  };
  press(value);
  for (const button of buttons) {
    button.addEventListener('click', () => {
      press(button.dataset.value);
      onSave(button.dataset.value);
    });
  }
  return node;
}

/** Controls next to each other. @param {...(HTMLElement | null | false)} controls */
export function row(...controls) {
  const node = el('<div class="st-row"></div>');
  node.append(...controls.filter(Boolean));
  return node;
}

/** @param {string} label @param {() => void} action @param {{ kind?: 'primary' | 'danger' }} [options] */
export function button(label, action, { kind } = {}) {
  const variant = kind === 'primary' ? ' default' : kind === 'danger' ? ' danger' : '';
  const node = el(html`<button class="btn${variant}" type="button">${label}</button>`);
  node.addEventListener('click', action);
  return node;
}

/**
 * A list you add to and take from, such as quick messages: a line for each thing, with its first part and
 * the rest after it, that opens a box for each of its parts. It is a list whose lines fold (foldList), so
 * it stays as short, and an × at the end of a line takes it out.
 * It says what the whole list is whenever a part was changed or one was taken out. One that was only just
 * added is not said until something is typed in it, and is not kept if it is closed with nothing in it.
 * @param {object} opts
 * @param {Record<string, any>[]} opts.items  what is not in a box, such as a script's id, stays with its line
 * @param {{ key: string, placeholder: string, kind?: 'text' | 'secret' | 'code' | 'prose', mono?: boolean, label?: string }[]} opts.fields
 *   `prose`: words, such as a message, that wrap as a command does and are spelled
 * @param {string} opts.add  what the button that adds one says
 * @param {string} [opts.empty]  what stands there while it has none
 * @param {() => Record<string, any> | null | Promise<Record<string, any> | null>} [opts.make]  the one Add starts
 *   with: null adds none, and one with something in it is said at once
 * @param {(items: Record<string, any>[]) => void} opts.onChange
 */
export function listEditor({ items, fields, add, empty = '', make = () => ({}), onChange }) {
  /** @typedef {{ id: string, values: Record<string, string>, rest: Record<string, any>, said: boolean }} Line */
  const [first, ...others] = fields;
  const untitled = add.replace(/^Add\b/, 'New').replace(/(\.\.\.|…)$/, '');
  /** @param {Record<string, any>} item @param {boolean} said @returns {Line} */
  const toLine = (item, said) => ({
    id: `st-list-line-${++listFieldId}`,
    values: Object.fromEntries(fields.map((field) => [field.key, item[field.key] ?? ''])),
    rest: Object.fromEntries(Object.entries(item).filter(([key]) => !fields.some((field) => field.key === key))),
    said,
  });
  let lines = items.map((item) => toLine(item, true));

  const foot = el(
    html`<div class="st-list-foot"><button class="btn default" type="button">${raw(PLUS)}${add}</button></div>`
  );
  const addButton = /** @type {HTMLButtonElement} */ (foot.querySelector('button'));

  const save = () => {
    for (const line of lines) line.said = true;
    onChange(lines.map(({ values, rest }) => ({ ...rest, ...values })));
  };
  /** A part as its line says it: a value kept out of sight stays out of it. @param {Line} line @param {typeof first} field */
  const shown = (line, field) => {
    const value = line.values[field.key].trim();
    return field.kind === 'secret' && value ? '••••••••' : value;
  };
  /** @param {Line} line */
  const more = (line) =>
    others
      .map((field) => shown(line, field))
      .filter(Boolean)
      .join(' · ');

  const list = foldList({
    items: () => lines,
    // One without its first part, such as a message without a name, is called by the rest, as it is kept. One
    // with nothing in it yet is called as Add calls it, such as New quick message, as a new role is New role.
    name: (line) => shown(line, first) || more(line) || untitled,
    summary: (line) => (shown(line, first) ? more(line) : ''),
    settings: (line, { label }) =>
      fields.map((field) => {
        const cell = box(field, fields.length > 1);
        const input = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (cell.querySelector('.input'));
        input.value = line.values[field.key];
        input.addEventListener('input', () => {
          line.values[field.key] = input.value;
          label();
        });
        input.addEventListener('change', save);
        return cell;
      }),
    empty,
    remove: (line) => {
      lines = lines.filter((other) => other !== line);
      if (line.said) save();
    },
    closed: (line) => {
      if (fields.some((field) => line.values[field.key].trim())) return;
      lines = lines.filter((other) => other !== line);
      if (line.said) save();
      // Its line is gone, so Add is in focus: Add, then Esc, is as if Add was not pressed.
      addButton.focus();
    },
  });
  const node = list.node;
  node.classList.add('st-list');
  // A command, an address or a value kept out of sight is read in the font it is typed in.
  node.classList.toggle(
    'mono',
    others.some((field) => field.mono || field.kind === 'code' || field.kind === 'secret')
  );
  node.append(foot);
  addButton.addEventListener('click', async () => {
    const item = await make();
    if (!item) return;
    const line = toLine(item, false);
    lines.push(line);
    const body = list.show(line.id);
    /** @type {HTMLElement | null | undefined} */ (body?.querySelector('.input'))?.focus();
    // One that came with something in it, such as a file that was picked, is there to stay.
    if (fields.some((field) => item[field.key])) save();
  });
  return node;
}

/**
 * A box for one part of a line in a list you add to, with what it is over it when the line has more than one.
 * @param {{ key: string, placeholder: string, kind?: 'text' | 'secret' | 'code' | 'prose', mono?: boolean, label?: string }} field
 * @param {boolean} labelled
 */
function box(field, labelled) {
  const id = `st-list-field-${++listFieldId}`;
  const name = field.label || field.placeholder;
  const wide = field.kind === 'code' || field.kind === 'prose';
  const cell = el(
    html`<div class="st-field${wide ? ' wide' : ''}">
      ${labelled ? html`<label class="st-field-label" for="${id}">${name}</label>` : ''}
    </div>`
  );
  let input;
  if (wide) {
    const prose = field.kind === 'prose';
    input = el(
      html`<textarea class="input st-code${prose ? ' prose' : ''}" rows="1" spellcheck="${String(prose)}"></textarea>`
    );
    // CSS sizes a command or message as it wraps, including after a change of look or window size.
    cell.append(input);
  } else if (field.kind === 'secret') {
    const wrap = el(
      html`<span class="st-secret"
        ><input class="input st-mono" type="password" spellcheck="false" autocomplete="off" /><button
          class="st-icon"
          type="button"
          title="Show"
          aria-label="Show the value"
        >
          ${raw(EYE)}
        </button></span
      >`
    );
    input = wrap.querySelector('input');
    wrap.querySelector('button').addEventListener('click', (e) => {
      const shown = input.type === 'text';
      input.type = shown ? 'password' : 'text';
      e.currentTarget.title = shown ? 'Show' : 'Hide';
    });
    cell.append(wrap);
  } else {
    input = el(html`<input class="input${field.mono ? ' st-mono' : ''}" type="text" spellcheck="false" />`);
    cell.append(input);
  }
  input.id = id;
  input.placeholder = field.placeholder;
  input.setAttribute('aria-label', name);
  return cell;
}
