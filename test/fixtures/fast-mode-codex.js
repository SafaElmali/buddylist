#!/usr/bin/env node
// Synthetic Codex app-server for the Electron Fast mode smoke check. Never calls a model or reads credentials.
import fs from 'node:fs';
import readline from 'node:readline';

if (process.argv.includes('login')) {
  console.log('Logged in (synthetic UI fixture)');
  process.exit(0);
}

const model = (id, fast) => ({
  id,
  model: id,
  displayName: fast ? 'Codex Demo' : 'Codex Demo Standard',
  description: 'Synthetic UI verification',
  hidden: false,
  isDefault: fast,
  defaultReasoningEffort: 'high',
  supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'High' }],
  serviceTiers: fast ? [{ id: 'priority', name: 'Fast', description: '2x speed, increased usage' }] : [],
  additionalSpeedTiers: fast ? ['fast'] : [],
});
const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const notify = (method, params) => write({ method, params });
let serviceTier = 'default';
let selectedModel = 'gpt-6.1-sol';
let threadId = 'synthetic-thread';
let turns = 0;

for await (const line of readline.createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (!('id' in request)) continue;
  if (process.env.BUDDYLIST_FAST_MODE_LOG) {
    fs.appendFileSync(process.env.BUDDYLIST_FAST_MODE_LOG, `${JSON.stringify(request)}\n`);
  }
  const { id, method, params = {} } = request;
  let result;
  switch (method) {
    case 'initialize':
      result = { userAgent: 'codex-ui-fixture/0.164.0' };
      break;
    case 'model/list':
      result = { data: [model('gpt-6.1-sol', true), model('demo-standard', false)], nextCursor: null };
      break;
    case 'experimentalFeature/list':
      result = { data: [{ name: 'fast_mode', enabled: true }], nextCursor: null };
      break;
    case 'configRequirements/read':
      result = { requirements: null, supportsIndependentSpeedModes: true };
      break;
    case 'config/read':
      result = { config: { features: { fast_mode: true } }, origins: {}, layers: [] };
      break;
    case 'thread/start':
    case 'thread/resume':
      selectedModel = params.model || selectedModel;
      serviceTier = params.serviceTier ?? 'default';
      threadId = params.threadId || `synthetic-${process.pid}`;
      result = { thread: { id: threadId }, model: selectedModel, serviceTier, reasoningEffort: 'high' };
      break;
    case 'skills/list':
      result = { data: [] };
      break;
    case 'turn/start': {
      if ('serviceTier' in params) serviceTier = params.serviceTier ?? 'default';
      selectedModel = params.model || selectedModel;
      const turn = { id: `turn-${++turns}`, status: 'inProgress', error: null, items: [] };
      result = { turn };
      setTimeout(() => {
        const item = { type: 'agentMessage', id: `message-${turns}`, text: `Synthetic reply at ${serviceTier} speed.` };
        notify('turn/started', { threadId, turn });
        notify('item/started', { threadId, turnId: turn.id, item });
        notify('item/agentMessage/delta', { threadId, turnId: turn.id, itemId: item.id, delta: item.text });
        notify('item/completed', { threadId, turnId: turn.id, item });
        notify('turn/completed', { threadId, turn: { ...turn, status: 'completed' } });
      }, 30);
      break;
    }
    default:
      write({ id, error: { code: -32601, message: `Unsupported fixture method: ${method}` } });
      continue;
  }
  write({ id, result });
}
