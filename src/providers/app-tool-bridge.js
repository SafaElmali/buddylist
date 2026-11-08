// Session-scoped MCP tools for CLIs outside this process. The CLI runs a tiny stdio
// proxy; only its private loopback endpoint can call this session's app tools.
import http from 'node:http';
import crypto from 'node:crypto';
import { z } from 'zod';
import { APP_SERVER, appActivity } from '../shared/app-tools.js';

// Self-contained: also runs from the packaged Electron executable, without a
// separate Node install or a path into the app's bundled source.
const STDIO_PROXY = String.raw`
  const http = require('node:http');
  const readline = require('node:readline');
  const lines = readline.createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const request = http.request(process.env.BUDDYLIST_TOOL_URL, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + process.env.BUDDYLIST_TOOL_TOKEN, 'content-type': 'application/json' },
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => {
        if (message.id !== undefined && response.statusCode === 200) process.stdout.write(text + '\n');
        else if (message.id !== undefined) failed();
      });
    });
    const failed = () => {
      if (message.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id,
        error: { code: -32603, message: 'The buddylist session is no longer connected.' } }) + '\n');
    };
    request.on('error', failed);
    request.end(line);
  });
  lines.on('close', () => process.exit(0));
`;

export const APP_TOOL_INSTRUCTIONS =
  'The buddylist MCP server provides tools for this conversation. Use its tools to open terminals, ' +
  'start conversations, and read or save project instructions. A project manager also uses them to ' +
  'read worker progress, message workers, and keep its brief and sources. Use the tools by their listed names.';

/** Give Codex the session's exact tool names so delegation need not wait on tool discovery. */
export function appToolInstructions(tools) {
  const catalog = tools.map((tool) => {
    const schema = z.toJSONSchema(z.object(tool.input));
    const required = new Set(schema.required || []);
    const fields = Object.keys(tool.input).map((key) => `${key}${required.has(key) ? '' : ' (optional)'}`);
    return `- mcp__${APP_SERVER}__${tool.name}: ${fields.join(', ') || 'no arguments'}`;
  });
  return [
    APP_TOOL_INSTRUCTIONS,
    'These buddylist tools are available in this session. Use them directly when their inputs are known; ' +
      'do not enumerate unrelated tools first. If your runtime requires lookup, look up the exact tool name only.',
    ...catalog,
  ].join('\n');
}

/**
 * @param {import('./base-session.js').BaseSession} session
 * @param {import('../main/app-tools.js').AppTool[]} tools
 * @param {() => boolean} [unasked] whether the user's mode allows app actions without asking
 */
export async function appToolBridge(session, tools, unasked = () => false) {
  const token = crypto.randomBytes(32).toString('hex');
  let closed = false;
  const definitions = tools.map((tool) => ({ tool, schema: z.object(tool.input) }));
  const call = async (name, input) => {
    const found = definitions.find(({ tool }) => tool.name === name);
    if (!found) throw new Error('That tool is not available in this conversation.');
    const args = found.schema.parse(input ?? {});
    const { tool } = found;
    if (closed) throw new Error('The buddylist session has ended.');
    if (tool.ask(args) && !unasked()) {
      const response = await session.requestPermission({
        kind: 'tool',
        canAlways: false,
        activity: tool.activity?.(args) ?? appActivity(tool.name, args),
      });
      if (!['allow', 'always'].includes(response.decision)) {
        throw new Error(response.message || 'The user did not allow this action.');
      }
    }
    if (closed) throw new Error('The buddylist session has ended.');
    return tool.run(args, session.appToolContext());
  };
  const respond = async ({ method, params }) => {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: APP_SERVER, version: '1.0.0' },
        };
      case 'ping':
        return {};
      case 'tools/list':
        return {
          tools: definitions.map(({ tool, schema }) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: z.toJSONSchema(schema),
          })),
        };
      case 'tools/call':
        try {
          return { content: [{ type: 'text', text: await call(params?.name, params?.arguments) }] };
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: error.message }] };
        }
      default:
        throw new Error('Method not found');
    }
  };
  const server = http.createServer(async (request, response) => {
    if (
      closed ||
      request.method !== 'POST' ||
      request.url !== '/' ||
      request.headers.origin ||
      request.headers.authorization !== `Bearer ${token}`
    ) {
      response.writeHead(403).end();
      return;
    }
    let message;
    try {
      let body = '';
      request.setEncoding('utf8');
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 1024 * 1024) {
          response.writeHead(413).end();
          return;
        }
      }
      message = JSON.parse(body);
      if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
        response.writeHead(400).end();
        return;
      }
      if (message.id === undefined) {
        response.writeHead(204).end();
        return;
      }
      const result = await respond(message);
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    } catch {
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message?.id ?? null,
          error: { code: -32600, message: 'Invalid buddylist tool request.' },
        })
      );
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  server.unref();
  const env = {
    ELECTRON_RUN_AS_NODE: '1',
    BUDDYLIST_TOOL_URL: `http://127.0.0.1:${server.address().port}/`,
  };
  const codexEnv = { BUDDYLIST_TOOL_TOKEN: token };
  const command = process.execPath;
  const args = ['-e', STDIO_PROXY];
  return {
    // ACP v1 requires every agent to support stdio MCP servers.
    acp: {
      name: APP_SERVER,
      command,
      args,
      env: Object.entries({ ...env, ...codexEnv }).map(([name, value]) => ({ name, value })),
    },
    // Only the variable name goes into -c (and the process list). Codex forwards
    // its value from the app-server environment to this MCP server via env_vars.
    codexEnv,
    // Only this authenticated, session-private server skips Codex’s outer approval.
    // AppTool.ask and requestPermission above still decide whether each action may run.
    // Each value is a TOML literal. No shell is involved, and no user config is written.
    codex: [
      `mcp_servers.${APP_SERVER}={command=${JSON.stringify(command)},args=${JSON.stringify(args)},env={${Object.entries(
        env
      )
        .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
        .join(
          ','
        )}},env_vars=["BUDDYLIST_TOOL_TOKEN"],enabled=true,required=true,tool_timeout_sec=86400,default_tools_approval_mode="approve"}`,
    ],
    close() {
      closed = true;
      server.close();
      server.closeAllConnections();
    },
  };
}
