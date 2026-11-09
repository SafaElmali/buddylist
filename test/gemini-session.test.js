import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AcpSession } from '../src/providers/acp/session.js';
import { createGeminiProvider, descriptor, geminiAgent } from '../src/providers/gemini/index.js';
import { createProviders } from '../src/providers/index.js';
import { GEMINI_SESSION, rpcError, start, started, tick } from './fixtures/fake-acp.js';

// What is particular to Gemini CLI. The rest of its session is in
// acp-session.test.js, which plays every agent's part the way Gemini does.
const GEMINI = geminiAgent();

const selected = (optionId) => ({ outcome: { outcome: 'selected', optionId } });

test('Gemini’s word of a mode change is a mode change, not part of its reply', async () => {
  const { agent, events, of, session, contact } = await started(GEMINI, { contact: { permissionMode: 'plan' } });
  const before = events.length;
  // The echo of the mode this session asked for itself.
  agent.say('[MODE_UPDATE] plan');
  assert.equal(events.length, before);

  // A plan was approved on Gemini's card: Gemini leaves plan mode by itself.
  agent.say('Here is the plan.');
  const approval = agent.ask({ toolCallId: 'p1', status: 'pending', kind: 'other', title: 'Plan approval' }, [
    { optionId: 'proceed_once', name: 'Yes', kind: 'allow_once' },
    { optionId: 'cancel', name: 'No', kind: 'reject_once' },
  ]);
  await tick();
  session.respond(of('permission').at(-1).requestId, { decision: 'allow' });
  await approval;
  agent.say('[MODE_UPDATE] default');
  await agent.endTurn();
  assert.deepEqual(of('mode'), [{ type: 'mode', mode: 'default' }]);
  assert.equal(contact.permissionMode, 'default');
  assert.deepEqual(
    of('text-end').map((e) => e.text),
    ['Here is the plan.']
  );

  // Between turns too, which is when the echo of a change made in the Mode menu arrives.
  await session.setPermissionMode('autoEdit');
  agent.say('[MODE_UPDATE] autoEdit');
  assert.equal(of('mode').length, 1);
  assert.equal(of('text-start').length, 1);
  // Only that exact line is taken for one.
  session.send({ text: 'what does [MODE_UPDATE] yolo mean?' });
  await tick();
  agent.say('The line "[MODE_UPDATE] yolo" tells');
  await agent.endTurn();
  assert.equal(contact.permissionMode, 'autoEdit');
  assert.equal(of('text-end').at(-1).text, 'The line "[MODE_UPDATE] yolo" tells');
});

test('Gemini’s reply text never puts it in a looser mode than the one the user picked', async () => {
  for (const [from, to] of [
    ['default', 'yolo'],
    ['default', 'autoEdit'],
    ['plan', 'default'],
    ['autoEdit', 'yolo'],
  ]) {
    const { agent, of, session, contact } = await started(GEMINI, { contact: { permissionMode: from } });
    // Its model writes the very line Gemini CLI uses for one.
    agent.say(`[MODE_UPDATE] ${to}`);
    await agent.endTurn();
    assert.equal(contact.permissionMode, from, `${from} → ${to}`);
    assert.deepEqual(of('mode'), []);
    assert.equal(session.appToolsUnasked(), false);
    session.close();
  }
});

test('a stricter mode Gemini says it is in is taken, such as Plan mode it went into', async () => {
  const { agent, of, contact } = await started(GEMINI, { contact: { permissionMode: 'yolo' } });
  agent.say('[MODE_UPDATE] plan');
  await agent.endTurn();
  assert.equal(contact.permissionMode, 'plan');
  assert.deepEqual(of('mode'), [{ type: 'mode', mode: 'plan' }]);
});

test('Always allow on a file change lets Gemini go on auto-accepting edits, as it does by itself', async () => {
  const { agent, of, session, contact } = await started(GEMINI);
  const edit = { toolCallId: 'e1', status: 'pending', kind: 'edit', title: 'Edit a.js', locations: [{ path: 'a.js' }] };
  const answer = agent.ask(edit);
  await tick();
  session.respond(of('permission').at(-1).requestId, { decision: 'always' });
  assert.deepEqual(await answer, selected('proceed_always'));
  agent.say('[MODE_UPDATE] autoEdit');
  assert.equal(contact.permissionMode, 'autoEdit');
  // Once: a second word of it in this turn is the model's.
  await session.setPermissionMode('default');
  agent.say('[MODE_UPDATE] autoEdit');
  await agent.endTurn();
  assert.equal(contact.permissionMode, 'default');
  assert.deepEqual(of('mode'), [{ type: 'mode', mode: 'autoEdit' }]);
});

test('what the user let Gemini do lasts for that turn: in the next its reply text loosens nothing', async () => {
  const { agent, of, session, contact } = await started(GEMINI, { contact: { permissionMode: 'plan' } });
  const fetch = agent.ask({ toolCallId: 'f1', status: 'pending', kind: 'fetch', title: 'Fetch a page' });
  await tick();
  session.respond(of('permission').at(-1).requestId, { decision: 'allow' });
  await fetch;
  await agent.endTurn();
  session.send({ text: 'go on' });
  await tick();
  agent.say('[MODE_UPDATE] default');
  await agent.endTurn();
  assert.equal(contact.permissionMode, 'plan');
});

test('a read-only Gemini stays in Plan mode, whatever it says, and is put back in it where it left', async () => {
  const { agent, of, session, contact } = await started(GEMINI, {
    contact: { permissionMode: 'plan', readOnly: true },
  });
  agent.say('[MODE_UPDATE] yolo');
  await tick();
  assert.equal(contact.permissionMode, 'plan');
  assert.equal(session.appToolsUnasked(), false);
  const setModes = () => agent.params('session/set_mode').map((p) => p.modeId);
  const before = setModes().length;
  // A plan approved on its card: Gemini really leaves Plan mode, and is put back in it.
  const approval = agent.ask({ toolCallId: 'p1', status: 'pending', kind: 'other', title: 'Plan approval' });
  await tick();
  session.respond(of('permission').at(-1).requestId, { decision: 'allow' });
  await approval;
  agent.say('[MODE_UPDATE] default');
  await tick();
  assert.deepEqual(setModes().slice(before), ['plan']);
  assert.equal(contact.permissionMode, 'plan');
  assert.deepEqual(of('mode'), []);
});

test('old messages Gemini sends after loading a session stay out of the chat', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { agent, events, of, session } = start(GEMINI, { contact: { sessionId: 's-old' }, settleMs: 150 });
  session.send({ text: 'hi' });
  await tick();
  // Gemini answers `session/load` after the first old message, and sends the rest behind it.
  assert.deepEqual(agent.methods(), ['initialize', 'session/load']);
  agent.say('An old reply', {}, 's-old');
  agent.tool({ toolCallId: 'old', status: 'completed', title: 'ls', kind: 'execute', content: [] }, 's-old');
  t.mock.timers.tick(149);
  await tick();
  agent.say('Another old reply', {}, 's-old');
  t.mock.timers.tick(149);
  await tick();
  assert.equal(agent.params('session/prompt').length, 0, 'still hearing old messages');
  assert.equal(session.state, 'connecting');

  // Quiet for long enough: that was all of them.
  t.mock.timers.tick(1);
  await tick();
  assert.deepEqual(agent.prompts(), ['hi']);
  assert.deepEqual(
    events.map((e) => e.type),
    ['state', 'ready', 'state']
  );
  agent.say('A new reply', {}, 's-old');
  assert.deepEqual(of('text-delta'), [{ type: 'text-delta', key: 's-old:1', text: 'A new reply' }]);
});

test('if Gemini dies while its old messages arrive, the next message starts over', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { agent, of, session, contact } = start(GEMINI, { contact: { sessionId: 's-old' }, settleMs: 150 });
  session.send({ text: 'hi' });
  await tick();
  agent.die('Gemini stopped unexpectedly (exit code 1).');
  await tick();
  assert.equal(of('error').length, 1);
  assert.equal(session.state, 'offline');
  assert.equal(contact.sessionId, 's-old');

  session.send({ text: 'again' });
  await tick();
  t.mock.timers.tick(150);
  await tick();
  assert.equal(agent.launches.length, 2);
  assert.deepEqual(agent.prompts(), ['again']);
});

test('a session Gemini won’t load for want of a saved sign-in choice is replaced by a fresh one', async () => {
  // With only GEMINI_API_KEY to go on, Gemini starts sessions but refuses to load them.
  const { agent, of, contact } = await started(GEMINI, {
    contact: { sessionId: 's-old' },
    replies: {
      'session/load': () => {
        throw rpcError('Authentication required', -32000);
      },
    },
  });
  assert.deepEqual(agent.methods(), ['initialize', 'session/load', 'session/new', 'session/prompt']);
  assert.equal(contact.sessionId, 's-1');
  assert.equal(of('session-reset').length, 1);
  assert.match(of('notice')[0].text, /fresh one/);
  assert.equal(of('error').length, 0);
});

test('“Always allow” is for the session, and for one tool of an MCP server', async () => {
  const { agent, of, session } = await started(GEMINI);
  const once = [
    { optionId: 'proceed_once', name: 'Allow', kind: 'allow_once' },
    { optionId: 'cancel', name: 'Reject', kind: 'reject_once' },
  ];
  const always = async (call, options) => {
    const answer = agent.ask(call, options);
    session.respond(of('permission').at(-1).requestId, { decision: 'always' });
    return answer;
  };
  // An MCP tool: Gemini offers the whole server first.
  const mcp = await always({ toolCallId: 'm1', status: 'pending', title: 'create_issue (github)', kind: 'other' }, [
    { optionId: 'proceed_always_server', name: 'Allow all server tools for this session', kind: 'allow_always' },
    { optionId: 'proceed_always_tool', name: 'Allow tool for this session', kind: 'allow_always' },
    { optionId: 'proceed_always_and_save', name: 'Allow tool for all future sessions', kind: 'allow_always' },
    ...once,
  ]);
  assert.deepEqual(mcp, selected('proceed_always_tool'));
  // A file edit, with "for all future sessions" switched on in Gemini's settings.
  const edit = await always({ toolCallId: 'e1', status: 'pending', title: 'a.txt', kind: 'edit' }, [
    { optionId: 'proceed_always', name: 'Allow for this session', kind: 'allow_always' },
    { optionId: 'proceed_always_and_save', name: 'Allow for this file in all future sessions', kind: 'allow_always' },
    ...once,
  ]);
  assert.deepEqual(edit, selected('proceed_always'));
});

test('Gemini has nothing to say to requests for the app’s files', async () => {
  const { agent } = await started(GEMINI);
  await assert.rejects(agent.hooks.onRequest('fs/write_text_file', { path: '/tmp/x', content: 'x' }), /can’t answer/);
});

test('Gemini is offered as a service, with modes and a picture of its own', () => {
  const providers = createProviders({ app: { isPackaged: false } });
  assert.deepEqual(
    providers.list().map((p) => p.id),
    ['claude', 'codex', 'gemini', 'opencode', 'hermes']
  );
  assert.equal(providers.descriptor('gemini'), descriptor);
  assert.equal(descriptor.name, 'Gemini');
  assert.ok(descriptor.permissionModes.some((m) => m.id === descriptor.defaultPermissionMode));
  assert.ok(descriptor.avatars.some((a) => a.id === descriptor.avatar));
  // The modes are Gemini CLI's own, by the ids it knows them under.
  assert.deepEqual(
    descriptor.permissionModes.map((m) => m.id).sort(),
    GEMINI_SESSION.modes.availableModes.map((m) => m.id).sort()
  );
  assert.deepEqual(
    descriptor.permissionModes.filter((m) => m.danger).map((m) => m.id),
    ['yolo']
  );
  assert.match(descriptor.loginHint, /run "gemini"/);

  const session = providers.createSession(
    { provider: 'gemini', cwd: '/tmp', model: '', permissionMode: 'default', sessionId: null },
    () => {}
  );
  assert.ok(session instanceof AcpSession);
  assert.equal(session.agent.command, 'gemini');
  assert.deepEqual(session.agent.args, ['--acp']);
  assert.equal(session.state, 'offline', 'nothing is started until there is a message to send');
});

test('BUDDYLIST_GEMINI_CLI points the app at another Gemini CLI', (t) => {
  const before = process.env.BUDDYLIST_GEMINI_CLI;
  t.after(() => {
    if (before === undefined) delete process.env.BUDDYLIST_GEMINI_CLI;
    else process.env.BUDDYLIST_GEMINI_CLI = before;
  });
  process.env.BUDDYLIST_GEMINI_CLI = '/opt/gemini/bin/gemini';
  const contact = { cwd: '/tmp', model: '', permissionMode: 'default', sessionId: null };
  const session = createGeminiProvider().createSession({ contact, emit: () => {} });
  assert.equal(session.agent.command, '/opt/gemini/bin/gemini');
});
