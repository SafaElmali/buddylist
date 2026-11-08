// A project manager (see main/managers.js): a manager over a project's managers, which hands a worker's job from one
// team to another as the user asks, hears from the managers alone, and changes nothing itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Conversations } from '../src/main/conversations.js';
import { appTools } from '../src/main/app-tools.js';
import { Managers } from '../src/main/managers.js';
import { Projects } from '../src/main/project-settings.js';
import { History } from '../src/main/storage/history.js';
import { Store } from '../src/main/storage/store.js';
import { descriptor as claude } from '../src/providers/claude/index.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';
import {
  MANAGERS_MAX,
  REPORT_UP_MAX,
  TEAMS_LISTED,
  answeredLead,
  cleanManagers,
  draggable,
  dropUnder,
  ledBy,
  managerInstructions,
  managerNoteOf,
  managersAtWork,
  managersFor,
  projectManagerInstructions,
  scopedManager,
  teamChoices,
  underFor,
} from '../src/shared/managers.js';

const services = [claude, codex];
const descriptor = (id) => services.find((one) => one.id === id) || claude;
const file = (filePath, added = 1, removed = 0) => ({ path: filePath, status: 'modified', added, removed });
const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

/**
 * The shop project as the app has it, with stand-ins for the agents' sessions and for git: its first manager, the
 * coder manager, turned on; a review manager; and its project manager over both.
 */
function shop(t, { withLead = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-lead-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'shop');
  const home = path.join(dir, 'worktrees');
  fs.mkdirSync(root);
  fs.mkdirSync(path.join(home, 'shop'), { recursive: true });
  const key = `git:${root}/.git`;
  const store = new Store(path.join(dir, 'data'), { defaultProvider: 'claude' });
  const history = new History(path.join(dir, 'history'), { retainAll: (id) => Boolean(store.getContact(id)?.manages) });
  const inShop = (cwd) => cwd.startsWith(root) || cwd.startsWith(path.join(home, 'shop'));
  const projects = new Projects({
    store,
    worktreesHome: home,
    describe: async (cwd) => (inShop(cwd) ? { key, name: 'shop', root } : { key: `dir:${cwd}`, name: 'x', root: cwd }),
  });
  const changed = new Map();
  const changes = {
    list: async (cwd) => ({
      repository: true,
      branch: path.basename(cwd),
      mainLine: 'origin/main',
      files: [],
      more: 0,
      ...changed.get(cwd),
    }),
    diff: async (_cwd, { path: name }) => ({ text: `diff --git a/${name} b/${name}\n+changed\n`, binary: false }),
  };
  const sessions = [];
  const pullRequests = new Map();
  const conversations = new Conversations({
    store,
    history,
    providers: {
      descriptor,
      list: () => services,
      upgradeHistory: (_id, entries) => entries,
      createSession: (contact, emit, opts) => {
        const session = { contact, emit, opts, sent: [], waiting: 0, closed: false };
        Object.assign(session, {
          send: (message) => session.sent.push(message),
          setModel: async () => {},
          interrupt: async () => {},
          usage: async () => ({ limits: [] }),
          close: () => (session.closed = true),
        });
        sessions.push(session);
        return session;
      },
    },
    chats: { send: () => {}, isFocused: () => false },
    notifier: { notify: () => {}, dismiss: () => {} },
    onContactsChanged: () => {},
    pullRequests: { of: (contact) => pullRequests.get(contact.id) ?? null, lookSoon: () => {} },
    managing: {
      forAgent: (contact, guest) => managers.forAgent(contact, guest),
      roundOver: (id, round) => managers.roundOver(id, round),
      modelChanged: (id) => managers.modelChanged(id),
      oversees: (contact) => managers.oversees(contact),
      managerOf: (contact) => managers.managerOf(contact),
      leadOf: (contact) => managers.leadOf(contact),
      roundCut: (id, round) => managers.roundCut(id, round),
    },
  });
  const managers = new Managers({
    store,
    history,
    projects,
    conversations,
    descriptor,
    worktreesHomes: [home],
    onContactsChanged: () => {},
    onProjectChanged: () => {},
    changes,
  });
  // The coder manager: the project's first, turned on in Settings.
  const before = projects.settings(key).manager;
  const after = projects.update(key, { manager: { ...before, on: true } }).manager;
  managers.settingsChanged(key, before, after);
  const coder = /** @type {any} */ (store.contacts.find((one) => one.manages === key));
  const reviewer = managers.add(key, { name: 'review manager', provider: 'codex' });
  const lead = withLead ? managers.add(key, { lead: true }) : null;
  /** A conversation in a worktree of the shop's, under `under`. */
  const worker = (name, { under = coder.id, files = [] } = {}) => {
    const cwd = path.join(home, 'shop', name.replace(/\W+/g, '-'));
    fs.mkdirSync(cwd, { recursive: true });
    changed.set(cwd, { files });
    return store.addContact({ provider: 'claude', name, cwd, model: '', permissionMode: 'default', managedBy: under });
  };
  /** The session of a contact's own agent, the newest. */
  const sessionOf = (id) => sessions.findLast((one) => one.contact.id === id);
  /** What a contact's agent was sent, all of it. */
  const sentTo = (id) =>
    sessions
      .filter((one) => one.contact.id === id)
      .flatMap((one) => one.sent.map((message) => message.text))
      .join('\n\n');
  /** A round of a contact's agent: it says `text`, and is done, stopped or gone wrong. */
  const round = async (id, text, { stopped = false, isError = false, errorText = '' } = {}) => {
    const session = sessionOf(id);
    session.emit({ type: 'state', state: 'working' });
    if (text) session.emit({ type: 'text-end', key: `k${Math.random()}`, text });
    session.emit({ type: 'result', isError, stopped, errorText, durationMs: 1, costUsd: 0 });
    session.emit({ type: 'state', state: 'idle' });
    await settle();
  };
  /** The lines a contact's window shows, as its history keeps them. */
  const lines = (id) =>
    history
      .read(id)
      .filter((entry) => entry.kind === 'notice')
      .map((entry) => entry.text);
  /** A project manager's message as the tool sends it, approved by the user or not. */
  const tell = (to, text, { job, urgent, approved = true } = {}) =>
    managers.tellManager(/** @type {any} */ (lead).id, to, text, { job, urgent, approve: async () => approved });
  return {
    dir,
    key,
    root,
    home,
    store,
    history,
    projects,
    changed,
    pullRequests,
    conversations,
    managers,
    sessions,
    coder,
    reviewer,
    lead: /** @type {any} */ (lead),
    worker,
    sessionOf,
    sentTo,
    round,
    lines,
    tell,
  };
}

// ---- the chain of command -------------------------------------------------------------------------------------

test('a job goes down to the review manager, its verdict back up, and on to the coder manager and its worker', async (t) => {
  const app = shop(t);
  const { managers, coder, reviewer, lead } = app;
  const tags = app.worker('Claude (tags)', { files: [file('src/tags.js', 12, 3), file('test/tags.test.js', 30)] });
  app.pullRequests.set(tags.id, {
    number: 412,
    url: 'https://github.com/acme/shop/pull/412',
    title: 'Tags',
    state: 'open',
  });
  await app.round(lead.id, 'Ready.');
  await app.round(reviewer.id, 'Ready.');
  await app.round(coder.id, 'Ready.');

  // Down: the project manager hands the coder's job to the review manager, with all it needs.
  const told = await app.tell('review manager', 'Review it against COM-630’s acceptance criteria.', {
    job: 'Claude (tags)',
  });
  assert.match(told, /^review manager has your message\. The user approved it\./);
  const handed = app.sentTo(reviewer.id);
  assert.match(handed, /shop project manager, the project manager over this project’s managers, has a message for you/);
  assert.match(handed, /The user approved this message: the work it asks for is work the user asked for\./);
  assert.match(handed, /Review it against COM-630’s acceptance criteria\./);
  assert.match(handed, /The job: Claude \(tags\), under shop manager/);
  assert.match(handed, /Pull request: #412 \(Open\): https:\/\/github\.com\/acme\/shop\/pull\/412/);
  assert.match(handed, /Branch: Claude-tags-/);
  assert.match(handed, new RegExp(`Folder: ${tags.cwd.replace(/[()]/g, '\\$&')}`));
  assert.match(handed, /M src\/tags\.js \(\+12 −3\)/);
  assert.deepEqual(managerNoteOf(app.sessionOf(reviewer.id).sent.at(-1).text), {
    kind: 'lead',
    name: 'shop project manager',
  });
  assert.ok(
    app
      .lines(reviewer.id)
      .includes('shop project manager hands over Claude (tags)’s job: Review it against COM-630’s acceptance criteria.')
  );
  // Approved: what it starts for the job starts at once.
  assert.equal(managers.startsAtOnce(reviewer.id), true);

  // Up: the round that read it answers the project manager, as a worker answers its manager.
  await app.round(reviewer.id, 'Started Codex (review-630) to review it.');
  assert.ok(app.lines(lead.id).includes('review manager answered: Started Codex (review-630) to review it.'));
  assert.match(
    app.sentTo(lead.id),
    new RegExp(answeredLead('review manager', 'Started Codex (review-630) to review it.').replace(/[[\]().]/g, '\\$&'))
  );

  // Later, the verdict, which the review manager sends up itself.
  assert.equal(
    managers.report(reviewer.id, 'Claude (tags): changes needed. Empty tags crash the list; add a test.'),
    'shop project manager has your report. Carry on meanwhile, without waiting for its answer.'
  );
  assert.ok(
    app
      .lines(lead.id)
      .includes('review manager reports: Claude (tags): changes needed. Empty tags crash the list; add a test.')
  );
  assert.match(
    app.sentTo(lead.id),
    /\[review manager reports to you\. This is a note from buddylist, not from the user\./
  );

  // Back down: to the coder manager, which knows its own worker by name.
  await app.round(lead.id, 'Passing it on.');
  await app.tell('shop manager', 'The review asks for a fix: empty tags crash the list. Add a test.', {
    job: 'Claude (tags)',
  });
  const verdict = app.sentTo(coder.id);
  assert.match(verdict, /It is about your worker Claude \(tags\)\./);
  assert.doesNotMatch(verdict, /The job: Claude \(tags\)/, 'its own worker’s job is not told again');
  assert.ok(
    app
      .lines(coder.id)
      .includes(
        'shop project manager says, about Claude (tags): The review asks for a fix: empty tags crash the list. Add a test.'
      )
  );

  // And on to the worker, as a manager messages one, which answers its manager.
  await app.round(coder.id, 'Telling it.');
  await managers.say(coder.id, 'Claude (tags)', 'Empty tags crash the list: fix it, with a test.');
  assert.match(app.sentTo(tags.id), /shop manager, who oversees this project, has a message for you/);
  await app.round(tags.id, 'Fixed, with a test.');
  assert.ok(app.lines(coder.id).some((line) => line.startsWith('Claude (tags) answered: Fixed, with a test.')));
});

test('a project manager hears from its managers alone, never of their workers’ changes', async (t) => {
  const app = shop(t);
  const { coder, lead } = app;
  const tags = app.worker('Claude (tags)', { files: [file('src/tags.js')] });
  await app.round(lead.id, 'Ready.');
  await app.round(coder.id, 'Ready.');
  const before = app.sentTo(lead.id);
  app.conversations.send(tags.id, { text: 'Add tags.' });
  app.sessionOf(tags.id).emit({ type: 'state', state: 'working' });
  app.sessionOf(tags.id).emit({ type: 'tool', toolId: 't1', activity: { kind: 'edit', path: 'src/tags.js' } });
  await app.round(tags.id, 'Tags are in.');
  assert.ok(
    app.lines(coder.id).some((line) => line.startsWith('Claude (tags) changed 1 file')),
    'its manager hears'
  );
  assert.equal(app.sentTo(lead.id), before, 'the project manager is sent nothing');
  assert.ok(!app.lines(lead.id).some((line) => line.includes('Claude (tags)')));
  // Nor of its managers’ own rounds, where they answer no message of its.
  await app.round(coder.id, 'Looked at Claude (tags): all good.');
  assert.equal(app.sentTo(lead.id), before);
});

test('a manager whose session starts for the message answers it, and isn’t taken for stopped', async (t) => {
  const app = shop(t);
  const { reviewer, lead } = app;
  app.worker('Claude (tags)');
  await app.round(lead.id, 'Ready.');
  // No session yet: one starts for the message, and is idle as it connects, before the turn that reads it.
  await app.tell('review manager', 'Review it.', { job: 'Claude (tags)' });
  app.sessionOf(reviewer.id).emit({ type: 'state', state: 'connecting' });
  app.sessionOf(reviewer.id).emit({ type: 'state', state: 'idle' });
  await settle();
  assert.ok(
    !app.lines(lead.id).some((line) => /turn was stopped|failed before/.test(line)),
    app.lines(lead.id).join('\n')
  );
  await app.round(reviewer.id, 'Started a reviewer.');
  assert.ok(app.lines(lead.id).includes('review manager answered: Started a reviewer.'));
});

test('a worker whose session starts for its manager’s message answers its manager', async (t) => {
  const app = shop(t);
  const tags = app.worker('Claude (tags)');
  await app.round(app.coder.id, 'Ready.');
  await app.managers.say(app.coder.id, 'Claude (tags)', 'Add a test.');
  app.sessionOf(tags.id).emit({ type: 'state', state: 'connecting' });
  app.sessionOf(tags.id).emit({ type: 'state', state: 'idle' });
  await settle();
  await app.round(tags.id, 'Test added.');
  assert.ok(app.lines(app.coder.id).some((line) => line.startsWith('Claude (tags) answered: Test added.')));
});

// ---- approval -------------------------------------------------------------------------------------------------

test('a message the user did not approve is the manager’s own idea: what it starts for it waits for the user', async (t) => {
  const app = shop(t);
  const { managers, reviewer, lead } = app;
  app.worker('Claude (tags)');
  await app.round(lead.id, 'Ready.');
  await app.round(reviewer.id, 'Ready.');
  const told = await app.tell('review manager', 'Review it.', { job: 'Claude (tags)', approved: false });
  assert.match(told, /It went without the user’s approval, so it is that manager’s own idea\./);
  const handed = app.sentTo(reviewer.id);
  assert.match(handed, /The user did not approve this message itself: take what it asks for as your own idea\./);
  assert.match(handed, /A conversation you start for it waits for the user to send its first message\./);
  assert.doesNotMatch(handed, /work the user asked for/);
  assert.equal(managers.startsAtOnce(reviewer.id), false, 'held while it acts on it');
  await app.round(reviewer.id, 'Started a review, waiting for you.');
  assert.equal(managers.startsAtOnce(reviewer.id), false, 'and after that round, until the user writes to it');
  // An approved message later doesn't undo it: the user hasn't asked this manager for anything.
  await app.tell('review manager', 'Also check the docs.');
  assert.equal(managers.startsAtOnce(reviewer.id), false);
  app.conversations.send(reviewer.id, { text: 'Go ahead.' });
  assert.equal(managers.startsAtOnce(reviewer.id), true, 'once the user wrote to it, what they ask is theirs');
  // Another manager was sent nothing unapproved.
  assert.equal(managers.startsAtOnce(app.coder.id), true);
});

test('a project manager’s message goes only to a manager at work, within the limit, and says how it waits', async (t) => {
  const app = shop(t);
  const { managers, reviewer, lead, key, projects } = app;
  app.worker('Claude (tags)');
  await app.round(lead.id, 'Ready.');
  await assert.rejects(
    app.tell('nobody', 'Hi.'),
    /No manager of shop is called “nobody”\. The managers at work are: shop manager, review manager\./
  );
  await assert.rejects(
    app.tell('review manager', 'Hi.', { job: 'Claude (nope)' }),
    /No conversation working on shop is called “Claude \(nope\)”\. These are: Claude \(tags\)\./
  );
  await assert.rejects(app.tell('review manager', '  '), /Say what the message is/);
  // A message to a worker goes through its manager: a project manager has no worker of its own.
  await assert.rejects(app.tell('Claude (tags)', 'Hi.'), /No manager of shop is called “Claude \(tags\)”/);

  // Stopped by the user: it waits, also an urgent one, which Send now would not respect.
  await app.round(reviewer.id, 'Ready.');
  app.conversations.send(reviewer.id, { text: 'Hold on.' });
  await app.conversations.interrupt(reviewer.id);
  await app.round(reviewer.id, '', { stopped: true });
  const sent = app.sessionOf(reviewer.id).sent.length;
  assert.match(
    await app.tell('review manager', 'Stop the review.', { urgent: true }),
    /^review manager has your message\. The user stopped it, so it waits until the user writes to it\./
  );
  assert.equal(app.sessionOf(reviewer.id).sent.length, sent, 'nothing reaches it until the user writes');

  // As many as the user allows for each of their messages to it.
  app.store.settings.turnLimit = 2;
  app.conversations.send(reviewer.id, { text: 'Carry on.' });
  await app.round(reviewer.id, 'On it.');
  await app.tell('review manager', 'One.');
  await app.tell('review manager', 'Two.');
  await assert.rejects(
    app.tell('review manager', 'Three.'),
    /was sent 2 messages of yours since the user last wrote to it/
  );

  // Turned off, it takes nothing: the project manager is told which are at work.
  const theirs = managers.settingsOf(key, reviewer.id);
  managers.set(key, { ...theirs, on: false });
  managers.settingsChanged(key, theirs, { ...theirs, on: false });
  await assert.rejects(
    app.tell('review manager', 'Hi.'),
    /review manager is turned off, so it can’t take it\. The managers at work are: shop manager\./
  );
  assert.ok(projects.settings(key));
});

test('a manager’s reports go to its project manager alone, within the limit, and briefly', async (t) => {
  const app = shop(t);
  const { managers, reviewer, lead } = app;
  app.store.settings.turnLimit = 2;
  managers.report(reviewer.id, 'One.');
  managers.report(reviewer.id, 'Two.');
  assert.throws(
    () => managers.report(reviewer.id, 'Three.'),
    /You sent shop project manager 2 reports since the user last wrote to it/
  );
  app.conversations.send(lead.id, { text: 'What’s new?' });
  assert.doesNotThrow(() => managers.report(reviewer.id, 'Three.'), 'the user writing to it starts the count again');
  assert.throws(
    () => managers.report(reviewer.id, 'x'.repeat(REPORT_UP_MAX + 1)),
    /A report is at most 2000 characters/
  );
  assert.throws(() => managers.report(lead.id, 'Done.'), /A project manager reports to the user/);
});

test('a manager with no project manager has nobody to report to, and isn’t told of one', (t) => {
  const app = shop(t, { withLead: false });
  assert.throws(
    () => app.managers.report(app.reviewer.id, 'Done.'),
    /No project manager oversees the managers of shop/
  );
  assert.doesNotMatch(app.managers.forAgent(app.reviewer)?.instructions ?? '', /project manager/);
});

// ---- when a manager can't answer --------------------------------------------------------------------------------

test('a project manager hears when the round that read its message was stopped or went wrong', async (t) => {
  const app = shop(t);
  const { reviewer, lead } = app;
  app.worker('Claude (tags)');
  await app.round(lead.id, 'Ready.');
  await app.round(reviewer.id, 'Ready.');
  await app.tell('review manager', 'Review it.', { job: 'Claude (tags)' });
  await app.round(reviewer.id, '', { stopped: true });
  assert.ok(app.lines(lead.id).includes('review manager’s turn was stopped before it answered.'));
  assert.deepEqual(managerNoteOf(app.sessionOf(lead.id).sent.at(-1).text), { kind: 'cut', name: 'review manager' });
  assert.match(
    app.sentTo(lead.id),
    /\[review manager’s turn was stopped before it answered your message\. .*\] It waits until the user writes to it/
  );

  app.conversations.send(reviewer.id, { text: 'Go on.' });
  await app.round(reviewer.id, 'Going on.');
  await app.tell('review manager', 'Review it again.', { job: 'Claude (tags)' });
  await app.round(reviewer.id, '', { isError: true, errorText: 'The service is overloaded.' });
  assert.ok(app.lines(lead.id).includes('review manager’s turn failed before it answered.'));
  assert.match(
    app.sentTo(lead.id),
    /review manager’s turn failed: The service is overloaded\. before it answered your message/
  );
});

test('a project manager hears when a manager it handed a job to is turned off, put away or deleted', async (t) => {
  const app = shop(t);
  const { managers, key, reviewer, lead, store, projects } = app;
  app.worker('Claude (tags)');
  await app.round(lead.id, 'Ready.');
  await app.tell('review manager', 'Review it.', { job: 'Claude (tags)' });
  await app.round(reviewer.id, 'Started a review.');
  // Answering the message settles nothing of the job: its report is still owed.
  const theirs = managers.settingsOf(key, reviewer.id);
  managers.set(key, { ...theirs, on: false });
  managers.settingsChanged(key, theirs, { ...theirs, on: false });
  assert.ok(app.lines(lead.id).includes('review manager was turned off before it reported back.'));
  assert.match(
    app.sentTo(lead.id),
    /\[review manager was turned off before it reported on Claude \(tags\)’s job\. .*\] Nobody is on it now/
  );

  // A message that handed no job is settled by the answer; one that did, by the report.
  const docs = managers.add(key, { name: 'docs manager' });
  await app.round(docs.id, 'Ready.');
  await app.tell('docs manager', 'How are the docs?');
  await app.round(docs.id, 'Fine.');
  await app.tell('docs manager', 'Write the tags docs.', { job: 'Claude (tags)' });
  managers.report(docs.id, 'Tags docs are written.');
  const told = app.lines(lead.id).length;
  store.updateContact(docs.id, { archived: true });
  managers.putAway(store.getContact(docs.id));
  assert.equal(app.lines(lead.id).length, told, 'nothing was owed');

  const qa = managers.add(key, { name: 'qa manager' });
  await app.round(qa.id, 'Ready.');
  await app.tell('qa manager', 'Test it.', { job: 'Claude (tags)' });
  managers.forgotten(/** @type {any} */ (store.getContact(qa.id)));
  store.removeContact(qa.id);
  assert.ok(app.lines(lead.id).includes('qa manager was deleted before it reported back.'));
  assert.ok(
    projects.settings(key).managers.some((one) => one.id === lead.id),
    'the project manager stays'
  );
});

// ---- looking at the teams -------------------------------------------------------------------------------------

test('a project manager’s look at the project lists its managers and the 20 workers most recently at work, briefly', async (t) => {
  const app = shop(t);
  const { managers, reviewer, lead, history } = app;
  const many = Array.from({ length: TEAMS_LISTED + 5 }, (_, i) =>
    app.worker(`Claude (w${String(i).padStart(2, '0')})`, {
      under: i % 2 ? reviewer.id : app.coder.id,
      files: [file(`src/w${i}.js`)],
    })
  );
  // Each said something long, the newest last.
  for (const [i, one] of many.entries()) {
    history.append(one.id, { kind: 'user', text: `Task ${i}` });
    history.append(one.id, { kind: 'assistant', text: `Reply ${i} ${'x'.repeat(500)}` });
    // When it was last at work is when its conversation last changed, to the millisecond.
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const seen = await managers.teams(lead.id);
  assert.match(seen, /^shop: 2 managers, 25 conversations\./);
  assert.match(seen, /Managers:\n- shop manager \(idle, Claude, 13 conversations\)/);
  assert.match(seen, /- review manager \(idle, Codex, 12 conversations\)/);
  const workers = seen.split('\n').filter((line) => line.startsWith('- Claude (w'));
  assert.equal(workers.length, TEAMS_LISTED);
  assert.ok(
    workers[0].startsWith('- Claude (w24) · under shop manager · idle · Claude-w24- · 1 file changed · “Reply 24'),
    workers[0]
  );
  assert.ok(
    workers.every((line) => line.length < 260),
    'a line each, clipped'
  );
  assert.match(seen, /and 5 more: ask with manager or conversation for them\./);
  assert.doesNotMatch(seen, /Task \d+/, 'no tasks in the overview');
  assert.doesNotMatch(seen, /diff --git/);
  assert.ok(seen.length < 6000, `${seen.length} characters`);

  // A team, with each worker's task and changes; a job, as a manager is handed it. No diff either way.
  const team = await managers.teams(lead.id, { manager: 'review manager' });
  assert.match(team, /^review manager \(idle, Codex, 12 conversations\)/);
  assert.match(team, /Claude \(w01\) \(Claude, idle\)\nPull request: none yet\nBranch: Claude-w01-/);
  assert.match(team, /Its task: Task 1/);
  assert.doesNotMatch(team, /diff --git/);
  const job = await managers.teams(lead.id, { conversation: 'Claude (w03)' });
  assert.match(
    job,
    /^Claude \(w03\) \(Claude, idle\)\nThe job: Claude \(w03\), under review manager\nPull request: none yet/
  );
  assert.match(job, /M src\/w3\.js \(\+1 −0\)/);
  assert.doesNotMatch(job, /diff --git/);
  await assert.rejects(
    managers.teams(lead.id, { manager: 'nope' }),
    /No manager of shop is called “nope”\. These are: shop manager, review manager\./
  );
  await assert.rejects(managers.teams(app.coder.id), /Only a project manager has this/);
});

// ---- what it is, and what it is not --------------------------------------------------------------------------

test('a project manager works read-only, and its guests too, as a manager does', async (t) => {
  const app = shop(t);
  const { lead } = app;
  await app.round(lead.id, 'Ready.');
  const session = app.sessionOf(lead.id);
  assert.equal(session.contact.readOnly, true, 'its session changes no files');
  assert.match(session.opts.instructions, /\[You are shop project manager, the project manager of shop\]/);
  assert.match(session.opts.instructions, /Do not change any files/);
  assert.match(session.opts.instructions, /You start no conversation and message no worker: the managers do\./);
  const participants = app.conversations.participants(lead.id);
  assert.equal(participants[0].readOnly, true);
  // A guest joins read-only, as in any manager's conversation.
  app.conversations.inviteNew(lead.id, { provider: 'codex' });
  const guest = app.conversations.participants(lead.id)[1];
  assert.equal(guest.permissionMode, 'read-only');
  assert.equal(guest.readOnlyHere, true);
});

test('a guest in a manager’s conversation is part of the manager: told so, read-only, with its tools and folders', async (t) => {
  const app = shop(t);
  const { coder, managers, conversations, home } = app;
  const [, joined] = conversations.inviteNew(coder.id, { provider: 'codex', name: 'Codex' });
  conversations.setPaused(coder.id, coder.id, true);
  await conversations.usage(coder.id, joined.id);
  const session = app.sessionOf(joined.id);
  const told = session.opts.instructions;
  assert.match(told, /^\[You are Codex, answering in the conversation of shop manager, the manager of shop\]/);
  assert.match(told, /A manager’s conversation changes no files, and neither do you here/);
  assert.match(told, /start a worker with buddylist’s start_conversation tool in the same turn/);
  assert.match(told, /listed under shop manager/);
  assert.match(told, /what one of them already started is started/);
  assert.match(told, /You answer here as part of shop manager, also while it is paused/);
  assert.ok(told.endsWith(managers.forAgent(coder).instructions), 'then all the manager itself is told');
  assert.deepEqual(
    [session.contact.readOnly, session.contact.permissionMode, session.contact.readDirs],
    [true, 'read-only', [path.join(home, 'shop')]]
  );
  // It answers with the manager's own tools, bound to it as the one asking.
  const started = [];
  const toolsFor = appTools({
    store: app.store,
    terminals: { wanted: () => true },
    startConversation: async (hostId, options) => (started.push({ hostId, ...options }), { id: 'w', name: 'w' }),
    instructions: { of: async () => ({ key: app.key, name: 'shop', instructions: {} }), save: () => {} },
    managers,
  });
  const tools = toolsFor(coder.id, joined.id);
  assert.deepEqual(
    tools.map((tool) => tool.name),
    toolsFor(coder.id).map((tool) => tool.name)
  );
  await tools.find((tool) => tool.name === 'start_conversation').run({ prompt: 'Fix the cart', asked_by_user: true });
  assert.deepEqual(
    started.map(({ hostId, speakerId }) => [hostId, speakerId]),
    [[coder.id, joined.id]]
  );
  // The manager itself is told what it always was.
  await conversations.usage(coder.id, coder.id);
  // Its session started before the other managers were there, so it says it is the only one.
  assert.match(app.sessionOf(coder.id).opts.instructions, /^\[You are the manager of shop\]/);
  assert.doesNotMatch(app.sessionOf(coder.id).opts.instructions, /answering in the conversation of/);
});

test('a guest with a role in a manager’s conversation does its role’s job, and hands changes to workers', async (t) => {
  const app = shop(t);
  const { coder, conversations, store } = app;
  store.updateSettings({
    roles: [{ id: 'qa', name: 'QA', provider: 'codex', model: '', effort: '', answers: 'always', rules: 'Test it.' }],
    teams: [],
  });
  const [, joined] = conversations.inviteSavedRole(coder.id, 'qa');
  await conversations.usage(coder.id, joined.id);
  const { opts, contact } = app.sessionOf(joined.id);
  assert.match(
    opts.instructions,
    /^\[You are QA, answering in the conversation of shop manager, the manager of shop\]/
  );
  assert.match(opts.instructions, /start_conversation/);
  assert.match(opts.instructions, /Do what your role says\. The brief and the sources are shop manager’s to keep\./);
  assert.match(opts.instructions, /\[Your role: QA\][\s\S]*Test it\.$/, 'its role comes last');
  assert.doesNotMatch(opts.instructions, /Know what the project is building/, 'not the manager’s whole job');
  assert.equal(contact.readOnly, true);
});

test('a guest in the project manager’s conversation hands work to the managers, as the project manager does', async (t) => {
  const app = shop(t);
  const { lead, conversations } = app;
  const [, joined] = conversations.inviteNew(lead.id, { provider: 'codex', name: 'Codex' });
  await conversations.usage(lead.id, joined.id);
  const told = app.sessionOf(joined.id).opts.instructions;
  assert.match(told, /^\[You are Codex, answering in the conversation of shop project manager, the project manager/);
  assert.match(told, /Work goes to the project’s managers, with message_manager/);
  assert.doesNotMatch(told, /start a worker with buddylist’s start_conversation/);
  assert.match(told, /You start no conversation and message no worker: the managers do\./);
});

test('a guest of a manager that is off, or of a conversation that is none, is told nothing of managing', async (t) => {
  const app = shop(t);
  const { conversations, store } = app;
  const tags = app.worker('Claude (tags)');
  const [, joined] = conversations.inviteNew(tags.id, { provider: 'codex', name: 'Codex' });
  await conversations.usage(tags.id, joined.id);
  assert.equal(app.sessionOf(joined.id).opts.instructions, undefined);
  assert.equal(app.sessionOf(joined.id).contact.readOnly, undefined);

  const off = store.addContact({ provider: 'claude', name: 'old manager', cwd: app.root, model: '', manages: app.key });
  const [, guest] = conversations.inviteNew(off.id, { provider: 'codex', name: 'Codex 2' });
  await conversations.usage(off.id, guest.id);
  assert.equal(app.sessionOf(guest.id).opts.instructions, undefined);
  assert.equal(app.sessionOf(guest.id).contact.readOnly, true, 'still read-only in a manager’s conversation');
});

test('in the app, the tools come from the Managers itself: a manager has its own, and the project manager its', (t) => {
  const app = shop(t);
  const toolsFor = appTools({
    store: app.store,
    terminals: { wanted: () => true },
    startConversation: async () => ({ id: 'x', name: 'x', worktree: true, joined: [] }),
    instructions: { of: async () => ({ key: app.key, name: 'shop', instructions: {} }), save: () => {} },
    managers: app.managers,
  });
  const names = (id) => toolsFor(id).map((tool) => tool.name);
  assert.deepEqual(names(app.lead.id), [
    'open_terminals',
    'project_instructions',
    'message_manager',
    'project_teams',
    'project_brief',
    'project_sources',
  ]);
  assert.deepEqual(names(app.reviewer.id), [
    'open_terminals',
    'start_conversation',
    'project_instructions',
    'message_conversation',
    'answer_question',
    'project_conversations',
    'project_brief',
    'project_sources',
    'message_project_manager',
  ]);
  assert.deepEqual(names(app.worker('Claude (tags)').id), [
    'open_terminals',
    'start_conversation',
    'project_instructions',
  ]);
});

test('managers are told of their project manager, and the project manager of its managers', (t) => {
  const app = shop(t);
  const { managers, coder, reviewer, lead } = app;
  const theirs = managers.forAgent(reviewer)?.instructions ?? '';
  assert.match(theirs, /shop project manager is the project manager over you and the project’s other managers\./);
  assert.match(theirs, /send it a short report with the message_project_manager tool/);
  assert.match(
    theirs,
    /shop manager oversees the project’s other conversations/,
    'the project manager is no other manager of conversations'
  );
  assert.equal(
    managers.forAgent(lead)?.instructions,
    projectManagerInstructions('shop', managers.settingsOf(app.key, lead.id), {
      name: 'shop project manager',
      managers: ['shop manager', 'review manager'],
    })
  );
  assert.doesNotMatch(managerInstructions('shop', managers.settingsOf(app.key, coder.id)), /project manager/);
  assert.deepEqual(
    managers.managersUnder(lead).map((one) => one.name),
    ['shop manager', 'review manager']
  );
});

test('the project manager oversees managers, not conversations: nothing is put under it', async (t) => {
  const app = shop(t);
  const { managers, key, lead, coder, reviewer, store } = app;
  const tags = app.worker('Claude (tags)');
  assert.equal(managers.leads(lead), true);
  assert.equal(managers.leads(coder), false);
  assert.equal(managers.managerFor({ key, under: lead.id }), null, 'Add a Contact can’t put one under it');
  assert.equal(managers.managerFor({ key, startedBy: lead.id }), null);
  await assert.rejects(managers.assign(tags.id, lead.id), /oversees the project’s managers, not its conversations/);
  assert.deepEqual(managers.workersOf(lead), []);
  // The managers at work are under it, and drawn under it.
  assert.equal(managers.leadOf(coder)?.id, lead.id);
  assert.equal(managers.leadOf(reviewer)?.id, lead.id);
  assert.equal(managers.leadOf(lead), null);
  assert.equal(managers.leadOf(tags), null);
  const views = new Map(store.contacts.map((one) => [one.id, app.conversations.view(one)]));
  assert.equal(views.get(coder.id).ledBy, lead.id);
  assert.equal(views.get(lead.id).oversees, true);
  assert.equal(views.get(lead.id).leads, true);
  assert.equal(views.get(tags.id).ledBy, null);
  assert.equal(views.get(tags.id).overseenBy, coder.id);
  // Turned off, it oversees nothing.
  const its = managers.settingsOf(key, lead.id);
  managers.set(key, { ...its, on: false });
  managers.settingsChanged(key, its, { ...its, on: false });
  assert.equal(managers.leadOf(coder), null);
  assert.equal(app.conversations.view(store.getContact(coder.id)).ledBy, null);
  assert.equal(managers.managersIn(key).find((one) => one.id === lead.id)?.leads, true);
});

test('a project has one project manager, once it has a manager, and it is never its first', (t) => {
  const app = shop(t);
  const { managers, key, lead, coder, store, projects } = app;
  assert.throws(
    () => managers.add(key, { lead: true, name: 'boss' }),
    /shop has a project manager already: shop project manager\./
  );
  assert.equal(lead.name, 'shop project manager');
  assert.equal(store.getContact(lead.id)?.leads, true);
  // Its settings are among the others: never the first.
  assert.notEqual(projects.settings(key).manager.id, lead.id);
  assert.ok(projects.settings(key).managers.some((one) => one.id === lead.id));
  // The first deleted, the next manager of conversations takes its place, not the project manager.
  managers.forgotten(/** @type {any} */ (store.getContact(coder.id)));
  store.removeContact(coder.id);
  assert.equal(projects.settings(key).manager.id, app.reviewer.id);
  assert.ok(projects.settings(key).managers.some((one) => one.id === lead.id));
  // Eight managers of conversations, besides it.
  for (let i = managers.managersIn(key).filter((one) => !one.leads).length; i < MANAGERS_MAX; i += 1) {
    managers.add(key, { name: `m${i}` });
  }
  assert.equal(managers.managersIn(key).length, MANAGERS_MAX + 1);
  assert.throws(() => managers.add(key, { name: 'one too many' }), /has 8 managers, as many as a project can have/);
  assert.equal(cleanManagers(projects.settings(key).managers).length, MANAGERS_MAX);
});

test('a project with no manager can’t have a project manager yet', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-lead-none-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'cart');
  fs.mkdirSync(root);
  const key = `git:${root}/.git`;
  const store = new Store(path.join(dir, 'data'), { defaultProvider: 'claude' });
  const managers = new Managers({
    store,
    history: new History(path.join(dir, 'history')),
    projects: new Projects({ store, worktreesHome: dir, describe: async () => ({ key, name: 'cart', root }) }),
    conversations: /** @type {any} */ ({ pass: () => true, notice: () => {}, view: () => ({}), end: () => {} }),
    descriptor,
    worktreesHomes: [dir],
    onContactsChanged: () => {},
    onProjectChanged: () => {},
  });
  assert.throws(() => managers.add(key, { lead: true }), /cart has no manager yet\. Add one first/);
  assert.equal(store.contacts.length, 0);
});

test('the windows leave a project manager out of what is about conversations', () => {
  const project = 'shop';
  const contacts = [
    { id: 'm1', project, manages: 'k', oversees: true },
    { id: 'p1', project, manages: 'k', leads: true, oversees: true },
    { id: 'c1', project, managedBy: 'm1' },
  ];
  assert.deepEqual(
    managersFor(contacts[2], contacts).map((one) => one.id),
    ['m1'],
    'Assign to manager... offers no project manager'
  );
  assert.deepEqual(teamChoices(contacts[1], contacts), [], 'it has no conversations to assign');
  assert.equal(dropUnder(contacts[2], { manager: contacts[1] }), undefined, 'nothing is dropped onto it');
  assert.equal(draggable(contacts[2], [contacts[1], contacts[2]]), false, 'a project manager alone takes no drop');
  const listed = {
    repository: true,
    managers: [
      { id: 'm1', name: 'shop manager', archived: false, settings: { on: true, scope: ['safa/*'] } },
      { id: 'p1', name: 'shop project manager', archived: false, leads: true, settings: { on: true, scope: ['*'] } },
    ],
  };
  assert.deepEqual(
    managersAtWork(listed).map((one) => one.id),
    ['m1']
  );
  assert.deepEqual(
    underFor(listed)?.choices.map((one) => one.label),
    ['No manager', 'shop manager', 'Add another manager...']
  );
  assert.equal(scopedManager(/** @type {any} */ (listed.managers.toReversed()), { branch: 'x/y' }), '');
  assert.equal(ledBy({ id: 'p1' }, { ledBy: 'p1' }), true);
  assert.equal(ledBy({ id: 'p1' }, { ledBy: 'p1', archived: true }), false);
});
