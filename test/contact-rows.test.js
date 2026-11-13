import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addedIn,
  companyOf,
  contactRow,
  foldLabel,
  hitRow,
  hitRowId,
  lastAdded,
  liveHits,
  markParts,
  nearMatch,
  nobodyHere,
  SNIPPET_LEAD,
  startedTitle,
  typedName,
  unreadTitle,
} from '../src/renderer/contacts/rows.js';
import { DEFAULT_LIST_VIEW, listSections } from '../src/shared/list-view.js';
import { pullRequestStatus } from '../src/shared/pull-request-text.js';

const checksOf = (failing, pending, passed) => ({ failing, pending, passed });

const claude = {
  id: 'c1',
  name: 'Claude',
  status: 'online',
  location: '~/projects/api',
  personalMessage: '~/projects/api',
};

// ---- a contact's row ------------------------------------------------------------------------------

test('a contact’s row wears its status, and says where it works or what it is doing', () => {
  assert.deepEqual(contactRow(claude), {
    look: 'online',
    icon: 'online',
    iconLabel: '',
    lead: false,
    note: '~/projects/api',
    doing: false,
    where: false,
    below: false,
    company: '',
    unread: 0,
    tags: [],
    tagsTitle: '',
    size: null,
    buttons: [],
  });
  const busy = contactRow({ ...claude, status: 'busy', personalMessage: 'Running npm test' });
  assert.deepEqual([busy.look, busy.icon, busy.note, busy.doing], ['busy', 'busy', 'Running npm test', true]);
  const away = contactRow({ ...claude, status: 'away', personalMessage: 'Waiting for you to approve something' });
  assert.deepEqual([away.look, away.doing], ['away', true]);
});

test('a row has no + of its own: another contact on its project is started from the project', () => {
  for (const status of ['online', 'busy', 'away', 'offline']) {
    assert.equal('add' in contactRow({ ...claude, status }), false, status);
  }
});

test('a contact whose folder is gone wears the offline buddy, and is doing nothing', () => {
  const row = contactRow({ ...claude, status: 'offline' });
  assert.deepEqual([row.look, row.icon, row.doing], ['offline', 'offline', false]);
});

test('a contact’s row counts what you have not seen in its conversation', () => {
  assert.equal(contactRow({ ...claude, unread: 2 }).unread, 2);
  assert.equal(contactRow(claude).unread, 0, 'a contact nobody counted for has nothing unread');
  assert.equal(unreadTitle(2), '2 unread in this conversation');
});

test('the count of the conversations started from a contact says what a click on it does', () => {
  assert.equal(startedTitle(1), 'A conversation started from this one. Click to hide it');
  assert.equal(startedTitle(3), '3 conversations started from this one. Click to hide them');
  assert.equal(startedTitle(3, true), '3 conversations started from this one. Click to show them');
  assert.equal(startedTitle(1, true), 'A conversation started from this one. Click to show it');
});

test('a project manager’s count and its row say the managers it oversees', () => {
  assert.equal(startedTitle(2, false, true, true), '2 managers it oversees are under it. Click to hide them');
  assert.equal(startedTitle(1, true, true, true), 'A manager it oversees is under it. Click to show it');
  assert.equal(foldLabel(2, false, true), 'Hide 2 managers');
  assert.equal(foldLabel(1, true), 'Show 1 conversation');
  const lead = {
    id: 'pm',
    name: 'shop project manager',
    status: 'online',
    oversees: true,
    leads: true,
    location: '~/shop',
    personalMessage: '~/shop',
  };
  assert.equal(contactRow(lead, { team: 2 }).note, 'Oversees 2 managers');
  assert.equal(contactRow(lead, { team: 0 }).note, 'No managers to oversee yet');
  assert.equal(contactRow({ ...lead, leads: undefined }, { team: 1 }).note, 'Oversees 1 conversation');
});

test('a project’s manager’s count says the conversations it oversees are under it', () => {
  assert.equal(startedTitle(3, false, true), '3 conversations it oversees are under it. Click to hide them');
  assert.equal(startedTitle(1, false, true), 'A conversation it oversees is under it. Click to hide it');
  assert.equal(startedTitle(3, true, true), '3 conversations it oversees are under it. Click to show them');
});

test('a contact with guests says who it is with', () => {
  const guests = [{ id: 'c2', name: 'Codex' }, { name: 'Opus' }];
  assert.equal(contactRow({ ...claude, guests }).company, 'with Codex and Opus');
  assert.equal(companyOf({ guests }), 'with Codex and Opus');
  assert.equal(companyOf({ guests: [] }), '');
  assert.equal(companyOf({}), '');
});

test('a contact with guests says what it is busy with on its second line, before who it is with', () => {
  const guests = [{ id: 'c2', name: 'Codex' }];
  const busy = contactRow({ ...claude, guests, status: 'busy', personalMessage: 'Running npm test' });
  assert.deepEqual([busy.note, busy.doing, busy.below, busy.company], ['Running npm test', true, true, 'with Codex']);
  const away = contactRow({
    ...claude,
    guests,
    status: 'away',
    personalMessage: 'Waiting for you to approve something',
  });
  assert.deepEqual([away.note, away.below], ['Waiting for you to approve something', true]);
  // Idle, where it works stays on the first line: before who it is with, a long path would hide them.
  const idle = contactRow({ ...claude, guests });
  assert.deepEqual([idle.note, idle.below], ['~/projects/api', false]);
  // Without guests there is no second line: what it is doing shares the first with the name.
  assert.equal(contactRow({ ...claude, status: 'busy', personalMessage: 'Running npm test' }).below, false);
  // A row with tags says nothing of it.
  const pullRequest = { number: 12, state: 'open', checks: checksOf(0, 0, 2) };
  const tagged = contactRow({ ...claude, guests, status: 'busy', personalMessage: 'Running npm test', pullRequest });
  assert.deepEqual([tagged.note, tagged.below], ['', false]);
  // Away from its project's section, it says which project instead, on the first line.
  const elsewhere = contactRow(
    { ...claude, guests, status: 'away', project: 'api', personalMessage: 'Waiting for you to approve something' },
    { projectNote: true }
  );
  assert.deepEqual([elsewhere.note, elsewhere.below], ['api', false]);
  // Put away, it is doing nothing, and with nobody.
  assert.equal(contactRow({ ...claude, guests, status: 'busy', archived: true }).below, false);
});

test('one with commands left running in the background says so as work going on, wherever it is drawn', () => {
  const running = { ...claude, personalMessage: '2 commands running in the background', inBackground: true };
  const row = contactRow(running);
  assert.deepEqual(
    [row.look, row.note, row.doing, row.below],
    ['online', '2 commands running in the background', true, false],
    'its turn is over, and still it is at work: not a quiet line like where it works'
  );
  assert.deepEqual(
    [row.icon, row.iconLabel],
    ['background', '2 commands running in the background'],
    'its buddy wears the arrow going round, and says what it means'
  );
  // Under a manager it says what runs, not who started it.
  assert.equal(contactRow(running, { startedBy: 'shop manager' }).note, '2 commands running in the background');
  // With guests, on the second line, before who it is with.
  const guests = [{ id: 'c2', name: 'Reviewer' }];
  const company = contactRow({ ...running, guests });
  assert.deepEqual(
    [company.note, company.doing, company.below, company.company],
    ['2 commands running in the background', true, true, 'with Reviewer']
  );
  // A row with tags is its name and its tags, as a busy one is, and its buddy still says it; away from its
  // project, it says which, and its buddy says what runs.
  const pullRequest = { number: 12, state: 'open', checks: checksOf(0, 0, 2) };
  const tagged = contactRow({ ...running, pullRequest });
  assert.deepEqual([tagged.note, tagged.icon], ['', 'background']);
  const elsewhere = contactRow({ ...running, project: 'api' }, { projectNote: true });
  assert.deepEqual(
    [elsewhere.note, elsewhere.doing, elsewhere.where, elsewhere.icon],
    ['api', false, true, 'background']
  );
  // Busy, waiting for you or put away, it wears that instead.
  for (const [more, icon] of [
    [{ status: 'busy', personalMessage: 'Running npm test' }, 'busy'],
    [{ status: 'away', personalMessage: 'Waiting for you to approve something' }, 'away'],
    [{ archived: true }, 'offline'],
  ]) {
    const other = contactRow({ ...running, ...more });
    assert.deepEqual([other.icon, other.iconLabel], [icon, ''], icon);
  }
  // Once they end, it is idle again: where it works, quietly, with the online buddy.
  const ended = contactRow({ ...running, personalMessage: claude.location, inBackground: false });
  assert.deepEqual([ended.note, ended.doing, ended.icon, ended.iconLabel], ['~/projects/api', false, 'online', '']);
});

test('a project’s manager at work leads, and with nothing else to say tells how many it oversees', () => {
  const manager = { ...claude, name: 'Manager', oversees: true };
  const row = contactRow(manager, { team: 6 });
  assert.deepEqual([row.lead, row.look, row.icon, row.note], [true, 'online', 'online', 'Oversees 6 conversations']);
  assert.equal(contactRow(manager, { team: 1 }).note, 'Oversees 1 conversation');
  assert.equal(contactRow(manager).note, 'No conversations to oversee yet');
  // What it is doing, what waits for you, and what it left running say more than that.
  const busy = contactRow({ ...manager, status: 'busy', personalMessage: 'Reading the PRD' }, { team: 6 });
  assert.deepEqual([busy.lead, busy.icon, busy.note, busy.doing], [true, 'busy', 'Reading the PRD', true]);
  const away = contactRow({ ...manager, status: 'away', personalMessage: 'Waiting for you to approve something' });
  assert.deepEqual([away.lead, away.note], [true, 'Waiting for you to approve something']);
  assert.equal(contactRow({ ...manager, personalMessage: '1 shell running' }, { team: 6 }).note, '1 shell running');
  // Away from its project's section, it says which project, as any row does.
  assert.equal(contactRow({ ...manager, project: 'shop' }, { team: 6, projectNote: true }).note, 'shop');
  // Turned off, or put away, it is a contact like any other.
  assert.deepEqual(contactRow({ ...manager, oversees: false }, { team: 6 }), contactRow(claude));
  assert.equal(contactRow({ ...manager, archived: true }, { team: 6 }).lead, false);
});

test('one under a project’s manager says who started it, with nothing else to say', () => {
  assert.equal(contactRow(claude, { startedBy: 'shop manager' }).note, 'started by shop manager');
  assert.equal(contactRow(claude, { startedBy: 'Claude (cart)' }).note, 'started by Claude (cart)');
  // Nobody started it: where it works, as before.
  assert.equal(contactRow(claude, { startedBy: '' }).note, '~/projects/api');
  // What it is doing, what waits for you, and its tags say more than that.
  const busy = contactRow(
    { ...claude, status: 'busy', personalMessage: 'Editing tags.rb' },
    { startedBy: 'shop manager' }
  );
  assert.deepEqual([busy.note, busy.doing], ['Editing tags.rb', true]);
  assert.equal(
    contactRow({ ...claude, personalMessage: '1 shell running' }, { startedBy: 'shop manager' }).note,
    '1 shell running'
  );
  const pullRequest = { number: 12, state: 'open', checks: checksOf(0, 0, 2) };
  assert.equal(contactRow({ ...claude, pullRequest }, { startedBy: 'shop manager' }).note, '');
  // Away from its project's section, it says which project, as any row does.
  assert.equal(
    contactRow({ ...claude, project: 'shop' }, { startedBy: 'shop manager', projectNote: true }).note,
    'shop'
  );
  assert.equal(contactRow({ ...claude, archived: true }, { startedBy: 'shop manager' }).note, '~/projects/api');
});

test('a conversation a manager drafted says it waits to start, as a row that needs you says it', () => {
  const drafted = { ...claude, startedBy: 'm', draft: 'Round the cart total.' };
  assert.deepEqual(contactRow(drafted, { startedBy: 'shop manager' }), {
    look: 'online',
    icon: 'draft',
    iconLabel: 'Waiting to start',
    lead: false,
    note: 'Waiting to start',
    // In the colours of a row at work, which the list beside a conversation still shows.
    doing: true,
    where: false,
    below: false,
    company: '',
    unread: 0,
    tags: [],
    tagsTitle: '',
    size: null,
    buttons: [],
  });
  // With guests, on the second line, as what a busy one does is.
  const together = contactRow({ ...drafted, guests: [{ id: 'g', name: 'Codex' }] });
  assert.deepEqual([together.note, together.below, together.company], ['Waiting to start', true, 'with Codex']);
  // Away from its project's section it says which project, and still wears its badge.
  const away = contactRow({ ...drafted, project: 'shop' }, { projectNote: true });
  assert.deepEqual([away.note, away.doing, away.icon], ['shop', false, 'draft']);
});

test('a draft that waits on nobody, or one that can’t start, is a row like any other', () => {
  // The user's own, from an issue: theirs to finish.
  assert.deepEqual(contactRow({ ...claude, draft: 'Issue #1: Fix login' }), contactRow(claude));
  // Sent: it has started.
  const started = { ...claude, startedBy: 'm', draft: null };
  assert.deepEqual(contactRow(started, { startedBy: 'shop manager' }).note, 'started by shop manager');
  // Its folder is gone: offline says that first.
  const gone = contactRow({ ...claude, status: 'offline', startedBy: 'm', draft: 'Round the cart total.' });
  assert.deepEqual([gone.icon, gone.note, gone.doing], ['offline', '~/projects/api', false]);
  // Archived: put away, as any.
  const archived = contactRow({ ...claude, archived: true, startedBy: 'm', draft: 'Round the cart total.' });
  assert.equal(archived.icon, 'offline');
});

test('an archived contact’s row: the offline buddy, its folder, and nothing to click', () => {
  const archived = {
    look: 'archived',
    icon: 'offline',
    iconLabel: '',
    lead: false,
    note: '~/projects/api',
    doing: false,
    where: false,
    below: false,
    company: '',
    unread: 0,
    tags: [],
    tagsTitle: '',
    size: null,
    buttons: [],
  };
  assert.deepEqual(contactRow({ ...claude, archived: true }), archived);
  // Whatever its status would be, whoever it was with, and whatever its pull request said.
  for (const status of ['online', 'busy', 'away', 'offline']) {
    const row = contactRow({
      ...claude,
      status,
      archived: true,
      favorite: true,
      personalMessage: 'Running npm test',
      unread: 3,
      guests: [{ name: 'Codex' }],
      pullRequest: {
        number: 12,
        url: 'https://github.com/you/api/pull/12',
        title: 'Fix',
        state: 'open',
        lines: { added: 40, removed: 2 },
      },
    });
    assert.deepEqual(row, archived, status);
  }
});

// ---- how its pull request stands ------------------------------------------------------------------

const pullRequest = (fields = {}) => ({
  number: 12,
  url: 'https://github.com/you/api/pull/12',
  title: 'Back off when the API says to slow down',
  state: 'open',
  ...fields,
});
const tagsOf = (row) => row.tags.map((tag) => tag.kind);

test('a chat tab under its own conversation leaves the shared pull request to that one’s row, and says what it does', () => {
  const pr = pullRequest({ checks: checksOf(2, 0, 9), lines: { added: 1684, removed: 34 } });
  const guests = [{ id: 'g', name: 'Codex' }];
  const shared = { ...claude, status: 'busy', personalMessage: 'Running npm test', guests, pullRequest: pr };
  const own = contactRow(shared);
  assert.deepEqual(tagsOf(own), ['failing']);
  assert.ok(own.size);
  assert.equal(own.note, '', 'with tags, only its name and its tags');
  const tab = contactRow(shared, { tab: true });
  assert.deepEqual([tab.tags, tab.tagsTitle, tab.size, tab.buttons], [[], '', null, []]);
  // Its own status and its guests stay.
  assert.deepEqual([tab.look, tab.note, tab.doing, tab.company], ['busy', 'Running npm test', true, own.company]);
  assert.ok(tab.company, 'the “with Codex” line');
  // Merged: no Continue, Archive and Delete either, which come after the tag.
  const merged = { ...claude, pullRequest: pullRequest({ state: 'merged' }) };
  assert.equal(contactRow(merged).buttons.length, 3);
  assert.deepEqual(contactRow(merged, { tab: true }).buttons, []);
  assert.equal(contactRow(merged, { tab: true }).note, '~/projects/api');
  // With nothing else to say, it would say how the pull request stands: it says where it works instead.
  const idle = { ...claude, pullRequest: pr, personalMessage: pullRequestStatus(pr) };
  assert.equal(contactRow(idle).note, '', 'its tags say it');
  assert.equal(contactRow(idle, { tab: true }).note, '~/projects/api');
  // Anything else it says stays: what it left running, say.
  assert.equal(contactRow({ ...idle, personalMessage: '1 shell running' }, { tab: true }).note, '1 shell running');
});

test('a contact’s row wears tags for its pull request, worded the way its card words it', () => {
  const row = contactRow({ ...claude, pullRequest: pullRequest({ conflict: true, checks: checksOf(2, 0, 9) }) });
  assert.deepEqual(row.tags, [
    {
      kind: 'conflict',
      text: 'Conflict',
      action: 'fixConflicts',
      title: 'Merge conflict with the base branch\nClick to ask Claude to merge it in and resolve the conflicts.',
    },
    {
      kind: 'failing',
      text: '2 failing',
      action: 'checks',
      title:
        '#12: 2 checks failing\nBack off when the API says to slow down\nClick to see them beside the conversation.',
    },
  ]);
  assert.deepEqual(tagsOf(contactRow({ ...claude, pullRequest: pullRequest({ state: 'merged' }) })), ['merged']);
});

test('before its tags, a row says how many lines its pull request adds and removes', () => {
  const lines = { added: 2173, removed: 54 };
  assert.deepEqual(contactRow({ ...claude, pullRequest: pullRequest({ lines }) }).size, {
    added: '+2,173',
    removed: '−54',
  });
  assert.equal(contactRow({ ...claude, pullRequest: pullRequest() }).size, null, 'GitHub did not say');
  assert.equal(contactRow({ ...claude, pullRequest: pullRequest({ state: 'merged', lines }) }).size, null, 'merged');
  assert.equal(contactRow({ ...claude, status: 'offline', pullRequest: pullRequest({ lines }) }).size, null, 'gone');
});

test('pointing at the tags tells how the pull request stands, what it is called and what a click does', () => {
  const pr = pullRequest({ conflict: true, checks: checksOf(2, 0, 9) });
  assert.equal(
    contactRow({ ...claude, pullRequest: pr }).tagsTitle,
    'Pull request #12 · merge conflict, 2 checks failing\nBack off when the API says to slow down\nClick to open it on GitHub.'
  );
  assert.equal(
    contactRow({ ...claude, pullRequest: { ...pr, title: '' } }).tagsTitle,
    'Pull request #12 · merge conflict, 2 checks failing\nClick to open it on GitHub.',
    'no title, no line for it'
  );
});

test('a click on the tag for its checks shows them beside the conversation, and its tooltip says so', () => {
  const acts = (checks, fields = {}) =>
    contactRow({ ...claude, pullRequest: pullRequest({ checks, ...fields }) }).tags.map(({ kind, action, title }) => [
      kind,
      action,
      title,
    ]);
  const click = 'Back off when the API says to slow down\nClick to see them beside the conversation.';
  assert.deepEqual(
    acts(checksOf(1, 2, 3)),
    [['failing', 'checks', `#12: 1 check failing\n${click}`]],
    'while others run'
  );
  assert.deepEqual(acts(checksOf(0, 2, 3)), [['running', 'checks', `#12: checks running\n${click}`]]);
  assert.deepEqual(acts(checksOf(0, 0, 3), { state: 'draft' }), [['passed', 'checks', `#12: checks passed\n${click}`]]);
});

test('the tooltip of the tag for its checks names a five-digit pull request first, and leaves out a missing title', () => {
  const [tag] = contactRow({
    ...claude,
    pullRequest: pullRequest({ number: 48213, title: '', checks: checksOf(1, 0, 4) }),
  }).tags;
  assert.deepEqual(
    [tag.text, tag.title],
    ['1 failing', '#48213: 1 check failing\nClick to see them beside the conversation.']
  );
});

test('a click on Conflict asks the contact to resolve the conflicts, and its tooltip says whom', () => {
  const row = contactRow({ ...claude, pullRequest: pullRequest({ conflict: true, checks: checksOf(0, 0, 3) }) });
  assert.deepEqual(row.tags[0], {
    kind: 'conflict',
    text: 'Conflict',
    action: 'fixConflicts',
    title: 'Merge conflict with the base branch\nClick to ask Claude to merge it in and resolve the conflicts.',
  });
  assert.equal(row.tags[1].action, 'checks', 'its checks are a tag of their own');
});

test('any other tag acts on GitHub alone: no action and no tooltip of its own', () => {
  const acts = (fields) =>
    contactRow({ ...claude, pullRequest: pullRequest({ checks: checksOf(1, 0, 3), ...fields }) }).tags.map(
      ({ kind, action, title }) => [kind, action, title]
    );
  assert.deepEqual(acts({ checks: null }), [['open', undefined, undefined]], 'no checks to show');
  assert.deepEqual(acts({ checks: null, state: 'draft' }), [['draft', undefined, undefined]]);
  assert.deepEqual(acts({ state: 'merged' }), [['merged', undefined, undefined]], 'its checks no longer matter');
  assert.deepEqual(acts({ state: 'closed', conflict: true }), [['closed', undefined, undefined]]);
});

test('a row with tags is its name and its tags: no note, whether the contact is idle, busy or waiting', () => {
  const pr = pullRequest({ checks: checksOf(1, 0, 3) });
  const idle = contactRow({ ...claude, personalMessage: '#12: 1 check failing', pullRequest: pr });
  assert.deepEqual([tagsOf(idle), idle.note], [['failing'], '']);
  const busy = contactRow({ ...claude, status: 'busy', personalMessage: 'Running npm test', pullRequest: pr });
  assert.deepEqual([tagsOf(busy), busy.note, busy.look], [['failing'], '', 'busy']);
  const away = contactRow({
    ...claude,
    status: 'away',
    personalMessage: 'Waiting for you to approve something',
    pullRequest: pr,
  });
  assert.deepEqual([tagsOf(away), away.note, away.look], [['failing'], '', 'away']);
});

test('a row away from its project says which project, instead of what the contact is doing', () => {
  const waiting = {
    ...claude,
    status: 'away',
    project: 'api',
    personalMessage: 'Waiting for you to approve something',
  };
  const row = contactRow(waiting, { projectNote: true });
  assert.deepEqual([row.note, row.doing, row.where, row.look], ['api', false, true, 'away']);
  // Beside the tags of a pull request too, where a row has no note otherwise.
  const tagged = contactRow(
    { ...waiting, pullRequest: pullRequest({ checks: checksOf(1, 0, 3) }) },
    { projectNote: true }
  );
  assert.deepEqual([tagsOf(tagged), tagged.note, tagged.where], [['failing'], 'api', true]);
  // Without it, or without a project to say, the row says what it always does.
  const plain = contactRow(waiting);
  assert.deepEqual([plain.note, plain.doing, plain.where], ['Waiting for you to approve something', true, false]);
  const nowhere = contactRow({ ...waiting, project: '' }, { projectNote: true });
  assert.deepEqual([nowhere.note, nowhere.doing, nowhere.where], ['Waiting for you to approve something', true, false]);
  // Put away, it says where it worked, as any archived contact does.
  const archived = contactRow({ ...waiting, archived: true }, { projectNote: true });
  assert.deepEqual([archived.note, archived.where], ['~/projects/api', false]);
});

const buttonsOf = (row) => row.buttons.map(({ id, label, disabled }) => [id, label, disabled]);

test('after a Merged or Closed tag come the ways on: Continue with the contact, Archive it, or Delete it', () => {
  for (const state of ['merged', 'closed']) {
    const row = contactRow({ ...claude, pullRequest: pullRequest({ state }) });
    assert.deepEqual(tagsOf(row), [state]);
    assert.deepEqual(buttonsOf(row), [
      ['continue', 'Continue', false],
      ['archive', 'Archive', false],
      ['delete', 'Delete', false],
    ]);
    assert.equal(row.buttons[0].tip, 'Continue on a new branch with the same conversation');
    assert.match(row.buttons[1].tip, /^Put this contact away\./);
    assert.match(row.buttons[2].tip, /^Delete this contact\. It asks first/);
  }
  // Continue waits while the contact is working, and is there to be seen meanwhile.
  const busy = contactRow({ ...claude, status: 'busy', pullRequest: pullRequest({ state: 'merged' }) });
  assert.deepEqual(
    buttonsOf(busy).map(([id, , disabled]) => [id, disabled]),
    [
      ['continue', true],
      ['archive', false],
      ['delete', false],
    ]
  );
});

test('a pull request still to be merged, none at all, or a folder that is gone: no way on to offer', () => {
  assert.deepEqual(contactRow({ ...claude, pullRequest: pullRequest() }).buttons, []);
  assert.deepEqual(contactRow({ ...claude, pullRequest: pullRequest({ state: 'draft' }) }).buttons, []);
  assert.deepEqual(contactRow({ ...claude, pullRequest: null }).buttons, []);
  assert.deepEqual(
    contactRow({ ...claude, status: 'offline', pullRequest: pullRequest({ state: 'merged' }) }).buttons,
    []
  );
  assert.deepEqual(
    contactRow({ ...claude, archived: true, pullRequest: pullRequest({ state: 'merged' }) }).buttons,
    []
  );
});

test('a contact without a pull request, or whose folder is gone, wears no tags', () => {
  assert.deepEqual(contactRow({ ...claude, pullRequest: null }).tags, []);
  assert.deepEqual(contactRow({ ...claude }).tags, [], 'a view from before there were tags');
  const gone = contactRow({ ...claude, status: 'offline', pullRequest: pullRequest({ state: 'merged' }) });
  assert.deepEqual([gone.tags, gone.tagsTitle, gone.note], [[], '', '~/projects/api']);
});

test('"Add a contact!" is for a list with nobody in it but archived contacts', () => {
  assert.equal(nobodyHere([]), true);
  assert.equal(nobodyHere([{ id: 'c1', archived: true }]), true);
  assert.equal(nobodyHere([{ id: 'c1', archived: true, favorite: true }]), true);
  assert.equal(nobodyHere([{ id: 'c1' }]), false);
  assert.equal(
    nobodyHere([{ id: 'c1', favorite: true }]),
    false,
    'every contact a favorite: Online is empty, not the list'
  );
  assert.equal(nobodyHere([{ id: 'c1', status: 'offline' }]), false, 'a contact whose folder is gone is still one');
  assert.equal(nobodyHere([{ id: 'c1', archived: true }, { id: 'c2' }]), false);
});

test('a new contact starts out like the one added last that still works somewhere', () => {
  const first = { ...claude, id: 'c1' };
  const second = { ...claude, id: 'c2' };
  assert.equal(lastAdded([]), null);
  assert.equal(lastAdded([first, second]), second);
  assert.equal(lastAdded([first, { ...second, status: 'busy' }]).id, 'c2', 'whatever it is doing');
  assert.equal(lastAdded([first, { ...second, archived: true }]), first, 'an archived one is put away');
  assert.equal(lastAdded([first, { ...second, status: 'offline' }]), first, 'its folder is gone');
  assert.equal(lastAdded([{ ...first, archived: true }]), null);
});

// ---- the + on a section that is no project's ------------------------------------------------------

/** The sections of `contacts` grouped by `groupBy`, by name, as the list draws them. */
const sectionsOf = (contacts, groupBy, groups = []) =>
  listSections(contacts, groups, { ...DEFAULT_LIST_VIEW, groupBy, sortBy: 'name' });
const sectionOf = (sections, id) => sections.find((s) => s.id === id);

test('a group’s + starts a contact out like the one added last in the group, and in it', () => {
  const groups = [{ id: 'g1', name: 'Work' }];
  const zed = { ...claude, id: 'c1', name: 'Zed', groupId: 'g1' };
  const amy = { ...claude, id: 'c2', name: 'Amy', groupId: 'g1' };
  const other = { ...claude, id: 'c3', name: 'Other' };
  const contacts = [zed, amy, other];
  const work = sectionOf(sectionsOf(contacts, 'group', groups), 'g1');
  assert.deepEqual(
    work.members.map((c) => c.name),
    ['Amy', 'Zed'],
    'listed by name'
  );
  assert.deepEqual(addedIn(work, contacts), { from: amy, groupId: 'g1' }, 'added last, wherever it is listed');
});

test('an empty group’s + starts a contact out like the one added last of all, in that group', () => {
  const groups = [{ id: 'g1', name: 'Work' }];
  const first = { ...claude, id: 'c1' };
  const second = { ...claude, id: 'c2' };
  const work = sectionOf(sectionsOf([first, second], 'group', groups), 'g1');
  assert.deepEqual(addedIn(work, [first, second]), { from: second, groupId: 'g1' });
  assert.deepEqual(addedIn(work, []), { from: null, groupId: 'g1' }, 'nobody to start out like');
});

test('the + on a status, a service or Favorites starts a contact out like the one added last there', () => {
  const working = { ...claude, id: 'c1', status: 'busy', provider: 'codex', providerName: 'Codex' };
  const ready = { ...claude, id: 'c2', provider: 'claude', providerName: 'Claude Code' };
  const favorite = { ...claude, id: 'c3', favorite: true };
  const contacts = [working, ready, favorite];
  const byStatus = sectionsOf(contacts, 'status');
  assert.deepEqual(addedIn(sectionOf(byStatus, 'status:busy'), contacts), { from: working });
  assert.deepEqual(addedIn(sectionOf(byStatus, 'online'), contacts), { from: ready });
  assert.deepEqual(addedIn(sectionOf(byStatus, 'favorites'), contacts), { from: favorite });
  const byService = sectionsOf(contacts, 'service');
  assert.deepEqual(addedIn(sectionOf(byService, 'service:codex'), contacts), { from: working });
  assert.deepEqual(addedIn(sectionOf(byService, 'service:claude'), contacts), { from: ready });
});

test('Online with nobody in it starts a contact out like the one added last, or like nobody', () => {
  const working = { ...claude, id: 'c1', status: 'busy' };
  const online = sectionOf(sectionsOf([working], 'status'), 'online');
  assert.equal(online.members.length, 0);
  assert.deepEqual(addedIn(online, [working]), { from: working });
  assert.deepEqual(addedIn(sectionOf(sectionsOf([], 'group'), 'online'), []), { from: null });
});

test('Offline and Archived have no +: their contacts are gone or put away', () => {
  const contacts = [
    { ...claude, id: 'c1', status: 'offline' },
    { ...claude, id: 'c2', archived: true },
  ];
  const sections = sectionsOf(contacts, 'group');
  assert.equal(addedIn(sectionOf(sections, 'offline'), contacts), null);
  assert.equal(addedIn(sectionOf(sections, 'archived'), contacts), null);
});

test('Waiting for you has no +, however the list is grouped: a new contact never needs you yet', () => {
  const contacts = [{ ...claude, id: 'c1', status: 'away', groupId: 'g1' }];
  for (const groupBy of ['group', 'project', 'status', 'service']) {
    const waiting = sectionOf(sectionsOf(contacts, groupBy, [{ id: 'g1', name: 'Work' }]), 'waiting');
    assert.equal(addedIn(waiting, contacts), null, groupBy);
  }
});

// ---- typing another name for a contact ------------------------------------------------------------

test('a name typed over an agent’s own is what it is called from then on', () => {
  assert.equal(typedName('Reviewer', 'Codex'), 'Reviewer');
  assert.equal(typedName('  Reviewer  ', 'Codex'), 'Reviewer', 'without the spaces around it');
  assert.equal(typedName('codex', 'Codex'), 'codex', 'another letter case is another way to write it');
});

test('a name left blank or as it was changes nothing', () => {
  assert.equal(typedName('', 'Codex'), null);
  assert.equal(typedName('   ', 'Codex'), null, 'only spaces is blank');
  assert.equal(typedName('Codex', 'Codex'), null);
  assert.equal(typedName(' Codex ', 'Codex'), null, 'spaces around it are no new name');
});

// ---- marking what was searched for ----------------------------------------------------------------

/** The parts as one string, with the marked ones in [brackets]. */
const marked = (text, query) =>
  markParts(text, query)
    .map((part) => (part.match ? `[${part.text}]` : part.text))
    .join('');

test('what was searched for is marked wherever it is in the line', () => {
  assert.deepEqual(markParts('run the deploy script', 'deploy'), [
    { text: 'run the ', match: false },
    { text: 'deploy', match: true },
    { text: ' script', match: false },
  ]);
  assert.equal(marked('deploy it, then deploy again', 'deploy'), '[deploy] it, then [deploy] again');
});

test('a match at the very start or the very end leaves no empty piece', () => {
  assert.deepEqual(markParts('deploy now', 'deploy'), [
    { text: 'deploy', match: true },
    { text: ' now', match: false },
  ]);
  assert.deepEqual(markParts('time to deploy', 'deploy'), [
    { text: 'time to ', match: false },
    { text: 'deploy', match: true },
  ]);
  assert.deepEqual(markParts('deploy', 'deploy'), [{ text: 'deploy', match: true }]);
  assert.equal(marked('aaaa', 'aa'), '[aa][aa]', 'matches next to each other');
  assert.equal(marked('aaa', 'aa'), '[aa]a', 'and never two that overlap');
});

test('the line keeps its own letter case', () => {
  assert.equal(
    marked('Deploy to PROD, then deploy to staging', 'DEPLOY'),
    '[Deploy] to PROD, then [deploy] to staging'
  );
  assert.equal(marked('ran `NPM Test`', 'npm test'), 'ran `[NPM] [Test]`');
  assert.equal(marked('ran `NPM Test`', '"npm test"'), 'ran `[NPM Test]`');
});

test('a query is text, not a pattern', () => {
  assert.equal(marked('const a = b.c(d) || e*f;', '".c(d) ||"'), 'const a = b[.c(d) ||] e*f;');
  assert.equal(marked('const a = b.c(d) || e*f;', '.c(d) ||'), 'const a = b[.c(d)] [||] e*f;');
  assert.equal(marked('what is a.b?', 'a.b?'), 'what is [a.b?]');
  assert.equal(marked('axb', 'a.b'), 'axb', 'a dot is a dot');
  assert.equal(marked('[x] done \\ $1 ^', '[x]'), '[[x]] done \\ $1 ^');
  assert.equal(marked('price: $5 (was $6)', '"$5 ("'), 'price: [$5 (]was $6)');
  assert.equal(marked('a\\b', '\\'), 'a[\\]b');
});

test('each word searched for is marked wherever it is, as the search found them apart', () => {
  assert.equal(
    marked('Add the stripe webhook, then check idempotency of Stripe calls', 'stripe idempotency'),
    'Add the [stripe] webhook, then check [idempotency] of [Stripe] calls'
  );
  assert.equal(marked('the login page', 'log login'), 'the [login] page', 'words that overlap are one mark');
  assert.equal(marked('only one word here', 'word missing'), 'only one [word] here', 'what is there is marked');
});

test('a line without the text is one unmarked piece', () => {
  assert.deepEqual(markParts('nothing here', 'deploy'), [{ text: 'nothing here', match: false }]);
  assert.deepEqual(markParts('nothing here', ''), [{ text: 'nothing here', match: false }]);
  assert.deepEqual(markParts('nothing here', '   '), [{ text: 'nothing here', match: false }]);
  assert.deepEqual(markParts('', 'deploy'), []);
});

test('the query is matched the way it was searched for: by its words, a quoted phrase with its spaces collapsed', () => {
  assert.equal(marked('run npm test now', '  npm test '), 'run [npm] [test] now');
  assert.equal(marked('run npm test now', '"npm   test"'), 'run [npm test] now');
  assert.equal(marked('run npm test now', '"npm\ntest"'), 'run [npm test] now');
  assert.equal(marked('run npm test now', '“npm test”'), 'run [npm test] now', 'in curly quotes too');
});

test('a line whose letters change length in lower case is left unmarked rather than marked wrong', () => {
  // "İ" is one character, and two in lower case.
  const line = 'İstanbul deploy';
  assert.notEqual(line.toLowerCase().length, line.length);
  assert.deepEqual(markParts(line, 'deploy'), [{ text: line, match: false }]);
});

test('the pieces always add up to the line', () => {
  for (const [text, query] of [
    ['deploy it, then deploy again', 'deploy'],
    ['…cut at both ends…', 'both'],
    ['aaaa', 'a'],
    ['no match', 'zz'],
    ['', 'zz'],
  ]) {
    assert.equal(
      markParts(text, query)
        .map((part) => part.text)
        .join(''),
      text
    );
  }
});

// ---- keeping the match in sight -------------------------------------------------------------------

test('a snippet whose match is near the start is shown as it is', () => {
  assert.equal(nearMatch('deploy the app', 'deploy'), 'deploy the app');
  assert.equal(nearMatch('…we can deploy the app', 'deploy'), '…we can deploy the app');
  const edge = `${'x'.repeat(SNIPPET_LEAD)}deploy`;
  assert.equal(nearMatch(edge, 'deploy'), edge, 'exactly as far in as is allowed');
});

test('what comes before a match further in is cut down to a few words', () => {
  assert.equal(
    nearMatch('first we should really run the deploy script before lunch', 'deploy'),
    '…run the deploy script before lunch'
  );
  assert.equal(nearMatch('…and after that we should run the Deploy script', 'deploy'), '…run the Deploy script');
  // Only the first match counts: the others follow it anyway.
  assert.equal(
    nearMatch('it is a long way to the first deploy, and deploy again', 'deploy'),
    '…the first deploy, and deploy again'
  );
});

test('with no word starting close enough, the cut is in the middle of one', () => {
  const snippet = `${'x'.repeat(40)}deploy`;
  assert.equal(nearMatch(snippet, 'deploy'), `…${'x'.repeat(SNIPPET_LEAD)}deploy`);
  // A space right in front of the match: the snippet starts at the match.
  assert.equal(nearMatch(`${'x'.repeat(40)} deploy`, 'deploy'), '…deploy');
});

test('the cut never leaves more in front of the match than is allowed', () => {
  const words = 'a bb ccc dddd eeeee ffffff ggggggg hhhhhhhh iiiiiiiii jjjjjjjjjj';
  for (const query of ['bb', 'ccc', 'eeeee', 'ggggggg', 'iiiiiiiii', 'jjjjjjjjjj', 'j']) {
    const cut = nearMatch(words, query);
    const at = cut.indexOf(query);
    assert.notEqual(at, -1, query);
    assert.equal(at <= SNIPPET_LEAD + 1, true, `${query}: ${cut}`);
    assert.equal(words.endsWith(cut.replace(/^…/, '')), true, 'and nothing after it is lost');
  }
});

test('a snippet without the text is left alone', () => {
  const snippet = 'a line that is quite a bit longer than what may come before a match';
  assert.equal(nearMatch(snippet, 'deploy'), snippet);
  assert.equal(nearMatch(snippet, ''), snippet);
  assert.equal(nearMatch('', 'deploy'), '');
});

// ---- a hit's row ----------------------------------------------------------------------------------

const hit = {
  contactId: 'c1',
  name: 'Claude',
  archived: false,
  conversations: 3,
  latest: 1760000000000,
  snippet: 'run the deploy script',
};

test('a hit’s row names the contact and marks the text in the line it was found in', () => {
  assert.deepEqual(hitRow(hit, 'deploy'), {
    id: 'hit:c1',
    name: 'Claude',
    tag: '',
    parts: [
      { text: 'run the ', match: false },
      { text: 'deploy', match: true },
      { text: ' script', match: false },
    ],
    title: 'Found in 3 conversations with Claude',
  });
});

test('the tooltip counts the conversations, one or several', () => {
  assert.equal(hitRow({ ...hit, conversations: 1 }, 'deploy').title, 'Found in 1 conversation with Claude');
  assert.equal(hitRow({ ...hit, conversations: 2 }, 'deploy').title, 'Found in 2 conversations with Claude');
  assert.equal(hitRow({ ...hit, conversations: 50 }, 'deploy').title, 'Found in 50 conversations with Claude');
});

test('an archived contact’s hit says so, next to a name that is free to be cut short', () => {
  const row = hitRow({ ...hit, archived: true }, 'deploy');
  assert.equal(row.name, 'Claude');
  assert.equal(row.tag, '(archived)');
  assert.equal(row.title, 'Found in 3 conversations with Claude (archived)');
});

test('a hit’s line starts near its match, so the match is in sight in a narrow list', () => {
  const far = { ...hit, snippet: 'first we should really run the deploy script before lunch' };
  assert.deepEqual(hitRow(far, 'Deploy').parts, [
    { text: '…run the ', match: false },
    { text: 'deploy', match: true },
    { text: ' script before lunch', match: false },
  ]);
});

test('a hit whose line does not show the text is still a row', () => {
  // The match ran over a line break, or is in a letter that changes length in lower case.
  assert.deepEqual(hitRow({ ...hit, snippet: 'something else' }, 'deploy').parts, [
    { text: 'something else', match: false },
  ]);
  assert.deepEqual(hitRow({ ...hit, snippet: '' }, 'deploy').parts, []);
});

test('a hit’s row is told from its contact’s own row', () => {
  assert.equal(hitRowId('c1'), 'hit:c1');
  assert.notEqual(hitRowId('c1'), 'c1');
  assert.equal(hitRow(hit, 'deploy').id, hitRowId(hit.contactId));
});

// ---- hits of a list that has changed since -----------------------------------------------------------

test('hits are listed for the contacts as they are now', () => {
  const hits = [
    hit,
    { ...hit, contactId: 'c2', name: 'Codex', archived: true },
    { ...hit, contactId: 'c3', name: 'Opus' },
  ];
  const contacts = [
    { id: 'c1', name: 'Claude (api)' },
    { id: 'c2', name: 'Codex' },
    { id: 'c4', name: 'Gemini' },
  ];
  assert.deepEqual(liveHits(hits, contacts), [
    { ...hit, name: 'Claude (api)', archived: false },
    { ...hit, contactId: 'c2', name: 'Codex', archived: false },
  ]);
});

test('a contact archived since the search is marked as such, and a deleted one is gone', () => {
  assert.deepEqual(liveHits([hit], [{ id: 'c1', name: 'Claude', archived: true }]), [{ ...hit, archived: true }]);
  assert.deepEqual(liveHits([hit], []), []);
  assert.deepEqual(liveHits([], [{ id: 'c1', name: 'Claude' }]), [], 'no hits, no rows');
});

test('the order the main process gave the hits in is kept', () => {
  const hits = ['c3', 'c1', 'c2'].map((contactId) => ({ ...hit, contactId }));
  const contacts = ['c1', 'c2', 'c3'].map((id) => ({ id, name: id }));
  assert.deepEqual(
    liveHits(hits, contacts).map((h) => h.contactId),
    ['c3', 'c1', 'c2']
  );
});
