import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Projects } from '../src/main/project-settings.js';
import { Schedules } from '../src/main/schedules.js';
import { Store } from '../src/main/storage/store.js';
import { REQUESTS } from '../src/shared/ipc-channels.js';

// Schedules through the real IPC handlers: what the dialog sends is checked, and a run is a contact of its own, in a
// worktree of its project on a branch named after the schedule, or on This computer, with its prompt sent at once.
// Only Electron is replaced.
const electron = `data:text/javascript,${encodeURIComponent(`
  export const handlers = new Map();
  export const ipcMain = { handle: (name, fn) => handlers.set(name, fn), on() {} };
  export const app = { getVersion: () => '0.0.0' };
  export const nativeTheme = { on() {} };
  export const BrowserWindow = {}, dialog = {}, nativeImage = {}, screen = {}, shell = {};
`)}`;
let registerIpc;
let handlers;
if (module.registerHooks) {
  const hook = module.registerHooks({
    resolve(name, context, next) {
      return name === 'electron' ? { url: electron, shortCircuit: true } : next(name, context);
    },
  });
  try {
    ({ registerIpc } = await import('../src/main/ipc.js'));
    ({ handlers } = await import(electron));
  } finally {
    hook.deregister();
  }
}
const opts = { skip: !registerIpc };

process.env.TZ = 'America/New_York';
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bl-schedules-')));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

function fixture(t, { computer = true } = {}) {
  const root = tmp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const computerHome = path.join(root, 'this-computer');
  const store = new Store(path.join(root, 'data'), { defaultProvider: 'claude' });
  const projects = new Projects({
    store,
    worktreesHome: path.join(root, 'worktrees'),
    computerHome,
    describe: async (cwd) => ({ key: `dir:${cwd}`, name: path.basename(cwd), root: cwd }),
  });
  const descriptor = {
    id: 'claude',
    name: 'Claude',
    avatars: [],
    permissionModes: [{ id: 'default' }, { id: 'bypassPermissions' }],
    defaultPermissionMode: 'default',
  };
  const sent = [];
  const notices = [];
  const efforts = [];
  let schedules;
  const systemVersion = process.getSystemVersion;
  process.getSystemVersion = () => 'test';
  let runSchedule;
  try {
    schedules = new Schedules({
      store,
      start: (schedule, at) => runSchedule(schedule, at),
      now: () => new Date(2026, 9, 27, 9, 0).getTime(),
      timers: { set: () => null, clear() {} },
    });
    ({ runSchedule } = registerIpc({
      store,
      providers: { descriptor: () => descriptor, list: () => [descriptor], models: async () => [] },
      conversations: {
        view: (contact) => contact,
        forget() {},
        addTeam() {},
        notice: (id, message) => notices.push({ id, message }),
        send: (id, message) => sent.push({ id, ...message }),
        setEffort: async (id, effort) => {
          efforts.push([id, effort]);
          store.updateContact(id, { effort });
        },
      },
      projects,
      managers: { managerFor: () => undefined, forgotten() {} },
      schedules,
      runs: { setup: async () => {}, stop: async () => {} },
      terminals: { closeFor() {} },
      chats: { get: () => null, close() {}, retitle() {} },
      historyWindows: { close() {}, retitle() {} },
      pullRequests: { startedOver() {} },
      analytics: { counting: (_name, fn) => fn },
      broadcast() {},
      broadcastContacts() {},
      worktreesHome: path.join(root, 'worktrees'),
      ...(computer && { computerHome }),
      pathReady: Promise.resolve(),
    }));
  } finally {
    if (systemVersion) process.getSystemVersion = systemVersion;
    else delete process.getSystemVersion;
  }
  const invoke = async (channel, ...args) => handlers.get(channel)({ sender: {} }, ...args);
  const ask = (more = {}) => ({
    name: 'Triage new issues',
    prompt: 'Label the issues opened since yesterday.',
    cwd: root,
    cron: '0 9 * * 1-5',
    provider: 'claude',
    model: '',
    effort: '',
    permissionMode: 'bypassPermissions',
    maxRuns: '',
    ...more,
  });
  return { root, computerHome, store, invoke, ask, sent, notices, efforts };
}

/** A git repository with one commit, as a project is. */
function repository(root) {
  const repo = path.join(root, 'shop');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), '# shop\n');
  git(repo, 'add', '.');
  git(repo, '-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-q', '-m', 'init');
  return repo;
}

test('a schedule the dialog sends is checked, kept and listed, on with no run yet', opts, async (t) => {
  const app = fixture(t);
  const added = await app.invoke(REQUESTS.schedulesAdd, app.ask({ maxRuns: '3' }));
  assert.equal(added.on, true);
  assert.equal(added.maxRuns, 3);
  assert.equal(added.runs, 0);
  assert.equal(added.next, new Date(2026, 9, 27, 9, 0).getTime() + 24 * 3600_000);
  assert.deepEqual(
    (await app.invoke(REQUESTS.schedulesList)).map((one) => one.id),
    [added.id]
  );
  assert.equal(app.store.settings.schedules[0].prompt, 'Label the issues opened since yesterday.');
  const edited = await app.invoke(REQUESTS.schedulesUpdate, added.id, app.ask({ name: 'Triage' }));
  assert.equal(edited.name, 'Triage');
  assert.equal((await app.invoke(REQUESTS.schedulesSetOn, added.id, false)).on, false);
  assert.equal(await app.invoke(REQUESTS.schedulesRemove, added.id), true);
  assert.deepEqual(app.store.settings.schedules, []);
});

test('a schedule on a folder that is gone, or on a This computer there is none of, is refused', opts, async (t) => {
  const app = fixture(t, { computer: false });
  await assert.rejects(app.invoke(REQUESTS.schedulesAdd, app.ask({ cwd: path.join(app.root, 'gone') })), {
    message: 'Pick a folder that exists.',
  });
  await assert.rejects(app.invoke(REQUESTS.schedulesAdd, app.ask({ computer: true })), /This computer is not here/);
  await assert.rejects(app.invoke(REQUESTS.schedulesAdd, app.ask({ cron: '0 9 * *' })), /five fields/);
});

test('a run is a contact of its own on a branch named after the schedule, with its prompt sent', opts, async (t) => {
  const app = fixture(t);
  const repo = repository(app.root);
  // A branch of that name is there already: the run takes the next number.
  git(repo, 'branch', 'triage-new-issues-1');
  const schedule = await app.invoke(REQUESTS.schedulesAdd, app.ask({ cwd: repo, effort: 'high' }));
  await app.invoke(REQUESTS.schedulesRunNow, schedule.id);
  const [contact] = app.store.contacts;
  assert.equal(contact.name, 'Triage new issues (Oct 27, 9:00 AM)');
  assert.equal(contact.permissionMode, 'bypassPermissions', 'the mode the schedule was given');
  assert.notEqual(contact.cwd, repo, 'in a worktree of its own');
  assert.equal(git(contact.cwd, 'branch', '--show-current'), 'triage-new-issues-2');
  assert.deepEqual(app.sent, [{ id: contact.id, text: 'Label the issues opened since yesterday.' }]);
  assert.deepEqual(app.notices.at(-1), {
    id: contact.id,
    message: 'The schedule Triage new issues started this conversation.',
  });
  assert.deepEqual(app.efforts, [[contact.id, 'high']]);
  assert.equal(contact.startedBy, undefined, 'listed as an ordinary contact');
});

test('a run on This computer gets a new folder of its own there', opts, async (t) => {
  const app = fixture(t);
  const schedule = await app.invoke(REQUESTS.schedulesAdd, app.ask({ computer: true, name: '' }));
  await app.invoke(REQUESTS.schedulesRunNow, schedule.id);
  const [contact] = app.store.contacts;
  assert.equal(contact.cwd, path.join(app.computerHome, 'chat-1'));
  assert.equal(contact.name, 'Label the issues opened since yesterday. (Oct 27, 9:00 AM)');
});

test('a run whose folder is gone says so on its schedule', opts, async (t) => {
  const app = fixture(t);
  const folder = path.join(app.root, 'project');
  fs.mkdirSync(folder);
  const schedule = await app.invoke(REQUESTS.schedulesAdd, app.ask({ cwd: folder }));
  fs.rmSync(folder, { recursive: true });
  await assert.rejects(app.invoke(REQUESTS.schedulesRunNow, schedule.id), /is not there any more/);
  const [view] = await app.invoke(REQUESTS.schedulesList);
  assert.match(view.lastError, /project is not there any more\.$/);
  assert.deepEqual(app.store.contacts, []);
});
