import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Analytics } from '../src/main/analytics.js';
import { Store } from '../src/main/storage/store.js';
import { REQUESTS } from '../src/shared/ipc-channels.js';

// What ipc.js counts itself, where it happens, through the real handlers and without Electron's windows.
const electron = `data:text/javascript,${encodeURIComponent(`
  export const handlers = new Map();
  export const ipcMain = { handle: (name, fn) => handlers.set(name, fn), on() {} };
  export const app = { getVersion: () => '0.0.0' };
  export const nativeTheme = { on() {} };
  export const BrowserWindow = { fromWebContents: () => null, getAllWindows: () => [] };
  export const dialog = {}, nativeImage = {}, screen = {}, shell = {};
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

function fixture(t, providerIds = []) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cm-ipc-counts-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store(path.join(root, 'data'), { defaultProvider: 'claude' });
  const contact = store.addContact({ provider: 'claude', name: 'Claude (shop)', cwd: root });
  const posts = [];
  const analytics = new Analytics({
    store,
    enabled: true,
    about: {},
    key: 'phc_test',
    host: 'https://posthog.example',
    fetch: async (_url, request) => {
      posts.push(JSON.parse(request.body));
      return new Response('{"status":1}');
    },
  });
  const systemVersion = process.getSystemVersion;
  process.getSystemVersion = () => 'test';
  try {
    registerIpc({
      store,
      providers: {
        list: () => providerIds.map((id) => ({ id })),
        descriptor: () => ({ id: 'claude', name: 'Claude' }),
      },
      conversations: {
        view: () => ({ status: 'online' }),
        send: () => ({ id: 'e1', editable: true }),
        presenceChanged() {},
      },
      chats: { send() {} },
      // Quick send is open on the contact: it hands over what was typed.
      quickSend: { send: (_win, text, deliver) => deliver(contact.id, text) },
      errorReports: { setEnabled() {} },
      listening: { setEnabled() {} },
      // The shortcuts from any app are the system's: there is none to register here.
      shortcuts: { apply() {} },
      analytics,
      broadcast() {},
      pathReady: Promise.resolve(),
    });
  } finally {
    if (systemVersion) process.getSystemVersion = systemVersion;
    else delete process.getSystemVersion;
  }
  const invoke = (channel, ...args) => handlers.get(channel)({ sender: {} }, ...args);
  const counted = async () => {
    await analytics.flush();
    return posts.flatMap((post) => post.batch);
  };
  return { invoke, counted };
}

test('the maximize setting saves through IPC and counts only its on/off value', opts, async (t) => {
  const { invoke, counted } = fixture(t);
  for (const on of [true, true, false]) {
    const settings = await invoke(REQUESTS.settingsUpdate, { openWindowsMaximized: on });
    assert.equal(settings.openWindowsMaximized, on);
  }
  const counts = (await counted()).filter((count) => count.event === 'setting changed');
  assert.deepEqual(
    counts.map(({ properties: { setting, on } }) => ({ setting, on })),
    [
      { setting: 'openWindowsMaximized', on: true },
      { setting: 'openWindowsMaximized', on: false },
    ]
  );
});

test('a message from Quick send is counted as a message sent, and says it came from there', opts, async (t) => {
  const { invoke, counted } = fixture(t);
  await invoke(REQUESTS.quickSendSend, 'the secret plan');

  const [count, ...more] = await counted();
  assert.deepEqual(more, []);
  assert.equal(count.event, 'message sent');
  assert.equal(count.properties.provider, 'claude');
  assert.equal(count.properties.agents, 1);
  assert.equal(count.properties.from, 'quick send');
  assert.ok(!JSON.stringify(count).includes('secret'));
});

test(
  'a change of settings counts what it changed: your contacts shown or hidden, a setting, and no drag of the list',
  opts,
  async (t) => {
    const { invoke, counted } = fixture(t);
    await invoke(REQUESTS.settingsUpdate, { contactsPane: { shown: false } });
    await invoke(REQUESTS.settingsUpdate, { contactsPane: { shown: false } });
    await invoke(REQUESTS.settingsUpdate, { contactsPane: { width: 300 } });
    await invoke(REQUESTS.settingsUpdate, { contactsPane: { shown: true } });
    await invoke(REQUESTS.settingsUpdate, { sounds: false });
    await invoke(REQUESTS.settingsUpdate, { sounds: false });
    await invoke(REQUESTS.settingsUpdate, { branchPrefix: 'secret/' });

    const counts = await counted();
    assert.deepEqual(
      counts.map(({ event, properties: { shown, setting, on } }) => [event, shown ?? setting, on]),
      [
        ['contacts pane toggled', false, undefined],
        ['contacts pane toggled', true, undefined],
        ['setting changed', 'sounds', false],
        ['setting changed', 'branchPrefix', undefined],
      ]
    );
    assert.ok(!JSON.stringify(counts).includes('secret'));
  }
);

test('saving fallback settings counts only the changed, accepted rule and returning to manual', opts, async (t) => {
  const { invoke, counted } = fixture(t, ['claude', 'codex']);
  await invoke(REQUESTS.settingsUpdate, { limitFallbacks: { claude: 'codex', 'Secret project': 'codex' } });
  await invoke(REQUESTS.settingsUpdate, { limitFallbacks: { claude: 'codex' } });
  await invoke(REQUESTS.settingsUpdate, { limitFallbacks: {} });
  await invoke(REQUESTS.settingsUpdate, { limitFallbacks: { claude: 'Secret account' } });
  const counts = await counted();
  assert.deepEqual(
    counts.map(({ event, properties: { setting, provider, fallback } }) => [event, setting, provider, fallback]),
    [
      ['setting changed', 'limitFallbacks', 'claude', 'codex'],
      ['setting changed', 'limitFallbacks', 'claude', 'manual'],
    ]
  );
  assert.ok(!JSON.stringify(counts).includes('Secret'));
});
