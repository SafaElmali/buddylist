import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { appTools } from '../src/main/app-tools.js';
import { makeComputerFolder } from '../src/main/computer.js';
import { Projects } from '../src/main/project-settings.js';
import { Store } from '../src/main/storage/store.js';
import { createProviders } from '../src/providers/index.js';
import { APP_TOOLS } from '../src/shared/app-tools.js';
import { cleanWorkers } from '../src/shared/managers.js';

// Exercise the real app tool, provider wiring and contact creation without starting an AI process.
const electron = `data:text/javascript,${encodeURIComponent(`
  export const ipcMain = { handle() {}, on() {} };
  export const app = { getVersion: () => '0.0.0' };
  export const nativeTheme = { on() {} };
  export const BrowserWindow = {}, dialog = {}, nativeImage = {}, screen = {}, shell = {};
`)}`;
let registerIpc;
if (module.registerHooks) {
  const hook = module.registerHooks({
    resolve(name, context, next) {
      return name === 'electron' ? { url: electron, shortCircuit: true } : next(name, context);
    },
  });
  try {
    ({ registerIpc } = await import('../src/main/ipc.js'));
  } finally {
    hook.deregister();
  }
}
const opts = { skip: !registerIpc };

/**
 * A conversation whose agent starts others, through the app's own tool and contact creation. With `workers`, it is a
 * project's manager whose New workers use says that; without, a contact like any.
 */
function fixture(t, hostProvider = 'claude', { workers, hostMode, sendResult } = {}) {
  const getSystemVersion = process.getSystemVersion;
  process.getSystemVersion = () => 'test';
  t.after(() => {
    if (getSystemVersion) process.getSystemVersion = getSystemVersion;
    else delete process.getSystemVersion;
  });
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bl-started-conversations-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const computerHome = path.join(root, 'computer');
  const store = new Store(path.join(root, 'data'), { defaultProvider: 'claude' });
  store.updateSettings({ renameBranches: false });
  const providers = createProviders({
    app: { isPackaged: false },
    tools: (conversation, speaker) => toolsFor(conversation, speaker),
  });
  const host = store.addContact({
    name: 'Manager',
    provider: hostProvider,
    cwd: makeComputerFolder(computerHome),
    model: hostProvider === 'claude' ? 'sonnet' : 'gpt-5.5',
    effort: 'high',
    permissionMode: hostMode ?? (hostProvider === 'claude' ? 'bypassPermissions' : 'ask'),
    ...(workers && { manages: 'git:/code/shop/.git' }),
  });
  const sent = [];
  const notices = [];
  const efforts = [];
  const invites = [];
  const conversations = {
    notice: (id, text) => notices.push({ id, text }),
    send: (id, message) => {
      sent.push({ id, ...message });
      return sendResult;
    },
    view: (contact) => ({ status: fs.existsSync(contact.cwd) ? 'online' : 'offline' }),
    // As Conversations has it: only a level the model takes is kept.
    setEffort: async (id, effort) => {
      efforts.push({ id, effort });
      if (effort !== 'nonsense') store.updateContact(id, { effort });
    },
    // As Conversations has them join: by service alone, or with a model, an effort level or a role.
    inviteNew: (id, fields) => void invites.push(['new', id, fields]),
    inviteAsked: async (id, asked) => {
      invites.push(['asked', id, asked]);
      return {
        id: 'g1',
        name: asked.role?.name ?? providers.descriptor(asked.provider).name,
        agent: '',
        already: false,
        starts: false,
      };
    },
  };
  const managers = {
    managerFor: ({ startedBy }) => startedBy,
    oversees: () => true,
    newWorkers: (contact) => (contact?.manages ? cleanWorkers(workers) : null),
  };
  const { startConversation } = registerIpc({
    store,
    providers,
    conversations,
    projects: new Projects({
      store,
      computerHome,
      worktreesHome: path.join(root, 'worktrees'),
      describe: async (cwd) => ({ key: `dir:${cwd}`, name: path.basename(cwd), root: cwd }),
    }),
    managers,
    runs: { setup: async () => {} },
    analytics: { counting: (_name, fn) => fn },
    broadcast() {},
    broadcastContacts() {},
    worktreesHome: path.join(root, 'worktrees'),
    computerHome,
    pathReady: Promise.resolve(),
  });
  const toolsFor = appTools({ store, startConversation, managers, agents: providers.list() });
  const starter = (speaker = host) => {
    const session = providers.createSession(speaker, () => {}, { conversation: host.id });
    return (session.appTools ?? session.tools).find((tool) => tool.name === APP_TOOLS.conversation);
  };
  const children = () => store.contacts.filter((contact) => contact.startedBy === host.id);
  /** A contact the user added, with a folder of its own that is there. */
  const added = (fields) =>
    store.addContact({ name: 'Mine', cwd: makeComputerFolder(computerHome), sessionId: null, ...fields });
  return { store, host, starter, children, sent, notices, efforts, invites, computerHome, added };
}

test(
  'Codex retries confirm one real worker before its first reply, preserving its permission mode',
  {
    ...opts,
    timeout: 5000,
  },
  async (t) => {
    const app = fixture(t, 'codex', {
      workers: { use: 'manager' },
      hostMode: 'read-only',
      // The worker has been sent its work, but has not answered it yet.
      sendResult: new Promise(() => {}),
    });
    const request = { prompt: 'Review the bug', asked_by_user: true, request_id: 'review-bug' };
    const original = app.starter().run(request);
    const retry = app.starter().run(request);
    const answer = await original;
    assert.equal(await retry, answer);
    assert.equal(await app.starter().run(request), answer);
    const [worker] = app.children();
    assert.equal(app.children().length, 1);
    assert.equal(worker.provider, 'codex');
    assert.equal(worker.permissionMode, 'read-only');
    assert.equal(worker.managedBy, app.host.id);
    assert.deepEqual(app.sent, [{ id: worker.id, text: request.prompt }]);
    assert.ok(answer.startsWith(`${worker.name} has started`));
  }
);

test(
  'Codex in a paused Claude manager conversation starts a Codex worker with its in-chat permissions, the same as the manager',
  opts,
  async (t) => {
    const app = fixture(t, 'claude', { workers: { use: 'manager' } });
    app.store.updateContact(app.host.id, { paused: true });
    const codex = app.store.addContact({
      name: 'Codex',
      provider: 'codex',
      cwd: '/some-other-project',
      model: 'gpt-5.5',
      effort: 'xhigh',
      permissionMode: 'full-access',
    });
    app.store.addGuest(app.host.id, { id: codex.id, permissionMode: 'read-only' });
    const answer = await app.starter(codex).run({
      prompt: 'Review the bug',
      asked_by_user: true,
      // Session identity is bound by the app, never chosen by tool input.
      speakerId: app.host.id,
    });
    const [worker] = app.children();
    assert.equal(worker.provider, 'codex');
    assert.match(worker.name, /^Codex /);
    assert.equal(worker.model, 'gpt-5.5');
    assert.equal(worker.effort, 'xhigh');
    assert.equal(worker.permissionMode, 'read-only');
    assert.equal(worker.managedBy, app.host.id);
    assert.equal(path.dirname(worker.cwd), app.computerHome);
    assert.notEqual(worker.cwd, app.host.cwd);
    assert.deepEqual(app.sent, [{ id: worker.id, text: 'Review the bug' }]);
    assert.match(answer, /^Codex /);
    assert.ok(answer.includes(`Conversation ID: ${worker.id}.`));
    assert.equal(app.store.getContact(app.host.id).paused, true);
  }
);

test(
  'a solo Codex manager the same as the manager passes its own settings and leaves an unrequested task as a draft',
  opts,
  async (t) => {
    const app = fixture(t, 'codex', { workers: { use: 'manager' } });
    await app.starter().run({ prompt: 'Review later' });
    const [worker] = app.children();
    assert.equal(worker.provider, 'codex');
    assert.equal(worker.model, app.host.model);
    assert.equal(worker.effort, app.host.effort);
    assert.equal(worker.permissionMode, app.host.permissionMode);
    assert.equal(worker.draft, 'Review later');
    assert.deepEqual(app.sent, []);
  }
);

for (const hostProvider of ['claude', 'codex']) {
  const name = hostProvider === 'claude' ? 'Claude' : 'Codex';

  test(`a ${name} manager starts its workers with your defaults, never its own model and mode`, opts, async (t) => {
    const app = fixture(t, hostProvider, {
      workers: { use: 'defaults' },
      hostMode: hostProvider === 'claude' ? 'bypassPermissions' : 'full-access',
    });
    app.added({ provider: 'codex', model: 'gpt-5.5', effort: 'medium', permissionMode: 'ask' });
    app.added({ provider: 'claude', model: 'opus', effort: 'xhigh', permissionMode: 'bypassPermissions' });
    await app.starter().run({ prompt: 'Build the tags page', asked_by_user: true });
    const [worker] = app.children();
    assert.deepEqual(
      [worker.provider, worker.model, worker.effort, worker.permissionMode],
      ['claude', 'opus', 'xhigh', 'default']
    );
    assert.match(worker.name, /^Claude /);
    assert.deepEqual(app.sent, [{ id: worker.id, text: 'Build the tags page' }]);
  });

  test(`a ${name} manager starts its workers on a service and model you pick, in its own mode`, opts, async (t) => {
    const app = fixture(t, hostProvider, {
      workers: { use: 'picked', provider: 'codex', model: 'gpt-5.5', effort: 'xhigh' },
    });
    await app.starter().run({ prompt: 'Build the tags page', asked_by_user: true });
    const [worker] = app.children();
    assert.deepEqual(
      [worker.provider, worker.model, worker.effort, worker.permissionMode],
      ['codex', 'gpt-5.5', 'xhigh', 'ask']
    );
    assert.match(worker.name, /^Codex /);
    assert.deepEqual(app.efforts, [{ id: worker.id, effort: 'xhigh' }], 'set as Add a Contact sets one picked');
  });

  test(`a ${name} manager the same as the manager starts its own worker`, opts, async (t) => {
    const app = fixture(t, hostProvider, { workers: { use: 'manager' } });
    app.added({ provider: 'gemini', model: '', permissionMode: 'default' });
    await app.starter().run({ prompt: 'Build the tags page', asked_by_user: true });
    const [worker] = app.children();
    assert.deepEqual(
      [worker.provider, worker.model, worker.effort, worker.permissionMode],
      [app.host.provider, app.host.model, app.host.effort, app.host.permissionMode]
    );
  });
}

test('your defaults leave out managers, conversations agents started, and ones put away or gone', opts, async (t) => {
  const app = fixture(t, 'claude', { workers: { use: 'defaults' } });
  const mine = app.added({ provider: 'codex', model: 'gpt-5.5', effort: 'low', permissionMode: 'full-access' });
  app.added({ provider: 'claude', model: 'haiku', permissionMode: 'default', manages: 'git:/code/other/.git' });
  app.added({ provider: 'claude', model: 'haiku', permissionMode: 'default', startedBy: mine.id });
  const away = app.added({ provider: 'claude', model: 'haiku', permissionMode: 'default' });
  app.store.updateContact(away.id, { archived: true });
  app.added({ provider: 'claude', model: 'haiku', permissionMode: 'default', cwd: '/gone/away' });
  await app.starter().run({ prompt: 'Work', asked_by_user: true });
  const [worker] = app.children();
  assert.deepEqual(
    [worker.provider, worker.model, worker.effort, worker.permissionMode],
    ['codex', 'gpt-5.5', 'low', 'ask']
  );
});

test('a guest made for one conversation, added last, is not your defaults', opts, async (t) => {
  const app = fixture(t, 'claude', { workers: { use: 'defaults' } });
  app.added({ provider: 'claude', model: 'opus', effort: 'high', permissionMode: 'acceptEdits' });
  // As Invite > New makes one: unlisted, a contact of that conversation alone.
  const other = app.added({ provider: 'claude', model: 'haiku', permissionMode: 'default' });
  app.added({ provider: 'codex', model: 'gpt-5.5', effort: 'xhigh', permissionMode: 'read-only', guestOf: other.id });
  await app.starter().run({ prompt: 'Work', asked_by_user: true });
  const [worker] = app.children();
  assert.deepEqual([worker.provider, worker.model], ['claude', 'haiku']);
});

test('with nobody of yours to start like, a manager’s worker is the first service as it is', opts, async (t) => {
  const app = fixture(t, 'codex', { workers: { use: 'defaults' } });
  await app.starter().run({ prompt: 'Work', asked_by_user: true });
  const [worker] = app.children();
  assert.deepEqual(
    [worker.provider, worker.model, worker.effort ?? null, worker.permissionMode],
    ['claude', '', null, 'default']
  );
});

test('a guest in a manager’s conversation starts workers with your defaults too', opts, async (t) => {
  const app = fixture(t, 'claude', { workers: { use: 'defaults' } });
  app.added({ provider: 'claude', model: 'opus', permissionMode: 'acceptEdits' });
  const codex = app.store.addContact({
    name: 'Codex',
    provider: 'codex',
    cwd: '/x',
    model: 'gpt-5.5',
    permissionMode: 'full-access',
  });
  app.store.addGuest(app.host.id, { id: codex.id, permissionMode: 'full-access' });
  await app.starter(codex).run({ prompt: 'Work', asked_by_user: true });
  const [worker] = app.children();
  assert.deepEqual([worker.provider, worker.model, worker.permissionMode], ['claude', 'opus', 'default']);
});

test(
  'a worker a guest starts in a manager’s conversation is the manager’s, and says who started it',
  opts,
  async (t) => {
    const app = fixture(t, 'claude', { workers: { use: 'manager' } });
    const codex = app.store.addContact({ name: 'Codex', provider: 'codex', cwd: '/x', model: '' });
    app.store.addGuest(app.host.id, { id: codex.id, permissionMode: 'read-only' });
    await app.starter(codex).run({ prompt: 'Fix the cart total', asked_by_user: true });
    const [worker] = app.children();
    assert.deepEqual([worker.startedBy, worker.managedBy], [app.host.id, app.host.id]);
    assert.deepEqual(
      app.notices.filter(({ id }) => id === worker.id).map(({ text }) => text),
      ['Codex started this conversation from Manager.']
    );
    assert.deepEqual(
      app.sent.map(({ id, text }) => [id, text]),
      [[worker.id, 'Fix the cart total']]
    );
  }
);

test('a guest’s worker is never looser than a read-only manager, the same as the manager', opts, async (t) => {
  const app = fixture(t, 'claude', { workers: { use: 'manager' }, hostMode: 'plan' });
  const codex = app.store.addContact({
    name: 'Codex',
    provider: 'codex',
    cwd: '/x',
    model: 'gpt-5.5',
    permissionMode: 'full-access',
  });
  app.store.addGuest(app.host.id, { id: codex.id, permissionMode: 'full-access' });
  await app.starter(codex).run({ prompt: 'Work', asked_by_user: true });
  const [worker] = app.children();
  assert.deepEqual([worker.provider, worker.permissionMode], ['codex', 'read-only']);
});

test('a level picked that the model doesn’t take is left to the model', opts, async (t) => {
  const app = fixture(t, 'claude', {
    workers: { use: 'picked', provider: 'claude', model: 'opus', effort: 'nonsense' },
  });
  await app.starter().run({ prompt: 'Work', asked_by_user: true });
  const [worker] = app.children();
  assert.equal(worker.effort ?? null, null);
});

test('a contact that is no manager still starts ones like the agent that starts them', opts, async (t) => {
  const app = fixture(t, 'claude');
  app.added({ provider: 'codex', model: 'gpt-5.5', permissionMode: 'ask' });
  await app.starter().run({ prompt: 'Work', asked_by_user: true });
  const [worker] = app.children();
  assert.deepEqual(
    [worker.provider, worker.model, worker.effort, worker.permissionMode],
    ['claude', 'sonnet', 'high', 'bypassPermissions']
  );
});

const TESTER = {
  id: 'tester',
  name: 'Tester',
  provider: 'codex',
  model: '',
  effort: '',
  answers: 'always',
  readOnly: false,
  rules: 'Run the tests.',
};

test('agents in a new conversation join with the model, effort level and role asked for', opts, async (t) => {
  const app = fixture(t, 'claude');
  app.store.updateSettings({ roles: [TESTER] });
  const answer = await app.starter().run({
    prompt: 'Build it',
    asked_by_user: true,
    invite: [
      'codex',
      { service: 'claude', model: 'opus', effort: 'high' },
      { service: 'codex', role: 'tester' },
      { service: 'gemini', role: 'Designer' },
    ],
  });
  const [worker] = app.children();
  assert.deepEqual(app.invites, [
    ['new', worker.id, { provider: 'codex' }],
    ['asked', worker.id, { provider: 'claude', model: 'opus', effort: 'high', role: null }],
    ['asked', worker.id, { provider: 'codex', model: '', effort: '', role: TESTER }],
  ]);
  assert.deepEqual(app.notices.at(-1), {
    id: worker.id,
    text: 'Gemini could not join: There is no role called “Designer” in Settings > Roles & teams. These are: Tester.',
  });
  assert.match(answer, /with Codex, Claude and Tester in it\./);
  assert.match(answer, /Not every agent you asked for could join/);
});

test('a role an agent invites into a new conversation brings the mode picked for it', opts, async (t) => {
  const app = fixture(t, 'claude');
  app.store.updateSettings({ roles: [{ ...TESTER, permissionMode: 'full-access' }] });
  await app.starter().run({ prompt: 'Build it', asked_by_user: true, invite: [{ service: 'codex', role: 'Tester' }] });
  const [[, , asked]] = app.invites;
  assert.equal(asked.role.permissionMode, 'full-access');
});

test('a stale guest tool cannot create a worker after the guest leaves the conversation', opts, async (t) => {
  const app = fixture(t);
  const codex = app.store.addContact({ name: 'Codex', provider: 'codex', cwd: app.host.cwd, model: '' });
  app.store.addGuest(app.host.id, { id: codex.id, permissionMode: 'ask' });
  const tool = app.starter(codex);
  app.store.updateContact(app.host.id, { guests: [] });
  const before = fs.readdirSync(app.computerHome);
  await assert.rejects(tool.run({ prompt: 'Work', asked_by_user: true }), /no longer in this conversation/);
  assert.deepEqual(app.children(), []);
  assert.deepEqual(fs.readdirSync(app.computerHome), before);
});

for (const demo of [false, true]) {
  test(`every ${demo ? 'scripted' : 'real'} provider binds app tools to the speaking agent`, () => {
    const asked = [];
    const providers = createProviders({
      app: { isPackaged: false },
      demo,
      tools: (conversation, speaker) => {
        asked.push({ conversation, speaker });
        return [];
      },
    });
    for (const provider of providers.list()) {
      providers.createSession({ id: provider.id, provider: provider.id, cwd: '/tmp', model: '' }, () => {}, {
        conversation: 'host',
      });
    }
    assert.deepEqual(
      asked,
      providers.list().map(({ id }) => ({ conversation: 'host', speaker: id }))
    );
  });
}

test(
  'a conversation drafted for the user says it was drafted, and one started at once that it was started',
  opts,
  async (t) => {
    const app = fixture(t, 'claude', { workers: { use: 'manager' } });
    await app.starter().run({ prompt: 'Round the cart total', asked_by_user: false });
    await app.starter().run({ prompt: 'Fix the coupon code', asked_by_user: true });
    const [drafted, started] = app.children();
    assert.equal(drafted.draft, 'Round the cart total');
    const said = (worker) => app.notices.filter(({ id }) => id === worker.id).map(({ text }) => text);
    assert.deepEqual(said(drafted), ['Manager drafted this conversation.']);
    assert.deepEqual(said(started), ['Manager started this conversation.']);
    // Nothing is sent for the one it drafted: it waits for the user.
    assert.deepEqual(
      app.sent.map(({ id }) => id),
      [started.id]
    );
  }
);

test('a worker a guest drafts in a manager’s conversation says who drafted it, and where', opts, async (t) => {
  const app = fixture(t, 'claude', { workers: { use: 'manager' } });
  const codex = app.store.addContact({ name: 'Codex', provider: 'codex', cwd: '/x', model: '' });
  app.store.addGuest(app.host.id, { id: codex.id, permissionMode: 'read-only' });
  await app.starter(codex).run({ prompt: 'Round the cart total', asked_by_user: false });
  const [worker] = app.children();
  assert.deepEqual(
    app.notices.filter(({ id }) => id === worker.id).map(({ text }) => text),
    ['Codex drafted this conversation from Manager.']
  );
});
