import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { appToolBridge, appToolInstructions } from '../src/providers/app-tool-bridge.js';
import { BaseSession } from '../src/providers/base-session.js';
import { connectProcess } from '../src/providers/json-rpc.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('the tool catalog names only this session’s tools and distinguishes required inputs', () => {
  const instructions = appToolInstructions([
    { name: 'start_conversation', input: { prompt: z.string(), asked_by_user: z.boolean().optional() } },
    { name: 'project_conversations', input: { name: z.string().optional() } },
  ]);
  assert.match(instructions, /mcp__messenger__start_conversation: prompt, asked_by_user \(optional\)/);
  assert.match(instructions, /mcp__messenger__project_conversations: name \(optional\)/);
  assert.doesNotMatch(instructions, /mcp__messenger__message_conversation/);
  assert.match(instructions, /look up the exact tool name only/);
});
async function setup(t, { ask = false, unasked = false } = {}) {
  const events = [];
  const calls = [];
  const session = new BaseSession({ contact: {}, emit: (event) => events.push(event) });
  session.setState('working');
  const bridge = await appToolBridge(
    session,
    [
      {
        name: 'project_brief',
        description: 'Keep the brief',
        input: { text: z.string().max(100) },
        ask: () => ask,
        run: ({ text }) => {
          calls.push(text);
          return 'Saved: ' + text;
        },
      },
    ],
    () => unasked
  );
  const { command, args, env } = bridge.acp;
  const rpc = connectProcess({
    command,
    args,
    env: Object.fromEntries(env.map(({ name, value }) => [name, value])),
    version: '2.0',
    name: 'Tools',
    onClose: () => {},
    onRequest: () => {},
    onNotification: () => {},
  });
  t.after(() => {
    session.cancelPrompts();
    rpc.close();
    bridge.close();
  });
  return { rpc, bridge, session, events, calls };
}

test('a real stdio client discovers and calls session-scoped app tools', async (t) => {
  const { rpc, calls } = await setup(t);
  const hello = await rpc.request('initialize', { protocolVersion: '2024-11-05' });
  assert.ok(hello.capabilities.tools);
  rpc.notify('notifications/initialized', {});
  const { tools } = await rpc.request('tools/list', {});
  assert.equal(tools[0].name, 'project_brief');
  assert.equal(tools[0].inputSchema.properties.text.maxLength, 100);
  assert.deepEqual((await rpc.request('tools/call', { name: 'project_brief', arguments: { text: 'Goals' } })).content, [
    { type: 'text', text: 'Saved: Goals' },
  ]);
  assert.deepEqual(calls, ['Goals']);
  assert.equal((await rpc.request('tools/call', { name: 'project_brief', arguments: { text: 42 } })).isError, true);
  assert.equal((await rpc.request('tools/call', { name: 'another_conversation' })).isError, true);
  assert.deepEqual(calls, ['Goals']);
});

test('app actions wait for approval, and declining never runs the tool', async (t) => {
  const { rpc, session, events, calls } = await setup(t, { ask: true });
  const pending = rpc.request('tools/call', { name: 'project_brief', arguments: { text: 'Goals' } });
  while (!events.some((event) => event.type === 'permission')) await tick();
  const prompt = events.find((event) => event.type === 'permission');
  assert.deepEqual(calls, []);
  session.respond(prompt.requestId, { decision: 'deny' });
  assert.equal((await pending).isError, true);
  assert.deepEqual(calls, []);
  const allowed = rpc.request('tools/call', { name: 'project_brief', arguments: { text: 'Approved' } });
  while (events.filter((event) => event.type === 'permission').length < 2) await tick();
  session.respond(events.filter((event) => event.type === 'permission').at(-1).requestId, { decision: 'allow' });
  assert.equal((await allowed).isError, undefined);
  assert.deepEqual(calls, ['Approved']);
});

test('the never-ask mode applies to app tools; each session has its own endpoint', async (t) => {
  const first = await setup(t, { ask: true, unasked: true });
  const second = await setup(t);
  await first.rpc.request('tools/call', { name: 'project_brief', arguments: { text: 'First only' } });
  assert.deepEqual(first.calls, ['First only']);
  assert.deepEqual(second.calls, []);
  assert.equal(
    first.events.some((event) => event.type === 'permission'),
    false
  );
  const env = Object.fromEntries(first.bridge.acp.env.map(({ name, value }) => [name, value]));
  const bad = await fetch(env.BUDDYLIST_TOOL_URL, { method: 'POST', body: '{}' });
  assert.equal(bad.status, 403);
  const otherEnv = Object.fromEntries(second.bridge.acp.env.map(({ name, value }) => [name, value]));
  assert.notEqual(env.BUDDYLIST_TOOL_TOKEN, otherEnv.BUDDYLIST_TOOL_TOKEN);
  for (const token of ['wrong-token', otherEnv.BUDDYLIST_TOOL_TOKEN]) {
    const wrong = await fetch(env.BUDDYLIST_TOOL_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: '{}',
    });
    assert.equal(wrong.status, 403);
  }
  const crossSite = await fetch(env.BUDDYLIST_TOOL_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.BUDDYLIST_TOOL_TOKEN}`, origin: 'https://example.com' },
    body: '{}',
  });
  assert.equal(crossSite.status, 403);
  first.bridge.close();
  await assert.rejects(first.rpc.request('tools/list', {}), /no longer connected/);
});

test('only the private messenger server skips outer Codex approval without claiming all tools are read-only', async (t) => {
  const { bridge, rpc } = await setup(t, { ask: true });
  assert.equal(bridge.codex.length, 1);
  assert.match(bridge.codex[0], /^mcp_servers\.messenger=\{/);
  assert.match(bridge.codex[0], /default_tools_approval_mode="approve"/);
  const { tools } = await rpc.request('tools/list', {});
  assert.equal(tools[0].annotations?.readOnlyHint, undefined);
  const token = bridge.codexEnv.BUDDYLIST_TOOL_TOKEN;
  assert.equal(bridge.codex.join('').includes(token), false);
});

test('cancelled protected app tools never run when outer Codex approval is skipped', async (t) => {
  const { rpc, session, events, calls } = await setup(t, { ask: true });
  const answer = rpc.request('tools/call', { name: 'project_brief', arguments: { text: 'Do not save' } });
  while (!events.some((event) => event.type === 'permission')) await tick();
  session.cancelPrompts();
  assert.equal((await answer).isError, true);
  assert.deepEqual(calls, []);
});

test('the authenticated app bridge still rejects oversized and wrong-method requests', async (t) => {
  const { bridge, calls } = await setup(t);
  const env = Object.fromEntries(bridge.acp.env.map(({ name, value }) => [name, value]));
  const headers = { authorization: 'Bearer ' + env.BUDDYLIST_TOOL_TOKEN };
  assert.equal((await fetch(env.BUDDYLIST_TOOL_URL, { headers })).status, 403);
  const large = await fetch(env.BUDDYLIST_TOOL_URL, {
    method: 'POST',
    headers,
    body: ' '.repeat(1024 * 1024 + 1),
  });
  assert.equal(large.status, 413);
  assert.deepEqual(calls, []);
});

test('a tool that asks on a card of its own asks under any mode, and hears what the user answered', async (t) => {
  const events = [];
  let finishReading;
  const session = new BaseSession({ contact: {}, emit: (event) => events.push(event) });
  session.setState('working');
  const bridge = await appToolBridge(
    session,
    [
      {
        name: 'project_instructions',
        description: 'Save them',
        input: { text: z.string() },
        // The call itself goes ahead: what it saves, it asks about as it runs.
        ask: () => false,
        run: async ({ text }, { ask }) => {
          if (text === 'Delayed.') await new Promise((resolve) => (finishReading = resolve));
          const answer = await ask({ kind: 'instructions', activity: { kind: 'app' }, instructions: { after: text } });
          return answer.decision === 'edit' ? `Saved: ${answer.text}` : answer.decision;
        },
      },
    ],
    () => true
  );
  const { command, args, env } = bridge.acp;
  const rpc = connectProcess({
    command,
    args,
    env: Object.fromEntries(env.map(({ name, value }) => [name, value])),
    version: '2.0',
    name: 'Tools',
    onClose: () => {},
    onRequest: () => {},
    onNotification: () => {},
  });
  t.after(() => {
    session.cancelPrompts();
    rpc.close();
    bridge.close();
  });
  const edited = rpc.request('tools/call', { name: 'project_instructions', arguments: { text: 'Merge it.' } });
  while (!events.some((event) => event.type === 'permission')) await tick();
  const prompt = events.find((event) => event.type === 'permission');
  assert.deepEqual([prompt.kind, prompt.instructions], ['instructions', { after: 'Merge it.' }]);
  assert.equal(session.prompts.get(prompt.requestId).automatic, false);
  session.respond(prompt.requestId, { decision: 'edit', text: 'Leave merging to me.' });
  assert.deepEqual((await edited).content, [{ type: 'text', text: 'Saved: Leave merging to me.' }]);

  const stopped = rpc.request('tools/call', { name: 'project_instructions', arguments: { text: 'Merge it.' } });
  while (events.filter((event) => event.type === 'permission').length < 2) await tick();
  session.cancelPrompts();
  assert.deepEqual((await stopped).content, [{ type: 'text', text: 'cancelled' }]);

  const delayed = rpc.request('tools/call', { name: 'project_instructions', arguments: { text: 'Delayed.' } });
  while (!finishReading) await tick();
  session.cancelPrompts();
  finishReading();
  assert.deepEqual((await delayed).content, [{ type: 'text', text: 'cancelled' }]);
  assert.equal(events.filter((event) => event.type === 'permission').length, 2, 'no new prompt after interruption');
});
