import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ABOUT, SHORT_MAX, aboutLine, putAboutAway, putAway } from '../src/renderer/chat/pane-about.js';
import { addMenu } from '../src/renderer/chat/side-pane.js';
import { el } from '../src/renderer/lib/dom.js';
import { page } from './fixtures/dom.js';
import { paneFor } from './fixtures/side-pane.js';

/** Storage that keeps what it is given, as localStorage does. */
const storage = () => {
  const kept = new Map();
  return { getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, String(value)), kept };
};

test('every kind of tab says what it is in a few words for the +, and in a sentence or two over the tab', () => {
  for (const [kind, { short, full }] of Object.entries(ABOUT)) {
    assert.ok(short && !/\n/.test(short), `${kind}: one line`);
    assert.ok(short.length <= SHORT_MAX, `${kind}: “${short}” is ${short.length} characters, more than ${SHORT_MAX}`);
    assert.doesNotMatch(short, /\.$/, `${kind}: a label, not a sentence`);
    const sentences = full.split(/(?<=[.!?])\s+(?=[A-Z])/);
    assert.ok(sentences.length >= 1 && sentences.length <= 2, `${kind}: “${full}” is ${sentences.length} sentences`);
    assert.match(full, /\.$/, `${kind}: ends as a sentence does`);
  }
});

// The tabs main.js lists in the side pane's + (paneMenu) and in its lower half's (lowerMenu), by the name it
// gives each, and where that kind of tab is made.
const KINDS = {
  team: ['team-tab.js', 'TeamTab'],
  brief: ['brief-tab.js', 'BriefTab'],
  changes: ['changes.js', 'Changes'],
  files: ['files.js', 'Files'],
  terminals: ['terminals.js', 'Terminals'],
  browser: ['browser.js', 'Browser'],
  checks: ['checks.js', 'Checks'],
  prStack: ['pr-stack.js', 'PrStack'],
  session: ['session.js', 'Session'],
  shared: ['shared-tab.js', 'SharedTab'],
  agents: ['agents-tab.js', 'AgentsTab'],
  helpers: ['helpers.js', 'Helpers'],
  background: ['background.js', 'Background'],
  scripts: ['script-tabs.js', 'ScriptTabs'],
};

test('every kind of tab the side pane’s + menus list has both, under the same name in the menu as on its tab', async (t) => {
  const main = readFileSync(new URL('../src/renderer/chat/main.js', import.meta.url), 'utf8');
  const menus = ['paneMenu', 'lowerMenu']
    .map((name) => main.match(new RegExp(`^function ${name}\\(\\) \\{[\\s\\S]*?\\n\\}$`, 'm'))[0])
    .join('\n');
  const listed = new Set([...menus.matchAll(/\b(\w+)\.kinds?\b/g)].map(([, name]) => name));
  assert.deepEqual([...listed].sort(), Object.keys(KINDS).sort(), 'a kind the + lists that is not here: add it');

  // What these modules read of the page as they load: the app's bridge, whatever they ask of it, among them.
  /** @type {any} */
  const bridge = new Proxy(() => {}, { get: () => bridge, apply: () => undefined });
  const previous = { window: globalThis.window, location: globalThis.location };
  Object.assign(globalThis, {
    window: { messenger: bridge, addEventListener() {}, removeEventListener() {} },
    location: { href: 'file:///app/chat.html', search: '' },
  });
  page(t);
  t.after(() => {
    for (const [name, was] of Object.entries(previous)) {
      if (was === undefined) delete globalThis[name];
      else globalThis[name] = was;
    }
  });
  const kinds = [];
  for (const [file, name] of Object.values(KINDS)) {
    const { prototype } = (await import(`../src/renderer/chat/${file}`))[name];
    const getter = (key) => Object.getOwnPropertyDescriptor(prototype, key)?.get;
    // A getter makes its kind with what it opens it with, which is not called here.
    kinds.push(...(getter('kinds')?.call({}) ?? [getter('kind').call({})]));
  }
  for (const kind of kinds) {
    assert.ok(ABOUT[kind.about], `${kind.label}: its kind is in pane-about.js`);
    const [item] = addMenu([kind]);
    assert.equal(item.about, ABOUT[kind.about].short, `${kind.label}: the + says what it is under its name`);
  }
  assert.deepEqual(
    Object.keys(ABOUT).sort(),
    [...new Set(kinds.map((kind) => kind.about))].sort(),
    'and nothing in pane-about.js that the + does not list'
  );
});

test('what is put away is kept for every tab of its kind, and storage that keeps nothing puts nothing away', () => {
  const kept = storage();
  assert.equal(aboutLine('changes', putAway(kept)), ABOUT.changes.full);
  putAboutAway('changes', kept);
  putAboutAway('changes', kept);
  putAboutAway('terminal', kept);
  assert.deepEqual([...putAway(kept)], ['changes', 'terminal'], 'once each');
  assert.equal(aboutLine('changes', putAway(kept)), null);
  assert.equal(aboutLine('files', putAway(kept)), ABOUT.files.full, 'the other kinds still say theirs');
  assert.equal(aboutLine(undefined, putAway(kept)), null, 'a file or a plan has none');

  const broken = {
    getItem: () => {
      throw new Error('no storage');
    },
    setItem: () => {
      throw new Error('no storage');
    },
  };
  assert.doesNotThrow(() => putAboutAway('changes', broken));
  assert.deepEqual([...putAway(broken)], []);
  assert.deepEqual([...putAway({ getItem: () => '{"not": "a list"}' })], [], 'what is not a list is nothing');
});

const tab = (id, more = {}) => ({ id, title: id, body: el('<div></div>'), icon: '', ...more });
const line = (pane, half = 'upper') => pane.halves[half].about;

test('over the tab a half shows is what its kind of tab is, and the tab is described by it', (t) => {
  const { pane } = paneFor(t, { localStorage: storage() });
  pane.open(tab('changes', { about: 'changes' }));
  assert.equal(line(pane).hidden, false);
  assert.equal(line(pane).querySelector('p').textContent, ABOUT.changes.full);
  const chosen = pane.root.querySelector('.pane-tab.selected');
  assert.equal(chosen.getAttribute('aria-describedby'), line(pane).querySelector('p').id);
  assert.equal(line(pane).getAttribute('role'), 'note');
  assert.equal(line(pane).querySelector('button').getAttribute('aria-label'), 'Hide this note');

  pane.open(tab('file:notes.md'));
  assert.equal(line(pane).hidden, true, 'a file has none');
  pane.select('changes');
  assert.equal(line(pane).hidden, false, 'going back brings it back');

  pane.open(tab('script-run', { about: 'run', lower: true }));
  assert.equal(line(pane, 'lower').querySelector('p').textContent, ABOUT.run.full, 'the lower half has its own');
  assert.equal(line(pane).querySelector('p').textContent, ABOUT.changes.full);
});

test('its ✕ puts it away for every tab of that kind, in every conversation, and gives the tab the keyboard', (t) => {
  const kept = storage();
  const { pane, document } = paneFor(t, { localStorage: kept });
  pane.open(tab('terminal-1', { about: 'terminal', lower: true }));
  pane.open(tab('changes', { about: 'changes' }));
  line(pane, 'lower').querySelector('button').click();
  assert.equal(line(pane, 'lower').hidden, true);
  assert.equal(document.activeElement?.dataset.id, 'terminal-1');
  assert.equal(
    pane.root.querySelector('.pane-tab[data-id="terminal-1"]').getAttribute('aria-describedby'),
    null,
    'nothing left to describe it'
  );
  assert.equal(line(pane).hidden, false, 'another kind still says what it is');

  pane.open(tab('terminal-2', { about: 'terminal', lower: true }));
  assert.equal(line(pane, 'lower').hidden, true, 'another terminal has none either');

  // Another conversation's window reads what was put away.
  const other = paneFor(t, { localStorage: kept }).pane;
  other.open(tab('terminal-9', { about: 'terminal', lower: true }));
  assert.equal(line(other, 'lower').hidden, true);
});

test('the + says what each kind is under its name; what it lists after them has no line', () => {
  const items = addMenu(
    [
      { label: 'Changes', about: 'changes', icon: '', open() {} },
      { label: 'Session', about: 'session', icon: '', open() {} },
    ],
    { more: [{ label: 'Plan: cart total', action() {} }] }
  );
  assert.deepEqual(
    items.map(({ label, about }) => [label, about]),
    [
      ['Changes', ABOUT.changes.short],
      ['Session', ABOUT.session.short],
      [undefined, undefined],
      ['Plan: cart total', undefined],
    ]
  );
});
