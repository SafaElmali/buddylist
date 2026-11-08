// A stand-in for an ACP agent's process, for the session tests: it records
// what the session sends, and lets a test play the agent's part.
import { AcpSession } from '../../src/providers/acp/session.js';

export const tick = () => new Promise((resolve) => setImmediate(resolve));

const ids = (...names) => names.map((id) => ({ id, name: id }));

/** What Gemini CLI answers with: modes and models of the older kind. */
export const GEMINI_SESSION = {
  modes: { currentModeId: 'default', availableModes: ids('default', 'autoEdit', 'yolo', 'plan') },
  models: { currentModelId: 'auto', availableModels: [{ modelId: 'auto', name: 'Auto' }] },
};

/** What opencode answers with: the same things as session config options. */
export const opencodeOptions = ({ mode = 'build', model = 'opencode/big-pickle' } = {}) => [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: model,
    options: [
      { value: 'opencode/big-pickle', name: 'OpenCode Zen/Big Pickle' },
      { value: 'anthropic/claude-sonnet-4-5', name: 'Anthropic/Claude Sonnet 4.5' },
    ],
  },
  {
    id: 'mode',
    name: 'Session Mode',
    category: 'mode',
    type: 'select',
    currentValue: mode,
    options: [
      { value: 'build', name: 'build' },
      { value: 'plan', name: 'plan' },
    ],
  },
];

const REPLIES = {
  initialize: () => ({
    protocolVersion: 1,
    agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
    authMethods: [],
  }),
  'session/new': () => ({ sessionId: 's-1', ...GEMINI_SESSION }),
  'session/load': () => GEMINI_SESSION,
  'session/set_mode': () => ({}),
  'session/set_model': () => ({}),
};

/** The options Gemini CLI offers with a command it wants to run. */
export const OPTIONS = [
  { optionId: 'proceed_always', name: 'Allow for this session', kind: 'allow_always' },
  { optionId: 'proceed_once', name: 'Allow', kind: 'allow_once' },
  { optionId: 'cancel', name: 'Reject', kind: 'reject_once' },
];

/** An error as the agent would send it back. */
export const rpcError = (message, code, data) => Object.assign(new Error(message), { code, data });

export function fakeAgent(replies = {}) {
  const agent = {
    sent: [],
    /** What each start of the process was given. */
    launches: [],
    closed: 0,
    hooks: null,
    /** The `session/prompt` requests that haven't been answered yet. */
    turns: [],
    connect(hooks) {
      agent.hooks = hooks;
      const { command, args, cwd, version } = hooks;
      agent.launches.push({ command, args, cwd, version });
      return {
        request: async (method, params) => {
          agent.sent.push({ method, params });
          const reply = replies[method] || REPLIES[method];
          if (reply) return reply(params);
          // A turn lasts until the test ends it.
          if (method === 'session/prompt') {
            return new Promise((resolve, reject) => agent.turns.push({ resolve, reject }));
          }
          throw rpcError(`"Method not found": ${method}`, -32601);
        },
        notify: (method, params) => agent.sent.push({ method, params }),
        close: () => {
          agent.closed += 1;
          agent.drop(new Error('Not connected.'));
        },
      };
    },
    /** As the real connection does when it ends: fail what was still waiting. */
    drop(error) {
      for (const turn of agent.turns.splice(0)) turn.reject(error);
    },
    methods: () => agent.sent.map((m) => m.method),
    /** Everything the session sent for one method. */
    params: (method) => agent.sent.filter((m) => m.method === method).map((m) => m.params),
    /** What the session said in each message it sent. */
    prompts: () => agent.params('session/prompt').map((p) => p.prompt.at(-1).text),
    update: (update, sessionId = 's-1') => agent.hooks.onNotification('session/update', { sessionId, update }),
    say: (text, extra = {}, sessionId = undefined) =>
      agent.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text }, ...extra }, sessionId),
    tool: (toolCall, sessionId = undefined) => agent.update({ sessionUpdate: 'tool_call', ...toolCall }, sessionId),
    toolUpdate: (toolCall, sessionId = undefined) =>
      agent.update({ sessionUpdate: 'tool_call_update', ...toolCall }, sessionId),
    ask: (toolCall, options = OPTIONS, sessionId = 's-1') =>
      agent.hooks.onRequest('session/request_permission', { sessionId, toolCall, options }),
    die(message) {
      const error = new Error(message);
      agent.drop(error);
      agent.hooks.onClose(error);
    },
    async endTurn(stopReason = 'end_turn') {
      agent.turns.shift().resolve({ stopReason });
      await tick();
    },
    async failTurn(error) {
      agent.turns.shift().reject(error);
      await tick();
    },
  };
  return agent;
}

/**
 * A session wired to a fake agent.
 * @param {import('../../src/providers/acp/session.js').AcpAgent} profile
 * @param {{ replies?: object, contact?: object, settleMs?: number }} [opts]
 */
export function start(profile, { replies, contact, settleMs = 0 } = {}) {
  const agent = fakeAgent(replies);
  const events = [];
  const c = {
    cwd: '/tmp/project',
    model: '',
    permissionMode: profile.descriptor.defaultPermissionMode,
    sessionId: null,
    ...contact,
  };
  const session = new AcpSession({
    contact: c,
    emit: (e) => events.push(e),
    agent: profile,
    connect: agent.connect,
    settleMs,
  });
  const of = (type) => events.filter((e) => e.type === type);
  return { agent, events, of, session, contact: c };
}

/** The same, with a first message sent and its turn running. */
export async function started(profile, opts) {
  const s = start(profile, opts);
  s.session.send({ text: 'hi' });
  await tick();
  return s;
}
