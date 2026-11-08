import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Turns } from '../src/main/turns.js';
import { DEFAULT_TURN_LIMIT } from '../src/shared/turn-limit.js';

const claude = { id: 'claude', name: 'Claude' };
const codex = { id: 'codex', name: 'Codex' };
const gemini = { id: 'gemini', name: 'Gemini' };
const agents = [claude, codex, gemini];
const ME = 'Safa';

test('automatic continuation preserves the round budget and cannot restart a stopped round', () => {
  const turns = new Turns();
  turns.userSaid('Do it', [claude]);
  assert.equal(turns.next(1).id, claude.id);
  turns.turnEnded(claude.id, { type: 'result', usageLimited: true });
  assert.equal(turns.continueWith(codex.id, 'Continue'), true);
  assert.deepEqual(turns.next(1), { paused: true });
  assert.equal(turns.continueWith(gemini.id, 'Continue'), false);
  assert.equal(turns.next(), null);
  turns.userSaid('Again', [claude]);
  turns.stop();
  assert.equal(turns.continueWith(codex.id, 'Continue'), false);
});

const result = (stopped = false) => ({ type: 'result', isError: false, stopped });
const state = (to) => ({ type: 'state', state: to });

/** Whose turn starts next, or what else `next` says. */
const start = (turns) => {
  const turn = turns.next();
  return turn && (turn.paused ? 'paused' : turn.id);
};

/** Lets the round run with nobody mentioning anyone: who spoke, in order. */
function runOut(turns) {
  const spoke = [];
  for (let who = start(turns); who; who = start(turns)) {
    spoke.push(who);
    if (who !== 'paused') turns.turnEnded(who, result());
  }
  return spoke;
}

test('without a mention everyone answers: the host first, then the guests as they joined', () => {
  const turns = new Turns();
  assert.equal(turns.active, false);
  turns.userSaid('hello all', agents);
  assert.equal(turns.waiting, true);
  assert.equal(start(turns), 'claude');
  assert.equal(turns.current, 'claude');
  assert.equal(start(turns), null, 'one at a time');
  assert.equal(turns.turnEnded('claude', result()), true);
  assert.deepEqual(runOut(turns), ['codex', 'gemini']);
  assert.equal(turns.active, false);
});

test('taking turns, they answer in the order the user put them in, and anyone it leaves out answers last', () => {
  const turns = new Turns({ order: ['gemini', 'claude'] });
  turns.userSaid('hello all', agents);
  assert.deepEqual(runOut(turns), ['gemini', 'claude', 'codex']);

  // Changed while nobody is in line, the next message goes by the new order.
  turns.order = ['codex', 'claude', 'gemini'];
  turns.userSaid('and again', agents);
  assert.deepEqual(runOut(turns), ['codex', 'claude', 'gemini']);
});

test('the order leaves out who is paused, gives way to a mention, and a command is still the host’s', () => {
  const turns = new Turns({ order: ['codex', 'claude', 'gemini'] });
  turns.userSaid('hello all', [claude, { ...codex, paused: true }, gemini]);
  assert.deepEqual(runOut(turns), ['claude', 'gemini']);

  turns.userSaid('@Gemini then @Codex', agents);
  assert.deepEqual(runOut(turns), ['gemini', 'codex']);

  assert.deepEqual(turns.userSaid('/compact', agents), ['claude']);
});

test('with the agents picking their effort, the first in the order checks it', () => {
  const turns = new Turns({ order: ['codex', 'claude'] });
  turns.userSaid('hello all', [claude, codex], [], 'first');
  const check = turns.next();
  assert.equal(check.id, 'codex');
  assert.equal(check.check, true);
});

test('mentioning agents picks who answers, in the order they are mentioned', () => {
  const turns = new Turns();
  turns.userSaid('@Gemini and then @Claude, what do you think?', agents);
  assert.deepEqual(runOut(turns), ['gemini', 'claude']);

  turns.userSaid('just you, @codex', agents);
  assert.deepEqual(runOut(turns), ['codex']);
});

test('a file that is named like an agent picks nobody: everyone answers', () => {
  const turns = new Turns();
  turns.userSaid('read @CLAUDE.md and @codex-setup.sh', agents);
  assert.deepEqual(runOut(turns), ['claude', 'codex', 'gemini']);
});

test('a name in a quote you reply to picks nobody: only the names you write do', () => {
  const turns = new Turns();
  turns.userSaid('> @Codex please review this\n\nWhat do you all think?', agents);
  assert.deepEqual(runOut(turns), ['claude', 'codex', 'gemini']);

  turns.userSaid('> @Codex please review this\n\nYou do it, @Gemini.', agents);
  assert.deepEqual(runOut(turns), ['gemini']);
});

test('an agent that mentions another hands over to it', () => {
  const turns = new Turns();
  turns.userSaid('@Claude fix the login page', agents);
  assert.equal(start(turns), 'claude');
  turns.agentSaid('claude', 'Fixed. @Codex please review, and @Gemini write the tests.', agents, ME);
  turns.turnEnded('claude', result());
  assert.deepEqual(runOut(turns), ['codex', 'gemini']);
});

test('mentioning itself, the user, or someone already in line hands over to nobody new', () => {
  const turns = new Turns();
  turns.userSaid('hi', [claude, codex]);
  assert.equal(start(turns), 'claude');
  turns.agentSaid('claude', 'As I, @Claude, told @Safa: @Codex is next anyway.', [claude, codex], ME);
  turns.turnEnded('claude', result());
  assert.deepEqual(runOut(turns), ['codex']);
});

test('the user is told apart from an agent whose name theirs starts with', () => {
  const turns = new Turns();
  turns.userSaid('@Codex go', [claude, codex]);
  assert.equal(start(turns), 'codex');
  turns.agentSaid('codex', 'Done, @Claude Fan. Have a look.', [claude, codex], 'Claude Fan');
  turns.turnEnded('codex', result());
  assert.equal(start(turns), null, 'that was the user, not Claude');
});

test('only whoever has the turn can hand over', () => {
  const turns = new Turns();
  turns.userSaid('@Claude go', agents);
  assert.equal(start(turns), 'claude');
  turns.agentSaid('codex', '@Gemini your turn', agents, ME);
  turns.turnEnded('claude', result());
  assert.equal(start(turns), null);
  // Nor after everyone was stopped: the last words of a reply that was cut off count for nothing.
  turns.userSaid('@Claude again', agents);
  start(turns);
  turns.stop();
  turns.agentSaid('claude', '@Codex over to', agents, ME);
  assert.equal(start(turns), null);
});

test(`the agents take ${DEFAULT_TURN_LIMIT} turns on one message, then whoever is in line is sent away`, () => {
  const turns = new Turns();
  const pair = [claude, codex];
  turns.userSaid('discuss', pair);
  const spoke = [];
  for (let who = start(turns); who && who !== 'paused'; who = start(turns)) {
    spoke.push(who);
    // Each hands back to the other, for ever.
    turns.agentSaid(who, who === 'claude' ? '@Codex and you?' : '@Claude and you?', pair, ME);
    turns.turnEnded(who, result());
    if (spoke.length > 20) break;
  }
  assert.deepEqual(spoke, ['claude', 'codex', 'claude', 'codex', 'claude', 'codex']);
  assert.equal(spoke.length, DEFAULT_TURN_LIMIT);
  assert.equal(turns.active, false, 'the line is empty');
  assert.equal(start(turns), null, 'and that is only said once');

  turns.userSaid('carry on', pair);
  assert.deepEqual(runOut(turns), ['claude', 'codex'], 'a new message starts the count again');
});

/** Two agents handing back to each other for ever, with `limit` turns to take: who spoke, in order. */
function pingPong(turns, limit) {
  const pair = [claude, codex];
  const spoke = [];
  for (let turn = turns.next(limit); turn && !('paused' in turn); turn = turns.next(limit)) {
    spoke.push(turn.id);
    turns.agentSaid(turn.id, turn.id === 'claude' ? '@Codex and you?' : '@Claude and you?', pair, ME);
    turns.turnEnded(turn.id, result());
    if (spoke.length > 60) break;
  }
  return spoke;
}

test('with a limit of their own, the agents take that many turns on one message', () => {
  const turns = new Turns();
  turns.userSaid('discuss', [claude, codex]);
  assert.deepEqual(pingPong(turns, 3), ['claude', 'codex', 'claude']);
  assert.equal(turns.active, false, 'whoever was in line was sent away');

  turns.userSaid('more', [claude, codex]);
  assert.equal(pingPong(turns, 50).length, 50, 'another limit holds from the next message');
  assert.equal(turns.active, false);
});

test('a limit lowered during a round sends whoever is in line away at the next turn', () => {
  const turns = new Turns();
  const pair = [claude, codex];
  turns.userSaid('discuss', pair);
  for (const who of ['claude', 'codex', 'claude', 'codex']) {
    assert.equal(start(turns), who);
    turns.agentSaid(who, who === 'claude' ? '@Codex and you?' : '@Claude and you?', pair, ME);
    turns.turnEnded(who, result());
  }
  assert.deepEqual(turns.next(3), { paused: true }, 'four turns are more than three already');
  assert.equal(turns.active, false);
  assert.equal(turns.next(3), null, 'and that is only said once');
});

test('reaching the limit with nobody in line says nothing', () => {
  const turns = new Turns();
  const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, name: id.toUpperCase() }));
  turns.userSaid('everyone', six);
  assert.deepEqual(runOut(turns), ['a', 'b', 'c', 'd', 'e', 'f']);
});

test('a slash command is a turn of its own, for the host alone', () => {
  const turns = new Turns();
  turns.userSaid('/compact @Codex', agents, []);
  const turn = turns.next();
  assert.deepEqual(turn, { id: 'claude', images: [], command: '/compact @Codex' });
  turns.turnEnded('claude', result());
  assert.equal(start(turns), null);
});

test('a slash command waits behind what the host is already in line for', () => {
  const turns = new Turns();
  turns.userSaid('@Codex go', agents);
  start(turns);
  turns.userSaid('@Claude and you', agents);
  turns.userSaid('/review', agents);
  turns.turnEnded('codex', result());
  assert.deepEqual(
    [turns.next(), turns.turnEnded('claude', result()), turns.next()],
    [{ id: 'claude', images: [] }, true, { id: 'claude', images: [], command: '/review' }]
  );
});

test('pictures go to everyone the message is for', () => {
  const picture = { mediaType: 'image/png', data: 'AAAA' };
  const turns = new Turns();
  turns.userSaid('look at this', [claude, codex], [picture]);
  const first = turns.next();
  turns.turnEnded('claude', result());
  const second = turns.next();
  assert.deepEqual(
    [first, second],
    [
      { id: 'claude', images: [picture] },
      { id: 'codex', images: [picture] },
    ]
  );
  assert.notEqual(first.images, second.images, 'each has its own list');

  turns.turnEnded('codex', result());
  turns.userSaid('@Codex only you', [claude, codex], [picture]);
  assert.deepEqual(turns.next(), { id: 'codex', images: [picture] });
});

test('a message sent while a round is running waits for it, and then has a round of its own', () => {
  const turns = new Turns();
  const first = { mediaType: 'image/png', data: 'ONE' };
  const second = { mediaType: 'image/png', data: 'TWO' };
  turns.userSaid('hello', agents, [first]);
  assert.equal(start(turns), 'claude');
  // Codex and Gemini are in line already and keep their place. Each answers it on a turn of its own after.
  turns.userSaid('one more thing', agents, [second]);
  assert.equal(start(turns), null, 'the turn going on is left alone');
  turns.turnEnded('claude', result());
  const rest = [];
  for (let turn = turns.next(); turn; turn = turns.next()) {
    rest.push([turn.id, turn.images.map((image) => image.data)]);
    turns.turnEnded(turn.id, result());
  }
  assert.deepEqual(rest, [
    ['codex', ['ONE']],
    ['gemini', ['ONE']],
    ['claude', ['TWO']],
    ['codex', ['TWO']],
    ['gemini', ['TWO']],
  ]);
});

test('a message in the middle of a long round gives it six more turns', () => {
  const turns = new Turns();
  const pair = [claude, codex];
  const pingPong = (who) => {
    turns.agentSaid(who, who === 'claude' ? '@Codex?' : '@Claude?', pair, ME);
    turns.turnEnded(who, result());
  };
  turns.userSaid('discuss', pair);
  const spoke = [];
  for (let i = 0; i < 4; i++) {
    spoke.push(start(turns));
    pingPong(spoke.at(-1));
  }
  spoke.push(start(turns));
  turns.userSaid('@Codex keep going', pair);
  pingPong(spoke.at(-1));
  for (let who = start(turns); who && who !== 'paused'; who = start(turns)) {
    spoke.push(who);
    pingPong(who);
  }
  assert.equal(spoke.length, 5 + DEFAULT_TURN_LIMIT, 'five before the message, six after it');
});

test('a turn the user stopped sends everyone in line away', () => {
  const turns = new Turns();
  turns.userSaid('hello', agents);
  assert.equal(start(turns), 'claude');
  assert.equal(turns.turnEnded('claude', result(true)), true);
  assert.equal(turns.active, false);
  assert.equal(start(turns), null);
});

test('stopping everyone empties the line', () => {
  const turns = new Turns();
  turns.userSaid('hello', agents);
  start(turns);
  turns.stop();
  assert.equal(turns.active, false);
  assert.equal(turns.turnEnded('claude', result(true)), false, 'what the stopped session says next ends nothing');
  assert.equal(start(turns), null);
  turns.userSaid('again', agents);
  assert.deepEqual(runOut(turns), ['claude', 'codex', 'gemini']);
});

test('a session that fails or goes offline without a result still ends its turn', () => {
  const error = { type: 'error', message: 'Not logged in' };
  for (const ending of [
    // A sign-in that fails, a message that could not be delivered, a process that died.
    [state('connecting'), error, state('offline')],
    [state('working'), error, state('idle')],
    [state('connecting'), state('working'), state('waiting'), state('working'), state('offline')],
    [state('offline')],
  ]) {
    const turns = new Turns();
    turns.userSaid('hello', [claude, codex]);
    assert.equal(start(turns), 'claude');
    const ended = ending.map((event) => turns.turnEnded('claude', event));
    assert.deepEqual(ended, [...ending.slice(1).map(() => false), true], JSON.stringify(ending));
    assert.equal(start(turns), 'codex', 'the next one is not left waiting');
  }
});

test('a session saying "idle" as it starts has not finished its turn', () => {
  const turns = new Turns();
  turns.userSaid('hello', [claude, codex]);
  start(turns);
  // The scripted demo session: ready and idle first, then to work.
  assert.equal(turns.turnEnded('claude', state('idle')), false);
  assert.equal(turns.turnEnded('claude', state('working')), false);
  assert.equal(turns.turnEnded('claude', state('waiting')), false);
  assert.equal(turns.turnEnded('claude', { type: 'text-end', key: 'k', text: 'hi' }), false);
  // Nor is "idle" in the middle of a turn the end, with nothing gone wrong: that is a
  // session finishing the turn before, a moment late.
  assert.equal(turns.turnEnded('claude', state('idle')), false);
  assert.equal(turns.turnEnded('claude', state('working')), false);
  assert.equal(turns.turnEnded('claude', result()), true);
  assert.equal(turns.turnEnded('claude', state('idle')), false, 'nor does what follows the result end the next turn');
  assert.equal(start(turns), 'codex');
  assert.equal(turns.turnEnded('claude', state('idle')), false);
  assert.equal(turns.current, 'codex');
});

test('only the speaker can end the turn', () => {
  const turns = new Turns();
  turns.userSaid('hello', [claude, codex]);
  start(turns);
  assert.equal(turns.turnEnded('codex', result()), false);
  assert.equal(turns.turnEnded('codex', state('offline')), false);
  assert.equal(turns.current, 'claude');
});

test('an agent that was already answering when the others joined has the turn', () => {
  const turns = new Turns();
  turns.alreadySpeaking('claude');
  turns.userSaid('@Codex what do you think?', [claude, codex]);
  assert.equal(start(turns), null, 'Codex waits for Claude to finish');
  assert.equal(turns.turnEnded('claude', state('working')), false);
  assert.equal(turns.turnEnded('claude', result()), true);
  assert.equal(start(turns), 'codex');

  turns.alreadySpeaking('claude');
  assert.equal(turns.current, 'codex', 'never while someone else is speaking');
});

test('an agent nobody gave its turn is done once it is idle again, with or without a result', () => {
  const turns = new Turns();
  // Only starting up, with nothing to answer, when the others joined.
  turns.alreadySpeaking('claude');
  turns.userSaid('@Codex what do you think?', [claude, codex]);
  assert.equal(turns.turnEnded('claude', state('idle')), true);
  assert.equal(start(turns), 'codex');
  turns.turnEnded('codex', result());

  // Waiting for you outside a turn, for a helper's question, and answered.
  turns.alreadySpeaking('claude');
  assert.equal(turns.turnEnded('claude', state('idle')), true);
  assert.equal(turns.active, false);
});

test('an agent that starts on its own has the turn until its result, and hands over to nobody', () => {
  const turns = new Turns();
  turns.startedItself('claude');
  assert.deepEqual([turns.current, turns.asked('claude'), turns.active], ['claude', false, true]);
  turns.userSaid('@Claude and now?', agents);
  assert.equal(start(turns), null, 'what you say meanwhile waits for it to finish');
  turns.agentSaid('claude', 'They are back. @Codex have a look.', agents, ME);
  assert.deepEqual(turns.line, ['claude'], 'what it says on its own answers nobody here');
  assert.equal(turns.turnEnded('claude', result()), true);

  // The turn it is then given is like any other.
  assert.equal(start(turns), 'claude');
  assert.equal(turns.asked('claude'), true);
  turns.agentSaid('claude', 'Done. @Codex have a look.', agents, ME);
  assert.equal(turns.turnEnded('claude', result()), true);
  assert.equal(start(turns), 'codex');

  turns.startedItself('claude');
  assert.deepEqual(
    [turns.current, turns.asked('codex'), turns.asked('claude')],
    ['codex', true, false],
    'never while someone else is speaking'
  );
});

test('someone who leaves gives up their place in line', () => {
  const turns = new Turns();
  turns.userSaid('hello', agents);
  turns.userSaid('/review', agents);
  assert.equal(start(turns), 'claude');
  turns.remove('codex');
  turns.turnEnded('claude', result());
  assert.deepEqual(runOut(turns), ['gemini', 'claude']);
});

test('the speaker leaving ends its turn without sending the others away', () => {
  const turns = new Turns();
  turns.userSaid('@Codex then @Gemini', agents);
  assert.equal(start(turns), 'codex');
  turns.leaving('codex');
  // Being stopped on the way out is not the user stopping the round.
  assert.equal(turns.turnEnded('codex', state('idle')), false);
  assert.equal(turns.turnEnded('codex', result(true)), false);
  turns.agentSaid('codex', '@Claude take over', agents, ME);
  assert.equal(start(turns), null, 'nobody starts while it is being stopped');
  turns.remove('codex');
  assert.deepEqual(runOut(turns), ['gemini']);

  // Back again, it takes turns like anyone else.
  turns.userSaid('@Codex welcome back', agents);
  assert.equal(start(turns), 'codex');
  assert.equal(turns.turnEnded('codex', result()), true);
});

// ---- the agents picking their effort ------------------------------------------------------------

/** The next turn, as an effort check by `id`. */
const check = (id) => ({ id, images: [], check: true });

test('with the agents picking their effort, a check by the first one asked comes before anyone answers', () => {
  const turns = new Turns();
  turns.userSaid('hello all', agents, [], 'first');
  assert.deepEqual(turns.line, ['claude', 'codex', 'gemini'], 'the check itself is not in line to answer');
  assert.deepEqual(turns.next(), check('claude'));
  assert.equal(turns.checking, true);
  assert.equal(turns.turnEnded('claude', result()), true);
  assert.equal(turns.checking, false);
  assert.equal(start(turns), 'claude', 'and then it answers, like the others');
  assert.equal(turns.checking, false);
  assert.deepEqual(turns.line, ['codex', 'gemini']);
  turns.turnEnded('claude', result());
  assert.deepEqual(runOut(turns), ['codex', 'gemini']);
});

test('the first one asked is the first one you mention', () => {
  const turns = new Turns();
  turns.userSaid('@Gemini and then @Codex', agents, [], 'first');
  assert.deepEqual(turns.next(), check('gemini'));
  turns.turnEnded('gemini', result());
  assert.deepEqual(runOut(turns), ['gemini', 'codex']);
});

test('an agent you named does the check, also when the message is not for it', () => {
  const turns = new Turns();
  turns.userSaid('@Claude fix it', agents, [], 'codex');
  assert.deepEqual(turns.next(), check('codex'));
  assert.deepEqual(turns.line, ['claude']);
  turns.turnEnded('codex', result());
  assert.deepEqual(runOut(turns), ['claude'], 'it gets no turn to answer for it');

  // Named, but no longer here: the first one asked does it.
  turns.userSaid('@Gemini you', agents, [], 'someone-who-left');
  assert.deepEqual(turns.next(), check('gemini'));
});

test('nobody picking means no check, as before', () => {
  for (const nobody of [undefined, null, '']) {
    const turns = new Turns();
    turns.userSaid('hello all', agents, [], nobody);
    assert.deepEqual(turns.next(), { id: 'claude', images: [] });
    assert.equal(turns.checking, false);
  }
});

test('a check gives levels, not turns: who it names is not handed over to', () => {
  const turns = new Turns();
  turns.userSaid('@Claude fix it', agents, [], 'first');
  assert.equal(start(turns), 'claude');
  turns.agentSaid('claude', '@Claude(high) @Codex(low) and @Gemini too', agents, ME);
  turns.turnEnded('claude', result());
  assert.equal(start(turns), 'claude');
  // In its answer, the same words hand over.
  turns.agentSaid('claude', 'Fixed. @Codex(low) please review.', agents, ME);
  turns.turnEnded('claude', result());
  assert.deepEqual(runOut(turns), ['codex']);
});

test('a check is not one of the turns that are counted', () => {
  const turns = new Turns();
  const pair = [claude, codex];
  turns.userSaid('discuss', pair, [], 'first');
  const spoke = [];
  for (let who = start(turns); who && who !== 'paused'; who = start(turns)) {
    spoke.push(who);
    turns.agentSaid(who, who === 'claude' ? '@Codex and you?' : '@Claude and you?', pair, ME);
    turns.turnEnded(who, result());
    if (spoke.length > 20) break;
  }
  assert.deepEqual(spoke, ['claude', 'claude', 'codex', 'claude', 'codex', 'claude', 'codex']);
  assert.equal(spoke.length, DEFAULT_TURN_LIMIT + 1, 'the check, and then six turns');
});

test('a slash command gets no check', () => {
  const turns = new Turns();
  turns.userSaid('/compact', agents, [], 'first');
  assert.deepEqual(turns.next(), { id: 'claude', images: [], command: '/compact' });
  turns.turnEnded('claude', result());
  assert.equal(turns.next(), null);
});

test('the one doing the check keeps its place in line, and its pictures', () => {
  const picture = { mediaType: 'image/png', data: 'AAAA' };
  const turns = new Turns();
  turns.userSaid('look at this', [claude, codex], [picture], 'first');
  assert.deepEqual(turns.next(), check('claude'), 'the check goes without them');
  // A message for it while it is checking waits for a turn of its own, after the round it is checking for.
  turns.userSaid('@Claude and this', [claude, codex], [picture], 'first');
  turns.turnEnded('claude', result());
  assert.deepEqual(turns.next(), { id: 'claude', images: [picture] });
  turns.turnEnded('claude', result());
  assert.deepEqual(turns.next(), { id: 'codex', images: [picture] });
  turns.turnEnded('codex', result());
  assert.deepEqual(turns.next(), check('claude'), 'the new message gets a check of its own');
  turns.turnEnded('claude', result());
  assert.deepEqual(turns.next(), { id: 'claude', images: [picture] });
});

test('each message in line gets a check of its own, when its round comes', () => {
  const turns = new Turns();
  turns.userSaid('@Claude start', agents, [], 'first');
  turns.userSaid('@Codex you too', agents, [], 'first');
  assert.deepEqual(turns.next(), check('claude'));
  turns.turnEnded('claude', result());
  assert.deepEqual(runOut(turns), ['claude', 'codex', 'codex']);

  // Sent while someone is answering: the round going on finishes first, and then its check comes.
  turns.userSaid('@Claude and @Codex', agents, [], 'first');
  turns.turnEnded(turns.next().id, result());
  assert.equal(start(turns), 'claude');
  turns.userSaid('@Gemini as well', agents, [], 'first');
  turns.turnEnded('claude', result());
  assert.equal(start(turns), 'codex');
  turns.turnEnded('codex', result());
  assert.deepEqual(turns.next(), check('gemini'));
  assert.deepEqual(turns.line, ['gemini']);
  turns.turnEnded('gemini', result());
  assert.deepEqual(runOut(turns), ['gemini']);
});

test('a check with no level to pick is passed over', () => {
  const turns = new Turns();
  turns.userSaid('hello all', agents, [], 'first');
  assert.deepEqual(turns.next(), check('claude'));
  turns.skip('claude');
  assert.equal(turns.current, null);
  assert.equal(turns.checking, false);
  assert.deepEqual(runOut(turns), ['claude', 'codex', 'gemini']);
});

test('a check that is stopped, or whose agent leaves, holds nobody up', () => {
  const stopped = new Turns();
  stopped.userSaid('hello all', agents, [], 'first');
  stopped.next();
  assert.equal(stopped.turnEnded('claude', result(true)), true);
  assert.equal(stopped.active, false, 'stopping it sends everyone away, as in any turn');

  const left = new Turns();
  left.userSaid('@Claude fix it', agents, [], 'codex');
  left.remove('codex');
  assert.deepEqual(runOut(left), ['claude'], 'in line: its check goes with it');

  const leaving = new Turns();
  leaving.userSaid('@Claude fix it', agents, [], 'codex');
  leaving.next();
  leaving.remove('codex');
  assert.equal(leaving.checking, false);
  assert.deepEqual(runOut(leaving), ['claude'], 'in the middle of it: the others carry on');
});

test('a check that fails without a result still ends', () => {
  const turns = new Turns();
  turns.userSaid('@Claude fix it', agents, [], 'first');
  turns.next();
  turns.turnEnded('claude', { type: 'error' });
  assert.equal(turns.turnEnded('claude', state('idle')), true);
  assert.deepEqual(runOut(turns), ['claude']);
});

test('a contact on its own that picks its effort: a check, then its answer', () => {
  const turns = new Turns();
  turns.userSaid('rework the export', [claude], [], 'first');
  assert.deepEqual(turns.next(), check('claude'));
  turns.agentSaid('claude', '@Claude(high) It touches invoices.', [claude], ME);
  turns.turnEnded('claude', result());
  assert.deepEqual(turns.next(), { id: 'claude', images: [] });
  // What you say while it answers waits in line, each message behind a check of its own.
  turns.userSaid('and the tests', [claude], [], 'first');
  turns.userSaid('with edge cases', [claude], [], 'first');
  assert.equal(turns.next(), null);
  turns.turnEnded('claude', result());
  assert.deepEqual(turns.next(), check('claude'));
  turns.turnEnded('claude', result());
  assert.equal(start(turns), 'claude');
  turns.turnEnded('claude', result());
  assert.deepEqual(turns.next(), check('claude'));
  turns.turnEnded('claude', result());
  assert.deepEqual(runOut(turns), ['claude'], 'an answer for each');
});

// ---- answering all at once ----------------------------------------------------------------------

/** Everyone whose turn can start now, as `next` hands them out. */
function startAll(turns) {
  const started = [];
  for (let who = start(turns); who; who = start(turns)) started.push(who);
  return started;
}

test('all at once, everyone asked starts together, and each turn ends on its own', () => {
  const turns = new Turns({ atOnce: true });
  turns.userSaid('hello all', agents);
  assert.deepEqual(startAll(turns), ['claude', 'codex', 'gemini']);
  assert.equal(turns.current, 'claude', 'the first of them to start');
  assert.equal(turns.turnEnded('codex', result()), true);
  assert.deepEqual(
    agents.map(({ id }) => turns.asked(id)),
    [true, false, true]
  );
  assert.equal(turns.active, true, 'the others are still at it');
  assert.equal(turns.turnEnded('codex', state('idle')), false, 'what follows its result ends nobody’s turn');
  turns.turnEnded('claude', result());
  turns.turnEnded('gemini', result());
  assert.equal(turns.active, false);
});

test('all at once, a mention still picks who answers', () => {
  const turns = new Turns({ atOnce: true });
  turns.userSaid('@Gemini and @Codex, what do you think?', agents);
  assert.deepEqual(startAll(turns), ['gemini', 'codex']);
});

test('all at once, an agent waits for its own turn before, and for nobody else', () => {
  const turns = new Turns({ atOnce: true });
  turns.userSaid('@Claude and @Codex go', agents);
  startAll(turns);
  turns.userSaid('one more thing', agents);
  assert.deepEqual(startAll(turns), ['gemini'], 'Claude and Codex are still on the first message');
  turns.turnEnded('codex', result());
  assert.deepEqual(startAll(turns), ['codex']);
  turns.userSaid('/compact', agents);
  turns.turnEnded('claude', result());
  assert.deepEqual(startAll(turns), ['claude'], 'one turn at a time each: its answer first');
  turns.turnEnded('claude', result());
  assert.deepEqual(turns.next(), { id: 'claude', images: [], command: '/compact' }, 'then the command');
});

test('all at once, a hand-over to an agent that is busy waits for it to finish', () => {
  const turns = new Turns({ atOnce: true });
  const pair = [claude, codex];
  turns.userSaid('review each other', pair);
  startAll(turns);
  turns.agentSaid('claude', 'Done. @Codex have a look.', pair, ME);
  turns.turnEnded('claude', result());
  assert.equal(start(turns), null, 'Codex is still answering the message');
  assert.deepEqual(turns.line, ['codex']);
  turns.turnEnded('codex', result());
  assert.equal(start(turns), 'codex', 'then it looks');
});

test(`all at once, the agents still take ${DEFAULT_TURN_LIMIT} turns on one message`, () => {
  const turns = new Turns({ atOnce: true });
  const pair = [claude, codex];
  turns.userSaid('discuss', pair);
  const spoke = [];
  for (let started = startAll(turns); started.length && spoke.length < 20; started = startAll(turns)) {
    spoke.push(...started);
    // Each hands back to the other, for ever.
    for (const who of started.filter((id) => id !== 'paused')) {
      turns.agentSaid(who, who === 'claude' ? '@Codex and you?' : '@Claude and you?', pair, ME);
      turns.turnEnded(who, result());
    }
  }
  assert.equal(spoke.filter((id) => id !== 'paused').length, DEFAULT_TURN_LIMIT);
  assert.equal(spoke.at(-1), 'paused');
  assert.equal(turns.active, false);
});

test('all at once, an effort check goes alone: before anyone answers, and once everyone is done', () => {
  const turns = new Turns({ atOnce: true });
  turns.userSaid('hello all', agents, [], 'first');
  assert.deepEqual(turns.next(), check('claude'));
  assert.equal(turns.next(), null, 'nobody answers while the levels are picked');
  turns.turnEnded('claude', result());
  assert.deepEqual(startAll(turns), ['claude', 'codex', 'gemini']);

  turns.userSaid('@Gemini more', agents, [], 'first');
  turns.turnEnded('gemini', result());
  assert.equal(turns.next(), null, 'the check waits for Claude and Codex to finish');
  turns.turnEnded('claude', result());
  turns.turnEnded('codex', result());
  assert.deepEqual(turns.next(), check('gemini'));
  assert.equal(turns.next(), null);
});

test('all at once, an agent that starts on its own holds up only itself', () => {
  const turns = new Turns({ atOnce: true });
  turns.userSaid('@Codex go', agents);
  assert.equal(start(turns), 'codex');
  turns.startedItself('claude');
  assert.deepEqual([turns.asked('claude'), turns.active], [false, true], 'Claude is at work, on a turn of its own');
  turns.userSaid('@Claude and @Gemini', agents);
  assert.deepEqual(startAll(turns), ['gemini'], 'Claude first finishes what it started');
  turns.agentSaid('claude', 'Back. @Codex look.', agents, ME);
  assert.deepEqual(turns.line, ['claude'], 'what it says on its own answers nobody');
  assert.equal(turns.turnEnded('claude', result()), true);
  assert.equal(start(turns), 'claude');
  turns.startedItself('claude');
  assert.equal(turns.asked('claude'), true, 'a turn it was given is not one it started itself');
});

test('all at once, an agent on its way out is given no turn', () => {
  const turns = new Turns({ atOnce: true });
  turns.userSaid('@Claude go', agents);
  start(turns);
  turns.leaving('codex');
  turns.userSaid('hello all', agents);
  assert.deepEqual(startAll(turns), ['gemini']);
  turns.remove('codex');
  turns.turnEnded('claude', result());
  assert.deepEqual(startAll(turns), ['claude']);
});

test('all at once, stopping everyone ends every turn', () => {
  const turns = new Turns({ atOnce: true });
  turns.userSaid('hello all', agents);
  startAll(turns);
  turns.stop();
  assert.equal(turns.active, false);
  assert.equal(turns.turnEnded('codex', result(true)), false, 'what a stopped session says next ends nothing');
});

test('switched to all at once in the middle of a round, whoever waits starts; switched back, they wait again', () => {
  const turns = new Turns();
  turns.userSaid('hello all', agents);
  assert.deepEqual(startAll(turns), ['claude']);
  turns.atOnce = true;
  assert.deepEqual(startAll(turns), ['codex', 'gemini']);
  turns.atOnce = false;
  turns.turnEnded('codex', result());
  turns.userSaid('@Codex again', agents);
  assert.equal(start(turns), null, 'taking turns, it waits for the others');
  turns.turnEnded('claude', result());
  turns.turnEnded('gemini', result());
  assert.equal(start(turns), 'codex');
});

// ---- paused agents ------------------------------------------------------------------------------

/** Everyone here, with the agents of `ids` paused. */
const pausing = (...ids) => agents.map((agent) => (ids.includes(agent.id) ? { ...agent, paused: true } : agent));

test('a paused agent sits out a message to everyone, and who was asked is said', () => {
  const turns = new Turns();
  assert.deepEqual(turns.userSaid('hello all', pausing('codex')), ['claude', 'gemini']);
  assert.deepEqual(runOut(turns), ['claude', 'gemini']);
  assert.deepEqual(turns.userSaid('hello all', pausing('claude')), ['codex', 'gemini'], 'the host as well');
  assert.deepEqual(runOut(turns), ['codex', 'gemini']);
});

test('a mention from the user still asks a paused agent', () => {
  const turns = new Turns();
  assert.deepEqual(turns.userSaid('@Codex and @Gemini, a look?', pausing('codex')), ['codex', 'gemini']);
  assert.deepEqual(runOut(turns), ['codex', 'gemini']);
});

test('with everyone paused, a message that mentions nobody asks nobody, not even for an effort check', () => {
  const turns = new Turns();
  assert.deepEqual(turns.userSaid('anyone?', pausing('claude', 'codex', 'gemini'), [], 'first'), []);
  assert.equal(turns.active, false);
  assert.equal(turns.next(), null);
});

test('a slash command is the host’s, paused or not', () => {
  const turns = new Turns();
  assert.deepEqual(turns.userSaid('/compact', pausing('claude')), ['claude']);
  assert.deepEqual(turns.next(), { id: 'claude', images: [], command: '/compact' });
});

test('a hand-over to a paused agent gives it no turn', () => {
  const turns = new Turns();
  const here = pausing('codex');
  turns.userSaid('@Claude fix it', here);
  assert.equal(start(turns), 'claude');
  turns.agentSaid('claude', '@Codex please review, then @Gemini', here, ME);
  turns.turnEnded('claude', result());
  assert.deepEqual(runOut(turns), ['gemini']);
});

test('a paused agent is still told apart from another whose name its own starts with', () => {
  const api = { id: 'api', name: 'Claude (api)', paused: true };
  const here = [claude, codex, api];
  const turns = new Turns();
  turns.userSaid('@Codex go', here);
  assert.equal(start(turns), 'codex');
  turns.agentSaid('codex', 'Done. @Claude (api), have a look', here, ME);
  turns.turnEnded('codex', result());
  assert.deepEqual(runOut(turns), [], 'neither the paused one nor Claude');
});

test('a paused agent you asked hands over like anyone else', () => {
  const turns = new Turns();
  const here = pausing('codex');
  turns.userSaid('@Codex review it', here);
  assert.equal(start(turns), 'codex');
  turns.agentSaid('codex', '@Gemini over to you', here, ME);
  turns.turnEnded('codex', result());
  assert.deepEqual(runOut(turns), ['gemini']);
});

test('pausing an agent takes it out of line, also where you mentioned it, and stops a turn it is in', () => {
  const turns = new Turns();
  turns.userSaid('hello', agents);
  turns.userSaid('@Codex and you?', agents);
  turns.userSaid('/review', agents);
  assert.equal(start(turns), 'claude');
  assert.equal(turns.pause('codex'), false, 'one in line only leaves it');
  assert.equal(turns.pause('claude'), true, 'one speaking is to stop');
  assert.equal(turns.current, 'claude', 'it speaks until it has stopped');
  assert.equal(start(turns), null, 'and nobody starts in the middle of that');
  assert.equal(turns.turnEnded('claude', result(true)), true);
  assert.deepEqual(runOut(turns), ['gemini', 'claude'], 'a slash command was sent to it alone, and still goes');
});

test('a paused agent being stopped hands over to nobody, and its stop sends nobody in line away', () => {
  const turns = new Turns();
  turns.userSaid('@Codex then @Gemini', agents);
  assert.equal(start(turns), 'codex');
  turns.agentSaid('codex', '@Claude have a look', agents, ME);
  turns.pause('codex');
  assert.equal(turns.asked('codex'), false, 'what it says now counts for nothing');
  assert.equal(turns.turnOf('codex'), null, 'nor is its turn to be sent anything');
  turns.agentSaid('codex', '@Gemini over to you, then @Claude', agents, ME);
  assert.deepEqual(turns.line, ['gemini', 'claude'], 'what it said before it was paused still hands over');
  assert.equal(turns.turnEnded('codex', result(true)), true);
  assert.deepEqual(runOut(turns), ['gemini', 'claude']);
});

test('a paused agent is stopped once its session goes idle, or says nothing more of its turn', () => {
  const idle = new Turns();
  idle.userSaid('@Codex then @Gemini', agents);
  idle.next();
  idle.pause('codex');
  assert.equal(idle.turnEnded('codex', state('idle')), true, 'idle again, it has stopped');
  assert.equal(idle.turnEnded('codex', result(true)), false, 'its result after that ends nothing');
  assert.equal(idle.stopped('codex'), false);
  assert.deepEqual(runOut(idle), ['gemini']);

  const silent = new Turns();
  silent.userSaid('@Codex then @Gemini', agents);
  silent.next();
  assert.equal(silent.stopped('codex'), false, 'one that is not being stopped goes on');
  silent.pause('codex');
  assert.equal(silent.stopped('codex'), true);
  assert.equal(silent.active, true, 'Gemini is still in line');
  assert.equal(start(silent), 'gemini');
  assert.equal(silent.stopped('gemini'), false);
});

test('a paused agent asked again after it stopped takes its turn like anyone else', () => {
  const turns = new Turns();
  turns.userSaid('@Codex go', agents);
  turns.next();
  turns.pause('codex');
  turns.turnEnded('codex', result(true));
  const here = pausing('codex');
  turns.userSaid('@Codex go on', here);
  assert.equal(start(turns), 'codex');
  assert.equal(turns.asked('codex'), true);
  assert.equal(turns.turnEnded('codex', state('idle')), false, 'idle as it starts ends nothing');
  turns.agentSaid('codex', '@Gemini your turn', here, ME);
  assert.equal(turns.turnEnded('codex', result(true)), true);
  assert.deepEqual(runOut(turns), [], 'a turn stopped by the user still sends the line away');
});

test('all at once, pausing one that is answering stops it alone', () => {
  const turns = new Turns({ atOnce: true });
  turns.userSaid('hello all', agents);
  assert.deepEqual(startAll(turns), ['claude', 'codex', 'gemini']);
  turns.userSaid('@Codex and @Gemini again', agents);
  turns.pause('codex');
  assert.equal(turns.turnEnded('codex', result(true)), true);
  assert.deepEqual(startAll(turns), [], 'Gemini is still answering');
  assert.equal(turns.turnEnded('gemini', result()), true);
  assert.deepEqual(startAll(turns), ['gemini']);
  assert.equal(turns.current, 'claude');
});

test('stopping everyone also ends a stop that is going on', () => {
  const turns = new Turns();
  turns.userSaid('@Codex go', agents);
  turns.next();
  turns.pause('codex');
  turns.stop();
  assert.equal(turns.stopped('codex'), false);
  turns.userSaid('@Codex go', agents);
  assert.equal(start(turns), 'codex');
  assert.equal(turns.asked('codex'), true);
});

test('a paused agent that would pick the effort levels leaves that to the first one asked', () => {
  const turns = new Turns();
  turns.userSaid('hello all', pausing('codex'), [], 'codex');
  assert.deepEqual(turns.next(), check('claude'));
  turns.turnEnded('claude', result());
  assert.deepEqual(runOut(turns), ['claude', 'gemini']);

  // Mentioned, it answers the message, so it picks as well.
  turns.userSaid('@Gemini and @Codex', pausing('codex'), [], 'codex');
  assert.deepEqual(turns.next(), check('codex'));
});

test('all at once, a paused agent sits out too, unless you mention it', () => {
  const turns = new Turns({ atOnce: true });
  turns.userSaid('hello all', pausing('codex'));
  assert.deepEqual(startAll(turns), ['claude', 'gemini']);
  turns.userSaid('@Codex you too', pausing('codex'));
  assert.deepEqual(startAll(turns), ['codex']);
});

test('what the user says while someone speaks is unheard until a turn starts, and only while someone is in line', () => {
  const turns = new Turns();
  turns.userSaid('hello all', agents);
  assert.equal(turns.unheard, 1);
  assert.equal(start(turns), 'claude');
  assert.equal(turns.unheard, 0, 'the turn that started heard it');

  turns.userSaid('one more thing', [claude]);
  turns.userSaid('and another', [claude]);
  assert.equal(turns.unheard, 2);
  assert.equal(turns.turnEnded('claude', result()), true);
  assert.equal(start(turns), 'codex');
  assert.equal(turns.unheard, 2, 'the round going on is not for them');
  turns.turnEnded('codex', result());
  assert.equal(start(turns), 'gemini');
  turns.turnEnded('gemini', result());
  assert.equal(start(turns), 'claude');
  assert.equal(turns.unheard, 1, 'a turn hears the message it is for');
  turns.turnEnded('claude', result());
  assert.equal(start(turns), 'claude');
  assert.equal(turns.unheard, 0, 'and the next one has a turn of its own');

  turns.userSaid('wait', [claude]);
  turns.stop();
  assert.equal(turns.unheard, 0, 'sent away by a nudge');
  turns.userSaid('again', [claude]);
  assert.equal(turns.unheard, 1, 'what was sent away waits no more');
  assert.equal(new Turns().unheard, 0);
});

test('two messages said while it works are answered in two turns, in order', () => {
  const one = { mediaType: 'image/png', data: 'ONE' };
  const turns = new Turns();
  turns.userSaid('hello', [claude], [], null, 'hello');
  assert.equal(start(turns), 'claude');
  turns.userSaid('keep it simple', [claude], [one], null, 'simple');
  turns.userSaid('type it with FC', [claude], [], null, 'fc');
  assert.deepEqual(turns.queuedIds, ['simple', 'fc']);
  assert.equal(start(turns), null, 'nothing goes into the turn it is in');

  turns.turnEnded('claude', result());
  assert.deepEqual(turns.next(), { id: 'claude', images: [one] }, 'the first that waited, with its pictures');
  assert.deepEqual(turns.queuedIds, ['fc'], 'the other still waits');
  assert.equal(start(turns), null);
  turns.turnEnded('claude', result());
  assert.deepEqual(turns.next(), { id: 'claude', images: [] });
  assert.deepEqual(turns.queuedIds, []);
  turns.turnEnded('claude', result());
  assert.equal(turns.next(), null);
});

test('a hand-over to someone in line for a message that waits joins that turn, as before', () => {
  const turns = new Turns();
  turns.userSaid('@Claude go', agents, [], null, 'go');
  assert.equal(start(turns), 'claude');
  turns.userSaid('@Codex and you', agents, [], null, 'you');
  turns.agentSaid('claude', '@Codex over to you', agents, ME);
  turns.turnEnded('claude', result());
  assert.equal(start(turns), 'codex');
  assert.deepEqual(turns.queuedIds, []);
  turns.turnEnded('codex', result());
  assert.equal(turns.next(), null, 'one turn for both');
});

test('at the limit only the round that ran out is sent away: a message that waits still gets its round', () => {
  const turns = new Turns();
  turns.userSaid('@Claude @Codex discuss', agents, [], null, 'discuss');
  assert.equal(turns.next(1).id, 'claude');
  turns.userSaid('@Gemini have a look', agents, [], null, 'look');
  turns.turnEnded('claude', result());
  assert.deepEqual(turns.next(1), { paused: true }, 'Codex was in line for the round that ran out');
  assert.deepEqual(turns.queuedIds, ['look']);
  assert.equal(turns.next(1).id, 'gemini', 'the message that waited starts a round of its own');
  assert.deepEqual(turns.queuedIds, []);
  turns.agentSaid('gemini', '@Claude your turn', agents, ME);
  turns.turnEnded('gemini', result());
  assert.deepEqual(turns.next(1), { paused: true });
  assert.equal(turns.next(1), null);
});

test('Send now on a message that waits leaves the others to come one by one', () => {
  const turns = new Turns();
  turns.userSaid('@Claude running', agents, [], null, 'running');
  turns.next();
  turns.userSaid('@Claude first', agents, [], null, 'first');
  turns.userSaid('@Claude second', agents, [], null, 'second');
  turns.userSaid('@Claude third', agents, [], null, 'third');
  assert.deepEqual(turns.hurry('third'), [claude.id]);
  turns.turnEnded(claude.id, result(true));
  assert.equal(turns.next().selected, 'third');
  assert.deepEqual(turns.queuedIds, ['first', 'second']);
  turns.turnEnded(claude.id, result());
  assert.equal(turns.next().id, claude.id);
  assert.deepEqual(turns.queuedIds, ['second']);
  turns.turnEnded(claude.id, result());
  assert.equal(turns.next().id, claude.id);
  assert.deepEqual(turns.queuedIds, []);
});

test('a message taken back before anyone starts on it asks nobody, and its pictures go with it', () => {
  const one = { mediaType: 'image/png', data: 'ONE' };
  const two = { mediaType: 'image/png', data: 'TWO' };
  const turns = new Turns();
  turns.userSaid('hello', [claude, codex], [one], null, 'hello');
  assert.equal(start(turns), 'claude');
  turns.userSaid('@Codex and this', agents, [two], null, 'this');
  turns.userSaid('@Gemini you too', agents, [], null, 'too');
  assert.equal(turns.unheard, 2);

  assert.equal(turns.takeBack('this'), true);
  assert.equal(turns.unheard, 1);
  assert.equal(turns.takeBack('too'), true);
  assert.equal(turns.unheard, 0);
  assert.equal(turns.takeBack('too'), false, 'it is gone already');
  assert.equal(turns.takeBack('hello'), false, 'Claude started on it: it was heard');
  assert.equal(turns.takeBack(''), false);

  turns.turnEnded('claude', result());
  assert.deepEqual(turns.next(), { id: 'codex', images: [one] }, 'Codex is still in line for the first message');
  turns.turnEnded('codex', result());
  assert.equal(turns.next(), null, 'Gemini was in line only for what was taken back');
});

test('a message taken back leaves whoever was handed over to in line, and whoever another message is for', () => {
  const turns = new Turns();
  turns.userSaid('@Claude go', agents, [], null, 'go');
  assert.equal(start(turns), 'claude');
  turns.userSaid('@Gemini and you', agents, [], null, 'gemini');
  turns.agentSaid('claude', '@Gemini over to you', agents, ME);
  turns.agentSaid('claude', '@Codex you next', agents, ME);
  turns.userSaid('@Codex and @Gemini', agents, [], null, 'both');
  turns.userSaid('@Claude once more', agents, [], null, 'more');
  turns.userSaid('@Claude and this', agents, [], null, 'this');
  for (const said of ['gemini', 'both', 'more']) assert.equal(turns.takeBack(said), true);
  assert.deepEqual(turns.line, ['gemini', 'codex', 'claude'], 'handed over to, and the message still waiting');
  turns.turnEnded('claude', result());
  assert.deepEqual(runOut(turns), ['gemini', 'codex', 'claude']);
});

test('a slash command, or an effort check with nobody left in line, goes with the message taken back', () => {
  const turns = new Turns();
  turns.userSaid('hello', [claude]);
  assert.equal(start(turns), 'claude');
  turns.userSaid('/compact', agents, [], null, 'compact');
  turns.userSaid('@Codex have a look', agents, [], 'first', 'look');
  assert.deepEqual(turns.line, ['claude', 'codex']);
  assert.equal(turns.takeBack('compact'), true);
  assert.deepEqual(turns.line, ['codex']);
  assert.equal(turns.takeBack('look'), true);
  assert.equal(turns.waiting, false, 'the check Codex was to do goes too');
  turns.turnEnded('claude', result());
  assert.equal(turns.next(), null);

  // A message that can't be named is never taken back.
  turns.userSaid('hello', [claude]);
  assert.equal(start(turns), 'claude');
  turns.userSaid('@Codex look', agents);
  assert.equal(turns.takeBack(null), false);
  assert.deepEqual(turns.line, ['codex']);
});

test('hurried, a turn the user stops leaves the line as it is; otherwise it sends the line away', () => {
  assert.deepEqual(new Turns().hurry(), [], 'nobody speaks, nobody to stop');

  const turns = new Turns();
  turns.userSaid('hello all', [claude, codex]);
  assert.equal(start(turns), 'claude');
  turns.userSaid('@Codex what do you think?', [claude, codex]);
  assert.deepEqual(turns.hurry(), ['claude']);
  assert.equal(turns.turnEnded('claude', result(true)), true);
  assert.deepEqual(turns.line, ['codex']);
  assert.equal(start(turns), 'codex');

  // With nobody left to stop, the next stop is the user taking over again.
  turns.userSaid('hello all', [claude, codex]);
  assert.equal(turns.turnEnded('codex', result(true)), true);
  assert.deepEqual(turns.line, []);
});

test('all at once, hurrying stops everyone speaking, and the line waits for the last of them', () => {
  const turns = new Turns({ atOnce: true });
  turns.userSaid('hello', [claude, codex]);
  assert.deepEqual([start(turns), start(turns), start(turns)], ['claude', 'codex', null]);
  turns.userSaid('both of you, now', [claude, codex]);
  assert.deepEqual(turns.hurry().sort(), ['claude', 'codex']);
  turns.turnEnded('claude', result(true));
  assert.deepEqual(turns.line, ['claude', 'codex'], 'one still speaks: the line stays');
  turns.turnEnded('codex', result(true));
  assert.deepEqual(turns.line, ['claude', 'codex']);
  assert.deepEqual([start(turns), start(turns)], ['claude', 'codex']);
});

// ---- an agent that answers after changes ---------------------------------------------------------

const reviewer = { id: 'reviewer', name: 'Reviewer', afterChanges: true };

test('an agent that answers after changes sits out a message to everyone, and is followed up with after the round', () => {
  const turns = new Turns();
  const asked = turns.userSaid('fix the login', [claude, reviewer, codex]);
  assert.deepEqual(asked, ['claude', 'codex']);
  assert.deepEqual(runOut(turns), ['claude', 'codex']);

  assert.deepEqual(turns.followUp(['reviewer']), ['reviewer']);
  assert.deepEqual(runOut(turns), ['reviewer']);
});

test('followed up with, it gets no turn while the round still goes on', () => {
  const turns = new Turns();
  turns.userSaid('fix the login', [claude, reviewer]);
  assert.equal(start(turns), 'claude');
  assert.deepEqual(turns.followUp(['reviewer']), [], 'Claude is still speaking');
  turns.turnEnded('claude', result());
  assert.deepEqual(turns.followUp(['reviewer']), ['reviewer']);
});

test('mentioned, or handed over to, it answers at once like anyone else', () => {
  const turns = new Turns();
  turns.userSaid('@Reviewer what do you think?', [claude, reviewer]);
  assert.deepEqual(runOut(turns), ['reviewer']);

  turns.userSaid('fix it', [claude, reviewer]);
  assert.equal(start(turns), 'claude');
  turns.agentSaid('claude', 'Done. @Reviewer please look', [claude, reviewer], ME);
  turns.turnEnded('claude', result());
  assert.deepEqual(runOut(turns), ['reviewer']);
});

test('with nobody else to answer, it answers a message to everyone itself', () => {
  const turns = new Turns();
  assert.deepEqual(turns.userSaid('anything?', [{ ...claude, paused: true }, reviewer]), ['reviewer']);
  // Paused, it sits out like anyone.
  assert.deepEqual(
    turns.userSaid('anything?', [
      { ...claude, paused: true },
      { ...reviewer, paused: true },
    ]),
    []
  );
});

test('nobody is followed up with after the user stopped the round, until they say something again', () => {
  const turns = new Turns();
  turns.userSaid('fix the login', [claude, reviewer]);
  assert.equal(start(turns), 'claude');
  turns.stop();
  assert.deepEqual(turns.followUp(['reviewer']), []);

  // A turn the user stopped by declining does the same.
  turns.userSaid('fix it again', [claude, reviewer]);
  assert.equal(start(turns), 'claude');
  turns.turnEnded('claude', result(true));
  assert.deepEqual(turns.followUp(['reviewer']), []);

  turns.userSaid('once more', [claude, reviewer]);
  runOut(turns);
  assert.deepEqual(turns.followUp(['reviewer']), ['reviewer']);
});

test('a follow-up counts as a turn: past the limit the round pauses, and is followed up with no more', () => {
  const turns = new Turns();
  turns.userSaid('go', [claude, reviewer]);
  for (let i = 0; i < DEFAULT_TURN_LIMIT / 2; i += 1) {
    assert.equal(start(turns), 'claude');
    turns.turnEnded('claude', result());
    assert.deepEqual(turns.followUp(['reviewer']), ['reviewer']);
    assert.equal(start(turns), 'reviewer');
    turns.agentSaid('reviewer', '@Claude fix the typo', [claude, reviewer], ME);
    turns.turnEnded('reviewer', result());
  }
  assert.equal(start(turns), 'paused');
  assert.deepEqual(turns.followUp(['reviewer']), []);
});

test('one on its way out is not followed up with', () => {
  const turns = new Turns();
  turns.leaving('reviewer');
  assert.deepEqual(turns.followUp(['reviewer', 'codex']), ['codex']);
});

test('Send now isolates a selected message even when its recipient was already queued by a handoff', () => {
  const turns = new Turns();
  turns.userSaid('@Claude running', agents, [], null, 'running');
  turns.next();
  turns.agentSaid(claude.id, '@Codex please review', agents, ME);
  turns.userSaid('@Codex first', agents, [], null, 'first');
  const images = [{ mediaType: 'image/png', data: 'AAAA' }];
  turns.userSaid('@Codex second', agents, images, null, 'second');
  assert.deepEqual(turns.hurry('second'), [claude.id]);
  turns.turnEnded(claude.id, result(true));
  const selected = turns.next();
  assert.equal(selected.selected, 'second');
  assert.deepEqual(selected.images, images);
  assert.deepEqual(turns.queuedIds, ['first']);
  assert.equal(turns.hurry('second'), null);
  turns.turnEnded(codex.id, result());
  assert.equal(turns.next().id, codex.id);
});

test('cancelling a selected group message before the stopped turn finishes preserves the remaining line', () => {
  const turns = new Turns();
  turns.userSaid('@Claude running', agents, [], null, 'running');
  turns.next();
  turns.userSaid('@Codex first', agents, [], null, 'first');
  turns.userSaid('@Gemini second', agents, [], null, 'second');
  turns.hurry('second');
  assert.equal(turns.takeBack('second'), true);
  assert.equal(turns.hurry('second'), null);
  turns.turnEnded(claude.id, result(true));
  assert.equal(turns.next().id, codex.id);
  assert.equal(turns.next(), null);
});

test('an urgent manager note preserves queued user messages and waits for all interrupted speakers', () => {
  const turns = new Turns({ atOnce: true });
  turns.userSaid('Work', [claude, codex], [], null, 'running');
  turns.next();
  turns.next();
  turns.userSaid('@Claude follow up', agents, [], null, 'follow-up');
  assert.equal(turns.noteNow(codex.id, 'correction'), true);
  assert.deepEqual(turns.hurry(), [claude.id, codex.id]);
  turns.turnEnded(claude.id, result(true));
  assert.equal(turns.next(), null);
  turns.turnEnded(codex.id, result(true));
  const note = turns.next();
  assert.equal(note.note, 'correction');
  assert.deepEqual(turns.queuedIds, ['follow-up']);
  assert.equal(turns.next(), null, 'the correction has its own turn even in all-at-once groups');
  turns.turnEnded(codex.id, result());
  assert.equal(turns.next().id, claude.id);
});

test('Send now on a note is the user acting: its turn starts a round, also past the limit', () => {
  const turns = new Turns();
  turns.userSaid('Work', [claude]);
  turns.next(1);
  assert.equal(turns.noteNow(claude.id, 'correction'), true, 'the round took all its turns, and one still speaks');
  turns.hurry();
  turns.turnEnded(claude.id, result(true));
  assert.equal(turns.next(1).note, 'correction');
  turns.turnEnded(claude.id, result());

  turns.userSaid('discuss', [claude, codex]);
  assert.equal(pingPong(turns, 2).length, 2);
  assert.equal(turns.noteNow(claude.id, 'later'), true, 'the round was cut at the limit');
  assert.equal(turns.next(2).note, 'later');
  turns.agentSaid(claude.id, '@Codex and you?', [claude, codex], ME);
  turns.turnEnded(claude.id, result());
  assert.equal(start(turns), 'codex', 'what it hands over to counts from the note on');
});

test('Send now on a note cannot restart a round the user stopped', () => {
  const turns = new Turns();
  turns.userSaid('Work', [claude]);
  turns.next(1);
  turns.stop();
  assert.equal(turns.noteNow(claude.id, 'correction'), false);

  turns.userSaid('Again', [claude]);
  turns.next();
  turns.turnEnded(claude.id, result(true));
  assert.equal(turns.noteNow(claude.id, 'correction'), false, 'nor one whose turn the user stopped');
});

// ---- notes for the conversation's agent ----------------------------------------------------------

test('notes are read on a round of their own: the limit holds the agents’ hand-offs, not the notes', () => {
  const turns = new Turns();
  turns.userSaid('discuss', [claude, codex]);
  assert.equal(pingPong(turns, DEFAULT_TURN_LIMIT).length, DEFAULT_TURN_LIMIT, 'the round was cut at the limit');
  for (let note = 0; note < 15; note += 1) {
    assert.equal(turns.readNotes(claude.id), true, `note ${note + 1}`);
    assert.equal(start(turns), 'claude');
    turns.turnEnded(claude.id, result());
  }
  assert.equal(turns.active, false);
});

test('the hand-offs on a note stop at the limit, counted from the note', () => {
  const turns = new Turns();
  assert.equal(turns.readNotes(claude.id), true);
  assert.deepEqual(pingPong(turns, 3), ['claude', 'codex', 'claude']);
  assert.equal(turns.active, false, 'the hand-off to Codex was sent away');
  assert.deepEqual(turns.followUp(['reviewer']), [], 'and nobody follows up on a round cut at the limit');
  assert.equal(turns.readNotes(claude.id), true, 'the next note still gets its round');
  assert.deepEqual(pingPong(turns, 3), ['claude', 'codex', 'claude']);
});

test('notes wait for a round going on, whose next turn reads them, and for one on its way out', () => {
  const turns = new Turns();
  turns.userSaid('Work', [claude]);
  assert.equal(start(turns), 'claude');
  assert.equal(turns.readNotes(claude.id), false);
  turns.turnEnded(claude.id, result());
  turns.leaving(codex.id);
  assert.equal(turns.readNotes(codex.id), false);
  assert.equal(turns.readNotes(claude.id), true);
});

test('notes never restart a round the user stopped, also one cut at the limit before', () => {
  const turns = new Turns();
  turns.userSaid('Work', [claude]);
  start(turns);
  turns.stop();
  assert.equal(turns.readNotes(claude.id), false);

  turns.userSaid('Again', [claude]);
  start(turns);
  turns.turnEnded(claude.id, result(true));
  assert.equal(turns.readNotes(claude.id), false, 'a turn the user stopped by declining does the same');

  turns.userSaid('discuss', [claude, codex]);
  pingPong(turns, 2);
  turns.stop();
  assert.equal(turns.readNotes(claude.id), false);

  turns.userSaid('once more', [claude]);
  runOut(turns);
  assert.equal(turns.readNotes(claude.id), true, 'what the user says next starts the rounds again');
});

test('a hand-off limit the user stopped at stays stopped for an automatic continuation', () => {
  const turns = new Turns();
  turns.userSaid('discuss', [claude, codex]);
  pingPong(turns, 2);
  assert.equal(turns.continueWith(gemini.id, 'Continue'), false, 'cut at the limit');
  assert.equal(turns.brief(gemini.id, 'Review'), false);
  turns.stop();
  assert.equal(turns.continueWith(gemini.id, 'Continue'), false);
});
