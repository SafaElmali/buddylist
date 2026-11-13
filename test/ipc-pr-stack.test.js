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
// The Checks tab's gh calls, noted; which pull request it may ask about is the real stackPage's to say.
const checksLoader = `data:text/javascript,${encodeURIComponent(`
  export { stackPage } from ${JSON.stringify(new URL('../src/main/checks.js', import.meta.url).href)};
  export const asked = [];
  export async function pullRequestChecks(cwd, asking) { asked.push(['list', cwd, asking.page]); return { pullRequest: true, checks: [] }; }
  export async function rerunFailedChecks(cwd, asking) { asked.push(['rerun', cwd, asking.page]); return 1; }
`)}`;
let registerIpc;
let handlers;
let calls;
let checksAsked;
if (module.registerHooks) {
  const hook = module.registerHooks({
    resolve(name, context, next) {
      if (name === 'electron') return { url: electron, shortCircuit: true };
      if (name === './pr-stack.js' && context.parentURL?.endsWith('/main/ipc.js'))
        return { url: loader, shortCircuit: true };
      if (name === './checks.js' && context.parentURL?.endsWith('/main/ipc.js'))
        return { url: checksLoader, shortCircuit: true };
      return next(name, context);
    },
  });
  try {
    ({ registerIpc } = await import('../src/main/ipc.js'));
    ({ handlers } = await import(electron));
    ({ calls } = await import(loader));
    ({ asked: checksAsked } = await import(checksLoader));
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

test(
  'the Checks tab asks about another PR of the stack only in the repository of the folder’s own',
  { skip: !registerIpc },
  async () => {
    const own = { url: 'https://github.com/o/r/pull/48213', number: 48213, state: 'open' };
    const systemVersion = process.getSystemVersion;
    process.getSystemVersion = () => 'test';
    try {
      registerIpc({
        store: { getContact: (id) => (id === 'contact' ? { cwd: '/verified-checkout' } : null) },
        pullRequests: { of: () => own, look: async () => own, lookSoon() {} },
        analytics: { counting: (_name, fn) => fn },
        pathReady: Promise.resolve(),
      });
    } finally {
      if (systemVersion) process.getSystemVersion = systemVersion;
      else delete process.getSystemVersion;
    }
    const list = handlers.get(REQUESTS.checksList);
    const rerun = handlers.get(REQUESTS.checksRerun);
    await list({}, 'contact');
    await list({}, 'contact', 'https://github.com/o/r/pull/48212');
    await rerun({}, 'contact', 'https://github.com/o/r/pull/48212');
    assert.deepEqual(checksAsked, [
      ['list', '/verified-checkout', null],
      ['list', '/verified-checkout', 'https://github.com/o/r/pull/48212'],
      ['rerun', '/verified-checkout', 'https://github.com/o/r/pull/48212'],
    ]);
    for (const url of ['https://github.com/someone/else/pull/1', 'https://evil.example/o/r/pull/1', 'file:///etc']) {
      await assert.rejects(list({}, 'contact', url), /not in this conversation’s repository/);
      await assert.rejects(rerun({}, 'contact', url), /not in this conversation’s repository/);
    }
    assert.equal(checksAsked.length, 3, 'gh was asked nothing about any other');
  }
);
