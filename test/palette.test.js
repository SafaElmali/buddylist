import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contactsToGoTo,
  conversationGoesTo,
  conversationsToGoTo,
  fileToGoTo,
  KEYWORDS,
  matchScore,
  menuActions,
  MOST_CONVERSATIONS,
  MOST_FILES,
  paletteSections,
  ranked,
  searchHistoryName,
  settingsToGoTo,
} from '../src/shared/palette.js';
import { APP_SETTINGS, PROJECT_SETTINGS } from '../src/shared/settings-pages.js';
import { defaultShortcut, matchesShortcut, shortcutLabel } from '../src/shared/shortcuts.js';

const press = (code, { key = code, ctrl = false, alt = false, shift = false, meta = false } = {}) => ({
  code,
  key,
  ctrlKey: ctrl,
  altKey: alt,
  shiftKey: shift,
  metaKey: meta,
});

const names = (found) => found.map((one) => one.name);

// ---- the key ---------------------------------------------------------------------------------

const MAC_KEY = defaultShortcut('palette', 'mac');
const OTHER_KEY = defaultShortcut('palette', 'linux');

test('⌘K opens the palette on a Mac, and Ctrl+K everywhere else', () => {
  assert.equal(MAC_KEY, 'Meta+KeyK');
  assert.equal(OTHER_KEY, 'Control+KeyK');
  assert.equal(defaultShortcut('palette', 'windows'), OTHER_KEY);
  assert.equal(shortcutLabel(MAC_KEY, true), '⌘K');
  assert.equal(shortcutLabel(OTHER_KEY, false), 'Ctrl+K');
  assert.equal(matchesShortcut(press('KeyK', { key: 'k', meta: true }), MAC_KEY), true);
  assert.equal(matchesShortcut(press('KeyK', { key: 'k', ctrl: true }), OTHER_KEY), true);
});

test('⇧⌘K is not the palette: it opens the Background tab', () => {
  assert.equal(matchesShortcut(press('KeyK', { key: 'k', meta: true, shift: true }), MAC_KEY), false);
  assert.equal(matchesShortcut(press('KeyK', { key: 'K', ctrl: true, shift: true }), OTHER_KEY), false);
  assert.equal(matchesShortcut(press('KeyK', { key: 'k', ctrl: true }), MAC_KEY), false, 'nor ⌃K on a Mac');
  assert.equal(defaultShortcut('background', 'mac'), 'Shift+Meta+KeyK');
});

// ---- how well what is typed names something ----------------------------------------------------

test('nothing typed names everything, and as well as anything else', () => {
  assert.equal(matchScore({ name: 'Sounds' }, ''), 0);
  assert.equal(matchScore({ name: 'Sounds' }, '   '), 0);
});

test('a word in neither the name nor the rest names nothing', () => {
  assert.equal(matchScore({ name: 'Sounds', also: 'Tools' }, 'theme'), null);
  assert.equal(matchScore({ name: 'Sounds' }, 'sounds theme'), null, 'every word has to be there');
});

test('the start of the name beats the start of a word in it, which beats the inside of one', () => {
  const start = matchScore({ name: 'Login redirect' }, 'log');
  const word = matchScore({ name: 'Fix the login redirect' }, 'log');
  const inside = matchScore({ name: 'Read the catalog' }, 'log');
  assert.ok(start > word, `${start} > ${word}`);
  assert.ok(word > inside, `${word} > ${inside}`);
  assert.ok(inside > 0);
});

test('a word starts after a space or a mark, as in a branch name or the way to a menu', () => {
  const inside = matchScore({ name: 'xlogin' }, 'login');
  for (const name of ['Claude (login)', 'fix-login', 'shop/login', 'Tools › login', 'fix_login']) {
    assert.ok(matchScore({ name }, 'login') > inside, name);
  }
});

test('a whole word counts a little more than one it only begins, and never as much as a better place', () => {
  assert.ok(matchScore({ name: 'PR' }, 'pr') > matchScore({ name: 'Proactive' }, 'pr'));
  assert.ok(matchScore({ name: 'fix login' }, 'login') > matchScore({ name: 'fix logins' }, 'login'));
  assert.ok(matchScore({ name: 'Proactive' }, 'pr') > matchScore({ name: 'View PR' }, 'pr'), 'its start counts most');
  assert.ok(matchScore({ name: 'fix logins' }, 'login') > matchScore({ name: 'the catalog' }, 'log'));
});

test('a word found twice counts where it does best', () => {
  assert.equal(matchScore({ name: 'catalog log' }, 'log'), matchScore({ name: 'my log' }, 'log'));
});

test('a word in the name counts twice what it does in the rest', () => {
  const inName = matchScore({ name: 'Sounds', also: 'Tools' }, 'sounds');
  const inRest = matchScore({ name: 'Mute', also: 'Sounds' }, 'sounds');
  assert.equal(inName, 2 * inRest);
});

test('letter case does not matter, and each word adds to how well it matches', () => {
  assert.equal(matchScore({ name: 'Tools' }, 'TOOLS'), matchScore({ name: 'tools' }, 'tools'));
  const one = matchScore({ name: 'View changes', also: 'File' }, 'changes');
  const two = matchScore({ name: 'View changes', also: 'File' }, 'file changes');
  assert.ok(two > one);
});

test('ranked lists what matches, the best first, and keeps the order of those as good', () => {
  const found = ranked(
    [
      { name: 'Read the catalog' },
      { name: 'Login redirect' },
      { name: 'Nothing here' },
      { name: 'Fix the login page' },
      { name: 'Fix the login form' },
    ],
    'log'
  );
  assert.deepEqual(names(found.map((one) => one.found)), [
    'Login redirect',
    'Fix the login page',
    'Fix the login form',
    'Read the catalog',
  ]);
  assert.ok(found.every(({ score }) => score > 0));
});

// ---- what is listed, under which heading ------------------------------------------------------------

const contact = (name, also = '') => ({ name, also });

test('with nothing typed, the palette is your contacts, then the actions, and no conversations', () => {
  const sections = paletteSections(
    {
      contacts: [contact('Claude'), contact('Codex')],
      conversations: [contact('Fix the login redirect')],
      actions: [contact('Sounds', 'Tools')],
    },
    ''
  );
  assert.deepEqual(
    sections.map(({ kind, heading, entries }) => [kind, heading, names(entries)]),
    [
      ['contacts', 'Contacts', ['Claude', 'Codex']],
      ['actions', 'Actions', ['Sounds']],
    ]
  );
});

test('a kind nothing was found of has no heading', () => {
  const sections = paletteSections(
    { contacts: [contact('Claude')], conversations: [], actions: [contact('Sounds', 'Tools')] },
    'sounds'
  );
  assert.deepEqual(
    sections.map(({ kind }) => kind),
    ['actions']
  );
  assert.deepEqual(paletteSections({ contacts: [], conversations: [], actions: [] }, 'x'), []);
});

test('the kind with the best match comes first, so Enter takes the best of all', () => {
  const sections = paletteSections(
    {
      contacts: [contact('Claude (shop-2)', 'shop')],
      conversations: [contact('Make the sound of a nudge louder', 'Claude shop')],
      actions: [contact('Sounds', 'Tools')],
    },
    'sound'
  );
  assert.deepEqual(
    sections.map(({ kind }) => kind),
    ['actions', 'conversations']
  );
});

test('as good, contacts come first, then conversations, then actions', () => {
  const sections = paletteSections(
    {
      contacts: [contact('Login')],
      conversations: [contact('Login')],
      actions: [contact('Login')],
    },
    'login'
  );
  assert.deepEqual(
    sections.map(({ kind }) => kind),
    ['contacts', 'conversations', 'actions']
  );
});

test(`only the ${MOST_CONVERSATIONS} best conversations are listed`, () => {
  const conversations = Array.from({ length: 30 }, (_, i) => contact(`Fix bug ${i}`));
  conversations.push(contact('Bug in the login'));
  const [section] = paletteSections({ contacts: [], conversations, actions: [] }, 'bug');
  assert.equal(section.entries.length, MOST_CONVERSATIONS);
  assert.equal(section.entries[0].name, 'Bug in the login', 'the best one, though it came last');
  assert.equal(section.entries[1].name, 'Fix bug 0', 'then the others in the order they came in: the newest first');
});

test('with nothing typed there are no files either: a folder can have thousands', () => {
  const sections = paletteSections(
    { contacts: [contact('Claude')], conversations: [], files: [fileToGoTo('src/cart.js')], actions: [] },
    ''
  );
  assert.deepEqual(
    sections.map(({ kind }) => kind),
    ['contacts']
  );
});

test('the files found have a heading of their own, and the contact list has none to find', () => {
  const files = ['README.md', 'src/cart.js', 'test/cart.test.js'].map(fileToGoTo);
  const [section] = paletteSections({ contacts: [], conversations: [], files, actions: [] }, 'cart');
  assert.equal(section.kind, 'files');
  assert.equal(section.heading, 'Files');
  assert.deepEqual(names(section.entries), ['cart.js', 'cart.test.js']);
  assert.deepEqual(
    paletteSections({ contacts: [], conversations: [], actions: [] }, 'cart'),
    [],
    'no files given, none found'
  );
});

test(`only the ${MOST_FILES} best files are listed, the best first though it came last`, () => {
  const files = Array.from({ length: 40 }, (_, i) => fileToGoTo(`src/views/oldview${i}.js`));
  files.push(fileToGoTo('src/view.js'));
  const [section] = paletteSections({ contacts: [], conversations: [], files, actions: [] }, 'view');
  assert.equal(section.entries.length, MOST_FILES);
  assert.equal(section.entries[0].also, 'src/view.js');
});

test('a file is found by the words of its name and of the folders it is in, the name counting most', () => {
  const files = ['src/shared/palette.js', 'src/renderer/lib/palette.js', 'test/palette.test.js', 'docs/shared.md'].map(
    fileToGoTo
  );
  const found = (query) => ranked(files, query).map(({ found: file }) => file.also);
  assert.deepEqual(found('shared palette'), ['src/shared/palette.js'], 'every word, from the name or a folder');
  assert.deepEqual(found('palette test'), ['test/palette.test.js']);
  assert.deepEqual(found('shared/palette.js'), ['src/shared/palette.js'], 'the way to it, as written');
  assert.deepEqual(found('shared'), ['docs/shared.md', 'src/shared/palette.js'], 'its name before its folder');
});

test('as good, files come after conversations and before actions', () => {
  const sections = paletteSections(
    {
      contacts: [],
      conversations: [contact('Login')],
      files: [fileToGoTo('src/Login')],
      actions: [contact('Login')],
    },
    'login'
  );
  assert.deepEqual(
    sections.map(({ kind }) => kind),
    ['conversations', 'files', 'actions']
  );
});

test('a file is told by its name, and the folder it is in is said beside it', () => {
  assert.deepEqual(fileToGoTo('src/shared/palette.js'), {
    name: 'palette.js',
    also: 'src/shared/palette.js',
    folder: 'src/shared',
  });
  assert.deepEqual(fileToGoTo('README.md'), { name: 'README.md', also: 'README.md', folder: '' });
  assert.deepEqual(fileToGoTo('docs/Getting started.md').name, 'Getting started.md');
});

test('a contact is found by its project and its service too, below one found by its name', () => {
  const [section] = paletteSections(
    {
      contacts: [contact('Claude (fix-login)', 'shop Claude'), contact('shop-2', 'shop Codex')],
      conversations: [],
      actions: [],
    },
    'shop'
  );
  assert.deepEqual(names(section.entries), ['shop-2', 'Claude (fix-login)']);
});

// ---- the contacts, the conversations and the actions there are ---------------------------------------

test('the contacts to go to are the one last talked with first, without the one you are in or the archived', () => {
  const contacts = [
    { id: 'a', lastActive: 100 },
    { id: 'b', lastActive: 300 },
    { id: 'here', lastActive: 400 },
    { id: 'gone', lastActive: 500, archived: true },
    { id: 'new', lastActive: null },
    { id: 'c', lastActive: 200 },
  ];
  assert.deepEqual(
    contactsToGoTo(contacts, 'here').map((c) => c.id),
    ['b', 'c', 'a', 'new']
  );
  assert.deepEqual(
    contactsToGoTo(contacts).map((c) => c.id),
    ['here', 'b', 'c', 'a', 'new'],
    'in the contact list there is no contact you are in'
  );
  assert.deepEqual(
    contacts.map((c) => c.id),
    ['a', 'b', 'here', 'gone', 'new', 'c'],
    'the list it was given is left as it was'
  );
});

test('the conversations to go to leave out the one going on here and those whose contact is gone', () => {
  const known = new Map([
    ['here', {}],
    ['other', {}],
  ]);
  const rows = [
    { id: 'current', contactId: 'here', current: true },
    { id: 'old', contactId: 'here' },
    { id: 'current', contactId: 'other', current: true },
    { id: 'old', contactId: 'other' },
    { id: 'old', contactId: 'deleted' },
  ];
  assert.deepEqual(
    conversationsToGoTo(rows, known, 'here').map((row) => `${row.contactId}/${row.id}`),
    ['here/old', 'other/current', 'other/old']
  );
  assert.equal(conversationsToGoTo(rows, known).length, 4, 'in the contact list every current one is listed');
});

test('a conversation going on is its contact, and a past one, or an archived contact’s, is its message history', () => {
  assert.equal(conversationGoesTo({ current: true }, {}), 'contact');
  assert.equal(conversationGoesTo({ current: true }, { archived: true }), 'history');
  assert.equal(conversationGoesTo({}, {}), 'history');
  assert.equal(conversationGoesTo({ current: false }, { archived: false }), 'history');
});

test('the actions are what the menus do, each with the way to it', () => {
  const run = () => {};
  const menus = [
    {
      label: 'File',
      items: () => [
        { label: 'New chat tab', hint: '⇧⌘A', action: run },
        { separator: true },
        { label: 'View a plan', disabled: true, submenu: [{ label: 'Plan', action: run }] },
        { label: 'Close', action: run },
      ],
    },
    {
      label: 'Tools',
      items: () => [
        {
          label: 'Theme',
          submenu: [
            { label: 'Light', checked: true, action: run },
            { label: 'Night', submenu: [{ label: 'Royale Noir', action: run }] },
            { label: 'Night follows the computer', note: true },
          ],
        },
        { label: 'Activities', disabled: true },
        { label: 'A heading with nothing to do' },
      ],
    },
  ];
  const actions = menuActions(menus);
  assert.deepEqual(
    actions.map(({ item, path }) => [...path, item.label].join(' › ')),
    ['File › New chat tab', 'File › Close', 'Tools › Theme › Light', 'Tools › Theme › Night › Royale Noir']
  );
  assert.equal(actions[0].item.hint, '⇧⌘A', 'each is the menu’s own item, with its shortcut');
  assert.equal(actions[2].item.checked, true, 'and its tick');
});

test('the menus are asked for their items each time, as they are when they open', () => {
  let sounds = true;
  const menus = [{ label: 'Tools', items: () => [{ label: 'Sounds', checked: sounds, action: () => {} }] }];
  assert.equal(menuActions(menus)[0].item.checked, true);
  sounds = false;
  assert.equal(menuActions(menus)[0].item.checked, false);
});

test('what a submenu has is found by the submenu’s keywords too', () => {
  const run = () => {};
  const menus = [
    {
      label: 'Actions',
      items: () => [
        { label: 'Create PR', keywords: ['pr'], submenu: [{ label: 'Ask Claude', keywords: ['claude'], action: run }] },
        { label: 'Send a nudge', action: run },
      ],
    },
  ];
  assert.deepEqual(
    menuActions(menus).map(({ item, keywords }) => [item.label, keywords]),
    [
      ['Ask Claude', ['pr', 'claude']],
      ['Send a nudge', []],
    ]
  );
});

// ---- the other words things are found by -------------------------------------------------------------

/** What the palette lists first for `query`, among things named as the menus and Settings name them. */
const SETTINGS = settingsToGoTo([{ id: 'c1', project: 'shop', lastActive: 1 }]);
const COMMANDS = [
  { name: 'New chat tab', also: 'Conversation' },
  { name: 'Invite...', also: 'Conversation', keywords: KEYWORDS.invite },
  { name: 'Start over', also: 'Conversation', keywords: KEYWORDS.startOver },
  { name: 'Commands', also: 'Conversation', keywords: KEYWORDS.commands },
  { name: 'Terminal', also: 'View', keywords: KEYWORDS.terminal },
  { name: 'Changes', also: 'View', keywords: KEYWORDS.changes },
  { name: 'Open in Cursor', also: 'Code', keywords: KEYWORDS.openIn },
  { name: 'Create PR', also: 'Code', keywords: KEYWORDS.pullRequest },
  { name: 'View all message history...', also: 'Contacts', keywords: KEYWORDS.history },
  { name: 'Add a manager...', also: 'Contacts', keywords: KEYWORDS.manager },
  { name: 'Settings...', also: 'View', keywords: KEYWORDS.settings },
  { name: 'Sounds', also: 'View' },
];
const foundFor = (query) =>
  ranked([...COMMANDS, ...SETTINGS], query).map(
    ({ found }) => (found.project ? `${found.project} › ` : '') + found.name
  );

test('"manager", "oversee" and "PM" find the manager’s page of Settings and the way to add one', () => {
  for (const query of ['manager', 'oversee', 'PM', 'project manager', 'lead']) {
    const found = foundFor(query);
    assert.ok(found.includes('shop › Manager'), `${query}: ${found}`);
    assert.ok(found.includes('Add a manager...'), `${query}: ${found}`);
  }
});

test('"agent" and "reviewer" find Invite and the Roles & teams page', () => {
  for (const query of ['agent', 'reviewer', 'guest']) {
    const found = foundFor(query);
    assert.ok(found.includes('Invite...'), `${query}: ${found}`);
    assert.ok(found.includes('Roles & teams'), `${query}: ${found}`);
  }
  assert.deepEqual(
    foundFor('agent').slice(0, 3),
    ['Invite...', 'Roles & teams', 'Services'],
    'the word typed whole before a name it only begins'
  );
});

test('"import", "history" and "claude code" find the message history', () => {
  for (const query of ['import', 'history', 'claude code', 'past conversations', 'Transcripts']) {
    assert.ok(foundFor(query).includes('View all message history...'), query);
  }
});

test('"terminal" and "shell" find the terminal; "diff" the changes; "PR" the pull request', () => {
  for (const query of ['terminal', 'shell', 'console', 'bash']) assert.equal(foundFor(query)[0], 'Terminal', query);
  assert.equal(foundFor('diff')[0], 'Changes');
  assert.equal(foundFor('uncommitted')[0], 'Changes');
  assert.equal(foundFor('pr')[0], 'Create PR');
  assert.equal(foundFor('pull request')[0], 'Create PR');
});

test('the words the conversation window’s menus used before find what they are called now', () => {
  // A new chat in a tab is a new conversation too: starting over this one is next to it.
  assert.deepEqual(foundFor('new conversation').slice(0, 2), ['New chat tab', 'Start over']);
  for (const query of ['clear', 'reset', 'fresh start']) assert.equal(foundFor(query)[0], 'Start over', query);
  for (const query of ['activities', 'slash commands', 'skills']) assert.equal(foundFor(query)[0], 'Commands', query);
  for (const query of ['open working folder', 'editor']) assert.equal(foundFor(query)[0], 'Open in Cursor', query);
});

test('part of a keyword counts as the rest of what something is known by, and a whole one as its name would', () => {
  const named = matchScore({ name: 'Terminal', also: 'File' }, 'terminal');
  const whole = matchScore({ name: 'Open the shell', also: 'File', keywords: ['terminal'] }, 'terminal');
  const part = matchScore({ name: 'Open the shell', also: 'File', keywords: ['terminal'] }, 'term');
  assert.equal(whole, named, 'typed whole');
  assert.equal(part, matchScore({ name: 'Open the shell', also: 'terminal' }, 'term'), 'in part, as the rest counts');
  assert.equal(matchScore({ name: 'Sounds', keywords: ['audio'] }, 'video'), null);
  assert.equal(
    matchScore({ name: 'Sounds', keywords: ['audio'] }, 'sounds audio'),
    2 * matchScore({ name: 'Sounds' }, 'sounds'),
    'each word where it does best'
  );
  assert.equal(
    matchScore({ name: 'Create PR', keywords: ['pull request'] }, '"pull request"'),
    matchScore({ name: 'Pull request' }, '"pull request"'),
    'a phrase typed whole'
  );
});

test('"PR" names the pull request before what only starts with it', () => {
  const found = ranked(
    [
      { name: 'Proactive', also: 'Tools Output style' },
      { name: 'Project settings...', also: 'Tools' },
      { name: 'View PR #128', also: 'Actions', keywords: KEYWORDS.pullRequest },
    ],
    'pr'
  );
  assert.equal(found[0].found.name, 'View PR #128');
});

test('every keyword is a word or a phrase in lower case, and none is said twice for the same thing', () => {
  for (const [id, words] of Object.entries(KEYWORDS)) {
    assert.ok(words.length, id);
    for (const word of words) assert.match(word, /^[a-z0-9.]+( [a-z0-9.]+)*$/, `${id}: ${word}`);
    assert.equal(new Set(words).size, words.length, id);
  }
  assert.ok(Object.isFrozen(KEYWORDS));
});

// ---- a "quoted phrase" ---------------------------------------------------------------------------------

test('a quoted phrase names only what has it as it is written', () => {
  const view = { name: 'View changes', also: 'File' };
  const other = { name: 'Changes to view later', also: 'File' };
  const found = (query) => names(ranked([other, view], query).map(({ found: one }) => one));
  assert.deepEqual(found('view changes'), ['Changes to view later', 'View changes'], 'its words, anywhere');
  assert.deepEqual(found('"view changes"'), ['View changes']);
  assert.deepEqual(found('"view changes'), ['View changes'], 'while its closing quote is still to come');
  assert.deepEqual(found('"changes view"'), []);
});

// ---- conversations found by what was said in them --------------------------------------------------------

test('a conversation found by what was said in it is named by that search, below one found by its name', () => {
  const said = { name: 'Fix the checkout', also: 'Claude shop', foundBy: 'stripe idempotency' };
  const named = { name: 'Stripe idempotency keys', also: 'Codex shop' };
  assert.equal(matchScore(said, 'stripe idempotency'), 1);
  assert.equal(matchScore(said, '  Stripe   IDEMPOTENCY '), 1, 'the same search, however it was typed');
  assert.equal(matchScore(said, 'stripe'), null, 'not another search');
  assert.equal(
    matchScore(said, 'checkout'),
    matchScore({ name: 'Fix the checkout' }, 'checkout'),
    'its name still counts'
  );
  const [section] = paletteSections({ contacts: [], conversations: [said, named], actions: [] }, 'stripe idempotency');
  assert.deepEqual(names(section.entries), ['Stripe idempotency keys', 'Fix the checkout']);
});

// ---- the pages of Settings ---------------------------------------------------------------------------

const projectOf = (page) => page.project;

test('Settings lists the app’s pages, then each project’s, the project last talked about first', () => {
  const pages = settingsToGoTo([
    { id: 'a', project: 'api', lastActive: 100 },
    { id: 'b', project: 'shop', lastActive: 300 },
    { id: 'c', project: 'shop', lastActive: 200 },
    { id: 'gone', project: 'old', lastActive: 400, archived: true },
    { id: 'd', project: '' },
  ]);
  assert.deepEqual(
    pages.filter((page) => !page.project).map((page) => [page.section, page.name]),
    APP_SETTINGS.map(({ id, label }) => [id, label]),
    'every page about the app, by the name the window gives it'
  );
  const projects = pages.filter(projectOf);
  assert.deepEqual([...new Set(projects.map(projectOf))], ['shop', 'api'], 'no archived contact’s project');
  assert.deepEqual(
    projects.filter((page) => page.project === 'shop').map((page) => [page.section, page.name, page.contactId]),
    PROJECT_SETTINGS.map(({ id, label }) => [id, label, 'b']),
    'opened by the contact last talked with on it'
  );
  assert.ok(pages.every((page) => page.keywords === (KEYWORDS[page.section] ?? [])));
});

test('beside a conversation, Settings lists only its own project’s pages', () => {
  const contacts = [
    { id: 'here', project: 'shop' },
    { id: 'other', project: 'api', lastActive: 999 },
  ];
  const projects = settingsToGoTo(contacts, 'here').filter(projectOf);
  assert.deepEqual([...new Set(projects.map(projectOf))], ['shop']);
  assert.ok(projects.every((page) => page.contactId === 'here'));
});

test('a page is found by its name, by "settings", by its project and by its keywords', () => {
  const pages = settingsToGoTo([{ id: 'c1', project: 'shop' }]);
  const found = (query) => ranked(pages, query).map(({ found: page }) => `${page.project || 'app'}:${page.section}`);
  assert.deepEqual(found('teams'), ['app:teams']);
  assert.deepEqual(found('shop manager'), ['shop:manager']);
  assert.deepEqual(found('project settings scripts'), ['shop:scripts']);
  assert.equal(found('settings').length, APP_SETTINGS.length + PROJECT_SETTINGS.length, '"settings" lists them all');
  assert.deepEqual(found('hotkeys'), ['app:shortcuts']);
  assert.deepEqual(found('env').slice(0, 2), ['app:environment', 'shop:project-environment']);
  assert.deepEqual(found('git'), ['app:git', 'shop:project-git']);
});

test('the pages of Settings are listed once something is typed, after the actions when as good', () => {
  const settings = settingsToGoTo([]);
  assert.deepEqual(
    paletteSections({ contacts: [contact('Claude')], conversations: [], actions: [], settings }, '').map(
      ({ kind }) => kind
    ),
    ['contacts'],
    'with nothing typed, no pages'
  );
  const sections = paletteSections(
    { contacts: [], conversations: [], actions: [contact('Teams', 'Tools')], settings },
    'teams'
  );
  assert.deepEqual(
    sections.map(({ kind, heading }) => [kind, heading]),
    [
      ['actions', 'Actions'],
      ['settings', 'Settings'],
    ]
  );
});

test('every page the Settings window lists has an id of its own and keywords to be found by', () => {
  const ids = [...APP_SETTINGS, ...PROJECT_SETTINGS].map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(KEYWORDS[id]?.length, id);
  assert.ok(
    APP_SETTINGS.every(({ heading }) => heading),
    'the app’s pages are under headings'
  );
  assert.ok(
    PROJECT_SETTINGS.every(({ heading }) => !heading),
    'a project’s are under the project'
  );
});

// ---- when nothing is found -------------------------------------------------------------------------------

const searchHistory = (query) => ({ name: searchHistoryName(query), query });

test('when nothing matches what was typed, the palette offers to search all message history for it', () => {
  const sections = paletteSections(
    { contacts: [contact('Claude')], conversations: [], actions: [contact('Sounds', 'Tools')], searchHistory },
    '  stripe idempotency '
  );
  assert.deepEqual(sections, [
    {
      kind: 'history',
      heading: 'Message history',
      entries: [{ name: 'Search all message history for “stripe idempotency”', query: 'stripe idempotency' }],
    },
  ]);
});

test('the message history is offered only when nothing else is found, and something was typed', () => {
  const findables = { contacts: [contact('Claude')], conversations: [], actions: [], searchHistory };
  assert.deepEqual(
    paletteSections(findables, 'claude').map(({ kind }) => kind),
    ['contacts']
  );
  assert.deepEqual(
    paletteSections(findables, '').map(({ kind }) => kind),
    ['contacts']
  );
  assert.deepEqual(paletteSections({ ...findables, contacts: [] }, '   '), [], 'spaces are nothing typed');
  assert.deepEqual(paletteSections({ ...findables, searchHistory: undefined }, 'nowhere'), [], 'nor without one');
});
