import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMcpServer } from '../src/providers/claude/mcp.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { createProviders } from '../src/providers/index.js';
import {
  MCP_ACTIONS,
  MCP_ACTION_LABELS,
  mcpActionsFor,
  mcpDetail,
  mcpMatching,
  mcpOrder,
  mcpSettling,
  mcpStatus,
  mcpGlance,
  mcpSummary,
} from '../src/shared/mcp.js';

const STATUSES = ['connected', 'failed', 'needs-auth', 'pending', 'disabled'];
const server = (name, status, extra = {}) => ({ name, status, ...extra });

test('each status has words of its own and the buddy a contact would wear for it', () => {
  assert.deepEqual(
    STATUSES.map((status) => [status, mcpStatus(status)]),
    [
      ['connected', { label: 'Connected', buddy: 'online' }],
      ['failed', { label: 'Failed', buddy: 'busy' }],
      ['needs-auth', { label: 'Needs sign-in', buddy: 'away' }],
      ['pending', { label: 'Connecting...', buddy: 'offline' }],
      ['disabled', { label: 'Disabled', buddy: 'offline' }],
    ]
  );
});

test('a status the app has not heard of is shown by its own name, with nothing to do about it', () => {
  assert.deepEqual(mcpStatus('quarantined'), { label: 'quarantined', buddy: 'offline' });
  assert.deepEqual(mcpActionsFor(server('x', 'quarantined')), []);
});

test('what can be done about a server goes by how it is doing, the likeliest first', () => {
  assert.deepEqual(
    STATUSES.map((status) => [status, mcpActionsFor(server('x', status))]),
    [
      ['connected', ['reconnect', 'disable']],
      ['failed', ['reconnect', 'disable']],
      ['needs-auth', ['sign-in', 'reconnect', 'disable']],
      ['pending', ['disable']],
      ['disabled', ['enable']],
    ]
  );
});

test('every action there is has a button and words for while it is going on', () => {
  const offered = new Set(STATUSES.flatMap((status) => mcpActionsFor(server('x', status))));
  assert.deepEqual([...offered].sort(), [...MCP_ACTIONS].sort());
  for (const action of MCP_ACTIONS) {
    assert.ok(MCP_ACTION_LABELS[action].label, action);
    assert.ok(MCP_ACTION_LABELS[action].doing, action);
  }
});

test('the list of actions handed out is the caller’s own', () => {
  mcpActionsFor(server('x', 'connected')).push('enable');
  assert.deepEqual(mcpActionsFor(server('x', 'connected')), ['reconnect', 'disable']);
});

test('only a server still connecting is worth asking about again by itself', () => {
  assert.deepEqual(
    STATUSES.filter((status) => mcpSettling(server('x', status))),
    ['pending']
  );
});

test('the servers that need you come first and the ones switched off last, by name within each', () => {
  const servers = [
    server('zeta', 'connected'),
    server('off', 'disabled'),
    server('Alpha', 'connected'),
    server('odd', 'quarantined'),
    server('slow', 'pending'),
    server('login', 'needs-auth'),
    server('broken', 'failed'),
    server('beta', 'connected'),
  ];
  const before = servers.map((s) => s.name);
  assert.deepEqual(
    mcpOrder(servers).map((s) => s.name),
    ['broken', 'login', 'slow', 'Alpha', 'beta', 'zeta', 'odd', 'off']
  );
  assert.deepEqual(
    servers.map((s) => s.name),
    before,
    'the list it was given stays as it was'
  );
});

test('the summary counts them by status, and leaves out what there is none of', () => {
  assert.equal(mcpSummary([]), 'No MCP servers are set up here.');
  assert.equal(mcpSummary([server('a', 'connected')]), '1 MCP server: 1 connected.');
  assert.equal(
    mcpSummary([
      server('a', 'connected'),
      server('b', 'connected'),
      server('c', 'needs-auth'),
      server('d', 'failed'),
      server('e', 'disabled'),
      server('f', 'pending'),
    ]),
    '6 MCP servers: 1 failed, 1 not signed in, 1 connecting, 2 connected, 1 disabled.'
  );
  assert.equal(mcpSummary([server('a', 'quarantined')]), '1 MCP server.');
});

test('a glance says what needs the user first, then what is still connecting, or else how many work', () => {
  assert.deepEqual(mcpGlance([]), { text: 'None set up', attention: false });
  assert.deepEqual(mcpGlance([server('a', 'connected'), server('b', 'connected'), server('c', 'disabled')]), {
    text: '2 connected, 1 disabled',
    attention: false,
  });
  assert.deepEqual(
    mcpGlance([server('a', 'connected'), server('b', 'needs-auth'), server('c', 'failed'), server('d', 'needs-auth')]),
    { text: '1 failed, 2 not signed in', attention: true }
  );
  // On its way to connecting is worth a word, and is nothing the user has to do.
  assert.deepEqual(mcpGlance([server('a', 'connected'), server('b', 'pending')]), {
    text: '1 connecting',
    attention: false,
  });
  assert.deepEqual(mcpGlance([server('a', 'failed'), server('b', 'pending')]), {
    text: '1 failed, 1 connecting',
    attention: true,
  });
  assert.deepEqual(mcpGlance([server('a', 'disabled')]), { text: '1 disabled', attention: false });
  // Only statuses the app doesn't know: how many there are.
  assert.deepEqual(mcpGlance([server('a', 'quarantined'), server('b', 'quarantined')]), {
    text: '2 set up',
    attention: false,
  });
});

test('a row says how the server is doing, how many tools it gives once connected, and where it is set up', () => {
  assert.equal(mcpDetail(server('a', 'connected', { tools: 82, origin: 'Plugin' })), 'Connected · 82 tools · Plugin');
  assert.equal(mcpDetail(server('a', 'connected', { tools: 1 })), 'Connected · 1 tool');
  assert.equal(mcpDetail(server('a', 'connected', { tools: 0, origin: 'This project' })), 'Connected · This project');
  assert.equal(mcpDetail(server('a', 'failed', { tools: 3, origin: 'This project' })), 'Failed · This project');
  assert.equal(mcpDetail(server('a', 'needs-auth')), 'Needs sign-in');
});

test('a search finds servers by name, address, where they are set up or how they are doing, in any case', () => {
  const servers = [
    server('claude.ai Google Sheets', 'needs-auth', {
      address: 'https://sheetsmcp.googleapis.com',
      origin: 'claude.ai connector',
    }),
    server('linear', 'connected', { address: 'https://mcp.linear.app/mcp', origin: 'This project' }),
    server('playwright', 'failed', { address: 'npx @playwright/mcp' }),
  ];
  const names = (query) => mcpMatching(servers, query).map(({ name }) => name);
  assert.deepEqual(names('sheets'), ['claude.ai Google Sheets']);
  assert.deepEqual(names('LINEAR'), ['linear']);
  assert.deepEqual(names('googleapis'), ['claude.ai Google Sheets']);
  assert.deepEqual(names('this project'), ['linear']);
  assert.deepEqual(names('sign-in'), ['claude.ai Google Sheets']);
  assert.deepEqual(names('failed'), ['playwright']);
  assert.deepEqual(names('mcp'), ['claude.ai Google Sheets', 'linear', 'playwright']);
  assert.deepEqual(names('nothing like it'), []);
});

test('an empty search finds them all, in the order they came, and a server with no address or origin is still searched', () => {
  const servers = [server('b', 'connected'), server('a', 'disabled')];
  assert.equal(mcpMatching(servers, ''), servers);
  assert.equal(mcpMatching(servers, '   '), servers);
  assert.deepEqual(mcpMatching(servers, ' a '), [servers[1]]);
});

// ---- what Claude Code says about a server, in the app's words -------------------------------

test('a connected server keeps its name, status, address, tool count and where it is set up', () => {
  assert.deepEqual(
    toMcpServer({
      name: 'claude.ai Linear',
      status: 'connected',
      scope: 'claudeai',
      source: 'claudeai',
      config: { type: 'claudeai-proxy', url: 'https://mcp.linear.app/mcp', id: 'mcpsrv_1' },
      serverInfo: { name: 'Linear MCP', version: '1.0.0' },
      tools: [{ name: 'list_issues' }, { name: 'get_issue' }],
    }),
    {
      name: 'claude.ai Linear',
      status: 'connected',
      address: 'https://mcp.linear.app/mcp',
      origin: 'claude.ai connector',
      tools: 2,
    }
  );
});

test('a server that failed says why', () => {
  assert.deepEqual(
    toMcpServer({
      name: 'Figma MCP Server',
      status: 'failed',
      error: 'ECONNREFUSED: Unable to connect.',
      scope: 'local',
      config: { type: 'http', url: 'http://127.0.0.1:3845/mcp' },
    }),
    {
      name: 'Figma MCP Server',
      status: 'failed',
      error: 'ECONNREFUSED: Unable to connect.',
      address: 'http://127.0.0.1:3845/mcp',
      origin: 'This folder, for you only',
    }
  );
});

test('a server that runs on this computer is known by the command that starts it', () => {
  const shown = toMcpServer({
    name: 'playwright',
    status: 'disabled',
    scope: 'user',
    config: { type: 'stdio', command: 'npx', args: ['@playwright/mcp@latest', '--headless'] },
  });
  assert.equal(shown.address, 'npx @playwright/mcp@latest --headless');
  assert.equal(shown.origin, 'Your Claude Code settings');
  assert.equal(toMcpServer({ name: 'bare', status: 'pending', config: { command: 'serve' } }).address, 'serve');
});

test('the headers and the environment a server is given never leave the session', () => {
  const shown = toMcpServer({
    name: 'secretive',
    status: 'needs-auth',
    scope: 'project',
    config: {
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer hunter2' },
      env: { API_KEY: 'hunter2' },
      oauth: { clientId: 'abc' },
    },
  });
  assert.deepEqual(shown, {
    name: 'secretive',
    status: 'needs-auth',
    address: 'https://example.com/mcp',
    origin: 'This project',
  });
  assert.doesNotMatch(JSON.stringify(shown), /hunter2|abc/);
});

test('a plugin’s server is told from one given to the session by where Claude Code says it came from', () => {
  const plugin = { name: 'plugin:figma:figma', status: 'needs-auth', scope: 'dynamic', source: 'plugin' };
  assert.equal(toMcpServer(plugin).origin, 'Plugin');
  // A Claude Code that doesn't say yet only has the scope.
  assert.equal(toMcpServer({ ...plugin, source: undefined }).origin, 'This session');
  assert.equal(toMcpServer({ name: 'x', status: 'connected', scope: 'managed' }).origin, 'Your organization');
  assert.equal(toMcpServer({ name: 'x', status: 'connected', scope: 'enterprise' }).origin, 'Your organization');
});

test('a scope the app has no words for is shown as Claude Code names it, and none at all is left out', () => {
  assert.equal(toMcpServer({ name: 'x', status: 'connected', scope: 'agent' }).origin, 'agent');
  assert.deepEqual(toMcpServer({ name: 'x', status: 'pending' }), { name: 'x', status: 'pending' });
});

test('only Claude answers /mcp with a list, and offers the command before a session has named its own', () => {
  const providers = createProviders({ app: { isPackaged: false } });
  assert.deepEqual(
    providers
      .list()
      .filter((descriptor) => descriptor.mcp)
      .map((descriptor) => descriptor.id),
    ['claude']
  );
  assert.ok(claude.commonCommands.includes('mcp'));
});
