// A tiny ACP agent to run as a real process, for testing the plumbing: it
// speaks JSON-RPC 2.0 over stdin and stdout, one message per line, the way
// `gemini --acp` and `opencode acp` do. What it does depends on the message:
//   "run"    asks to run a command, runs it (in name only) and replies
//   "wait"   does nothing until the turn is cancelled
//   "crash"  complains on stderr and exits
//   anything else is echoed back
import readline from 'node:readline';

const SESSION = 'fake-session';
const waiting = new Map();
let nextId = 1;
let cancel = () => {};

const write = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const update = (body) => write({ method: 'session/update', params: { sessionId: SESSION, update: body } });
const say = (text) => update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
const ask = (method, params) =>
  new Promise((resolve) => {
    waiting.set(nextId, resolve);
    write({ id: nextId++, method, params });
  });

async function prompt({ prompt: blocks }) {
  const text = blocks.find((block) => block.type === 'text')?.text;
  if (text === 'crash') {
    process.stderr.write('\x1b[31mfake agent: out of cheese\x1b[0m\n');
    process.exit(3);
  }
  if (text === 'wait') {
    await new Promise((resolve) => (cancel = resolve));
    return { stopReason: 'cancelled' };
  }
  if (text === 'run') {
    const call = { toolCallId: 'call-1', title: 'npm test', kind: 'execute', status: 'pending' };
    update({ sessionUpdate: 'tool_call', ...call });
    const { outcome } = await ask('session/request_permission', {
      sessionId: SESSION,
      toolCall: call,
      options: [
        { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
        { optionId: 'no', name: 'Reject', kind: 'reject_once' },
      ],
    });
    const allowed = outcome.outcome === 'selected' && outcome.optionId === 'yes';
    update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-1',
      status: allowed ? 'completed' : 'failed',
      content: [{ type: 'content', content: { type: 'text', text: allowed ? '3 passing' : 'not allowed' } }],
    });
    say(allowed ? 'All green.' : 'Then I won’t.');
    return { stopReason: 'end_turn' };
  }
  say('You said: ');
  say(text);
  return { stopReason: 'end_turn' };
}

const methods = {
  initialize: ({ protocolVersion }) => ({
    protocolVersion,
    agentCapabilities: { loadSession: false, promptCapabilities: { image: false } },
    agentInfo: { name: 'fake-agent', version: '1.0.0' },
    authMethods: [],
  }),
  'session/new': ({ cwd, mcpServers }) => {
    if (!cwd || !Array.isArray(mcpServers)) throw new Error('Invalid params');
    return { sessionId: SESSION };
  },
  'session/prompt': prompt,
  'session/cancel': () => cancel(),
};

// Things a real agent's stdout has been known to carry besides messages.
process.stdout.write('fake agent starting up...\n');
process.stdout.write('null\n42\n"a string"\n{"half":\n');

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  const message = JSON.parse(line);
  const { id, method, params } = message;
  if (message.jsonrpc !== '2.0')
    return write({ id, error: { code: -32600, message: 'Invalid request: not JSON-RPC 2.0' } });
  if (!method) return waiting.get(id)?.(message.result);
  const handler = methods[method];
  if (id === undefined) return handler?.(params);
  if (!handler) return write({ id, error: { code: -32601, message: `"Method not found": ${method}` } });
  try {
    write({ id, result: await handler(params) });
  } catch (err) {
    write({ id, error: { code: -32603, message: 'Internal error', data: { details: err.message } } });
  }
});
