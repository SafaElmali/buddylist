import { test } from 'node:test';
import assert from 'node:assert/strict';
import module from 'node:module';
import { REQUESTS } from '../src/shared/ipc-channels.js';

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

/** The app's requests, with a PATH that only has Codex once the login shell has been asked again. */
function fixture() {
  const steps = [];
  let installed = false;
  const systemVersion = process.getSystemVersion;
  process.getSystemVersion = () => 'test';
  try {
    registerIpc({
      store: { settings: {} },
      providers: {
        list: () => [{ id: 'codex', name: 'Codex' }],
        descriptor: (id) => ({ id }),
        setup: async (id) => {
          steps.push(`check ${id}`);
          return installed
            ? { state: 'ready', note: '', path: '/opt/homebrew/bin/codex' }
            : { state: 'missing', note: '' };
        },
      },
      analytics: { counting: (_name, fn) => fn },
      demo: true,
      pathReady: Promise.resolve(),
      reloadPath: async () => {
        steps.push('reload PATH');
        installed = true;
      },
    });
  } finally {
    if (systemVersion) process.getSystemVersion = systemVersion;
    else delete process.getSystemVersion;
  }
  return { steps };
}

test(
  'Settings’ Check again asks where programs are before it checks, and its first check does not',
  { skip: !registerIpc },
  async () => {
    const { steps } = fixture();
    const status = handlers.get(REQUESTS.agentStatus);
    assert.equal((await status({}, 'codex')).state, 'missing');
    assert.deepEqual(steps, ['check codex']);

    const again = await status({}, 'codex', true);
    assert.deepEqual(steps, ['check codex', 'reload PATH', 'check codex']);
    assert.deepEqual(again, { state: 'ready', note: '', path: '/opt/homebrew/bin/codex', custom: false });
  }
);

test(
  'the welcome wizard’s Check again asks where programs are before it checks every CLI',
  { skip: !registerIpc },
  async () => {
    const { steps } = fixture();
    const setup = handlers.get(REQUESTS.onboardingSetup);
    const codex = async (...args) => (await setup({}, ...args)).find((item) => item.id === 'codex');
    assert.equal((await codex()).state, 'missing');
    // Only a true Check again: anything else a window sends along is not one.
    assert.equal((await codex('yes')).state, 'missing');
    assert.deepEqual(steps, ['check codex', 'check codex']);

    assert.equal((await codex(true)).state, 'ready');
    assert.deepEqual(steps, ['check codex', 'check codex', 'reload PATH', 'check codex']);
  }
);
