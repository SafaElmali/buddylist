import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClaudeSession, limitReached } from '../src/providers/claude/session.js';
import { shareConfig } from '../src/providers/claude/accounts.js';
import { Accounts } from '../src/main/accounts.js';
import { createClaudeProvider } from '../src/providers/claude/index.js';
import { tempDir } from './fixtures/temp-dir.js';

// A stand-in for the SDK's query() that stays up between messages, as Claude Code does: each
// message gets the SDK messages `turn` gives for it. Every query started is kept, with the options
// it was started with, what it was sent and whether it was closed. `sdk` adds what each can be
// asked, by the options it was started with.
function fakeClaude(turn, sdk = () => ({})) {
  /** @type {{ options: any, prompts: any[], closed: boolean }[]} */
  const started = [];
  const queryFn = ({ prompt, options }) => {
    const call = { options, prompts: [], closed: false };
    started.push(call);
    async function* run() {
      for await (const message of prompt) {
        call.prompts.push(message);
        for (const step of turn(message.message.content, started.length - 1)) {
          if (typeof step === 'function') await step(options);
          else yield step;
        }
      }
    }
    const gen = run();
    gen.initializationResult = async () => ({});
    gen.interrupt = async () => {};
    gen.getContextUsage = async () => {
      throw new Error('not asked here');
    };
    gen.close = () => {
      call.closed = true;
    };
    return Object.assign(gen, sdk(options));
  };
  return { queryFn, started };
}

const RESETS = Date.UTC(2026, 9, 14, 9) / 1000;
const init = (id = 'sess-1') => ({
  type: 'system',
  subtype: 'init',
  session_id: id,
  model: 'opus',
  permissionMode: 'default',
  cwd: '/tmp',
});
const said = (text, id = 'm1') => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { id, content: [{ type: 'text', text }] },
});
const result = (isError = false) => ({
  type: 'result',
  subtype: 'success',
  is_error: isError,
  duration_ms: 5,
  total_cost_usd: 0,
  num_turns: 1,
});
/** What Claude Code says when the account's weekly limit turns a message away. */
const turnedAway = () => [
  init(),
  {
    type: 'rate_limit_event',
    rate_limit_info: { status: 'rejected', rateLimitType: 'seven_day', resetsAt: RESETS },
    uuid: 'u1',
    session_id: 'sess-1',
  },
  { ...said('You’ve hit your limit', 'limit'), error: 'rate_limit' },
  result(true),
];
const answered = () => [init(), said('Done.', 'm2'), result()];

/**
 * The logins a session can answer in, kept the way the app keeps them: the first is the user's own.
 * @param {string[]} names
 */
function logins(names, { automatic = false } = {}) {
  const all = names.map((name, i) => ({ id: i ? `acc-${i}` : '', dir: i ? `/data/accounts/acc-${i}` : '', name }));
  const state = { inUse: '', automatic, used: [] };
  const current = () => all.find((account) => account.id === state.inUse);
  return {
    state,
    accounts: {
      current,
      next: (tried) => all.find((account) => account.id !== current().id && !tried.has(account.id)) || null,
      use: (id) => {
        state.inUse = id;
        state.used.push(id);
      },
      automatic: () => state.automatic,
    },
  };
}

const contact = () => ({ cwd: '/tmp', model: '', permissionMode: 'default', sessionId: null });

function collect(session) {
  const events = [];
  session.emit = (e) => events.push(e);
  return events;
}

const until = (check) =>
  new Promise((resolve, reject) => {
    const give = setTimeout(() => {
      clearInterval(timer);
      reject(new Error('it never happened'));
    }, 2000);
    const timer = setInterval(() => {
      const found = check();
      if (found) {
        clearInterval(timer);
        clearTimeout(give);
        resolve(found);
      }
    }, 5);
  });
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

test('closing on a usage-limit result prevents both account offers and automatic account retries', async () => {
  for (const automatic of [false, true]) {
    const { queryFn, started } = fakeClaude(() => turnedAway());
    const { state, accounts } = logins(['me@example.com', 'work@example.com'], { automatic });
    const events = [];
    const session = new ClaudeSession({
      contact: contact(),
      queryFn,
      accounts,
      emit: (event) => {
        events.push(event);
        if (event.type === 'result' && event.usageLimited) session.close();
      },
    });
    session.send({ text: 'finish the work' });
    await until(() => events.some((event) => event.type === 'result'));
    await settle();
    assert.equal(started.length, 1);
    assert.equal(started[0].closed, true);
    assert.deepEqual(state.used, []);
    assert.equal(
      events.some((event) => event.type === 'permission'),
      false
    );
  }
});

test('a session starts in the account in use: an added one in its own folder, the user’s own as it is', async () => {
  const { queryFn, started } = fakeClaude(() => answered());
  const { state, accounts } = logins(['me@example.com', 'work@example.com']);
  const own = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, accounts });
  own.send({ text: 'hi' });
  assert.equal(started[0].options.env.CLAUDE_CONFIG_DIR, process.env.CLAUDE_CONFIG_DIR);

  state.inUse = 'acc-1';
  const added = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, accounts });
  added.send({ text: 'hi' });
  assert.equal(started[1].options.env.CLAUDE_CONFIG_DIR, '/data/accounts/acc-1');
});

test('a limit offers to go on in the next account, and accepting sends the message again from there', async () => {
  const { queryFn, started } = fakeClaude((_text, call) => (call === 0 ? turnedAway() : answered()));
  const { state, accounts } = logins(['me@example.com', 'work@example.com']);
  const c = contact();
  const session = new ClaudeSession({ contact: c, emit: () => {}, queryFn, accounts });
  const events = collect(session);
  session.send({ text: 'fix the tests', images: [], id: 'm-1' });

  const offer = await until(() => events.find((e) => e.type === 'permission'));
  assert.equal(offer.kind, 'tool');
  assert.deepEqual(offer.activity, { kind: 'account', label: 'work@example.com' });
  assert.equal(offer.canAlways, false);
  assert.match(
    offer.reason,
    /^me@example\.com reached its weekly limit\. Resets .+\. Your message is sent again from there\.$/
  );
  assert.equal(session.state, 'waiting');
  // Claude Code's own words about the limit are in the conversation too.
  assert.ok(events.some((e) => e.type === 'text-end' && e.text === 'You’ve hit your limit'));

  session.respond(offer.requestId, { decision: 'allow' });
  await until(() => started[1]?.prompts.length);
  assert.deepEqual(state.used, ['acc-1']);
  assert.equal(started[0].closed, true, 'Claude Code in the first account is closed');
  assert.equal(started[1].options.env.CLAUDE_CONFIG_DIR, '/data/accounts/acc-1');
  assert.equal(started[1].options.resume, 'sess-1', 'and the conversation is picked up in the next');
  assert.equal(started[1].prompts[0].message.content, 'fix the tests');
  // Claude Code has it by its id already, with what the limit said: going back to it goes back to before both.
  assert.equal(started[0].prompts[0].uuid, 'm-1');
  assert.equal('uuid' in started[1].prompts[0], false);
  assert.ok(
    events.some((e) => e.type === 'notice' && e.text === 'Switched to work@example.com, and sent your message again.')
  );
  await until(() => events.some((e) => e.type === 'text-end' && e.text === 'Done.'));
  assert.equal(state.automatic, false);
});

test('accepting a switch asks again if the next account also reaches its limit', async () => {
  const { queryFn, started } = fakeClaude(() => turnedAway());
  const { state, accounts } = logins(['me@example.com', 'work@example.com', 'other@example.com']);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, accounts });
  const events = collect(session);
  session.send({ text: 'go' });
  const offer = await until(() => events.find((e) => e.type === 'permission'));
  session.respond(offer.requestId, { decision: 'allow' });
  const nextOffer = await until(() => events.filter((e) => e.type === 'permission')[1]);
  assert.equal(nextOffer.activity.label, 'other@example.com');
  assert.equal(nextOffer.canAlways, false);
  assert.equal(state.automatic, false);
  assert.deepEqual(state.used, ['acc-1']);
  assert.equal(started.length, 2);
  assert.equal(session.state, 'waiting');
  session.respond(nextOffer.requestId, { decision: 'deny' });
  await session.close();
});

test('an Always allow response cannot enable automatic account switching', async () => {
  const { queryFn, started } = fakeClaude(() => turnedAway());
  const { state, accounts } = logins(['me@example.com', 'work@example.com']);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, accounts });
  const events = collect(session);
  session.send({ text: 'go' });
  const offer = await until(() => events.find((e) => e.type === 'permission'));
  session.respond(offer.requestId, { decision: 'always' });
  await settle();
  assert.equal(state.automatic, false);
  assert.deepEqual(state.used, []);
  assert.equal(started.length, 1);
  await session.close();
});

test('declining stays in the account that reached its limit, and sends nothing again', async () => {
  const { queryFn, started } = fakeClaude(() => turnedAway());
  const { state, accounts } = logins(['me@example.com', 'work@example.com']);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, accounts });
  const events = collect(session);
  session.send({ text: 'go' });
  const offer = await until(() => events.find((e) => e.type === 'permission'));
  session.respond(offer.requestId, { decision: 'deny' });
  await settle();
  assert.deepEqual(state.used, []);
  assert.equal(started.length, 1);
  assert.equal(started[0].prompts.length, 1);
  assert.equal(session.state, 'idle');
});

test('without asking, a limit goes on in the next account straight away', async () => {
  const { queryFn, started } = fakeClaude((_text, call) => (call === 0 ? turnedAway() : answered()));
  const { state, accounts } = logins(['me@example.com', 'work@example.com'], { automatic: true });
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, accounts });
  const events = collect(session);
  session.send({ text: 'go' });
  await until(() => started[1]?.prompts.length);
  assert.equal(events.filter((e) => e.type === 'permission').length, 0);
  assert.deepEqual(state.used, ['acc-1']);
  assert.equal(started[1].prompts[0].message.content, 'go');
});

test('a personal limit retries in the team organization with the same email', async () => {
  const email = 'me@example.com';
  const settings = {
    accounts: {
      claude: {
        added: [{ id: 'team', email, orgId: 'team-org', orgName: 'Our team', plan: 'team' }],
        inUse: '',
        switchOnLimit: true,
      },
    },
  };
  const manager = new Accounts({
    root: '/data/accounts',
    store: { settings, updateSettings: (patch) => Object.assign(settings, patch) },
    ops: () => ({
      status: async () => ({ signedIn: true, email, orgId: 'personal-org', plan: 'max' }),
      prepare: () => {},
    }),
  });
  await manager.start('claude');
  const { queryFn, started } = fakeClaude((_text, call) => (call === 0 ? turnedAway() : answered()));
  const session = new ClaudeSession({
    contact: contact(),
    emit: () => {},
    queryFn,
    accounts: manager.switchFor('claude'),
  });
  const events = collect(session);
  session.send({ text: 'continue this work' });
  await until(() => events.some((event) => event.type === 'text-end' && event.text === 'Done.'));
  assert.equal(settings.accounts.claude.inUse, 'team');
  assert.equal(started[0].closed, true);
  assert.equal(started[1].options.env.CLAUDE_CONFIG_DIR, '/data/accounts/claude/team');
  assert.equal(started[1].options.resume, 'sess-1');
  assert.equal(started[1].prompts[0].message.content, 'continue this work');
  assert.equal(
    events.some((event) => event.type === 'permission'),
    false
  );
  assert.ok(events.some((event) => event.type === 'notice' && event.text.includes('Our team · Team')));
  await session.close();
});

test('a limit goes on past an added account that is the same login as the user’s own', async () => {
  const team = { email: 'me@example.com', orgId: 'team-org', orgName: 'Our team', plan: 'team' };
  const settings = {
    accounts: {
      claude: {
        added: [
          { id: 'twin', ...team },
          { id: 'work', email: 'work@example.com' },
        ],
        inUse: '',
        switchOnLimit: true,
      },
    },
  };
  const manager = new Accounts({
    root: '/data/accounts',
    store: { settings, updateSettings: (patch) => Object.assign(settings, patch) },
    ops: () => ({ status: async () => ({ signedIn: true, ...team }), prepare: () => {} }),
  });
  await manager.start('claude');
  const { queryFn, started } = fakeClaude((_text, call) => (call === 0 ? turnedAway() : answered()));
  const session = new ClaudeSession({
    contact: contact(),
    emit: () => {},
    queryFn,
    accounts: manager.switchFor('claude'),
  });
  const events = collect(session);
  session.send({ text: 'go' });
  await until(() => events.some((event) => event.type === 'text-end' && event.text === 'Done.'));
  assert.equal(settings.accounts.claude.inUse, 'work');
  assert.equal(started[1].options.env.CLAUDE_CONFIG_DIR, '/data/accounts/claude/work');
  await session.close();
});

test('a message turned away by every account is not sent round in a circle', async () => {
  const { queryFn, started } = fakeClaude(() => turnedAway());
  const { state, accounts } = logins(['me@example.com', 'work@example.com'], { automatic: true });
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, accounts });
  const events = collect(session);
  session.send({ text: 'go' });
  const notice = await until(() => events.find((e) => e.type === 'notice' && /Every one/.test(e.text)));
  assert.match(
    notice.text,
    /^work@example\.com reached its weekly limit\. .+ Every one of your accounts has reached a limit\.$/
  );
  await settle();
  assert.deepEqual(state.used, ['acc-1']);
  assert.equal(started.length, 2);

  // A new message of the user’s own may go to every account again.
  session.send({ text: 'and now?' });
  await until(() => state.used.length === 2);
  assert.deepEqual(state.used, ['acc-1', '']);
});

test('with one account there is nobody else to offer, and Claude Code’s own message says it all', async () => {
  const { queryFn } = fakeClaude(() => turnedAway());
  const { accounts } = logins(['me@example.com']);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, accounts });
  const events = collect(session);
  session.send({ text: 'go' });
  await until(() => events.some((e) => e.type === 'result'));
  await settle();
  assert.equal(events.filter((e) => e.type === 'permission' || e.type === 'notice').length, 0);
});

for (const rateLimitType of ['five_hour', 'seven_day']) {
  test(`${rateLimitType} marks the blocked turn for an invite suggestion, without marking the next turn`, async () => {
    const { queryFn } = fakeClaude((text) => {
      if (text !== 'go') return answered();
      const steps = turnedAway();
      steps[1].rate_limit_info.rateLimitType = rateLimitType;
      return steps;
    });
    const { accounts } = logins(['me@example.com']);
    const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, accounts });
    const events = collect(session);
    session.send({ text: 'go' });
    const blocked = await until(() => events.find((e) => e.type === 'result'));
    assert.equal(blocked.usageLimited, true);
    assert.equal(blocked.limitKind, rateLimitType === 'five_hour' ? 'session' : 'weekly');
    session.send({ text: 'again' });
    await until(() => events.filter((e) => e.type === 'result').length === 2);
    assert.equal(events.filter((e) => e.type === 'result')[1].usageLimited, undefined);
    session.close();
  });
}

test('a new message withdraws the offer to send the one before again', async () => {
  const { queryFn } = fakeClaude((text) => (text === 'first' ? turnedAway() : answered()));
  const { state, accounts } = logins(['me@example.com', 'work@example.com']);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, accounts });
  const events = collect(session);
  session.send({ text: 'first' });
  const offer = await until(() => events.find((e) => e.type === 'permission'));
  session.send({ text: 'never mind' });
  const withdrawn = events.find((e) => e.type === 'permission-resolved' && e.requestId === offer.requestId);
  assert.equal(withdrawn?.decision, 'cancelled');
  await settle();
  assert.deepEqual(state.used, []);
});

test('a turn that was not the newest message, such as a check-in, switches without sending anything again', async () => {
  const { queryFn, started } = fakeClaude((text, call) =>
    call === 0
      ? [
          // Claude woke itself for a check-in, and the limit turned that away.
          async (options) => {
            const [submitted] = options.hooks.UserPromptSubmit[0].hooks;
            await submitted({ prompt: 'check CI', source: 'schedule_wakeup' });
          },
          ...turnedAway(),
        ]
      : answered()
  );
  const { state, accounts } = logins(['me@example.com', 'work@example.com']);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, accounts });
  const events = collect(session);
  session.send({ text: 'hello' });
  const offer = await until(() => events.find((e) => e.type === 'permission'));
  assert.doesNotMatch(offer.reason, /sent again/);
  session.respond(offer.requestId, { decision: 'allow' });
  await until(() => events.some((e) => e.type === 'notice' && e.text === 'Switched to work@example.com.'));
  await settle();
  assert.deepEqual(state.used, ['acc-1']);
  assert.equal(started.length, 1, 'nothing is started until there is something to send');
});

test('an account put in use elsewhere takes over with the next message, not in the middle of a turn', async () => {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const { queryFn, started } = fakeClaude((text) =>
    text === 'slow' ? [init(), () => held, said('Slow done.', 'm3'), result()] : answered()
  );
  const { state, accounts } = logins(['me@example.com', 'work@example.com']);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, accounts });
  const events = collect(session);
  session.send({ text: 'hi' });
  await until(() => events.some((e) => e.type === 'result'));

  session.send({ text: 'slow' });
  await until(() => started[0].prompts.length === 2);
  state.inUse = 'acc-1';
  // In the middle of a turn: what is sent meanwhile waits in the same Claude Code.
  session.send({ text: 'and this' });
  assert.equal(started.length, 1);
  release();
  await until(() => events.filter((e) => e.type === 'result').length === 3);

  session.send({ text: 'next' });
  assert.equal(started.length, 2);
  assert.equal(started[0].closed, true);
  assert.equal(started[1].options.env.CLAUDE_CONFIG_DIR, '/data/accounts/acc-1');
  assert.equal(started[1].options.resume, 'sess-1');
});

/**
 * Claude Code's task tools, as they keep a conversation's to-do list: a file a task in the config folder it was started
 * with. Each call is Claude's, and its result what Claude Code says back, in words and as the tool returned it.
 */
function taskTools(options, own) {
  const folder = path.join(options.env.CLAUDE_CONFIG_DIR || own, 'tasks', 'sess-1');
  const file = (id) => path.join(folder, `${id}.json`);
  const step = (id, name, input, text, structured) => [
    {
      type: 'assistant',
      parent_tool_use_id: null,
      message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name, input }] },
    },
    {
      type: 'user',
      parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] },
      tool_use_result: structured,
    },
  ];
  return {
    create: (taskId, subject) => {
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(file(taskId), JSON.stringify({ id: taskId, subject, status: 'pending' }));
      const text = `Task #${taskId} created successfully: ${subject}`;
      return step(`create-${taskId}`, 'TaskCreate', { subject, description: subject }, text, {
        task: { id: taskId, subject },
      });
    },
    update: (taskId, status) => {
      const id = `update-${taskId}-${status}`;
      if (!fs.existsSync(file(taskId))) {
        const failed = { success: false, taskId, updatedFields: [], error: 'Task not found' };
        return step(id, 'TaskUpdate', { taskId, status }, 'Task not found', failed);
      }
      fs.writeFileSync(file(taskId), JSON.stringify({ ...JSON.parse(fs.readFileSync(file(taskId), 'utf8')), status }));
      const done = { success: true, taskId, updatedFields: ['status'] };
      return step(id, 'TaskUpdate', { taskId, status }, `Updated task #${taskId} status`, done);
    },
  };
}

test('a to-do list made in one account goes on changing once the conversation moves to another', async () => {
  const home = tempDir('buddylist-switch-');
  const own = { dir: path.join(home, '.claude'), file: path.join(home, '.claude.json') };
  fs.mkdirSync(path.join(own.dir, 'projects'), { recursive: true });
  const all = ['me@example.com', 'work@example.com', 'old@example.com'].map((name, i) => ({
    id: `acc-${i + 1}`,
    dir: path.join(home, 'accounts', `acc-${i + 1}`),
    name,
  }));
  // The app gets each account's folder ready as it is added or put in use. The last one is as one was before the
  // to-do lists were shared: a folder of its own.
  shareConfig(all[0].dir, { own });
  shareConfig(all[1].dir, { own });
  fs.mkdirSync(all[2].dir, { recursive: true });
  const state = { inUse: 'acc-1' };
  const accounts = {
    current: () => all.find((account) => account.id === state.inUse),
    next: () => null,
    use: (id) => (state.inUse = id),
    automatic: () => false,
  };
  const { queryFn, started } = fakeClaude((text, i) => {
    const tasks = taskTools(started[i].options, own.dir);
    const steps = {
      plan: () => [
        ...tasks.create('1', 'Research'),
        ...tasks.create('2', 'Build'),
        ...tasks.update('1', 'in_progress'),
      ],
      'go on': () => [...tasks.update('1', 'completed'), ...tasks.update('2', 'in_progress')],
      finish: () => tasks.update('2', 'completed'),
    };
    return [init(), ...steps[text](), result()];
  });
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, accounts });
  const events = collect(session);
  const lastList = () => events.filter((e) => e.type === 'tool' && e.activity.kind === 'todo').at(-1).activity;
  const turns = (n) => until(() => events.filter((e) => e.type === 'result').length === n);

  session.send({ text: 'plan' });
  await turns(1);
  state.inUse = 'acc-2';
  session.send({ text: 'go on' });
  await turns(2);
  assert.equal(started[1].options.env.CLAUDE_CONFIG_DIR, all[1].dir);
  assert.equal(started[1].options.resume, 'sess-1');
  assert.deepEqual(lastList(), {
    kind: 'todo',
    todos: [
      { id: '1', text: 'Research', status: 'completed' },
      { id: '2', text: 'Build', status: 'in_progress' },
    ],
  });

  // In a folder that doesn’t share the list, Claude Code can’t find it: the list says so, and claims no step.
  state.inUse = 'acc-3';
  session.send({ text: 'finish' });
  await turns(3);
  assert.equal(started[2].options.env.CLAUDE_CONFIG_DIR, all[2].dir);
  assert.deepEqual(lastList(), {
    kind: 'todo',
    todos: [
      { id: '1', text: 'Research', status: 'completed' },
      { id: '2', text: 'Build', status: 'in_progress' },
    ],
    stale: true,
  });
  session.close();
});

test('how much of the plan’s limits is used is said to be of the account Claude Code was started in', async () => {
  const windows = {
    five_hour: { utilization: 0.4, resetsAt: RESETS },
    seven_day: { utilization: 0.2, resetsAt: RESETS },
  };
  const heard = () => [
    init(),
    {
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed', unifiedWindows: windows },
      uuid: 'u1',
      session_id: 'sess-1',
    },
    ...answered().slice(1),
  ];
  const { queryFn } = fakeClaude(() => heard());
  const { state, accounts } = logins(['me@example.com', 'work@example.com']);
  const limitsOf = async () => {
    const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, accounts });
    const events = collect(session);
    session.send({ text: 'hi' });
    return until(() => events.find((e) => e.type === 'limits'));
  };
  // The user's own says no account, as a provider with one login does.
  assert.equal('account' in (await limitsOf()), false);
  state.inUse = 'acc-1';
  const added = await limitsOf();
  assert.equal(added.account, 'acc-1');
  assert.deepEqual(
    added.limits.map(({ kind, percent }) => [kind, percent]),
    [
      ['session', 40],
      ['weekly', 20],
    ]
  );
});

// What each account says of its plan when asked: the user's own is nearly at its session limit, the added one isn't.
const PLANS = {
  own: { email: 'me@example.com', subscription: 'team', session: 95 },
  work: { email: 'work@example.com', subscription: 'max', session: 3 },
};
const ASK_PLAN = 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET';
/** A Claude Code that answers about its window and its plan, as the account it was started in. */
const answersUsage = (options) => {
  const { email, subscription, session } =
    options.env.CLAUDE_CONFIG_DIR === '/data/accounts/acc-1' ? PLANS.work : PLANS.own;
  return {
    getContextUsage: async () => ({ totalTokens: 279_100, maxTokens: 1_000_000, categories: [] }),
    [ASK_PLAN]: async () => ({
      subscription_type: subscription,
      rate_limits_available: true,
      rate_limits: { five_hour: { utilization: session, resets_at: '2026-10-14T09:00:00Z' } },
    }),
    accountInfo: async () => ({ email }),
  };
};

test('the plan shown after another account was put in use mid-turn is that one’s, and the turn goes on', async () => {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const { queryFn, started } = fakeClaude(() => [init(), () => held, said('Slow done.', 'm3'), result()], answersUsage);
  const { state, accounts } = logins(['me@example.com', 'work@example.com']);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, accounts });
  const events = collect(session);
  session.send({ text: 'slow' });
  await until(() => started[0].prompts.length);

  state.inUse = 'acc-1';
  const usage = await session.usage();
  assert.equal(usage.account, 'work@example.com (Max)');
  assert.equal(usage.plan, 'max');
  assert.deepEqual(
    usage.limits.map(({ kind, percent }) => [kind, percent]),
    [['session', 3]]
  );
  // The status bar is told they are the added account's, not the one the turn is still in.
  assert.deepEqual(events.filter((e) => e.type === 'limits').at(-1), {
    type: 'limits',
    limits: usage.limits,
    account: 'acc-1',
  });
  // A Claude Code of its own was started in that account to be asked, sent nothing, and closed again.
  assert.equal(started.length, 2);
  assert.equal(started[1].options.env.CLAUDE_CONFIG_DIR, '/data/accounts/acc-1');
  assert.equal(started[1].options.persistSession, false);
  assert.deepEqual(started[1].prompts, []);
  assert.equal(started[1].closed, true);
  // And the window is still the conversation's, whose turn goes on where it is.
  assert.equal(usage.context.used, 279_100);
  assert.equal(started[0].closed, false);
  release();
  await until(() => events.some((e) => e.type === 'text-end' && e.text === 'Slow done.'));
  session.close();
});

test('the plan of the account Claude Code is in is asked of Claude Code itself', async () => {
  const { queryFn, started } = fakeClaude(() => answered(), answersUsage);
  const { state, accounts } = logins(['me@example.com', 'work@example.com']);
  state.inUse = 'acc-1';
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, accounts });
  const events = collect(session);
  const usage = await session.usage();
  assert.equal(usage.account, 'work@example.com (Max)');
  assert.equal(started.length, 1);
  assert.equal(events.find((e) => e.type === 'limits').account, 'acc-1');

  // Put back in the user's own between turns, Claude Code moves there before it is asked.
  state.inUse = '';
  assert.equal((await session.usage()).account, 'me@example.com (Team)');
  assert.equal(started.length, 2);
  assert.equal(started[0].closed, true);
  assert.equal('account' in events.filter((e) => e.type === 'limits').at(-1), false);
  session.close();
});

test('an Ultra login is called Ultra in the usage popover, whichever Claude Code is asked about it', async (t) => {
  // Two logins Claude Code calls "max" alike: what it keeps of each in its folder says which one is Ultra.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-ultra-usage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const who = {
    mid: { email: 'mid@example.com', tier: 'default_claude_max_5x' },
    big: { email: 'big@example.com', tier: 'default_claude_max_20x' },
  };
  const all = Object.entries(who).map(([id, { email, tier }]) => {
    const dir = path.join(root, id);
    fs.mkdirSync(dir);
    const saved = { oauthAccount: { emailAddress: email, organizationRateLimitTier: tier } };
    fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify(saved));
    return { id, dir, name: email };
  });
  const state = { inUse: 'mid' };
  const accounts = {
    current: () => all.find((one) => one.id === state.inUse),
    next: () => null,
    use() {},
    automatic: () => false,
  };
  const answers = (options) => ({
    getContextUsage: async () => ({ totalTokens: 1000, maxTokens: 200_000, categories: [] }),
    [ASK_PLAN]: async () => ({
      subscription_type: 'max',
      rate_limits_available: true,
      rate_limits: { five_hour: { utilization: 5, resets_at: '2026-10-14T09:00:00Z' } },
    }),
    accountInfo: async () => ({ email: who[path.basename(options.env.CLAUDE_CONFIG_DIR)].email }),
  });
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const { queryFn, started } = fakeClaude(() => [init(), () => held, said('Slow done.', 'm3'), result()], answers);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, accounts });
  const events = collect(session);

  // The conversation's own Claude Code, in the Max login.
  let usage = await session.usage();
  assert.equal(usage.plan, 'max');
  assert.equal(usage.account, 'mid@example.com (Max)');

  // One started in the Ultra login only to be asked, while the turn goes on in the other.
  session.send({ text: 'slow' });
  await until(() => started[0].prompts.length);
  state.inUse = 'big';
  usage = await session.usage();
  assert.equal(started.length, 2);
  assert.equal(usage.plan, 'ultra');
  assert.equal(usage.account, 'big@example.com (Ultra)');
  release();
  await until(() => events.some((e) => e.type === 'text-end' && e.text === 'Slow done.'));

  // And the conversation's own once it has moved there.
  usage = await session.usage();
  assert.equal(started.length, 3);
  assert.equal(started[2].options.env.CLAUDE_CONFIG_DIR, path.join(root, 'big'));
  assert.equal(usage.plan, 'ultra');
  assert.equal(usage.account, 'big@example.com (Ultra)');
  session.close();
});

test('another account put in use mid-turn is said to hold from the next turn, and the turn goes on', async () => {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const { queryFn, started } = fakeClaude(
    (text) => (text === 'slow' ? [init(), () => held, said('Slow done.', 'm3'), result()] : answered()),
    answersUsage
  );
  const { state, accounts } = logins(['me@example.com', 'work@example.com']);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, accounts });
  const events = collect(session);
  session.send({ text: 'slow' });
  await until(() => started[0].prompts.length);

  state.inUse = 'acc-1';
  session.accountSwitched();
  assert.deepEqual(
    events.filter((e) => e.type === 'notice'),
    [{ type: 'notice', text: 'Switched to work@example.com from the next turn. This one finishes in me@example.com.' }]
  );
  // It finishes where it is, and the next message is in the one put in use.
  assert.equal(started[0].closed, false);
  release();
  await until(() => events.some((e) => e.type === 'result'));
  session.send({ text: 'next' });
  await until(() => started.length === 2);
  assert.equal(started[0].closed, true);
  assert.equal(started[1].options.env.CLAUDE_CONFIG_DIR, '/data/accounts/acc-1');
  session.close();
});

test('a session between turns, or already in the account put in use, says nothing of it', async () => {
  const { queryFn, started } = fakeClaude(() => answered());
  const { state, accounts } = logins(['me@example.com', 'work@example.com']);
  const session = new ClaudeSession({ contact: contact(), emit: () => {}, queryFn, accounts });
  const events = collect(session);
  // Not started yet: it starts in the one in use.
  state.inUse = 'acc-1';
  session.accountSwitched();
  session.send({ text: 'hi' });
  await until(() => events.some((e) => e.type === 'result'));
  // Between turns: it moves with the next message.
  state.inUse = '';
  session.accountSwitched();
  // Put back in the one it is in before it moved.
  state.inUse = 'acc-1';
  session.accountSwitched();
  assert.deepEqual(
    events.filter((e) => e.type === 'notice'),
    []
  );
  assert.equal(started.length, 1);
  session.close();
});

test('the conversation that switched by itself after a limit says nothing of the next turn', async () => {
  const { queryFn, started } = fakeClaude((_text, call) => (call === 0 ? turnedAway() : answered()));
  const { accounts } = logins(['me@example.com', 'work@example.com'], { automatic: true });
  const switched = [];
  const session = new ClaudeSession({
    contact: contact(),
    emit: () => {},
    queryFn,
    // As the app tells every session once one is put in use, this one too.
    accounts: { ...accounts, use: (id) => (accounts.use(id), switched.push(id), session.accountSwitched()) },
  });
  const events = collect(session);
  session.send({ text: 'hi' });
  await until(() => started.length === 2);
  assert.deepEqual(switched, ['acc-1']);
  assert.deepEqual(
    events.filter((e) => e.type === 'notice').map((e) => e.text),
    ['Switched to work@example.com, and sent your message again.']
  );
  session.close();
});

test('what a limit is called, and when it starts over', () => {
  const now = Date.UTC(2026, 9, 14, 7, 30);
  assert.equal(
    limitReached('me@example.com', { status: 'rejected', rateLimitType: 'five_hour', resetsAt: RESETS }, now),
    'me@example.com reached its session limit. Resets in 1 hr 30 min.'
  );
  assert.equal(
    limitReached(
      'me@example.com',
      { status: 'rejected', rateLimitType: 'seven_day_opus', resetsAt: RESETS * 1000 },
      now
    ),
    'me@example.com reached its weekly Opus limit. Resets in 1 hr 30 min.'
  );
  assert.equal(limitReached('me@example.com', null), 'me@example.com reached its usage limit.');
});

test('switching accounts as a selected queued message starts preserves every remaining message', async (t) => {
  let finish;
  const held = new Promise((resolve) => {
    finish = resolve;
  });
  const { queryFn, started } = fakeClaude((_text, call) => (call === 0 ? [init(), () => held, result()] : answered()));
  const { accounts } = logins(['First', 'Second']);
  const session = new ClaudeSession({ contact: contact(), emit() {}, queryFn, accounts });
  t.after(() => session.close());
  session.send({ id: 'running', text: 'running' });
  await until(() => started[0]?.prompts.length);
  session.send({ id: 'first', text: 'first' });
  session.send({ id: 'second', text: 'second' });
  session.send({ id: 'third', text: 'third' });
  accounts.use('acc-1');
  await session.sendNow('second');
  finish();
  await until(() => started[1]?.prompts.length === 3);
  assert.deepEqual(
    started[1].prompts.map((message) => message.uuid),
    ['second', 'first', 'third']
  );
});

/** A real shared account service, with read-only deterministic subscription probes. */
function proactiveAccounts() {
  let ownUsed = 10;
  let now = Date.now();
  const identity = (dir) => ({
    signedIn: true,
    eligible: true,
    email: dir ? 'work@example.com' : 'me@example.com',
    plan: 'max',
    orgId: dir ? 'work' : 'own',
  });
  const store = {
    settings: { accounts: { claude: { added: [{ id: 'work', ...identity('work') }], inUse: '' } } },
    updateSettings(patch) {
      Object.assign(this.settings, patch);
      return this.settings;
    },
    setLimits() {},
  };
  const ops = {
    prepare() {},
    status: async (dir) => identity(dir),
    quota: async (dir) => ({
      ...identity(dir),
      eligible: true,
      limits: ['session', 'weekly'].map((kind) => ({
        kind,
        percent: dir ? 10 : ownUsed,
        resetsAt: now + 3_600_000,
      })),
    }),
  };
  const accounts = new Accounts({ store, ops: () => ops, root: '/data/accounts', now: () => now });
  accounts.setProactive('claude', true, 90);
  return {
    accounts,
    ops,
    full: () => {
      ownUsed = 95;
      now += 60_001;
    },
  };
}

test('proactive rotation resumes the complete session with the same cwd, images and permissions', async (t) => {
  const f = proactiveAccounts();
  const { queryFn, started } = fakeClaude(() => answered());
  const c = { ...contact(), permissionMode: 'plan', cwd: '/tmp/account-worktree' };
  const session = new ClaudeSession({ contact: c, queryFn, accounts: f.accounts.switchFor('claude'), emit() {} });
  const events = collect(session);
  t.after(() => session.close());
  session.send({ text: 'first message', id: 'first' });
  await until(() => events.some((event) => event.type === 'result'));
  f.full();
  const image = { mediaType: 'image/png', data: 'aGVsbG8=' };
  const boundaryAt = events.length;
  session.send({ text: 'keep going', images: [image], id: 'next' });
  await until(() => started[1]?.prompts.length);
  assert.equal(started[0].closed, true);
  assert.equal(started[1].options.env.CLAUDE_CONFIG_DIR, '/data/accounts/claude/work');
  assert.equal(started[1].options.resume, 'sess-1');
  assert.equal(started[1].options.cwd, c.cwd);
  assert.equal(started[1].options.permissionMode, 'plan');
  assert.equal(started[1].prompts[0].uuid, 'next');
  const boundaryStates = events
    .slice(boundaryAt)
    .filter((event) => event.type === 'state')
    .map((event) => event.state);
  assert.deepEqual(
    boundaryStates.slice(0, 2),
    ['connecting', 'working'],
    'no idle notification releases manager notes before dispatch'
  );
  assert.equal(started[1].prompts[0].message.content[0].source.data, image.data);
  assert.ok(events.some((event) => event.type === 'notice' && /before this turn/.test(event.text)));
  session.close();
});

test('a helper, background command, check-in or explicit project credential prevents proactive restart', async () => {
  for (const busy of ['helper', 'background', 'check-in', 'project credential']) {
    const f = proactiveAccounts();
    const { queryFn, started } = fakeClaude(() => answered());
    const session = new ClaudeSession({
      contact: contact(),
      queryFn,
      accounts: f.accounts.switchFor('claude'),
      emit() {},
    });
    const events = collect(session);
    session.send({ text: 'first' });
    await until(() => events.some((event) => event.type === 'result'));
    if (busy === 'helper') session.helpers.set('h1', 'task1');
    if (busy === 'background')
      session.background.started({ task_id: 'bg1', task_type: 'local_bash', is_backgrounded: true });
    if (busy === 'check-in') session.checkIns = [{ id: 'wake' }];
    if (busy === 'project credential') session.env.ANTHROPIC_API_KEY = 'test-only';
    f.full();
    session.send({ text: 'second' });
    await until(() => events.filter((event) => event.type === 'result').length === 2);
    assert.equal(f.accounts.loginOf('claude'), '', busy);
    assert.equal(started.length, 1, busy);
    assert.equal(started[0].closed, false, busy);
    session.close();
  }
});

test('an active concurrent Claude turn stays in its account and blocks global proactive rotation', async () => {
  const f = proactiveAccounts();
  f.full();
  // This account service tracks sessions even when opting in happens after they were started.
  f.accounts.setProactive('claude', false, 90);
  let finish;
  const slow = fakeClaude(() => [
    init('active-session'),
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    result(),
  ]);
  const active = new ClaudeSession({
    contact: contact(),
    queryFn: slow.queryFn,
    accounts: f.accounts.switchFor('claude'),
    emit() {},
  });
  active.send({ text: 'long turn' });
  await until(() => finish);
  f.accounts.setProactive('claude', true, 90);
  const quick = fakeClaude(() => answered());
  const next = new ClaudeSession({
    contact: contact(),
    queryFn: quick.queryFn,
    accounts: f.accounts.switchFor('claude'),
    emit() {},
  });
  next.send({ text: 'another conversation' });
  await until(() => quick.started[0]?.prompts.length);
  assert.equal(f.accounts.loginOf('claude'), '');
  assert.equal(slow.started[0].closed, false);
  finish();
  active.close();
  next.close();
});

test('Stop while quota checks wait cancels dispatch and cannot later rotate an account', async () => {
  const f = proactiveAccounts();
  f.full();
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const read = f.ops.quota;
  f.ops.quota = async (dir) => {
    await wait;
    return read(dir);
  };
  const { queryFn, started } = fakeClaude(() => answered());
  const session = new ClaudeSession({
    contact: contact(),
    queryFn,
    accounts: f.accounts.switchFor('claude'),
    emit() {},
  });
  session.send({ text: 'do not dispatch this' });
  assert.equal(session.state, 'connecting');
  await session.interrupt();
  release();
  await settle();
  assert.equal(started.length, 0);
  assert.equal(f.accounts.loginOf('claude'), '');
  assert.equal(session.dispatching, false);
  session.close();
});

test('a pinned fallback starts synchronously in its explicit account without using the proactive gate', async () => {
  const f = proactiveAccounts();
  f.full();
  let probes = 0;
  f.ops.quota = async () => {
    probes++;
    throw new Error('must not read');
  };
  const { queryFn, started } = fakeClaude(() => answered());
  const session = new ClaudeSession({
    contact: { ...contact(), fallbackManaged: true },
    queryFn,
    accounts: f.accounts.switchFor('claude', 'work'),
    emit() {},
  });
  session.send({ text: 'consented fallback' });
  assert.equal(started.length, 1);
  assert.equal(started[0].options.env.CLAUDE_CONFIG_DIR, '/data/accounts/claude/work');
  assert.equal(f.accounts.loginOf('claude'), '');
  assert.equal(probes, 0);
  session.close();
});

// Two logins of one email, as the app keeps them: a personal Max plan, and a Team organization's.
function sameEmail() {
  const who = {
    personal: { email: 'me@example.com', orgId: 'o-personal', orgName: 'Personal', plan: 'max' },
    team: { email: 'me@example.com', orgId: 'o-acme', orgName: 'Acme', plan: 'team' },
  };
  const store = {
    settings: {
      accounts: {
        claude: {
          added: Object.entries(who).map(([id, one]) => ({ id, ...one })),
          inUse: 'personal',
          switchOnLimit: true,
        },
      },
    },
    updateSettings(patch) {
      Object.assign(this.settings, patch);
      return this.settings;
    },
    setLimits() {},
  };
  const ops = {
    prepare() {},
    status: async (dir) => ({ signedIn: true, eligible: true, ...who[dir.split('/').at(-1)] }),
    limits: async () => null,
  };
  const accounts = new Accounts({ store, ops: () => ops, root: '/data/accounts' });
  // Claude Code says what /usage says of the login of the folder it was started in.
  const answers = (options) => {
    const one = who[options.env.CLAUDE_CONFIG_DIR?.split('/').at(-1)];
    return {
      getContextUsage: async () => ({ totalTokens: 1000, maxTokens: 200_000, categories: [] }),
      [ASK_PLAN]: async () => ({
        subscription_type: one.plan,
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: one.plan === 'max' ? 9 : 0, resets_at: '2026-10-14T09:00:00Z' },
          seven_day: { utilization: one.plan === 'max' ? 95 : 0, resets_at: '2026-10-20T09:00:00Z' },
        },
      }),
      accountInfo: async () => ({ email: one.email, organization: one.orgName }),
    };
  };
  return { accounts, answers };
}

test('two logins of one email: the plan asked is of the one in use, named by its organization and plan', async () => {
  const { accounts, answers } = sameEmail();
  const { queryFn } = fakeClaude(() => answered(), answers);
  const session = new ClaudeSession({ contact: contact(), queryFn, accounts: accounts.switchFor('claude'), emit() {} });
  const events = collect(session);
  assert.equal((await session.usage()).account, 'me@example.com (Personal · Max)');

  accounts.use('claude', 'team');
  const usage = await session.usage();
  assert.equal(usage.plan, 'team');
  assert.equal(usage.account, 'me@example.com (Acme · Team)');
  assert.deepEqual(
    usage.limits.map(({ kind, percent }) => [kind, percent]),
    [
      ['session', 0],
      ['weekly', 0],
    ]
  );
  assert.equal(events.filter((e) => e.type === 'limits').at(-1).account, 'team');
  session.close();
});

test('with fallback rules on, a Claude session follows the account put in use, and only a continuation is pinned', () => {
  const { accounts } = sameEmail();
  const claude = createClaudeProvider({ isPackaged: false }, { accounts: (id) => accounts.switchFor('claude', id) });
  const ordinary = claude.createSession({ contact: { ...contact(), fallbackManaged: true }, emit() {} });
  const continuation = claude.createSession({
    contact: { ...contact(), fallbackManaged: true, accountId: 'personal' },
    emit() {},
  });
  accounts.use('claude', 'team');
  assert.equal(ordinary.accounts.current().id, 'team', 'it is in the account in use, not the one it was made in');
  assert.equal(continuation.accounts.current().id, 'personal');
  // Fallback rules, not a retry in the next account, decide what happens at a limit.
  assert.equal(ordinary.accounts.automatic(), false);
  assert.equal(ordinary.accounts.next(new Set()), null);
  ordinary.close();
  continuation.close();
});
