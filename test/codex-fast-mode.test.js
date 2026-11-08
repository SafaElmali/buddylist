import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CodexSession } from '../src/providers/codex/session.js';
import { listCodexModels } from '../src/providers/codex/models.js';
import { descriptor } from '../src/providers/codex/descriptor.js';
import { modelsFor } from '../src/renderer/chat/models.js';
import { MODELS_MAX_AGE_MS } from '../src/shared/models.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const MODEL = {
  id: 'gpt-demo',
  model: 'gpt-demo',
  displayName: 'Demo model',
  isDefault: true,
  supportedReasoningEfforts: [{ reasoningEffort: 'high' }],
  defaultReasoningEffort: 'high',
  serviceTiers: [{ id: 'priority', name: 'Fast', description: '2x speed, increased usage' }],
};
const STANDARD = { ...MODEL, id: 'standard', model: 'standard', isDefault: false, serviceTiers: [] };

function server({ models = [MODEL, STANDARD], enabled = true, requirements = null, overrides = {} } = {}) {
  const sent = [];
  const hooks = [];
  let turn = 0;
  const replies = {
    initialize: () => ({}),
    'model/list': () => ({ data: models }),
    'experimentalFeature/list': () => ({ data: [{ name: 'fast_mode', enabled }] }),
    'configRequirements/read': () => ({ requirements }),
    'thread/start': (params) => ({
      thread: { id: 'thread-demo' },
      model: params.model || MODEL.model,
      serviceTier: params.serviceTier ?? 'default',
    }),
    'thread/resume': (params) => ({
      thread: { id: params.threadId },
      model: params.model || MODEL.model,
      serviceTier: params.serviceTier ?? 'default',
    }),
    'skills/list': () => ({ data: [] }),
    'turn/start': () => ({ turn: { id: `turn-${++turn}` } }),
    'turn/interrupt': () => ({}),
    ...overrides,
  };
  return {
    sent,
    hooks,
    connect: (handlers) => {
      hooks.push(handlers);
      return {
        request: async (method, params) => {
          sent.push({ method, params });
          if (!replies[method]) throw new Error('Unknown method');
          return replies[method](params);
        },
        notify() {},
        close() {},
      };
    },
    params: (method) => sent.filter((request) => request.method === method).map((request) => request.params),
    complete: (status = 'completed') =>
      hooks.at(-1).onNotification('turn/completed', {
        threadId: 'thread-demo',
        turn: { id: `turn-${turn}`, status, error: null },
      }),
  };
}

async function start(t, contact = {}, options) {
  const rpc = server(options);
  const events = [];
  const saved = { cwd: '/tmp/demo-project', model: MODEL.model, permissionMode: 'ask', ...contact };
  const session = new CodexSession({ contact: saved, connect: rpc.connect, emit: (event) => events.push(event) });
  t.after(() => session.close());
  session.send({ text: 'Synthetic demo message' });
  await tick();
  return { rpc, session, saved, events };
}

test('Codex advertises Fast only from an allowed priority service tier, with its usage description', async () => {
  const rpc = server();
  const models = await listCodexModels({ command: 'fake-codex', connect: rpc.connect });
  assert.equal(models[0].fast, true);
  assert.equal(models[0].fastDescription, '2x speed, increased usage');
  assert.deepEqual(models[0].efforts, ['high'], 'speed never substitutes a lower reasoning effort');
  assert.equal(models[1].fast, undefined);
  assert.match(models[1].fastUnavailable, /does not offer/);
  assert.equal(
    rpc.sent.some(({ method }) => method.startsWith('thread/')),
    false
  );
});

test('old metadata, unknown tiers and unknown feature availability never promise Fast', async () => {
  for (const model of [
    { ...MODEL, serviceTiers: undefined, additionalSpeedTiers: ['fast'] },
    { ...MODEL, serviceTiers: [{ id: 'ultrafast', name: 'Ultrafast' }] },
  ]) {
    const rpc = server({ models: [model] });
    const [listed] = await listCodexModels({ command: 'fake-codex', connect: rpc.connect });
    assert.equal(listed.fast, undefined);
    assert.ok(listed.fastUnavailable);
  }
  const rpc = server({
    overrides: {
      'experimentalFeature/list': () => {
        throw new Error('Not supported');
      },
    },
  });
  const [listed] = await listCodexModels({ command: 'fake-codex', connect: rpc.connect });
  assert.match(listed.fastUnavailable, /could not confirm/);
  assert.equal(listed.fast, false);
});

test('Codex settings and managed policy can disable the advertised Fast tier', async () => {
  for (const [options, reason] of [
    [{ enabled: false }, /Codex settings/],
    [{ requirements: { featureRequirements: { fast_mode: false } } }, /organization/],
  ]) {
    const rpc = server(options);
    const [model] = await listCodexModels({ command: 'fake-codex', connect: rpc.connect });
    assert.equal(model.fast, false);
    assert.match(model.fastUnavailable, reason);
  }
});

for (const sessionId of [undefined, 'thread-demo']) {
  for (const fastMode of [undefined, true, false]) {
    test(`Codex ${sessionId ? 'resumes' : 'starts'} with deliberate speed ${fastMode} and preserves reasoning`, async (t) => {
      const { rpc, events } = await start(t, { sessionId, fastMode, effort: 'high' });
      const thread = rpc.params(sessionId ? 'thread/resume' : 'thread/start')[0];
      const turn = rpc.params('turn/start')[0];
      const expected = fastMode === true ? 'priority' : fastMode === false ? null : undefined;
      for (const request of [thread, turn]) {
        assert.equal(request.serviceTier, expected);
        assert.equal(Object.hasOwn(request, 'serviceTier'), fastMode !== undefined);
      }
      assert.equal(turn.effort, 'high');
      assert.equal(turn.approvalPolicy, 'untrusted');
      assert.equal(events.find((event) => event.type === 'ready').models[0].fast, true);
    });
  }
}

test('toggling Fast off explicitly clears the tier on the next turn and after session recreation', async (t) => {
  const { rpc, session, saved } = await start(t, { fastMode: true });
  rpc.complete();
  await session.setFastMode(false);
  session.send({ text: 'Standard speed now' });
  await tick();
  assert.equal(rpc.params('turn/start').at(-1).serviceTier, null);
  const restarted = await start(t, { ...JSON.parse(JSON.stringify(saved)), sessionId: 'thread-demo' });
  assert.equal(restarted.rpc.params('thread/resume')[0].serviceTier, null);
  assert.equal(restarted.rpc.params('turn/start')[0].serviceTier, null);
});

test('a saved Fast choice is suspended on unsupported or unknown models and restored on a supported model', async (t) => {
  const { rpc, session } = await start(t, { fastMode: true });
  for (const model of ['standard', 'custom-unknown', MODEL.model]) {
    rpc.complete();
    await session.setModel(model);
    session.send({ text: 'Next synthetic message' });
    await tick();
    assert.equal(rpc.params('turn/start').at(-1).serviceTier, model === MODEL.model ? 'priority' : null);
  }
});

test('an old Codex remains usable but never receives a guessed speed field', async (t) => {
  const { rpc, events } = await start(t, { fastMode: true }, { models: [{ ...MODEL, serviceTiers: undefined }] });
  assert.equal(Object.hasOwn(rpc.params('thread/start')[0], 'serviceTier'), false);
  assert.equal(Object.hasOwn(rpc.params('turn/start')[0], 'serviceTier'), false);
  assert.match(events.find((event) => event.type === 'notice').text, /cannot confirm the saved speed setting/);
});

test('thread-local feature policy blocks Fast before a model turn and is reported to the controls', async (t) => {
  const { rpc, events } = await start(
    t,
    { fastMode: true },
    {
      overrides: {
        'experimentalFeature/list': ({ threadId }) => ({ data: [{ name: 'fast_mode', enabled: !threadId }] }),
      },
    }
  );
  assert.equal(rpc.params('turn/start')[0].serviceTier, null);
  const model = events.find((event) => event.type === 'ready').models[0];
  assert.equal(model.fast, false);
  assert.match(model.fastUnavailable, /Codex settings/);
});

test('a loaded thread can allow Fast when the global default disables the controls', async (t) => {
  const { rpc, events } = await start(
    t,
    { fastMode: true },
    {
      overrides: {
        'experimentalFeature/list': ({ threadId }) => ({ data: [{ name: 'fast_mode', enabled: Boolean(threadId) }] }),
      },
    }
  );
  assert.equal(rpc.params('thread/start')[0].serviceTier, null);
  assert.equal(rpc.params('turn/start')[0].serviceTier, 'priority');
  assert.equal(events.find((event) => event.type === 'ready').models[0].fast, true);
});

test('cancelled-runtime recovery rechecks capabilities and resumes the deliberate tier', async (t) => {
  const { rpc, session } = await start(t, { fastMode: true });
  await session.interrupt();
  rpc.complete('interrupted');
  session.send({ text: 'A fresh runtime' });
  await tick();
  assert.equal(rpc.hooks.length, 2);
  assert.equal(rpc.params('model/list').length, 2);
  assert.equal(rpc.params('thread/resume')[0].serviceTier, 'priority');
  assert.equal(rpc.params('turn/start').at(-1).serviceTier, 'priority');
});

test('Fast does not grant write access to managers or read-only guests', async (t) => {
  const { rpc } = await start(t, { fastMode: true, readOnly: true, permissionMode: 'full-access' });
  assert.equal(rpc.params('thread/start')[0].sandbox, 'read-only');
  const turn = rpc.params('turn/start')[0];
  assert.equal(turn.serviceTier, 'priority');
  assert.equal(turn.approvalPolicy, 'never');
  assert.deepEqual(turn.sandboxPolicy, { type: 'readOnly', networkAccess: true });
});

test('an inherited tier is reported from Codex without writing a deliberate preference', async (t) => {
  const { rpc, saved, events } = await start(
    t,
    {},
    {
      overrides: {
        'thread/start': () => ({ thread: { id: 'thread-demo' }, model: MODEL.model, serviceTier: 'priority' }),
      },
    }
  );
  assert.equal(saved.fastMode, undefined);
  assert.equal(Object.hasOwn(rpc.params('turn/start')[0], 'serviceTier'), false);
  assert.deepEqual(events.find((event) => event.type === 'ready').fastMode, { state: 'on' });
});

test('Default waits for the actual configured model before applying Fast, not the catalog default', async (t) => {
  for (const model of [MODEL.model, 'standard', 'unknown-from-config']) {
    const { rpc } = await start(
      t,
      { model: '', fastMode: true },
      {
        overrides: { 'thread/start': () => ({ thread: { id: 'thread-demo' }, model, serviceTier: 'default' }) },
      }
    );
    assert.equal(rpc.params('thread/start')[0].serviceTier, null);
    assert.equal(rpc.params('turn/start')[0].serviceTier, model === MODEL.model ? 'priority' : null);
  }
});

test('reconnect replaces stale capabilities when the current CLI can no longer report them', async (t) => {
  let broken = false;
  const { rpc, session, events } = await start(
    t,
    { fastMode: true },
    {
      overrides: {
        'model/list': () => {
          if (broken) throw new Error('Unsupported method');
          return { data: [MODEL] };
        },
      },
    }
  );
  rpc.complete();
  broken = true;
  rpc.hooks.at(-1).onClose(new Error('Disconnected'));
  session.send({ text: 'New runtime' });
  await tick();
  const readies = events.filter((event) => event.type === 'ready');
  const shown = modelsFor(
    { provider: descriptor, models: readies.at(-1).models },
    { catalog: readies[0].models, shown: [MODEL.model] }
  );
  const selected = shown.catalog.find((model) => model.id === MODEL.model);
  assert.equal(selected.fast, undefined, 'the earlier global Fast capability cannot resurface');
  assert.match(selected.fastUnavailable, /could not confirm/);
  assert.ok(
    shown.catalog.some((model) => model.id === 'gpt-6-sol'),
    'built-in choices remain available'
  );
  assert.equal(Object.hasOwn(rpc.params('turn/start').at(-1), 'serviceTier'), false);
});

test('an empty catalog supplies unavailable controls for the actual configured default model', async (t) => {
  const { events, rpc } = await start(t, { model: '', fastMode: false }, { models: [] });
  const ready = events.find((event) => event.type === 'ready');
  const current = ready.models.find((model) => model.id === MODEL.model);
  assert.equal(current.default, true);
  assert.match(current.fastUnavailable, /could not confirm/);
  assert.equal(Object.hasOwn(rpc.params('turn/start')[0], 'serviceTier'), false);
});

test('changing speed in a live unsupported session immediately explains that it cannot apply it', async (t) => {
  const { session, events, rpc } = await start(t, {}, { models: [] });
  assert.equal(events.filter((event) => event.type === 'notice').length, 0);
  await session.setFastMode(false);
  assert.match(events.find((event) => event.type === 'notice').text, /cannot confirm the saved speed setting/);
  assert.equal(rpc.params('turn/start').length, 1, 'no extra turn is started by a setting change');
});

test('a running session asks Codex for its models again, and says so when the list changed', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let models = [MODEL, STANDARD];
  const { rpc, session, events } = await start(
    t,
    { fastMode: true },
    {
      overrides: {
        'model/list': () => {
          if (models instanceof Error) throw models;
          return { data: models };
        },
      },
    }
  );
  const said = () => events.filter((event) => event.type === 'models').map((event) => event.models.map((m) => m.id));
  const asked = () => rpc.params('model/list').length;
  const later = async () => {
    t.mock.timers.tick(MODELS_MAX_AGE_MS);
    await tick();
    await tick();
  };
  assert.equal(asked(), 1);
  await later();
  assert.equal(asked(), 2);
  assert.deepEqual(said(), [], 'the same list is not said again');

  const terra = {
    ...MODEL,
    id: 'gpt-6.1-terra',
    model: 'gpt-6.1-terra',
    displayName: 'GPT-6.1 Terra',
    isDefault: false,
  };
  models = [MODEL, terra, STANDARD];
  await later();
  assert.deepEqual(said(), [['gpt-demo', 'gpt-6.1-terra', 'standard']]);
  assert.equal(events.at(-1).models[1].fast, true, 'with Fast as the thread allows it');
  assert.equal(session.models[1].id, 'gpt-6.1-terra', 'the session goes by it too');

  for (const answer of [new Error('Codex took too long to answer.'), []]) {
    models = answer;
    await later();
  }
  assert.equal(said().length, 1, 'a failed or empty answer leaves the list');
  assert.equal(session.models.length, 3);

  session.close();
  const before = asked();
  await later();
  assert.equal(asked(), before, 'a closed session is not asked again');
});

test('a session whose list stood in for one Codex could not give is not asked again', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { rpc } = await start(
    t,
    {},
    { overrides: { 'model/list': () => Promise.reject(new Error('Unknown method')) } }
  );
  t.mock.timers.tick(MODELS_MAX_AGE_MS * 2);
  await tick();
  assert.equal(rpc.params('model/list').length, 1);
});
