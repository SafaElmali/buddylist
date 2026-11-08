// Just enough of a page for a control in Settings to be drawn, clicked and typed in under node --test: markup
// made into elements, classes, simple selectors, events that bubble, and focus that says a box was changed as
// it is left, as a browser does. A box taken out of the page while in focus says nothing, as in a browser.

const VOID = new Set(['input', 'br', 'img', 'path', 'circle', 'rect', 'line', 'polyline']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
const decode = (text) => text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name) => ENTITIES[name]);

class Text {
  parentElement = null;
  constructor(text) {
    this.data = text;
  }
  get textContent() {
    return this.data;
  }
}

/** `data-*` attributes by the names `dataset` gives them: data-tool-id is toolId. */
const dataName = (name) => `data-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

export class Element {
  parentElement = null;
  childNodes = [];
  attributes = new Map();
  listeners = {};
  focusedValue = null;
  /** What was typed or set, as against what the markup says. */
  #value = null;
  #selected = null;
  /** Styles set one by one, as `style.setProperty` sets them: nothing is laid out. */
  style = {
    props: new Map(),
    setProperty: (name, value) => this.style.props.set(name, String(value)),
    removeProperty: (name) => this.style.props.delete(name),
    getPropertyValue: (name) => this.style.props.get(name) ?? '',
  };

  constructor(document, tag) {
    this.ownerDocument = document;
    this.tagName = tag.toUpperCase();
    const own = this;
    this.classList = {
      get names() {
        return (own.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
      },
      contains: (name) => this.classList.names.includes(name),
      add: (...names) => this.setAttribute('class', [...new Set([...this.classList.names, ...names])].join(' ')),
      remove: (...names) =>
        this.setAttribute('class', this.classList.names.filter((one) => !names.includes(one)).join(' ')),
      toggle: (name, on = !this.classList.contains(name)) => {
        if (on) this.classList.add(name);
        else this.classList.remove(name);
        return on;
      },
    };
  }

  // ---- attributes
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  hasAttribute(name) {
    return this.attributes.has(name);
  }
  get id() {
    return this.getAttribute('id') ?? '';
  }
  set id(value) {
    this.setAttribute('id', value);
  }
  get className() {
    return this.getAttribute('class') ?? '';
  }
  set className(value) {
    this.setAttribute('class', value);
  }
  get dataset() {
    return new Proxy(
      {},
      {
        get: (_, name) => (typeof name === 'string' ? (this.getAttribute(dataName(name)) ?? undefined) : undefined),
        set: (_, name, value) => (this.setAttribute(dataName(String(name)), value), true),
        has: (_, name) => this.hasAttribute(dataName(String(name))),
        deleteProperty: (_, name) => (this.removeAttribute(dataName(String(name))), true),
      }
    );
  }
  get hidden() {
    return this.hasAttribute('hidden');
  }
  set hidden(on) {
    if (on) this.setAttribute('hidden', '');
    else this.removeAttribute('hidden');
  }
  get title() {
    return this.getAttribute('title') ?? '';
  }
  set title(value) {
    this.setAttribute('title', value);
  }
  get type() {
    return this.getAttribute('type') ?? '';
  }
  set type(value) {
    this.setAttribute('type', value);
  }
  get placeholder() {
    return this.getAttribute('placeholder') ?? '';
  }
  set placeholder(value) {
    this.setAttribute('placeholder', value);
  }
  /** A box is ticked as its markup says, until it is ticked or unticked. */
  #checked = null;
  get checked() {
    return this.#checked ?? this.hasAttribute('checked');
  }
  set checked(on) {
    this.#checked = Boolean(on);
  }

  // ---- what a field holds: a select, its chosen option's; a box, what its markup says until it is changed
  get value() {
    if (this.tagName === 'SELECT') {
      const options = this.querySelectorAll('option');
      return (options.find((option) => option.selected) ?? options[0])?.value ?? '';
    }
    if (this.#value !== null) return this.#value;
    if (this.tagName === 'OPTION') return this.getAttribute('value') ?? this.textContent;
    return this.getAttribute('value') ?? '';
  }
  set value(value) {
    if (this.tagName !== 'SELECT') this.#value = String(value);
    else for (const option of this.querySelectorAll('option')) option.selected = option.value === String(value);
  }
  get selected() {
    return this.#selected ?? this.hasAttribute('selected');
  }
  set selected(on) {
    this.#selected = Boolean(on);
  }
  /** A form's fields, by their names. */
  get elements() {
    const named = this.querySelectorAll('input, select, textarea, button').filter((node) => node.getAttribute('name'));
    return Object.fromEntries(named.map((node) => [node.getAttribute('name'), node]));
  }

  // ---- what is in it
  get children() {
    return this.childNodes.filter((node) => node instanceof Element);
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  hasChildNodes() {
    return this.childNodes.length > 0;
  }
  get firstElementChild() {
    return this.children[0] ?? null;
  }
  get lastElementChild() {
    return this.children.at(-1) ?? null;
  }
  get childElementCount() {
    return this.children.length;
  }
  get nextElementSibling() {
    const siblings = this.parentElement?.children ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get previousElementSibling() {
    const siblings = this.parentElement?.children ?? [];
    return siblings[siblings.indexOf(this) - 1] ?? null;
  }
  cloneNode(deep = false) {
    const copy = new Element(this.ownerDocument, this.tagName.toLowerCase());
    for (const [name, value] of this.attributes) copy.setAttribute(name, value);
    if (deep)
      copy.append(
        ...this.childNodes.map((node) => (node instanceof Element ? node.cloneNode(true) : new Text(node.data)))
      );
    return copy;
  }
  get textContent() {
    return this.childNodes.map((node) => node.textContent).join('');
  }
  set textContent(text) {
    this.replaceChildren(new Text(String(text)));
  }
  get isConnected() {
    let node = this;
    while (node.parentElement) node = node.parentElement;
    return node === this.ownerDocument.body;
  }
  /** The nodes, a string as the text it is, in this one. */
  #adopt(given) {
    const nodes = given.map((node) => (typeof node === 'string' ? new Text(node) : node));
    for (const node of nodes) {
      node.parentElement?.removeChild(node);
      node.parentElement = this;
    }
    return nodes;
  }
  removeChild(node) {
    this.ownerDocument.leaving(node);
    this.childNodes = this.childNodes.filter((one) => one !== node);
    node.parentElement = null;
  }
  append(...nodes) {
    // Adopting a child already in this parent replaces childNodes when it is removed.
    const adopted = this.#adopt(nodes);
    this.childNodes.push(...adopted);
  }
  prepend(...nodes) {
    const adopted = this.#adopt(nodes);
    this.childNodes.unshift(...adopted);
  }
  appendChild(node) {
    this.append(node);
    return node;
  }
  insertBefore(node, before) {
    if (!before) return this.appendChild(node);
    before.before(node);
    return node;
  }
  replaceChildren(...nodes) {
    for (const node of [...this.childNodes]) this.removeChild(node);
    this.append(...nodes);
  }
  before(...nodes) {
    const parent = this.parentElement;
    parent.#adopt(nodes);
    parent.childNodes.splice(parent.childNodes.indexOf(this), 0, ...nodes);
  }
  after(...nodes) {
    const parent = this.parentElement;
    const adopted = parent.#adopt(nodes);
    parent.childNodes.splice(parent.childNodes.indexOf(this) + 1, 0, ...adopted);
  }
  replaceWith(...nodes) {
    this.before(...nodes);
    this.remove();
  }
  remove() {
    this.parentElement?.removeChild(this);
  }

  // ---- finding
  matches(selector) {
    return selector.split(',').some((one) => matchesChain(this, one.trim().split(/\s+/)));
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
    return null;
  }
  querySelectorAll(selector) {
    const found = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  contains(node) {
    for (let at = node; at; at = at.parentElement) if (at === this) return true;
    return false;
  }

  // ---- events and focus
  addEventListener(type, listener) {
    (this.listeners[type] ??= []).push(listener);
  }
  removeEventListener(type, listener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((one) => one !== listener);
  }
  /** Sends an event that bubbles, with `fields` on it, such as `key`. The page hears it first, as a listener
   * that captures does. */
  fire(type, fields = {}) {
    let stopped = false;
    const event = {
      type,
      target: this,
      currentTarget: this,
      isComposing: false,
      defaultPrevented: false,
      ...fields,
      preventDefault: () => (event.defaultPrevented = true),
      stopPropagation: () => (stopped = true),
    };
    const path = [this.ownerDocument];
    for (let node = this; node; node = node.parentElement) path.push(node);
    for (const node of path) {
      if (stopped) break;
      event.currentTarget = node;
      for (const listener of node.listeners[type] ?? []) listener(event);
    }
    return event;
  }
  click() {
    this.fire('click');
  }
  /** An event made with `new Event(type)`, sent as `fire` sends one. */
  dispatchEvent(event) {
    return !this.fire(event.type).defaultPrevented;
  }
  scrollIntoView() {}
  /** Where it is on the page: nowhere, as nothing is laid out. */
  getBoundingClientRect() {
    return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
  }
  focus() {
    const document = this.ownerDocument;
    if (document.activeElement === this) return;
    document.activeElement?.blur();
    document.activeElement = this;
    this.focusedValue = this.value;
  }
  blur() {
    const document = this.ownerDocument;
    if (document.activeElement !== this) return;
    document.activeElement = null;
    if (this.value !== this.focusedValue && ['INPUT', 'TEXTAREA'].includes(this.tagName)) this.fire('change');
  }
}

/** Each part of a selector such as `.st-fold.open`, `button[aria-expanded="true"]` or `.menu-item:not(.disabled)`,
 * against one element. */
function matchesOne(node, part) {
  for (const [, not] of part.matchAll(/:not\(([^)]*)\)/g)) if (node.matches(not)) return false;
  part = part.replace(/:not\([^)]*\)/g, '');
  const tag = part.match(/^[a-z][a-z0-9-]*/i)?.[0];
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  for (const [, name] of part.matchAll(/\.([\w-]+)/g)) if (!node.classList.contains(name)) return false;
  for (const [, name, , value] of part.matchAll(/\[([\w-]+)(="([^"]*)")?\]/g)) {
    if (!node.hasAttribute(name)) return false;
    if (value !== undefined && node.getAttribute(name) !== value) return false;
  }
  return true;
}

/** A selector of parts one inside the other, such as `.st-list .st-fold-name`, or right inside: `.line > span`. */
function matchesChain(node, parts) {
  if (!matchesOne(node, parts.at(-1))) return false;
  const rest = parts.slice(0, -1);
  if (!rest.length) return true;
  if (rest.at(-1) === '>') return Boolean(node.parentElement) && matchesChain(node.parentElement, rest.slice(0, -1));
  for (let up = node.parentElement; up; up = up.parentElement) if (matchesChain(up, rest)) return true;
  return false;
}

/** Elements from markup that is well formed, as the html`` of the renderer makes it. */
function parse(document, markup) {
  const root = new Element(document, 'template');
  const open = [root];
  const pattern = /<!--[\s\S]*?-->|<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  for (const [, closing, tag, attrs, selfClosing, text] of markup.matchAll(pattern)) {
    const parent = open.at(-1);
    if (closing) open.pop();
    else if (tag) {
      const node = new Element(document, tag.toLowerCase());
      for (const [, name, , value] of attrs.matchAll(/([\w:-]+)(="([^"]*)")?/g))
        node.setAttribute(name, decode(value ?? ''));
      parent.append(node);
      if (!selfClosing && !VOID.has(tag.toLowerCase())) open.push(node);
    } else if (text) parent.append(new Text(decode(text)));
  }
  // What a textarea holds is its value.
  for (const box of root.querySelectorAll('textarea')) box.value = box.textContent;
  return root;
}

/**
 * A page for the test to use as `document`, until it is over.
 * @param {import('node:test').TestContext} t
 */
export function page(t, look = 'messenger') {
  const previous = globalThis.document;
  const document = {
    activeElement: null,
    documentElement: { dataset: { look } },
    listeners: {},
    addEventListener: Element.prototype.addEventListener,
    removeEventListener: Element.prototype.removeEventListener,
    createElement(tag) {
      if (tag !== 'template') return new Element(document, tag);
      return {
        content: { firstElementChild: null },
        set innerHTML(markup) {
          const root = parse(document, markup);
          this.content.firstElementChild = root.children[0] ?? null;
          this.content.firstElementChild?.remove();
        },
      };
    },
    /** A node that leaves the page takes the focus with it, without saying a box was changed. */
    leaving(node) {
      for (let at = document.activeElement; at; at = at.parentElement) if (at === node) document.activeElement = null;
    },
  };
  document.body = new Element(document, 'body');
  globalThis.document = document;
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  return document;
}
