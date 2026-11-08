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

test(
  'inviting a new agent passes its selected permissions through IPC with the other invite fields',
  {
    skip: !registerIpc,
  },
  async () => {
    const calls = [];
    const systemVersion = process.getSystemVersion;
    process.getSystemVersion = () => 'test';
    try {
      registerIpc({
        conversations: {
          inviteNew: (...args) => {
            calls.push(args);
            return [{ id: 'guest' }];
          },
        },
        analytics: { counting: (_name, fn) => fn },
        pathReady: Promise.resolve(),
      });
    } finally {
      if (systemVersion) process.getSystemVersion = systemVersion;
      else delete process.getSystemVersion;
    }
    const fields = {
      provider: 'codex',
      name: 'Reviewer',
      model: 'gpt-6-sol',
      effort: 'high',
      permissionMode: 'auto',
      listed: true,
    };
    const result = await handlers.get(REQUESTS.chatInviteNew)({}, 'host', {
      ...fields,
      cwd: '/untrusted-folder',
    });
    assert.deepEqual(calls, [['host', fields]]);
    assert.deepEqual(result, [{ id: 'guest' }]);
  }
);
