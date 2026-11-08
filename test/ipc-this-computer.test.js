import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
  computerFiles,
  computerFolderOf,
  freeComputerName,
  makeComputerFolder,
  removeComputerFolder,
} from '../src/main/computer.js';
import { Projects } from '../src/main/project-settings.js';
import { Store } from '../src/main/storage/store.js';
import { REQUESTS } from '../src/shared/ipc-channels.js';
import { tempDir } from './fixtures/temp-dir.js';

// Contacts on This computer through the real IPC handlers: a folder of its own when one is added, where Add a
// Contact says a new one can work, and what deleting one takes along. Only Electron is replaced.
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

const tmp = () => fs.realpathSync(tempDir('bl-this-computer-'));

function fixture(t, { computer = true } = {}) {
  const root = tmp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const computerHome = path.join(root, 'this-computer');
  const store = new Store(path.join(root, 'data'), { defaultProvider: 'claude' });
  // Any folder outside This computer is a project of its own, by its name: no git is asked.
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
  const forgotten = [];
  const modelRequests = [];
  /** The effort levels set, each with whose: Conversations.setEffort keeps only one its model takes. */
  const efforts = [];
  const systemVersion = process.getSystemVersion;
  process.getSystemVersion = () => 'test';
  try {
    registerIpc({
      store,
      providers: {
        descriptor: () => descriptor,
        list: () => [descriptor],
        models: async (...args) => {
          modelRequests.push(args);
          return [];
        },
      },
      conversations: {
        view: (contact) => contact,
        forget: (id) => forgotten.push(id),
        addTeam() {},
        setEffort: async (id, effort) => {
          efforts.push([id, effort]);
          store.updateContact(id, { effort });
        },
      },
      projects,
      managers: { managerFor: () => undefined, forgotten() {} },
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
    });
  } finally {
    if (systemVersion) process.getSystemVersion = systemVersion;
    else delete process.getSystemVersion;
  }
  const notices = [];
  const sender = { send: (_channel, message) => notices.push(message), isDestroyed: () => false };
  const invoke = (channel, ...args) => handlers.get(channel)({ sender }, ...args);
  const add = (fields = {}) => invoke(REQUESTS.contactAdd, { name: 'Claude (chat-1)', provider: 'claude', ...fields });
  return { root, computerHome, store, projects, invoke, add, notices, forgotten, efforts, modelRequests };
}

test('model defaults are queried with the folder’s project environment and trusted config root', opts, async (t) => {
  const { root, projects, invoke, modelRequests } = fixture(t);
  const env = { ANTHROPIC_MODEL: 'sonnet' };
  projects.forAgent = (cwd) => {
    assert.equal(cwd, root);
    return { env, mainFolder: '/trusted/main' };
  };
  await invoke(REQUESTS.providerModels, 'claude', root);
  await invoke(REQUESTS.providerModels, 'claude', '');
  await invoke(REQUESTS.providerModels, 'claude', path.join(root, 'missing'));
  await invoke(REQUESTS.providerModels, 'claude', 'relative/path');
  await invoke(REQUESTS.providerModels, 'claude');
  // A window shows the list it has while an old one is asked for again.
  const fresh = { fresh: true };
  assert.deepEqual(modelRequests, [
    ['claude', { cwd: root, env, mainFolder: '/trusted/main' }, fresh],
    ['claude', { cwd: '' }, fresh],
    ['claude', { cwd: '' }, fresh],
    ['claude', { cwd: '' }, fresh],
    ['claude', undefined, fresh],
  ]);
});

// ---- the folders -----------------------------------------------------------------------------------

test('each folder on This computer gets the lowest number nothing uses yet, made empty', () => {
  const home = path.join(tmp(), 'this-computer');
  assert.equal(freeComputerName(home), 'chat-1', 'before the first, where they go is not there yet');
  const first = makeComputerFolder(home);
  assert.equal(first, path.join(home, 'chat-1'));
  assert.deepEqual(fs.readdirSync(first), []);
  assert.equal(makeComputerFolder(home), path.join(home, 'chat-2'));
  fs.rmSync(first, { recursive: true });
  assert.equal(makeComputerFolder(home), path.join(home, 'chat-1'), 'a number given back is used again');
});

test('a folder on This computer goes when it is empty, and with what is in it only when asked', () => {
  const home = path.join(tmp(), 'this-computer');
  const dir = makeComputerFolder(home);
  // The Finder's notes about a folder are nobody's files.
  fs.writeFileSync(path.join(dir, '.DS_Store'), '');
  assert.equal(computerFiles(dir), 0);
  assert.equal(removeComputerFolder(dir, home), true);
  assert.equal(fs.existsSync(dir), false);

  const kept = makeComputerFolder(home);
  fs.writeFileSync(path.join(kept, 'letter.md'), '# Dear');
  fs.mkdirSync(path.join(kept, 'notes'));
  assert.equal(computerFiles(kept), 2);
  assert.equal(removeComputerFolder(kept, home), false);
  assert.equal(fs.existsSync(path.join(kept, 'letter.md')), true);
  assert.equal(removeComputerFolder(kept, home, { files: true }), true);
  assert.equal(fs.existsSync(kept), false);

  // Only a folder made for a contact there: never another one, nor where they all go.
  const other = tmp();
  assert.equal(removeComputerFolder(other, home, { files: true }), false);
  assert.equal(fs.existsSync(other), true);
  assert.equal(removeComputerFolder(home, home, { files: true }), false);
  assert.equal(computerFiles(path.join(home, 'gone')), 0);
});

// ---- adding one ------------------------------------------------------------------------------------

test(
  'a contact added on This computer gets a new, empty folder of its own, and a nickname that follows its work',
  opts,
  async (t) => {
    const app = fixture(t);
    const first = await app.add({ computer: true });
    assert.equal(first.cwd, path.join(app.computerHome, 'chat-1'));
    assert.deepEqual(fs.readdirSync(first.cwd), []);
    assert.equal(first.placeholderName, 'chat-1');
    assert.equal(first.placeholderBranch, undefined, 'there is no branch');
    // A folder picked as well is not where it works: it has none to pick.
    const second = await app.add({ computer: true, cwd: app.root, name: 'Claude (chat-2)' });
    assert.equal(second.cwd, path.join(app.computerHome, 'chat-2'));
    assert.equal((await app.projects.of(second.cwd)).key, (await app.projects.of(first.cwd)).key);
  }
);

test('with made-up names kept as they are, a contact on This computer keeps its nickname', opts, async (t) => {
  const app = fixture(t);
  app.store.updateSettings({ renameBranches: false });
  const added = await app.add({ computer: true });
  assert.equal(added.placeholderName, undefined);
});

test('the effort level picked in Add a Contact is set before the contact is answered for', opts, async (t) => {
  const app = fixture(t);
  const high = await app.add({ computer: true, effort: 'high' });
  assert.equal(high.effort, 'high', 'the window is answered with it');
  assert.equal(app.store.getContact(high.id).effort, 'high');
  // Its model's own level is none to set, and nothing but a level's name is one.
  await app.add({ computer: true, effort: '' });
  await app.add({ computer: true, effort: { level: 'max' } });
  await app.add({ computer: true });
  assert.deepEqual(app.efforts, [[high.id, 'high']]);
});

test('a contact is only on This computer where the app knows where those folders go', opts, async (t) => {
  const app = fixture(t, { computer: false });
  await assert.rejects(app.add({ computer: true }), /Pick a folder that exists/);
  assert.equal(fs.existsSync(app.computerHome), false);
});

test('a contact called off while it is added takes its folder along', opts, async (t) => {
  const app = fixture(t);
  const adding = app.add({ computer: true });
  await app.invoke(REQUESTS.contactCancelAdd);
  await assert.rejects(adding);
  assert.deepEqual(fs.readdirSync(app.computerHome), []);
  assert.equal(app.store.contacts.length, 0);
});

test(
  'Add a Contact is told the folder a new contact would get, and the projects there are, by name',
  opts,
  async (t) => {
    const app = fixture(t);
    const shop = path.join(app.root, 'shop');
    const api = path.join(app.root, 'api');
    fs.mkdirSync(shop);
    fs.mkdirSync(api);
    const common = { provider: 'claude', model: '', permissionMode: 'default' };
    app.store.addContact({ ...common, name: 'Shop', cwd: shop });
    app.store.addContact({ ...common, name: 'Shop again', cwd: shop });
    app.store.addContact({ ...common, name: 'Api', cwd: api });
    // One whose folder is gone is no project to start another on.
    app.store.addContact({ ...common, name: 'Gone', cwd: path.join(app.root, 'gone') });
    await app.add({ computer: true });
    const places = await app.invoke(REQUESTS.contactPlaces);
    assert.deepEqual(places.projects, [
      { name: 'api', folder: api },
      { name: 'shop', folder: shop },
    ]);
    assert.equal(places.computer.name, 'chat-2');
    assert.equal(places.computer.folder.endsWith(path.join('this-computer', 'chat-2')), true);
  }
);

// ---- deleting one ----------------------------------------------------------------------------------

test('deleting a contact on This computer takes its empty folder along, and keeps one with files', opts, async (t) => {
  const app = fixture(t);
  const empty = await app.add({ computer: true });
  assert.deepEqual(await app.invoke(REQUESTS.contactWorktree, empty.id), {
    branch: null,
    folder: empty.cwd,
    place: 'computer',
    files: 0,
  });
  await app.invoke(REQUESTS.contactRemove, empty.id);
  assert.equal(fs.existsSync(empty.cwd), false);

  const writer = await app.add({ computer: true, name: 'Claude (chat-2)' });
  fs.writeFileSync(path.join(writer.cwd, 'letter.md'), '# Dear');
  assert.equal((await app.invoke(REQUESTS.contactWorktree, writer.id)).files, 1);
  await app.invoke(REQUESTS.contactRemove, writer.id);
  assert.equal(fs.existsSync(path.join(writer.cwd, 'letter.md')), true, 'what it made is the user’s');
  assert.deepEqual(app.notices, []);

  const asked = await app.add({ computer: true, name: 'Claude (chat-3)' });
  fs.writeFileSync(path.join(asked.cwd, 'notes.md'), '- coffee');
  await app.invoke(REQUESTS.contactRemove, asked.id, { removeWorktree: true });
  assert.equal(fs.existsSync(asked.cwd), false, 'with the box ticked, the files go too');
});

test(
  'a folder on This computer that another contact works in stays, and the home folder is never touched',
  opts,
  async (t) => {
    const app = fixture(t);
    const host = await app.add({ computer: true });
    // A chat tab of it works in the same folder.
    const tab = app.store.addContact({
      provider: 'claude',
      name: 'Tab',
      cwd: host.cwd,
      model: '',
      permissionMode: 'default',
      tabOf: host.id,
    });
    assert.equal(await app.invoke(REQUESTS.contactWorktree, host.id), null);
    await app.invoke(REQUESTS.contactRemove, host.id, { removeWorktree: true });
    assert.equal(fs.existsSync(host.cwd), true);
    // The last one there takes it along.
    await app.invoke(REQUESTS.contactRemove, tab.id);
    assert.equal(fs.existsSync(host.cwd), false);

    const home = app.store.addContact({
      provider: 'claude',
      name: 'Home',
      cwd: os.homedir(),
      model: '',
      permissionMode: 'default',
    });
    assert.equal(await app.invoke(REQUESTS.contactWorktree, home.id), null);
    await app.invoke(REQUESTS.contactRemove, home.id);
    assert.equal(fs.existsSync(os.homedir()), true);
  }
);

test(
  'deleting the contacts on This computer at once takes the empty folders, and the others when asked',
  opts,
  async (t) => {
    const app = fixture(t);
    const empty = await app.add({ computer: true });
    const writer = await app.add({ computer: true, name: 'Claude (chat-2)' });
    fs.writeFileSync(path.join(writer.cwd, 'letter.md'), '# Dear');
    await app.invoke(REQUESTS.contactRemoveAll, [empty.id, writer.id], { removeWorktrees: false });
    assert.equal(fs.existsSync(empty.cwd), false);
    assert.equal(fs.existsSync(path.join(writer.cwd, 'letter.md')), true);

    const again = await app.add({ computer: true, name: 'Claude (chat-3)' });
    fs.writeFileSync(path.join(again.cwd, 'notes.md'), '- coffee');
    await app.invoke(REQUESTS.contactRemoveAll, [again.id], { removeWorktrees: true });
    assert.equal(fs.existsSync(again.cwd), false);
    assert.deepEqual(app.forgotten.length, 3);
  }
);

// ---- a folder that only seems to be on This computer ------------------------------------------------

test('only a folder really one level below This computer goes, whatever its path seems to say', () => {
  const root = tmp();
  const home = path.join(root, 'this-computer');
  const dir = makeComputerFolder(home);
  fs.writeFileSync(path.join(root, 'yours.md'), 'keep me');
  assert.equal(computerFolderOf(dir, home), dir);
  // ".." takes it out of there: to where the folders go, and to the folder that is in.
  for (const out of [path.join(dir, '..'), `${dir}/..`, `${dir}/../..`, `${home}/chat-1/../../..`]) {
    assert.equal(computerFolderOf(out, home), null, out);
    assert.equal(removeComputerFolder(out, home, { files: true }), false, out);
  }
  assert.equal(fs.existsSync(home), true);
  assert.equal(fs.readFileSync(path.join(root, 'yours.md'), 'utf8'), 'keep me');
  // A folder in one is two levels down: no contact's folder of its own.
  const sub = path.join(dir, 'sub');
  fs.mkdirSync(sub);
  assert.equal(computerFolderOf(sub, home), null);
  assert.equal(removeComputerFolder(sub, home, { files: true }), false);
  assert.equal(fs.existsSync(sub), true);
  // Gone, there is nothing to take along.
  assert.equal(computerFolderOf(path.join(home, 'chat-9'), home), null);
});

test('a link in This computer to a folder elsewhere is never followed out to delete it', () => {
  const root = tmp();
  const home = path.join(root, 'this-computer');
  makeComputerFolder(home);
  const elsewhere = path.join(root, 'documents');
  fs.mkdirSync(elsewhere);
  fs.writeFileSync(path.join(elsewhere, 'taxes.pdf'), '%PDF');
  const link = path.join(home, 'chat-7');
  fs.symlinkSync(elsewhere, link, 'dir');
  assert.equal(computerFolderOf(link, home), null);
  assert.equal(removeComputerFolder(link, home, { files: true }), false);
  assert.equal(fs.existsSync(path.join(elsewhere, 'taxes.pdf')), true);
  // A link to where they go, from outside, is that folder: one made in it really is one level below.
  const through = path.join(root, 'shortcut');
  fs.symlinkSync(home, through, 'dir');
  assert.equal(computerFolderOf(path.join(through, 'chat-1'), home), path.join(home, 'chat-1'));
});

test(
  'a contact whose folder only seems to be on This computer is asked about nothing, and nothing of it goes',
  opts,
  async (t) => {
    const app = fixture(t);
    makeComputerFolder(app.computerHome);
    fs.writeFileSync(path.join(app.root, 'yours.md'), 'keep me');
    const common = { provider: 'claude', model: '', permissionMode: 'default' };
    // From an older store, a folder picked by hand, or an agent: its path starts with where the folders go.
    const above = app.store.addContact({
      ...common,
      name: 'Up',
      cwd: path.join(app.computerHome, 'chat-1', '..', '..'),
    });
    const elsewhere = path.join(app.root, 'documents');
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, 'taxes.pdf'), '%PDF');
    fs.symlinkSync(elsewhere, path.join(app.computerHome, 'chat-5'), 'dir');
    const linked = app.store.addContact({ ...common, name: 'Linked', cwd: path.join(app.computerHome, 'chat-5') });
    const raw = app.store.addContact({ ...common, name: 'Raw', cwd: `${app.computerHome}/chat-1/../..` });
    for (const contact of [above, linked, raw]) {
      assert.equal(await app.invoke(REQUESTS.contactWorktree, contact.id), null, contact.name);
    }
    await app.invoke(REQUESTS.contactRemove, above.id);
    await app.invoke(REQUESTS.contactRemove, linked.id);
    await app.invoke(REQUESTS.contactRemoveAll, [raw.id], { removeWorktrees: true });
    assert.equal(app.store.contacts.length, 0);
    assert.equal(fs.readFileSync(path.join(app.root, 'yours.md'), 'utf8'), 'keep me');
    assert.equal(fs.existsSync(path.join(elsewhere, 'taxes.pdf')), true);
    assert.equal(fs.existsSync(path.join(app.computerHome, 'chat-1')), true);
  }
);
