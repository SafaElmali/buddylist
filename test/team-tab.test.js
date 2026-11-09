import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crewOf, teamHeading, teamOf, teamRow, teamSections, teamWhen } from '../src/renderer/chat/team-tab.js';

const NOW = Date.UTC(2026, 9, 22, 12);
const MINUTE = 60000;

const manager = { id: 'm', name: 'Manager', project: 'shop', manages: 'git:/w/shop/.git', status: 'online' };
/** A conversation on shop that the main process says the manager oversees (see `overseenBy`). */
const contact = (id, more = {}) => ({
  id,
  name: `Claude (${id})`,
  project: 'shop',
  status: 'online',
  overseenBy: 'm',
  ...more,
});

test('a project manager’s Team tab lists its managers, each saying how many conversations it oversees', () => {
  const lead = { id: 'pm', name: 'shop project manager', project: 'shop', manages: 'git:/w/shop/.git', leads: true };
  const reviewer = {
    id: 'rev',
    name: 'review manager',
    project: 'shop',
    status: 'busy',
    ledBy: 'pm',
    personalMessage: 'Reading src/tags.js',
  };
  const contacts = [
    lead,
    { ...manager, ledBy: 'pm', location: '~/shop', personalMessage: '~/shop', lastActive: NOW },
    reviewer,
    contact('cart'),
    contact('tags'),
    contact('review-1', { overseenBy: 'rev' }),
    { ...manager, id: 'm2', ledBy: 'pm', archived: true },
  ];
  const crew = crewOf(lead, contacts);
  assert.deepEqual(
    crew.map((one) => [one.id, one.personalMessage]),
    [
      ['m', 'Oversees 2 conversations'],
      ['rev', 'Reading src/tags.js'],
    ]
  );
  assert.equal(teamRow(crew[0], NOW).note, 'Oversees 2 conversations');
  assert.deepEqual(crewOf(manager, contacts), teamOf(manager, contacts), 'a manager’s is its team');
});

test('a manager’s team is the conversations under it, the archived ones aside', () => {
  const contacts = [
    manager,
    contact('cart'),
    contact('tags'),
    contact('old', { archived: true }),
    contact('blog', { project: 'blog', overseenBy: 'm2' }),
    contact('loose', { overseenBy: null }),
    { ...manager, id: 'm2', name: 'Manager of blog', project: 'blog' },
  ];
  assert.deepEqual(
    teamOf(manager, contacts).map(({ id }) => id),
    ['cart', 'tags']
  );
});

test('another manager on the same project is no one it oversees', () => {
  const other = { ...manager, id: 'm2', overseenBy: null };
  assert.deepEqual(
    teamOf(manager, [manager, other, contact('cart')]).map(({ id }) => id),
    ['cart']
  );
});

test('the ones waiting for you come first, then the ones at work most lately, then the ones never at work', () => {
  const contacts = [
    contact('never'),
    contact('earlier', { lastActive: NOW - 60 * MINUTE }),
    contact('waits', { status: 'away', lastActive: NOW - 120 * MINUTE }),
    contact('lately', { status: 'busy', lastActive: NOW - MINUTE }),
  ];
  assert.deepEqual(
    teamOf(manager, contacts).map(({ id }) => id),
    ['waits', 'lately', 'earlier', 'never']
  );
});

test('a row says that it needs you, or else when it was last at work', () => {
  assert.equal(teamWhen(contact('a', { status: 'away', lastActive: NOW - 5 * MINUTE }), NOW), 'Needs you');
  assert.equal(teamWhen(contact('a', { status: 'busy', lastActive: NOW - 5 * MINUTE }), NOW), '5m ago');
  assert.equal(teamWhen(contact('a', { lastActive: NOW - 3 * 60 * MINUTE }), NOW), '3h ago');
  assert.equal(teamWhen(contact('a', { lastActive: null }), NOW), '');
  assert.equal(teamWhen(contact('a'), NOW), '');
});

const PULL_REQUEST = {
  number: 131,
  url: 'https://github.com/o/shop/pull/131',
  title: 'Back off when the API says to slow down',
  state: 'open',
  checks: { failing: 0, pending: 0, passed: 14 },
  lines: { added: 2173, removed: 54 },
  conflict: true,
};

test('the team is in sections: the ones that need you, the ones at work, the idle ones, then the ones whose folder is gone', () => {
  const team = teamOf(manager, [
    manager,
    contact('gone', { status: 'offline' }),
    contact('idle', { lastActive: NOW - 60 * MINUTE }),
    contact('cart', { status: 'busy', lastActive: NOW - 2 * MINUTE }),
    contact('waits', { status: 'away', lastActive: NOW - 9 * MINUTE }),
    contact('tags', { status: 'busy', lastActive: NOW - MINUTE }),
  ]);
  assert.deepEqual(
    teamSections(team).map(({ id, label, members }) => [id, label, members.map(({ id }) => id)]),
    [
      ['waiting', 'Needs you', ['waits']],
      ['working', 'Working', ['tags', 'cart']],
      ['idle', 'Idle', ['idle']],
      ['offline', 'Offline', ['gone']],
    ]
  );
});

test('one with commands left running in the background is at work: under its name it says so, beside its branch and pull request', () => {
  const running = contact('checks', {
    personalMessage: '2 commands running in the background',
    inBackground: true,
    location: '~/.buddylist/worktrees/shop/shop-3',
    branch: 'fix/checks',
    pullRequest: PULL_REQUEST,
  });
  const row = teamRow(running, NOW);
  assert.deepEqual(
    [row.status, row.doing, row.branch, row.tags.length > 0, row.note],
    ['online', '2 commands running in the background', 'fix/checks', true, '']
  );
  const team = [contact('idle'), running, contact('cart', { status: 'busy' })];
  assert.deepEqual(
    teamSections(team).map(({ id, members }) => [id, members.map(({ id }) => id)]),
    [
      ['working', ['checks', 'cart']],
      ['idle', ['idle']],
    ],
    'not among the idle ones'
  );
  assert.equal(teamHeading(team, 'shop'), '3 on shop · 2 working');
  // Once they end, it is idle again.
  const ended = { ...running, personalMessage: running.location, inBackground: false };
  assert.deepEqual([teamRow(ended, NOW).doing, teamSections([ended]).map(({ id }) => id)], ['', ['idle']]);
});

test('a section with nobody in it is left out', () => {
  assert.deepEqual(
    teamSections([contact('a'), contact('b')]).map(({ id }) => id),
    ['idle']
  );
  assert.deepEqual(teamSections([]), []);
});

test('at work, a row says under its name what it is doing, and nothing of its branch or pull request', () => {
  const row = teamRow(
    contact('cart', {
      status: 'busy',
      unread: 2,
      lastActive: NOW,
      personalMessage: 'Editing cart.js',
      location: '~/w/shop/cart',
      branch: 'fix/cart',
      pullRequest: PULL_REQUEST,
    }),
    NOW
  );
  assert.deepEqual(
    { ...row, title: undefined },
    {
      id: 'cart',
      name: 'Claude (cart)',
      status: 'busy',
      when: 'now',
      unread: 2,
      doing: 'Editing cart.js',
      branch: '',
      tags: [],
      size: null,
      note: '',
      title: undefined,
    }
  );
});

test('otherwise a row says its branch, and its pull request’s tags and size as the contact list has them', () => {
  const row = teamRow(
    contact('rate', {
      lastActive: NOW - 20 * 60 * MINUTE,
      personalMessage: 'Merge conflict on pull request #131',
      location: '~/w/shop/rate',
      branch: 'fix/rate-limit',
      pullRequest: PULL_REQUEST,
    }),
    NOW
  );
  assert.deepEqual(
    [row.doing, row.branch, row.tags, row.size, row.note, row.when],
    [
      '',
      'fix/rate-limit',
      [
        { kind: 'conflict', text: 'Conflict' },
        { kind: 'passed', text: 'Passed' },
      ],
      { added: '+2,173', removed: '−54' },
      '',
      '20h ago',
    ]
  );
});

test('one that needs you says its branch too: the section and its end say it waits', () => {
  const row = teamRow(
    contact('waits', {
      status: 'away',
      personalMessage: 'Waiting for you to approve something',
      branch: 'fix/cart',
    }),
    NOW
  );
  assert.deepEqual([row.when, row.doing, row.branch, row.note], ['Needs you', '', 'fix/cart', '']);
});

test('a pull request with no branch known yet still has its tags; one merged has no size', () => {
  const row = teamRow(contact('done', { pullRequest: { ...PULL_REQUEST, state: 'merged' } }), NOW);
  assert.deepEqual([row.branch, row.tags, row.size, row.note], ['', [{ kind: 'merged', text: 'Merged' }], null, '']);
});

test('with neither branch nor pull request, a row says what its line in the contact list says', () => {
  const row = teamRow(contact('tags', { personalMessage: 'Dev server running in the background' }), NOW);
  assert.equal(row.note, 'Dev server running in the background');
});

test('a row never says the folder it works in, only its tooltip does', () => {
  const location = '~/.buddylist/worktrees/shop/shop-6';
  const idle = teamRow(contact('tags', { personalMessage: location, location }), NOW);
  assert.deepEqual([idle.note, idle.branch, idle.doing], ['', '', '']);
  assert.equal(idle.title, `Show Claude (tags)’s conversation here\n${location}`);
  const gone = teamRow(contact('gone', { status: 'offline', personalMessage: location, location }), NOW);
  assert.equal(gone.note, '');
  assert.ok(
    !JSON.stringify({ ...teamRow(contact('x', { location, personalMessage: location }), NOW), title: '' }).includes(
      location
    )
  );
});

test('the tooltip has the branch and the pull request, even while the row says what it is doing', () => {
  const row = teamRow(
    contact('cart', {
      status: 'busy',
      location: '~/w/shop/cart',
      personalMessage: 'Editing',
      branch: 'fix/cart',
      pullRequest: PULL_REQUEST,
    }),
    NOW
  );
  assert.equal(
    row.title,
    [
      'Show Claude (cart)’s conversation here',
      '~/w/shop/cart',
      'On fix/cart',
      'Pull request #131 · merge conflict, checks passed',
      'Back off when the API says to slow down',
    ].join('\n')
  );
});

test('a contact whose folder is gone wears no pull request, as in the contact list', () => {
  const row = teamRow(contact('gone', { status: 'offline', pullRequest: PULL_REQUEST, branch: null }), NOW);
  assert.deepEqual([row.tags, row.size, row.branch], [[], null, '']);
});

test('the tab says how many it oversees, on which project, and how many are at work', () => {
  assert.equal(teamHeading([contact('a')], 'shop'), '1 on shop');
  assert.equal(
    teamHeading([contact('a'), contact('b', { status: 'busy' }), contact('c', { status: 'away' })], 'shop'),
    '3 on shop · 1 working'
  );
  assert.equal(
    teamHeading(
      [contact('a', { status: 'busy' }), contact('b', { status: 'busy' }), contact('c'), contact('d')],
      'buddylist'
    ),
    '4 on buddylist · 2 working'
  );
});

// Exercise the real row event delegation and shared menu, in both looks.
import { TeamTab } from '../src/renderer/chat/team-tab.js';
import { closeMenu } from '../src/renderer/lib/menu.js';
import { Element, page } from './fixtures/dom.js';

function mounted(t, look) {
  const document = page(t, look);
  const previous = { window: globalThis.window, Element: globalThis.Element, CSS: globalThis.CSS };
  Object.assign(globalThis, {
    window: { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} },
    Element,
    CSS: { escape: (value) => value },
  });
  t.mock.method(globalThis, 'setInterval', () => 0);
  t.after(() => {
    closeMenu();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  });
  const opened = [];
  const added = [];
  const tab = new TeamTab(
    { open() {} },
    {
      open: (one) => opened.push(one.id),
      branch: async () => null,
      menu: (one) => [
        { label: 'Open conversation', action: () => opened.push(one.id) },
        { label: 'Add to message', action: () => added.push(one.id) },
      ],
    }
  );
  document.body.append(tab.body);
  tab.setContacts(manager, [contact('first'), contact('second')]);
  const row = (id) => tab.list.querySelector(`[data-id="${id}"]`);
  for (const one of tab.list.querySelectorAll('.team-row')) {
    one.getBoundingClientRect = () => ({ left: 10, right: 200, top: 10, bottom: 50 });
  }
  return { document, tab, row, opened, added };
}

for (const look of ['professional', 'messenger']) {
  test(`${look}: right-click selects that row without navigating, and actions use it`, (t) => {
    const { document, row, opened, added } = mounted(t, look);
    row('first').focus();
    row('second').querySelector('.team-name').fire('contextmenu', { button: 2, clientX: 40, clientY: 60 });
    assert.deepEqual(opened, []);
    assert.equal(row('second').getAttribute('aria-expanded'), 'true');
    assert.equal(row('first').getAttribute('aria-expanded'), 'false');
    const popup = document.body.querySelector('.popup');
    assert.equal(popup.getAttribute('aria-label'), 'Actions for Claude (second)');
    popup.querySelectorAll('.menu-item')[1].click();
    assert.deepEqual(added, ['second']);
    assert.equal(document.activeElement, row('second'));
    row('first').click();
    assert.deepEqual(opened, ['first'], 'normal clicks still navigate');
  });

  test(`${look}: Shift+F10 and Menu open actions, arrows choose, Escape restores focus`, (t) => {
    const { document, row, opened, added } = mounted(t, look);
    row('second').focus();
    const event = row('second').fire('keydown', { key: 'F10', shiftKey: true });
    assert.equal(event.defaultPrevented, true);
    const popup = document.body.querySelector('.popup');
    assert.equal(document.activeElement, popup);
    assert.equal(popup.getAttribute('aria-activedescendant'), 'team-action-0');
    popup.fire('keydown', { key: 'ArrowDown' });
    assert.equal(popup.getAttribute('aria-activedescendant'), 'team-action-1');
    popup.fire('keydown', { key: 'Enter' });
    assert.deepEqual(added, ['second']);
    assert.deepEqual(opened, []);
    row('second').fire('keydown', { key: 'ContextMenu' });
    document.body.querySelector('.popup').fire('keydown', { key: 'Escape' });
    assert.equal(document.body.querySelector('.popup'), null);
    assert.equal(document.activeElement, row('second'));
    assert.equal(row('second').getAttribute('aria-expanded'), 'false');
  });

  test(`${look}: status redraws keep the right-click target; removal closes its menu`, (t) => {
    const { document, tab, row } = mounted(t, look);
    row('second').fire('contextmenu', { button: 2, clientX: 40, clientY: 60 });
    tab.setContacts(manager, [contact('second', { status: 'busy' }), contact('first')]);
    assert.equal(row('second').getAttribute('aria-expanded'), 'true');
    document.body.querySelector('.popup').fire('keydown', { key: 'Escape' });
    assert.equal(document.activeElement, row('second'));
    row('second').fire('contextmenu', { button: 2, clientX: 40, clientY: 60 });
    tab.setContacts(manager, [contact('first')]);
    assert.equal(document.body.querySelector('.popup'), null);
  });
}
