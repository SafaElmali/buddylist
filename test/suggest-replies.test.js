import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeSuggestReplies } from '../src/providers/claude/suggest-replies.js';
import { suggestedNext, suggestedReplies } from '../src/providers/suggest-replies.js';
import { createProviders } from '../src/providers/index.js';

// A stand-in for the SDK's query(): plays back what Claude Code says, and records how it was used.
function fakeQuery(messages) {
  const calls = { prompt: null, options: null, closed: 0 };
  const queryFn = ({ prompt, options }) => {
    calls.prompt = prompt;
    calls.options = options;
    return {
      async *[Symbol.asyncIterator]() {
        yield* typeof messages === 'function' ? await messages() : messages;
      },
      close: () => {
        calls.closed += 1;
      },
    };
  };
  return { queryFn, calls };
}

const success = (result) => ({ type: 'result', subtype: 'success', is_error: false, result });

const ASKS =
  'I fixed the hover. Prettier passes.\n\nShould I commit it, or would you like to check it in the app first?';
const DONE = 'I fixed the hover and Prettier passes. Nothing is committed yet.';

// ---- asking Claude Code ------------------------------------------------------------------------

test('Claude’s answer is the replies, one on each line', async () => {
  const { queryFn } = fakeQuery([success('Commit it\nI’ll check it first\nShow me the diff')]);
  assert.deepEqual(await claudeSuggestReplies(ASKS, { queryFn }), [
    'Commit it',
    'I’ll check it first',
    'Show me the diff',
  ]);
});

test('Claude is shown the end of the reply, where it asks, set apart as a message to someone else', async () => {
  const short = fakeQuery([success('Commit it')]);
  await claudeSuggestReplies(ASKS, { queryFn: short.queryFn });
  assert.equal(short.calls.prompt, `<message>\n${ASKS}\n</message>`);

  const long = fakeQuery([success('Commit it')]);
  await claudeSuggestReplies(`${'What I did. '.repeat(400)}${ASKS}`, { queryFn: long.queryFn });
  const shown = long.calls.prompt.replace(/^<message>\n|\n<\/message>$/g, '');
  assert.equal(shown.length, 1500);
  assert.ok(shown.endsWith(ASKS));
});

test('the quickest model writes them in one turn, with no tools and none of the user’s settings', async () => {
  const { queryFn, calls } = fakeQuery([success('Commit it')]);
  await claudeSuggestReplies(ASKS, { queryFn, cliPath: '/opt/claude' });
  const { model, tools, settingSources, maxTurns, persistSession, pathToClaudeCodeExecutable, systemPrompt } =
    calls.options;
  assert.deepEqual(
    { model, tools, settingSources, maxTurns, persistSession, pathToClaudeCodeExecutable },
    {
      model: 'haiku',
      tools: [],
      settingSources: [],
      maxTurns: 1,
      persistSession: false,
      pathToClaudeCodeExecutable: '/opt/claude',
    }
  );
  assert.match(systemPrompt, /quick replies/);
  assert.match(systemPrompt, /not addressed to you/, 'it is told the message is not a question to it');
  assert.match(systemPrompt, /NONE/, 'and what to say when the message asks nothing');
  assert.equal(calls.closed, 1);
});

test('a reply that asks nothing, or a turn that went wrong, gets none', async () => {
  const failed = { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['overloaded'] };
  for (const messages of [[success('NONE')], [success('')], [failed], [{ type: 'system', subtype: 'init' }]]) {
    assert.deepEqual(await claudeSuggestReplies(ASKS, { queryFn: fakeQuery(messages).queryFn }), []);
  }
});

test('to a reply that asks nothing, the same quick model writes the one message the user would send next', async () => {
  const { queryFn, calls } = fakeQuery([success('looks good, commit it and open a pr')]);
  assert.deepEqual(await claudeSuggestReplies(DONE, { queryFn, asks: false }), ['looks good, commit it and open a pr']);
  assert.equal(calls.prompt, `<message>\n${DONE}\n</message>`);
  assert.equal(calls.options.model, 'haiku');
  assert.equal('asks' in calls.options, false, 'what it is asked for is no option of the SDK’s');
  assert.match(calls.options.systemPrompt, /next message/);
  assert.match(calls.options.systemPrompt, /not addressed to you/, 'it is told the message is not a question to it');
  assert.doesNotMatch(calls.options.systemPrompt, /quick replies/);
});

test('both are told to write as the user, not the message’s “say go” back, with examples of it', async () => {
  for (const asks of [true, false]) {
    const { queryFn, calls } = fakeQuery([success('NONE')]);
    await claudeSuggestReplies(ASKS, { queryFn, asks });
    const { systemPrompt } = calls.options;
    assert.match(systemPrompt, /Write as the user, to the assistant/, `asks: ${asks}`);
    assert.match(systemPrompt, /never those words back/, `asks: ${asks}`);
    assert.match(systemPrompt, /Say go and I’ll[^<]*<\/message>\n(go|Go),/, `asks: ${asks}`);
  }
  const { queryFn, calls } = fakeQuery([success('NONE')]);
  await claudeSuggestReplies(DONE, { queryFn, asks: false });
  assert.match(calls.options.systemPrompt, /Let me know which one you want\.\n<\/message>\nin memory is fine/);
});

const SAY_GO =
  'The proof video is recorded and the tests pass.\n\n' +
  'Say go and I’ll commit it, push and open the draft PR with the proof attached.';

test('the message’s words written back are never offered as the user’s, from either mode', async () => {
  const { queryFn } = fakeQuery([success('say go, commit it, push and open the draft PR with the proof attached')]);
  assert.deepEqual(await claudeSuggestReplies(SAY_GO, { queryFn, asks: false }), []);

  const replies = fakeQuery([success('Say go\nGo, open it\nLet me know which one\nNot yet')]);
  const ASKS_GO = 'Should I open the PR now? Say go, or let me know which one to open first.';
  assert.deepEqual(await claudeSuggestReplies(ASKS_GO, { queryFn: replies.queryFn }), ['Go, open it', 'Not yet']);
});

test('what the message told the user to send is not what they send', () => {
  assert.equal(suggestedNext('say go, commit it, push and open the draft PR with the proof attached', SAY_GO), '');
  assert.equal(suggestedNext('**Say go**', 'Looks right? **Say go** and I’ll push it.'), '');
  assert.equal(suggestedNext('just say the word', 'If it looks right, just say the word.'), '');
  const which = 'In memory or Redis both work. Let me know which one you want.';
  assert.equal(suggestedNext('let me know which one', which), '');
  assert.deepEqual(suggestedReplies('Let me know which one\nIn memory\nRedis', which), ['In memory', 'Redis']);
  assert.equal(suggestedNext('tell me which', 'I have two fixes. Tell me which you prefer.'), '');
  assert.equal(suggestedNext('reply yes', 'Ready to deploy. Reply yes to start it.'), '');
});

test('a run copied from the message that still speaks as the assistant is not the user’s either', () => {
  const offer = 'The fix is in. Want me to add tests for it before I open the PR?';
  assert.equal(suggestedNext('want me to add tests for it', offer), '');
  assert.equal(suggestedNext('I fixed the hover and Prettier passes', DONE), '');
  assert.deepEqual(suggestedReplies('Want me to add tests for it\nYes, add tests\nOpen the PR', offer), [
    'Yes, add tests',
    'Open the PR',
  ]);
});

test('the user’s own commands are kept, even when they take the message’s words for what to do', () => {
  const offer = 'Nothing is committed yet. I can commit it and open a PR, or add a test first. I’d add it now.';
  for (const text of ['go ahead', 'commit it and open a pr', 'yes, add it now', 'can you commit it and open a pr']) {
    assert.equal(suggestedNext(text, offer), text);
  }
  assert.deepEqual(suggestedReplies('Yes, add it now\nCommit it and open a PR\nYou decide', `${offer} Shall I?`), [
    'Yes, add it now',
    'Commit it and open a PR',
    'You decide',
  ]);
  // The very message the user asked for: it takes the offer’s words, but not its voice.
  const go = 'go, commit it, push and open the draft pr with the proof';
  assert.equal(suggestedNext(go, SAY_GO), go);
  // Words the message uses in passing tell the user nothing.
  const passing = 'I’ll reply to the review comments next, then say what changed in the PR.';
  assert.equal(suggestedNext('reply to the review comments now', passing), 'reply to the review comments now');
  assert.equal(suggestedNext('tell me more about the slow test', DONE), 'tell me more about the slow test');
});

test('one that takes too long is given up on, and closed', async () => {
  const { queryFn, calls } = fakeQuery(() => new Promise(() => {}));
  await assert.rejects(claudeSuggestReplies(ASKS, { queryFn, patienceMs: 20 }), /took too long/);
  assert.equal(calls.closed, 1);
});

// ---- reading the answer ------------------------------------------------------------------------

test('bullets, numbers and quotes the model put around them anyway are left out', () => {
  assert.deepEqual(suggestedReplies('- Commit it\n2. "Show me the diff"\n* “Not yet”\n• Ship it'), [
    'Commit it',
    'Show me the diff',
    'Not yet',
  ]);
});

test('at most three, none twice and none empty', () => {
  assert.deepEqual(suggestedReplies('Yes\n\n  \nyes\nNo\nLater\nNever'), ['Yes', 'No', 'Later']);
});

test('a question is no answer: the one it was shown, written back, or one of its own', () => {
  assert.deepEqual(suggestedReplies('Want me to build it?\nYes, build it\nNot yet'), ['Yes, build it', 'Not yet']);
});

test('NONE, however it is written, is no reply, and nor is anything said with it', () => {
  for (const answer of ['NONE', 'none', 'None.', '', 'NONE\n\nIt only says what was fixed.']) {
    assert.deepEqual(suggestedReplies(answer), [], answer);
  }
});

test('an answer that runs on is the model saying something else: none of it is a reply', () => {
  const offScript = [
    'I don’t have enough context to recommend one. Could you share:',
    '- What kind of failures are we handling?',
    '- Retry on failure',
  ].join('\n');
  assert.deepEqual(suggestedReplies(offScript), []);
});

test('the message sent next is one line, without the bullets and quotes around it, and it can be a question', () => {
  assert.equal(suggestedNext('commit it and open a pr'), 'commit it and open a pr');
  assert.equal(suggestedNext('  - “commit it and open a pr”  \n'), 'commit it and open a pr');
  assert.equal(suggestedNext('can you also add a test for it?'), 'can you also add a test for it?');
});

test('no message to send next: NONE, nothing, several lines, or one that runs on', () => {
  for (const answer of [
    'NONE',
    'none.',
    '',
    '\n  \n',
    'commit it\nopen a pr',
    `fix ${'and then fix more '.repeat(10)}`,
  ]) {
    assert.equal(suggestedNext(answer), '', answer);
  }
});

// ---- the providers ---------------------------------------------------------------------------

test('Claude and Codex can suggest replies; a provider without a quick model to ask suggests none', async () => {
  const providers = createProviders({ app: { isPackaged: false } });
  assert.equal(typeof providers.get('claude').suggestReplies, 'function');
  assert.equal(typeof providers.get('codex').suggestReplies, 'function');
  for (const id of ['gemini', 'opencode', 'hermes']) {
    assert.equal(providers.get(id).suggestReplies, undefined, id);
    assert.deepEqual(await providers.suggestReplies(id, ASKS), [], id);
    assert.deepEqual(await providers.suggestReplies(id, DONE, { asks: false }), [], id);
  }
  assert.deepEqual(await providers.suggestReplies('nobody', ASKS), [], 'Claude does not stand in for one nobody knows');
});

test('in the demo nobody’s CLI is started: a provider that can suggest answers from a script', async () => {
  const providers = createProviders({ app: { isPackaged: false }, demo: true });
  const answers = (id) =>
    Promise.all([
      providers.suggestReplies(id, ASKS, { asks: true }),
      providers.suggestReplies(id, 'Here’s what I found.', { asks: false }),
      providers.suggestReplies(id, 'Fixed: an item counts once.', { asks: false }),
    ]);
  for (const [id, [replies, [found], [fixed]]] of await Promise.all(
    ['claude', 'codex'].map(async (id) => [id, await answers(id)])
  )) {
    assert.ok(replies.length > 1, id);
    // The message sent next asks for another of the demo’s scenarios, to try next.
    assert.match(found, /\bfix\b/, id);
    assert.match(fixed, /diagram/, id);
  }
  for (const id of ['gemini', 'opencode', 'hermes']) {
    assert.deepEqual(await providers.suggestReplies(id, DONE, { asks: false }), [], id);
  }
});
