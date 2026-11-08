// Conversations Codex keeps outside buddylist. Only its app server reads them;
// continuing explicitly forks one, never resumes or writes into the original.
import { within } from '../within.js';
import { CLIENT_INFO, connectAppServer } from './rpc.js';
import { ENTRY_LIMIT, newestEntries, toEntries } from './transcript.js';

const SESSION_ID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const LIMIT = 100;
const LIMIT_ALL = 500;
const MOST_PAGES = 100;
const oneLine = (text) =>
  String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
const outside = (thread) =>
  thread.cwd &&
  !thread.ephemeral &&
  !thread.archived &&
  thread.originator !== CLIENT_INFO.name &&
  !thread.parentThreadId &&
  (typeof thread.source !== 'string' || !thread.source.startsWith('subAgent')) &&
  !(thread.source && typeof thread.source === 'object');

function held(thread) {
  const preview = oneLine(thread.preview);
  const title = oneLine(thread.name);
  const branch = thread.gitInfo?.branch;
  return {
    id: thread.id,
    cwd: thread.cwd,
    startedAt: thread.createdAt * 1000,
    endedAt: thread.updatedAt * 1000,
    preview,
    ...(title && title !== preview && { title }),
    ...(branch && branch !== 'HEAD' && { branch }),
  };
}

/** Active external threads, with a bounded walk and protection against a stuck cursor. */
async function* threads(rpc, cwd) {
  const seen = new Set();
  const ids = new Set();
  let cursor;
  for (let page = 0; page < MOST_PAGES; page++) {
    const { data, nextCursor } = await rpc.request('thread/list', {
      limit: 100,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      archived: false,
      modelProviders: [],
      // Codex's default source filter lists interactive conversations, as its own history does.
      ...(cwd && { cwd }),
      ...(cursor && { cursor }),
    });
    for (const thread of data) {
      if (!outside(thread) || (cwd && thread.cwd !== cwd) || ids.has(thread.id)) continue;
      ids.add(thread.id);
      yield thread;
    }
    if (!nextCursor) return;
    if (seen.has(nextCursor)) throw new Error('Codex repeated a page of conversations. Try again.');
    seen.add(nextCursor);
    cursor = nextCursor;
  }
  throw new Error('Codex has too many conversations to list right now.');
}

/** Check the active listing too: thread/read can also read an archived thread. */
async function active(rpc, cwd, id) {
  for await (const thread of threads(rpc, cwd)) if (thread.id === id) return thread;
  return null;
}

async function entries(rpc, thread) {
  if (thread.historyMode !== 'paginated') {
    const { thread: full } = await rpc.request('thread/read', { threadId: thread.id, includeTurns: true });
    return toEntries(full);
  }
  // Recent turns first so a long conversation needn't be loaded whole just to show its end.
  let kept = [];
  let cursor;
  const seen = new Set();
  for (let page = 0; page < MOST_PAGES; page++) {
    const { data, nextCursor } = await rpc.request('thread/turns/list', {
      threadId: thread.id,
      limit: 20,
      sortDirection: 'desc',
      itemsView: 'full',
      ...(cursor && { cursor }),
    });
    if (data.some((turn) => turn.itemsView && turn.itemsView !== 'full')) {
      throw new Error('Codex did not return the full conversation. Update the Codex CLI and try again.');
    }
    const chunk = toEntries({ ...thread, turns: [...data].reverse() }, { limit: Infinity });
    kept = [...chunk, ...kept];
    if (!nextCursor || kept.length >= ENTRY_LIMIT) return newestEntries(kept, ENTRY_LIMIT, Boolean(nextCursor));
    if (seen.has(nextCursor)) throw new Error('Codex repeated a page of messages. Try again.');
    seen.add(nextCursor);
    cursor = nextCursor;
  }
  return newestEntries(kept, ENTRY_LIMIT, true);
}

/**
 * @param {{ command?: () => string, connect?: typeof connectAppServer, patienceMs?: number }} [opts]
 * @returns {import('../contract.js').Elsewhere}
 */
export function codexElsewhere({ command = () => 'codex', connect = connectAppServer, patienceMs = 20000 } = {}) {
  const ask = async (work) => {
    const stopped = Promise.withResolvers();
    const rpc = connect({
      command: command(),
      config: ['features.hooks=false', 'features.shell_snapshot=false'],
      onNotification: () => {},
      onRequest: async () => {
        throw new Error('Not supported while reading History.');
      },
      onClose: stopped.reject,
    });
    const run = async () => {
      await rpc.request('initialize', { clientInfo: CLIENT_INFO, capabilities: null });
      rpc.notify('initialized');
      return work(rpc);
    };
    try {
      return await within(Promise.race([run(), stopped.promise]), patienceMs, 'Codex History');
    } catch (err) {
      if (err.code === -32601 || /unknown (?:method|variant)|method not found/i.test(err.message)) {
        throw new Error(
          'This Codex CLI cannot read or copy past conversations. Update it with "npm install -g @openai/codex" and try again.',
          { cause: err }
        );
      }
      throw err;
    } finally {
      rpc.close();
    }
  };
  const list = (cwd, limit) =>
    ask(async (rpc) => {
      const found = [];
      for await (const thread of threads(rpc, cwd)) {
        found.push(held(thread));
        if (found.length === limit) break;
      }
      return found;
    });
  return {
    name: 'Codex',
    list: (cwd) => (cwd ? list(cwd, LIMIT) : Promise.resolve([])),
    listAll: () => list(null, LIMIT_ALL),
    read: async (cwd, id) => {
      if (!cwd || !SESSION_ID.test(id)) return null;
      return ask(async (rpc) => {
        const listed = await active(rpc, cwd, id);
        if (!listed) return null;
        const { thread } = await rpc.request('thread/read', { threadId: id, includeTurns: false });
        if (!outside(thread)) return null;
        // The listing owns the folder association. Desktop threads may retain an older cwd
        // in their rollout, which thread/read returns even after the thread was moved.
        return { id, cwd: listed.cwd, entries: await entries(rpc, thread) };
      });
    },
    fork: async (cwd, id) => {
      const gone = () => new Error('Codex no longer has that conversation in this folder.');
      if (!cwd || !SESSION_ID.test(id)) throw gone();
      return ask(async (rpc) => {
        if (!(await active(rpc, cwd, id))) throw gone();
        // Copying starts no turn and needs no project integrations. They load normally when the contact resumes.
        const { config } = await rpc.request('config/read', { cwd, includeLayers: false });
        const servers = Object.fromEntries(
          Object.keys(config.mcp_servers ?? {}).map((key) => [key, { enabled: false }])
        );
        const { thread } = await rpc.request('thread/fork', {
          threadId: id,
          cwd,
          excludeTurns: true,
          ephemeral: false,
          sandbox: 'read-only',
          approvalPolicy: 'never',
          config: { mcp_servers: servers },
        });
        if (!thread?.id || thread.id === id)
          throw new Error('Codex did not make a separate copy of this conversation.');
        return thread.id;
      });
    },
  };
}
