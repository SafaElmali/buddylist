import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTACTS_PANE_GAP,
  CONTACTS_PANE_MAX,
  CONTACTS_PANE_MIN,
  CONTACTS_PANE_WIDTH,
  addressOf,
  clampPaneWidth,
  cleanContactsPane,
  contactsPane,
  contactsPaneRoom,
  paneMenu,
  paneView,
  widthInAddress,
} from '../src/shared/contacts-pane.js';
import { listSections, listView, listedContacts } from '../src/shared/list-view.js';
import { defaultShortcut } from '../src/shared/shortcuts.js';
import { keepUnsent, takeUnsent } from '../src/renderer/chat/unsent.js';
import { page } from './fixtures/dom.js';

// The list's hover card listens on the window, and lib/api.js reads the bridge when it is first imported.
globalThis.window = { messenger: {}, addEventListener() {} };
const { ContactsPane } = await import('../src/renderer/chat/contacts-pane.js');

// ---- the setting --------------------------------------------------------------------------------

test('without a word about it, your contacts are listed beside a conversation', () => {
  const usual = { shown: true, width: CONTACTS_PANE_WIDTH };
  assert.deepEqual(contactsPane(undefined), usual);
  assert.deepEqual(contactsPane({}), usual);
  assert.deepEqual(contactsPane({ contactsPane: {} }), usual);
  assert.deepEqual(contactsPane({ contactsPane: { shown: false } }), { shown: false, width: CONTACTS_PANE_WIDTH });
  assert.deepEqual(contactsPane({ contactsPane: { shown: true, width: 260 } }), { shown: true, width: 260 });
});

test('the list is never narrower than its narrowest, or wider than its widest', () => {
  assert.equal(clampPaneWidth(10), CONTACTS_PANE_MIN);
  assert.equal(clampPaneWidth(5000), CONTACTS_PANE_MAX);
  assert.equal(clampPaneWidth(240.6), 241, 'whole pixels');
  assert.equal(clampPaneWidth('260'), 260, 'as it is read from an address');
  for (const none of [undefined, null, '', 'wide', NaN, 0, -40]) {
    assert.equal(clampPaneWidth(none), CONTACTS_PANE_WIDTH, `${none} is no width`);
  }
});

test('a settings patch changes what it names about the list, and nothing else', () => {
  const settings = { contactsPane: { shown: true, width: 260 } };
  assert.deepEqual(cleanContactsPane({ contactsPane: { shown: false } }, settings), {
    contactsPane: { shown: false, width: 260 },
  });
  assert.deepEqual(cleanContactsPane({ contactsPane: { width: 300 } }, settings), {
    contactsPane: { shown: true, width: 300 },
  });
  assert.deepEqual(cleanContactsPane({ contactsPane: { width: 9999, shown: 'yes' } }, settings), {
    contactsPane: { shown: true, width: CONTACTS_PANE_MAX },
  });
  // A patch about something else leaves it alone.
  assert.deepEqual(cleanContactsPane({ sounds: false }, settings), {});
  assert.deepEqual(cleanContactsPane({ contactsPane: 'shown' }, settings), {});
  assert.deepEqual(cleanContactsPane(null, settings), {});
});

test('a new conversation window opens wider by the list and the bar beside it, while the list is shown', () => {
  assert.equal(contactsPaneRoom({}), CONTACTS_PANE_WIDTH + CONTACTS_PANE_GAP);
  assert.equal(contactsPaneRoom({ contactsPane: { width: 300 } }), 300 + CONTACTS_PANE_GAP);
  assert.equal(contactsPaneRoom({ contactsPane: { shown: false, width: 300 } }), 0);
});

test('a window’s address says how wide its list starts, and a window without the list says nothing', () => {
  assert.deepEqual(addressOf({ contactsPane: { width: 260 } }), { contacts: '260' });
  assert.deepEqual(addressOf({ contactsPane: { shown: false, width: 260 } }), {});
  const search = `?${new URLSearchParams({ ...addressOf({ contactsPane: { width: 260 } }), contactId: 'c1' })}`;
  assert.equal(widthInAddress(search), 260);
  assert.equal(widthInAddress('?contactId=c1'), 0);
  assert.equal(widthInAddress('?contactId=c1&contacts=5000'), CONTACTS_PANE_MAX, 'whatever the address says');
  assert.equal(widthInAddress(''), 0);
});

// ---- the list beside a conversation ------------------------------------------------------------

/**
 * A conversation window's page, as chat.html lays it out: the list, the bar beside it and the
 * conversation, for a window whose address is `search`.
 */
function chatPage(t, search) {
  const document = page(t);
  const make = (tag, name, parent) => {
    const node = document.createElement(tag);
    node.classList.add(name);
    node.style = {};
    parent.append(node);
    return node;
  };
  const main = make('div', 'chat-main', document.body);
  const root = make('aside', 'contacts-pane', main);
  make('button', 'contacts-pane-menu', root);
  make('div', 'cl-list', root);
  make('span', 'contacts-pane-add-icon', make('button', 'contacts-pane-add', root));
  const splitter = make('div', 'chat-splitter', main);
  const beside = make('section', 'chat-left', main);
  const previous = { location: globalThis.location, sessionStorage: globalThis.sessionStorage };
  globalThis.location = { search };
  globalThis.sessionStorage = { getItem: () => null, setItem() {} };
  t.after(() => Object.assign(globalThis, previous));
  return { root, splitter, beside };
}

/** The list on that page. `around` hears each change it wraps: shown or hidden, before and after. */
function listOn({ root, splitter, beside }, heard = []) {
  const noop = () => {};
  const pane = new ContactsPane(root, {
    splitter,
    beside,
    current: 'c1',
    around: async (change) => {
      heard.push(pane.shown);
      await change();
      heard.push(pane.shown);
    },
    ...Object.fromEntries(
      ['open', 'addFrom', 'addOnComputer', 'addIn', 'addLike', 'addProject', 'openPullRequest', 'tagAction']
        .concat(['rename', 'menu', 'projectMenu', 'viewMenu', 'resized'])
        .map((name) => [name, noop])
    ),
  });
  return pane;
}

test('a window whose address says how wide the list is shows it from the start, at that width', (t) => {
  const on = chatPage(t, '?contactId=c1&contacts=240');
  const pane = listOn(on);
  assert.equal(pane.shown, true);
  assert.equal(on.splitter.hidden, false);
  assert.equal(on.root.style.width, '240px');

  const off = chatPage(t, '?contactId=c1');
  assert.equal(listOn(off).shown, false);
  assert.equal(off.splitter.hidden, true);
});

test('hiding the list and showing it again changes the page alone: the conversation gives it its room', async (t) => {
  const on = chatPage(t, '?contactId=c1&contacts=200');
  const heard = [];
  const pane = listOn(on, heard);

  await pane.show(false);
  assert.deepEqual([on.root.hidden, on.splitter.hidden], [true, true]);
  await pane.show(true);
  assert.deepEqual([on.root.hidden, on.splitter.hidden], [false, false]);
  assert.deepEqual(
    heard,
    [true, false, false, true],
    'each change goes through `around`, which keeps the conversation at its end'
  );
  // The conversation is not held at its width meanwhile: it is what gets narrower or wider.
  assert.deepEqual(on.beside.style, {});
  assert.equal(on.root.style.width, '200px', 'the list comes back as wide as it was');

  await pane.show(true);
  assert.equal(heard.length, 4, 'shown already, nothing changes');
});

test('the list has a shortcut of its own on a Mac and everywhere else', () => {
  assert.equal(defaultShortcut('contactsPane', 'mac'), 'Shift+Meta+KeyL');
  assert.equal(defaultShortcut('contactsPane', 'linux'), 'Control+Shift+KeyL');
  assert.equal(defaultShortcut('contactsPane', 'windows'), 'Control+Shift+KeyL');
});

// ---- what is in it --------------------------------------------------------------------------------

test('the sidebar keeps archived contacts in their own section and updates it when they are restored', async () => {
  const previous = globalThis.window;
  globalThis.window ??= { messenger: {} };
  try {
    const { ContactsPane } = await import('../src/renderer/chat/contacts-pane.js');
    let sections;
    const pane = {
      placed: true,
      list: { setContacts: (contacts) => (sections = listSections(contacts, [], paneView({}))) },
    };
    const contacts = [
      { id: 'c1', project: 'app', status: 'online' },
      { id: 'c2', project: 'app', status: 'online', archived: true },
      { id: 'c3', project: 'app', status: 'online', archived: false },
    ];
    ContactsPane.prototype.setContacts.call(pane, contacts);
    assert.deepEqual(
      sections.at(-1).members.map((c) => c.id),
      ['c2']
    );
    assert.equal(sections.at(-1).id, 'archived');
    assert.deepEqual(
      sections[0].members.map((c) => c.id),
      ['c1', 'c3']
    );

    ContactsPane.prototype.setContacts.call(
      pane,
      contacts.map((c) => ({ ...c, archived: false }))
    );
    assert.ok(sections.every((section) => section.id !== 'archived'));
    assert.deepEqual(
      sections[0].members.map((c) => c.id),
      ['c1', 'c2', 'c3']
    );
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test('an archived sidebar contact can be restored, read, found on disk, or deleted', () => {
  for (const status of ['online', 'offline', 'busy']) {
    const contact = { id: 'c2', archived: true, status, pinned: true, favorite: true };
    const asked = [];
    const menu = paneMenu(contact, 'c1', {
      restore: (c) => asked.push(['restore', c]),
      history: (c) => asked.push(['history', c]),
      openFolder: (c) => asked.push(['openFolder', c]),
      remove: (c) => asked.push(['remove', c]),
    });
    assert.deepEqual(
      menu.map((item) => item.label ?? '-'),
      ['Restore contact', 'View message history', 'Open folder', '-', 'Delete contact']
    );
    assert.equal(menu[0].bold, true);
    assert.deepEqual(
      menu.filter((item) => item.danger).map((item) => item.label),
      ['Delete contact']
    );
    for (const item of menu) item.action?.();
    assert.deepEqual(asked, [
      ['restore', contact],
      ['history', contact],
      ['openFolder', contact],
      ['remove', contact],
    ]);
  }
});

test('the list is grouped and sorted as the contact list is, with every project in it', () => {
  assert.deepEqual(paneView({}), { groupBy: 'project', sortBy: 'added', project: null, hidden: [], pinned: [] });
  assert.deepEqual(paneView({ listView: { groupBy: 'status', sortBy: 'recent', project: 'api' } }), {
    groupBy: 'status',
    sortBy: 'recent',
    project: null,
    hidden: [],
    pinned: [],
  });
  // A project pinned in the contact list is pinned here too.
  assert.deepEqual(paneView({ listView: { pinned: ['shop'] } }).pinned, ['shop']);
});

test('a project hidden from the contact list is still in the list beside a conversation', () => {
  const settings = { listView: { groupBy: 'status', sortBy: 'recent', hidden: ['shop', 'api'] } };
  assert.deepEqual(listView(settings).hidden, ['shop', 'api'], 'hidden from the contact list');
  assert.deepEqual(paneView(settings), {
    groupBy: 'status',
    sortBy: 'recent',
    project: null,
    hidden: [],
    pinned: [],
  });

  // Whatever the contact list leaves out, a conversation has its own contact in the list beside it.
  const contacts = [
    { id: 'a', project: 'shop' },
    { id: 'b', project: 'api' },
    { id: 'c', project: 'web' },
    { id: 'd' },
  ];
  for (const view of [{ hidden: ['shop', 'api'] }, { project: 'web' }, { project: 'web', hidden: ['shop'] }]) {
    assert.deepEqual(listedContacts(contacts, paneView({ listView: view })), contacts);
  }
});

test('a right-click on a contact opens it here or in a window of its own, its history, another contact on its project, pins it, makes it a favorite, or archives or deletes it', () => {
  const asked = [];
  const actions = {
    here: (contact) => asked.push(['here', contact.id]),
    apart: (contact) => asked.push(['apart', contact.id]),
    history: (contact) => asked.push(['history', contact.id]),
    openFolder: (contact) => asked.push(['openFolder', contact.id]),
    copyPath: (contact) => asked.push(['copyPath', contact.id]),
    copyBranch: (contact) => asked.push(['copyBranch', contact.id]),
    unread: (contact) => asked.push(['unread', contact.id]),
    addFrom: (contact) => asked.push(['addFrom', contact.id]),
    rename: (contact) => asked.push(['rename', contact.id]),
    pin: (contact) => asked.push(['pin', contact.id]),
    favorite: (contact) => asked.push(['favorite', contact.id]),
    archive: (contact) => asked.push(['archive', contact.id]),
    remove: (contact) => asked.push(['remove', contact.id]),
  };
  const menu = paneMenu({ id: 'c2', status: 'online' }, 'c1', actions);
  assert.deepEqual(
    menu.map((item) => item.label ?? '-'),
    [
      'Open',
      'Open in a new window',
      '-',
      'View message history...',
      'Mark as unread',
      'New contact in this project...',
      '-',
      'Open folder',
      'Copy path',
      'Copy branch name',
      '-',
      'Rename...',
      'Pin to top',
      'Add to favorites',
      'Archive contact',
      'Delete contact',
    ]
  );
  assert.ok(menu.every((item) => !item.disabled));
  assert.deepEqual(
    menu.filter((item) => item.danger).map((item) => item.label),
    ['Delete contact'],
    'deleting is the one that is marked'
  );
  for (const item of menu) item.action?.();
  assert.deepEqual(asked, [
    ['here', 'c2'],
    ['apart', 'c2'],
    ['history', 'c2'],
    ['unread', 'c2'],
    ['addFrom', 'c2'],
    ['openFolder', 'c2'],
    ['copyPath', 'c2'],
    ['copyBranch', 'c2'],
    ['rename', 'c2'],
    ['pin', 'c2'],
    ['favorite', 'c2'],
    ['archive', 'c2'],
    ['remove', 'c2'],
  ]);

  // The conversation you are in is open already, here and nowhere else. It can still be marked unread to come
  // back to, its project can still have another contact, its folder opened or copied, it can still be renamed,
  // and archived or deleted.
  const own = paneMenu({ id: 'c1', status: 'busy' }, 'c1', actions);
  assert.deepEqual(
    own.filter((item) => item.disabled).map((item) => item.label),
    ['Open', 'Open in a new window']
  );
});

test('a contact whose folder is gone has no project to add another contact to, nor a folder to open', () => {
  const menu = paneMenu({ id: 'c2', status: 'offline' }, 'c1', {
    here: () => {},
    apart: () => {},
    history: () => {},
    openFolder: () => {},
    copyPath: () => {},
    copyBranch: () => {},
    unread: () => {},
    addFrom: () => {},
    rename: () => {},
    pin: () => {},
    favorite: () => {},
    archive: () => {},
    remove: () => {},
  });
  const add = menu.find((item) => item.label === 'New contact in this project...');
  assert.equal(add.disabled, true);
  assert.equal(menu.find((item) => item.label === 'Open folder').disabled, true);
  assert.equal(menu.find((item) => item.label === 'Copy branch name').disabled, true);
  assert.ok(!menu.find((item) => item.label === 'Copy path').disabled, 'the path it had can still be copied');
  assert.ok(!menu.find((item) => item.label === 'Rename...').disabled, 'it can still be renamed');
  assert.ok(!menu.find((item) => item.label === 'Archive contact').disabled, 'it can still be archived');
  assert.ok(!menu.find((item) => item.label === 'Delete contact').disabled, 'it can still be deleted');
  assert.ok(!menu[0].disabled, 'its conversation still opens');
  assert.ok(!menu.find((item) => item.label === 'Pin to top').disabled, 'it can still be pinned');
  assert.ok(!menu.find((item) => item.label === 'Add to favorites').disabled, 'it can still be a favorite');
});

test('a contact that is pinned or a favorite is offered the way back, as in the contact list', () => {
  const none = () => {};
  const actions = {
    here: none,
    apart: none,
    history: none,
    unread: none,
    addFrom: none,
    rename: none,
    archive: none,
    remove: none,
  };
  const asked = [];
  const menu = paneMenu({ id: 'c2', status: 'online', pinned: true, favorite: true }, 'c1', {
    ...actions,
    pin: (contact) => asked.push(['pin', contact.pinned]),
    favorite: (contact) => asked.push(['favorite', contact.favorite]),
  });
  const labels = menu.map((item) => item.label);
  assert.ok(labels.includes('Unpin') && !labels.includes('Pin to top'));
  assert.ok(labels.includes('Remove from favorites') && !labels.includes('Add to favorites'));
  menu.find((item) => item.label === 'Unpin').action();
  menu.find((item) => item.label === 'Remove from favorites').action();
  // Each is handed the contact as it is, to turn the other way.
  assert.deepEqual(asked, [
    ['pin', true],
    ['favorite', true],
  ]);
});

test('a contact with something unread is offered Mark as read, as in the contact list', () => {
  const none = () => {};
  const asked = [];
  const actions = {
    here: none,
    apart: none,
    history: none,
    addFrom: none,
    rename: none,
    pin: none,
    favorite: none,
    archive: none,
    remove: none,
    unread: (contact) => asked.push(['unread', contact.unread]),
  };
  const menu = paneMenu({ id: 'c2', status: 'online', unread: 2 }, 'c1', actions);
  const labels = menu.map((item) => item.label);
  assert.ok(labels.includes('Mark as read') && !labels.includes('Mark as unread'));
  menu.find((item) => item.label === 'Mark as read').action();
  paneMenu({ id: 'c2', status: 'online', unread: 0 }, 'c1', actions)
    .find((item) => item.label === 'Mark as unread')
    .action();
  // Each is handed the contact as it is, to turn the other way.
  assert.deepEqual(asked, [
    ['unread', 2],
    ['unread', 0],
  ]);
});

// ---- what you typed and did not send ------------------------------------------------------------

/**
 * What a window keeps while it is open, whatever page it loads.
 * @param {number} [room]  how many characters it has room for, as a real one has only so many
 */
function storage(room = Infinity) {
  const kept = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => (kept.has(key) ? kept.get(key) : null),
    setItem: (key, value) => {
      if (String(value).length > room) throw new DOMException('Full', 'QuotaExceededError');
      kept.set(key, String(value));
    },
  };
  return kept;
}

afterEach(() => {
  delete globalThis.sessionStorage;
});

/** A box with `text` in it, and nothing else. */
const words = (text) => ({ text, pictures: [], files: [], answers: {} });
const PICTURE = { url: 'data:image/png;base64,iVBORw0KGgo=', preview: 'data:image/webp;base64,UklGRg==' };

test('what you typed to a contact is in its box again when the window comes back to it', () => {
  storage();
  keepUnsent('c1', words('half a thought'));
  keepUnsent('c2', words('and another'));
  assert.deepEqual(takeUnsent('c1'), words('half a thought'));
  assert.equal(takeUnsent('c1'), null, 'once: it is in the box now, to be sent or changed');
  assert.deepEqual(takeUnsent('c2'), words('and another'));
  assert.equal(takeUnsent('c3'), null);
});

test('the pictures and files you were about to send come back with the words', () => {
  storage();
  const unsent = {
    text: 'look at these',
    pictures: [PICTURE, { ...PICTURE, preview: null }],
    files: ['src/app.js'],
    answers: {},
  };
  keepUnsent('c1', unsent);
  assert.deepEqual(takeUnsent('c1'), unsent);
});

test('a picture or a file alone is something to keep, with no words beside it', () => {
  storage();
  keepUnsent('c1', { text: '', pictures: [PICTURE], files: [] });
  keepUnsent('c2', { text: '  ', pictures: [], files: ['docs/'] });
  assert.deepEqual(takeUnsent('c1'), { text: '', pictures: [PICTURE], files: [], answers: {} });
  assert.deepEqual(takeUnsent('c2'), { text: '  ', pictures: [], files: ['docs/'], answers: {} });
});

test('the terminals whose output goes with the message come back with the words, alone too', () => {
  storage();
  const outputs = [
    { kind: 'terminal', id: 't1', name: 'Terminal' },
    { kind: 'terminal', id: 't1', name: 'Terminal', text: 'hello', cut: false, selection: true },
    { kind: 'script', id: 'run', name: 'dev' },
  ];
  keepUnsent('c1', { text: '', pictures: [], files: [], outputs });
  assert.deepEqual(takeUnsent('c1'), { text: '', pictures: [], files: [], outputs, answers: {} });
});

test('what was kept as a terminal’s card and is none is left out', () => {
  storage();
  const outputs = [
    { kind: 'window', id: 'w1', name: 'Window' },
    { kind: 'terminal', name: 'neither an id nor its output' },
    { kind: 'terminal', id: 't1' },
    'Terminal',
    null,
  ];
  keepUnsent('c1', { text: 'hi', pictures: [], files: [], outputs });
  assert.deepEqual(takeUnsent('c1'), words('hi'));
});

test('an empty box is kept as nothing, also over what was kept before', () => {
  storage();
  keepUnsent('c1', { text: 'half a thought', pictures: [PICTURE], files: ['a.js'] });
  keepUnsent('c1', words('   \n'));
  assert.equal(takeUnsent('c1'), null);
});

test('pictures with no room left for them stay behind: the words and files are kept all the same', () => {
  const big = { url: `data:image/png;base64,${'A'.repeat(5000)}`, preview: null };
  const kept = storage(2000);
  keepUnsent('c1', { text: 'look at this', pictures: [big], files: ['a.js'] });
  assert.deepEqual(takeUnsent('c1'), { text: 'look at this', pictures: [], files: ['a.js'], answers: {} });
  keepUnsent('c1', { text: '', pictures: [big], files: [] });
  assert.equal(takeUnsent('c1'), null, 'and pictures alone leave nothing');
  keepUnsent('c2', words('kept before'));
  keepUnsent('c1', { text: '', pictures: [big], files: [] });
  assert.deepEqual(JSON.parse(kept.get('unsent')), { c2: words('kept before') }, 'what other contacts have stays');
});

test('without anything to keep it in, or with something unreadable kept, the box starts empty', () => {
  assert.equal(takeUnsent('c1'), null);
  assert.doesNotThrow(() => keepUnsent('c1', words('half a thought')));
  const kept = storage();
  kept.set('unsent', 'not json');
  assert.equal(takeUnsent('c1'), null);
  kept.set('unsent', '["a list"]');
  assert.equal(takeUnsent('c1'), null);
  kept.set('unsent', '{"c1":7}');
  assert.equal(takeUnsent('c1'), null);
  kept.set('unsent', '{"c1":["a list"]}');
  assert.equal(takeUnsent('c1'), null);
});

test('what is unreadable in a box that was kept is left out, and the rest comes back', () => {
  const kept = storage();
  const odd = {
    text: 7,
    pictures: [PICTURE, 'a picture?', { url: 'https://x.test/a.png' }, { url: PICTURE.url, preview: 3 }],
    files: ['a.js', 5],
  };
  kept.set('unsent', JSON.stringify({ c1: odd, c2: { text: 'only words' } }));
  assert.deepEqual(takeUnsent('c1'), {
    text: '',
    pictures: [PICTURE, { url: PICTURE.url, preview: null }],
    files: ['a.js'],
    answers: {},
  });
  assert.deepEqual(takeUnsent('c2'), words('only words'));
});

const SO_FAR = { current: 2, picked: { 'Which DB?': { chosen: ['Postgres'], other: '' } } };

test('the answers you chose to its questions and did not send come back, also with nothing in the box', () => {
  storage();
  keepUnsent('c1', { ...words(''), answers: { r1: SO_FAR } });
  keepUnsent('c2', { ...words('and a thought'), answers: { r2: SO_FAR } });
  assert.deepEqual(takeUnsent('c1'), { ...words(''), answers: { r1: SO_FAR } });
  assert.deepEqual(takeUnsent('c2'), { ...words('and a thought'), answers: { r2: SO_FAR } });
});

test('the answers stay when the pictures beside them leave no room', () => {
  const big = { url: `data:image/png;base64,${'A'.repeat(5000)}`, preview: null };
  storage(2000);
  keepUnsent('c1', { text: '', pictures: [big], files: [], answers: { r1: SO_FAR } });
  assert.deepEqual(takeUnsent('c1'), { ...words(''), answers: { r1: SO_FAR } });
});

test('answers kept as something else come back as none', () => {
  const kept = storage();
  kept.set(
    'unsent',
    JSON.stringify({ c1: { text: 'hi', answers: ['a list'] }, c2: { text: 'hi', answers: { r1: 7, r2: SO_FAR } } })
  );
  assert.deepEqual(takeUnsent('c1'), words('hi'));
  assert.deepEqual(takeUnsent('c2'), { ...words('hi'), answers: { r2: SO_FAR } });
});
