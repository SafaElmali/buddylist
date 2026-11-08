import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import module from 'node:module';
import * as imported from '@anthropic-ai/claude-agent-sdk';
import { agentSdk, createSdkMcpServer, query, tool } from '../src/providers/claude/sdk.js';

const urlOf = (file) => new URL(file, import.meta.url).href;

test('the SDK that is loaded late is the one an import gives, with everything the app takes from it', () => {
  for (const name of ['query', 'tool', 'createSdkMcpServer']) {
    assert.equal(typeof agentSdk()[name], 'function', name);
    assert.equal(agentSdk()[name], imported[name], name);
  }
});

test('it is loaded once, however often it is asked for', () => {
  assert.equal(agentSdk(), agentSdk());
});

test('a tool and a server of tools are the SDK’s own', async () => {
  const handler = async () => ({ content: [{ type: 'text', text: 'Done.' }] });
  const made = tool('open', 'Opens something.', {}, handler);
  assert.equal(made.name, 'open');
  assert.equal(made.description, 'Opens something.');
  assert.deepEqual(await made.handler({}, {}), { content: [{ type: 'text', text: 'Done.' }] });
  const server = createSdkMcpServer({ name: 'messenger', tools: [made] });
  assert.equal(server.type, 'sdk');
  assert.equal(server.name, 'messenger');
});

test('starting a Claude Code is left to the SDK’s query()', () => {
  // Not called: that would start one. It takes what the SDK's takes, and nothing has loaded it twice.
  assert.equal(typeof query, 'function');
  assert.equal(query.length, imported.query.length);
});

// Every file that is read can be watched from Node 22.15 on.
test(
  'the providers are there without the SDK having been read, and its first use reads it',
  { skip: !module.registerHooks },
  () => {
    const script = `
      import { registerHooks } from 'node:module';
      const read = [];
      registerHooks({
        load(url, context, nextLoad) {
          if (url.includes('claude-agent-sdk')) read.push(url);
          return nextLoad(url, context);
        },
      });
      const { createProviders } = await import(${JSON.stringify(urlOf('../src/providers/index.js'))});
      const providers = createProviders({ app: { isPackaged: false } });
      const ids = providers.list().map((descriptor) => descriptor.id);
      const before = read.length;
      const { tool } = await import(${JSON.stringify(urlOf('../src/providers/claude/sdk.js'))});
      tool('x', 'x', {}, async () => ({ content: [] }));
      console.log(JSON.stringify({ ids, before, after: read.length }));
    `;
    const ran = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    assert.equal(ran.status, 0, ran.stderr);
    const { ids, before, after } = JSON.parse(ran.stdout);
    assert.ok(ids.includes('claude'));
    assert.equal(before, 0);
    assert.equal(after, 1);
  }
);
