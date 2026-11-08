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
const loader = `data:text/javascript,${encodeURIComponent(`
  export const calls = [];
  export async function pullRequestStack(cwd, options) { calls.push({ cwd, options }); return { current: options.known?.url ?? null }; }
`)}`;
let registerIpc;
let handlers;
let calls;
if (module.registerHooks) {
  const hook = module.registerHooks({
    resolve(name, context, next) {
      if (name === 'electron') return { url: electron, shortCircuit: true };
      if (name === './pr-stack.js' && context.parentURL?.endsWith('/main/ipc.js'))
        return { url: loader, shortCircuit: true };
      return next(name, context);
    },
  });
  try {
    ({ registerIpc } = await import('../src/main/ipc.js'));
    ({ handlers } = await import(electron));
    ({ calls } = await import(loader));
  } finally {
    hook.deregister();
  }
}

test(
  'PR stack IPC uses only the verified contact folder and PR, after PATH is ready',
  { skip: !registerIpc },
  async () => {
    const known = { url: 'https://github.com/o/r/pull/42', number: 42, state: 'merged' };
    const looked = [];
    let ready;
    const systemVersion = process.getSystemVersion;
    process.getSystemVersion = () => 'test';
    try {
      registerIpc({
        store: { getContact: (id) => (id === 'contact' ? { cwd: '/verified-checkout' } : null) },
        pullRequests: {
          look: async (cwd) => {
            looked.push(cwd);
            return known;
          },
        },
        analytics: { counting: (_name, fn) => fn },
        pathReady: new Promise((resolve) => {
          ready = resolve;
        }),
      });
    } finally {
      if (systemVersion) process.getSystemVersion = systemVersion;
      else delete process.getSystemVersion;
    }
    const invoke = handlers.get(REQUESTS.contactPrStack);
    const pending = invoke({}, 'contact', { cwd: '/attacker', known: { url: 'https://other/r/pull/1' } });
    assert.deepEqual(looked, []);
    ready();
    assert.deepEqual(await pending, { current: known.url });
    assert.deepEqual(looked, ['/verified-checkout']);
    assert.deepEqual(calls, [{ cwd: '/verified-checkout', options: { known } }]);
    await assert.rejects(invoke({}, 'missing'), /no longer exists/);
    assert.equal(calls.length, 1);
  }
);
