import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answerOrderNotice,
  buddyStatus,
  byline,
  cantRemove,
  guestName,
  invitable,
  isGroup,
  landsAbove,
  modeOf,
  nobodyToInvite,
  oneStep,
  removable,
  sentMarks,
  sentMentions,
  speakerOf,
  speakersIn,
  statusLine,
  takesOver,
  turnTakingChoices,
  turnTakingHint,
  turnTakingNotice,
  usageParticipant,
} from '../src/renderer/chat/participants.js';
import { listNames } from '../src/renderer/lib/format.js';
import { descriptor as claudeProvider } from '../src/providers/claude/descriptor.js';
import { descriptor as codexProvider } from '../src/providers/codex/descriptor.js';

const participant = (id, name, provider, extra = {}) => ({
  id,
  name,
  avatar: provider.avatar,
  provider,
  permissionMode: provider.defaultPermissionMode,
  state: 'idle',
  host: false,
  ...extra,
});
const claude = participant('c1', 'Claude', claudeProvider, { host: true });
const codex = participant('c2', 'Codex', codexProvider);
const opus = participant('c3', 'Opus', claudeProvider);
const alone = [claude];
const both = [claude, codex];
const doing = (...states) => [claude, codex, opus].slice(0, states.length).map((p, i) => ({ ...p, state: states[i] }));

test('the usage meter prefers a working or unpaused agent, and an explicit choice stays selected', () => {
  const paused = { ...claude, paused: true };
  assert.equal(usageParticipant([paused, codex]), codex);
  const working = { ...codex, state: 'working' };
  assert.equal(usageParticipant([claude, working]), working);
  assert.equal(usageParticipant([paused, working], claude.id), paused);
  assert.equal(usageParticipant([paused, working], 'removed'), working);
  assert.equal(usageParticipant([paused, { ...codex, paused: true }]), paused, 'all paused still have usage');
});

test('usage is available for a supported guest even when the host has no usage support', () => {
  const unsupported = { ...claude, provider: { id: 'other' } };
  assert.equal(usageParticipant([unsupported, codex], claude.id), codex);
  assert.equal(usageParticipant([unsupported]), undefined);
  assert.equal(usageParticipant([]), undefined);
  assert.equal(usageParticipant([codex]), codex);
});

test('names are listed the way you would say them', () => {
  assert.equal(listNames([]), '');
  assert.equal(listNames(['Claude']), 'Claude');
  assert.equal(listNames(['Claude', 'Codex']), 'Claude and Codex');
  assert.equal(listNames(['Claude', 'Codex', 'Opus']), 'Claude, Codex and Opus');
});

// ---- whose line it is -----------------------------------------------------------------------------

test('a line is from the host unless it names a speaker', () => {
  const fromClaude = { name: 'Claude', provider: claudeProvider, avatar: 'claude' };
  assert.deepEqual(speakerOf(alone), fromClaude);
  assert.deepEqual(speakerOf(both, { type: 'text-start', key: 'k' }), fromClaude);
  assert.deepEqual(speakerOf(both, { speaker: 'c1' }), fromClaude);
  assert.deepEqual(speakerOf(both, { speaker: 'c2' }), { name: 'Codex', provider: codexProvider, avatar: 'codex' });
});

test('a line has the picture its speaker has now, and none once a guest has left', () => {
  const repictured = [claude, { ...codex, avatar: 'pack:robot.png' }];
  assert.equal(speakerOf(repictured, { speaker: 'c2' }).avatar, 'pack:robot.png', 'a picture picked for it');
  assert.equal(speakerOf(repictured, { speaker: 'c2', speakerName: 'Codex' }).avatar, 'pack:robot.png');
  assert.equal(speakerOf(alone, { speaker: 'c2', speakerName: 'Codex' }).avatar, null, 'not the host’s picture');
  assert.equal(speakerOf(alone, { speaker: 'gone' }).avatar, 'claude', 'without a name it is the host’s line');
});

test('a saved line keeps the name it was written under', () => {
  const renamed = [claude, { ...codex, name: 'Reviewer' }];
  assert.equal(speakerOf(renamed, { speaker: 'c2' }).name, 'Reviewer', 'what it says now is under its new name');
  assert.equal(speakerOf(renamed, { speaker: 'c2', speakerName: 'Codex' }).name, 'Codex');
  // A guest that has left, or was deleted: its lines are still its own.
  assert.equal(speakerOf(alone, { speaker: 'c2', speakerName: 'Codex' }).name, 'Codex');
  assert.equal(speakerOf(alone, { speaker: 'gone' }).name, 'Claude', 'without a name there is only the host to go by');
});

test('a line that does not say whose it is gets a name once several agents answer', () => {
  assert.equal(isGroup(alone), false);
  assert.equal(isGroup(both), true);
  assert.equal(byline(alone), '');
  assert.equal(byline(alone, { speaker: 'c1' }), '', 'one-on-one, every line reads as it always did');
  assert.equal(byline(both, { speaker: 'c2' }), 'Codex: ');
  assert.equal(byline(both, {}), 'Claude: ', 'the host is named too, or its lines would look like nobody’s');
  assert.equal(byline(both, { speaker: 'c2', speakerName: 'Old name' }), 'Old name: ');
  assert.equal(byline(alone, { speaker: 'c2', speakerName: 'Codex' }), 'Codex: ', 'a guest’s line, after it has left');
});

test('the participants of a saved conversation are whoever has lines in it', () => {
  const host = { id: 'c1', name: 'Claude', cwd: '/p' };
  const entries = [
    { kind: 'user', text: 'hello' },
    { kind: 'assistant', text: 'Hi.' },
    { kind: 'notice', text: 'Codex has been added to the conversation.', joined: 'c2' },
    { kind: 'assistant', text: 'Hello.', speaker: 'c2', speakerName: 'Codex' },
    { kind: 'result', speaker: 'c2', speakerName: 'Codex' },
    { kind: 'tool', speaker: 'c3', speakerName: 'Opus' },
    { kind: 'assistant', text: 'Again.', speaker: 'c2', speakerName: 'Codex 2' },
  ];
  assert.deepEqual(speakersIn(entries, host), [
    { id: 'c1', name: 'Claude' },
    { id: 'c2', name: 'Codex' },
    { id: 'c3', name: 'Opus' },
  ]);
  assert.deepEqual(
    speakersIn(entries.slice(0, 3), host),
    [{ id: 'c1', name: 'Claude' }],
    'one-on-one until a guest speaks'
  );
  assert.deepEqual(speakersIn([], host), [{ id: 'c1', name: 'Claude' }]);
});

// ---- how they are doing ---------------------------------------------------------------------------

test('each participant wears the buddy of its own state', () => {
  assert.equal(buddyStatus('working'), 'busy');
  assert.equal(buddyStatus('connecting'), 'busy');
  assert.equal(buddyStatus('waiting'), 'away');
  assert.equal(buddyStatus('idle'), 'online');
  assert.equal(buddyStatus('offline'), 'online', 'a session that has not started is ready to');
  assert.equal(buddyStatus('idle', true), 'offline', 'nobody can work in a folder that is gone');
  assert.equal(buddyStatus('working', true), 'busy');
  assert.equal(buddyStatus('idle', false, true), 'offline', 'a paused agent is greyed out');
  assert.equal(buddyStatus('working', false, true), 'busy', 'unless you asked it, and it is at it');
  assert.equal(buddyStatus('waiting', false, true), 'away');
});

test('a participant’s mode is one of its own provider’s', () => {
  assert.equal(modeOf(claude).label, 'Ask before acting');
  assert.equal(modeOf({ ...codex, permissionMode: 'full-access' }).danger, true);
  assert.equal(
    modeOf({ ...codex, permissionMode: 'acceptEdits' }).id,
    'ask',
    'a mode it does not have reads as its first'
  );
});

test('the status bar says who is typing', () => {
  const line = (participants) => statusLine({ participants, lastReceived: null, cwd: '/Users/safa/api' });
  assert.deepEqual(line(doing('working')), { icon: 'pencil', text: 'Claude is typing a message...' });
  assert.deepEqual(line(doing('idle', 'working')), { icon: 'pencil', text: 'Codex is typing a message...' });
  assert.deepEqual(line(doing('working', 'working', 'working')), {
    icon: 'pencil',
    text: 'Claude, Codex and Opus are typing messages...',
  });
});

test('the status bar says what each one at work is doing, once the app knows', () => {
  const line = (participants) => statusLine({ participants, lastReceived: null, cwd: '/p' });
  const at = (status) => ({ status, since: 0 });
  const [host, guest] = doing('working', 'working');
  assert.deepEqual(line([{ ...host, doing: at('Thinking') }]), { icon: 'pencil', text: 'Claude is thinking...' });
  assert.equal(
    line([
      { ...host, doing: at('Writing schema.rb') },
      { ...guest, doing: at('Running npm test') },
    ]).text,
    'Claude is writing schema.rb and Codex is running npm test...'
  );
  assert.equal(
    line([{ ...host, doing: at('Thinking') }, guest]).text,
    'Claude is thinking and Codex is typing a message...',
    'one the app has not heard from yet is typing'
  );
  const [, waiting] = doing('working', 'waiting');
  assert.equal(
    line([{ ...host, doing: at('Running npm test') }, waiting]).text,
    'Codex is waiting for you to accept or decline. Claude is running npm test...'
  );
});

test('whoever waits for you comes first in the status bar', () => {
  const line = (participants) => statusLine({ participants, lastReceived: 1, cwd: '/p' });
  assert.deepEqual(line(doing('waiting')), {
    icon: 'info',
    text: 'Claude is waiting for you to accept or decline.',
  });
  assert.deepEqual(line(doing('idle', 'waiting')), {
    icon: 'info',
    text: 'Codex is waiting for you to accept or decline.',
  });
  assert.deepEqual(line(doing('waiting', 'idle', 'waiting')), {
    icon: 'info',
    text: 'Claude and Opus are waiting for you to accept or decline.',
  });
  assert.deepEqual(line(doing('working', 'waiting')), {
    icon: 'info',
    text: 'Codex is waiting for you to accept or decline. Claude is typing...',
  });
  assert.deepEqual(line(doing('connecting', 'waiting')).text, 'Codex is waiting for you to accept or decline.');
});

test('signing in names the service, once', () => {
  const line = (participants) => statusLine({ participants, lastReceived: null, cwd: '/p' });
  assert.deepEqual(line(doing('connecting')), { icon: 'clock', text: 'Signing in to Claude...' });
  assert.deepEqual(line(doing('idle', 'connecting')), { icon: 'clock', text: 'Signing in to Codex...' });
  assert.equal(line(doing('connecting', 'connecting', 'connecting')).text, 'Signing in to Claude and Codex...');
  assert.equal(line(doing('connecting', 'working')).text, 'Codex is typing a message...', 'typing says more');
});

test('with nothing going on, the status bar says when the last message came, or who works where', () => {
  const quiet = (participants, lastReceived = null) =>
    statusLine({ participants, lastReceived, cwd: '/Users/safa/projects/api' });
  assert.deepEqual(quiet(alone), { icon: '', text: 'Claude works in ~/projects/api. Say hi!' });
  assert.deepEqual(quiet(both), { icon: '', text: 'Claude and Codex work in ~/projects/api. Say hi!' });
  assert.equal(
    quiet(doing('offline', 'idle', 'offline')).text,
    'Claude, Codex and Opus work in ~/projects/api. Say hi!'
  );
  const received = quiet(both, new Date(2026, 9, 6, 17, 5).getTime());
  assert.equal(received.icon, '');
  assert.match(received.text, /^Last message received at \S.* on \S.*\.$/);
});

test('an archived contact’s conversation is only read: nobody is asked to say hi', () => {
  const quiet = (participants, lastReceived = null) =>
    statusLine({ participants, lastReceived, cwd: '/Users/safa/projects/api', archived: true });
  assert.deepEqual(quiet(alone), { icon: '', text: 'Claude works in ~/projects/api.' });
  assert.deepEqual(quiet(both), { icon: '', text: 'Claude and Codex work in ~/projects/api.' });
  assert.match(quiet(alone, new Date(2026, 9, 6, 17, 5).getTime()).text, /^Last message received at /);
});

// ---- inviting ---------------------------------------------------------------------------------------

test('everyone who is not in the conversation yet can be invited', () => {
  const contacts = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }];
  assert.deepEqual(invitable(contacts, alone), [{ id: 'c2' }, { id: 'c3' }, { id: 'c4' }], 'not the host itself');
  assert.deepEqual(invitable(contacts, both), [{ id: 'c3' }, { id: 'c4' }], 'nor a guest twice');
  assert.deepEqual(invitable(contacts.slice(0, 2), both), [], 'and sometimes nobody is left');
  assert.deepEqual(invitable([], alone), []);
});

test('an archived contact cannot be invited', () => {
  const contacts = [{ id: 'c1' }, { id: 'c2', archived: true }, { id: 'c3' }, { id: 'c4', archived: true }];
  assert.deepEqual(invitable(contacts, alone), [{ id: 'c3' }]);
  assert.deepEqual(invitable(contacts, [claude, opus]), [], 'the only one left to ask is archived');
  // Being a favorite, or whatever its status says, makes no difference.
  assert.deepEqual(
    invitable([{ id: 'c1' }, { id: 'c2', archived: true, favorite: true, status: 'online' }], alone),
    []
  );
  assert.deepEqual(invitable([{ id: 'c1' }, { id: 'c2', archived: false }], alone), [{ id: 'c2', archived: false }]);
  assert.deepEqual(
    invitable([{ id: 'c1' }, { id: 'c2', favorite: true }], alone),
    [{ id: 'c2', favorite: true }],
    'a favorite is invited like anyone'
  );
});

test('with nobody to invite, the dialog says why', () => {
  const everyone = 'Everyone on your contact list is in this conversation already.';
  const archived = 'Your other contacts are archived. Restore one in the contact list first.';
  const only = 'This is your only contact. Add another one in the contact list first.';
  assert.equal(nobodyToInvite([{ id: 'c1' }, { id: 'c2' }]), everyone);
  assert.equal(nobodyToInvite([{ id: 'c1' }, { id: 'c2' }, { id: 'c3', archived: true }]), everyone);
  assert.equal(nobodyToInvite([{ id: 'c1' }, { id: 'c2', archived: true }]), archived);
  assert.equal(nobodyToInvite([{ id: 'c1' }, { id: 'c2', archived: true }, { id: 'c3', archived: true }]), archived);
  assert.equal(nobodyToInvite([{ id: 'c1' }]), only);
});

test('a contact made to join is named after its service and its model', () => {
  assert.equal(guestName(codexProvider, '', alone), 'Codex');
  assert.equal(guestName(claudeProvider, 'opus', alone), 'Claude (opus)');
});

test('a contact made to join gets a number when its name is taken here', () => {
  assert.equal(guestName(claudeProvider, '', alone), 'Claude 2', 'the host is Claude already');
  assert.equal(guestName(codexProvider, '', both), 'Codex 2');
  const crowd = [...both, participant('c5', 'codex 2 ', codexProvider)];
  assert.equal(guestName(codexProvider, '', crowd), 'Codex 3', 'in any letter case, like a mention');
  const models = [claude, participant('c6', 'Claude (opus)', claudeProvider)];
  assert.equal(guestName(claudeProvider, 'opus', models), 'Claude (opus) 2');
  assert.equal(guestName(claudeProvider, 'haiku', models), 'Claude (haiku)', 'another model is another name');
});

// ---- mentions in what you sent ---------------------------------------------------------------------

test('a mention is marked where it picks who answers', () => {
  const marked = (text, participants) =>
    sentMentions(text, participants).map(({ start, end }) => text.slice(start, end));
  assert.deepEqual(marked('@Codex can you review this?', both), ['@Codex']);
  assert.deepEqual(marked('@codex and then @CLAUDE', both), ['@codex', '@CLAUDE']);
  assert.deepEqual(marked('look at @CLAUDE.md, @Codex', both), ['@Codex'], 'a file is not a participant');
  assert.deepEqual(marked('@Claude are you there?', alone), [], 'one-on-one, a mention picks nobody');
  assert.deepEqual(marked('/review @Codex', both), [], 'a slash command goes to the host, whoever it names');
  assert.deepEqual(marked('@Opus?', both), [], 'someone who is not here');
});

test('a web address in what you sent is marked as a link, next to the mentions', () => {
  const marked = (text, participants) =>
    sentMarks(text, participants).map(({ start, end, link }) => [text.slice(start, end), link ? 'link' : 'mention']);
  assert.deepEqual(marked('https://tracker.example.com/acme/issue/APP-618', alone), [
    ['https://tracker.example.com/acme/issue/APP-618', 'link'],
  ]);
  assert.deepEqual(marked('@Codex read https://a.dev/x, then tell @Claude', both), [
    ['@Codex', 'mention'],
    ['https://a.dev/x', 'link'],
    ['@Claude', 'mention'],
  ]);
  assert.deepEqual(
    marked('https://medium.com/@codex/post', both),
    [['https://medium.com/@codex/post', 'link']],
    'an @ inside an address mentions nobody'
  );
  assert.deepEqual(marked('/review https://a.dev/pull/1 @Codex', both), [['https://a.dev/pull/1', 'link']]);
  assert.deepEqual(marked('no address here', both), []);
});

test('a file named in what you sent is marked as one, with its path', () => {
  const marked = (text, participants) =>
    sentMarks(text, participants).map(({ start, end, link, file }) => [
      text.slice(start, end),
      link ? 'link' : (file ?? 'mention'),
    ]);
  assert.deepEqual(marked('@Codex summarize these\n@"/Users/me/My Notes.pdf" @src/app.js', both), [
    ['@Codex', 'mention'],
    ['@"/Users/me/My Notes.pdf"', '/Users/me/My Notes.pdf'],
    ['@src/app.js', 'src/app.js'],
  ]);
  assert.deepEqual(marked('/review @README.md', both), [['@README.md', 'README.md']], 'with a slash command too');
  assert.deepEqual(
    marked('https://medium.com/@codex/post.md', alone),
    [['https://medium.com/@codex/post.md', 'link']],
    'an @ inside an address names no file'
  );
});

test('with nobody at it, the status bar says who checks back when, before when the last message came', () => {
  const line = (participants) => statusLine({ participants, lastReceived: 1, cwd: '/p' });
  const checkIn = { id: 'x', schedule: '*/5 * * * *', recurring: true, prompt: 'Check CI' };
  const checking = (p, count = 1) => ({
    ...p,
    checkIns: Array.from({ length: count }, (_, i) => ({ ...checkIn, id: `x${i}` })),
  });
  assert.deepEqual(line([checking(claude)]), { icon: 'clock', text: 'Claude will check back every 5 minutes.' });
  assert.deepEqual(line([checking(claude, 3)]), { icon: 'clock', text: 'Claude has 3 check-ins scheduled.' });
  assert.deepEqual(line([claude, checking(codex), checking(opus, 2)]), {
    icon: 'clock',
    text: 'Codex and Opus have check-ins scheduled.',
  });
  assert.deepEqual(line([{ ...checking(claude), state: 'working' }]), {
    icon: 'pencil',
    text: 'Claude is typing a message...',
  });
  assert.deepEqual(line([{ ...claude, checkIns: [] }]).icon, '', 'none left is nothing to say');
});

test('with nobody at it, the status bar says what runs in the background, before who checks back', () => {
  const line = (participants) => statusLine({ participants, lastReceived: 1, cwd: '/p' });
  const task = (kind, status = 'running') => ({ id: kind, kind, label: '', status, started: 0, ended: null });
  const leaving = (p, ...tasks) => ({ ...p, background: tasks });
  const checkIns = [{ id: 'x', schedule: '*/5 * * * *', recurring: true, prompt: 'Check CI' }];
  assert.deepEqual(line([leaving({ ...claude, checkIns }, task('command'))]), {
    icon: 'clock',
    text: 'Claude has a command running in the background.',
  });
  assert.equal(
    line([leaving(claude, task('command'), task('command'), task('watcher'))]).text,
    'Claude has 2 commands and a watcher running in the background.'
  );
  assert.equal(
    line([leaving(claude, task('watcher')), codex, leaving(opus, task('command'))]).text,
    'Claude and Opus have things running in the background.'
  );
  assert.equal(
    line([leaving({ ...claude, checkIns }, task('command', 'done'))]).text,
    'Claude will check back every 5 minutes.',
    'what ended is nothing to say'
  );
  assert.deepEqual(line([{ ...leaving(claude, task('command')), state: 'working' }]), {
    icon: 'pencil',
    text: 'Claude is typing a message...',
  });
});

test('the agents take turns until they are told to answer all at once', () => {
  assert.deepEqual(turnTakingChoices(undefined), [
    { atOnce: false, label: 'Take turns', pressed: true },
    { atOnce: true, label: 'All at once', pressed: false },
  ]);
  assert.deepEqual(
    turnTakingChoices(false).map((choice) => choice.pressed),
    [true, false]
  );
  assert.deepEqual(
    turnTakingChoices(true).map((choice) => choice.pressed),
    [false, true]
  );
  assert.equal(turnTakingHint(undefined), 'They answer one after another, top to bottom. Drag to reorder.');
  assert.equal(turnTakingHint(false), 'They answer one after another, top to bottom. Drag to reorder.');
  assert.equal(turnTakingHint(true), 'They all start answering right away.');
  assert.equal(
    turnTakingNotice(true),
    'Everyone answers at once now: each agent starts as soon as a message is for it.'
  );
  assert.equal(turnTakingNotice(false), 'Everyone takes turns again, one after another.');
});

test('a row dragged over the list lands above the first row whose middle is below the pointer', () => {
  const rows = [
    { id: 'claude', top: 0, height: 40 },
    { id: 'codex', top: 50, height: 40 },
    { id: 'gemini', top: 100, height: 40 },
  ];
  assert.equal(landsAbove(rows, -10), 'claude');
  assert.equal(landsAbove(rows, 19), 'claude');
  assert.equal(landsAbove(rows, 21), 'codex');
  assert.equal(landsAbove(rows, 119), 'gemini');
  assert.equal(landsAbove(rows, 121), null, 'under the middle of the last: after it');
  assert.equal(landsAbove([], 5), null);
});

test('moving an agent one place up or down says where it goes, and nowhere at either end', () => {
  const ids = ['claude', 'codex', 'gemini'];
  assert.equal(oneStep(ids, 'codex', -1), 'claude');
  assert.equal(oneStep(ids, 'gemini', -1), 'codex');
  assert.equal(oneStep(ids, 'claude', 1), 'gemini', 'just before the one after the next');
  assert.equal(oneStep(ids, 'codex', 1), null, 'to the end');
  assert.equal(oneStep(ids, 'claude', -1), undefined);
  assert.equal(oneStep(ids, 'gemini', 1), undefined);
});

test('the conversation says who answers first from now on', () => {
  assert.equal(answerOrderNotice(['Codex', 'Claude']), 'Codex answers first now, then Claude.');
  assert.equal(answerOrderNotice(['Gemini', 'Codex', 'Claude']), 'Gemini answers first now, then Codex, then Claude.');
  assert.equal(answerOrderNotice(['Codex']), 'Codex answers first now.');
});

test('a guest is always removable, and the host only while a guest is here to take over from it', () => {
  const host = { id: 'h', name: 'Codex', host: true, paused: true };
  const guest = { id: 'g', name: 'Claude' };
  const paused = { id: 'p', name: 'Gemini', paused: true };
  assert.equal(removable(guest, [host, guest], {}), true);
  assert.equal(removable(paused, [host, guest, paused], {}), true, 'paused, it is still removable');
  assert.equal(removable(host, [host, guest], {}), true, 'paused or not');
  assert.equal(removable(host, [host], {}), false, 'there is nobody to leave the conversation to');
  assert.equal(removable(host, [host, guest], { manages: 'project' }), false, 'a manager switches services instead');
});

test('a greyed-out ✕ says why its agent stays', () => {
  const host = { id: 'h', name: 'Claude', host: true };
  const guest = { id: 'g', name: 'Codex' };
  assert.equal(
    cantRemove(host, [host], {}),
    'Claude is the only agent here. Invite another one to take the conversation over first.'
  );
  assert.equal(
    cantRemove(host, [host, guest], { manages: 'project' }),
    'Claude manages this project, so it stays in its conversation. Switch its service instead.'
  );
  assert.equal(cantRemove(host, [host, guest], {}), '');
  assert.equal(cantRemove(guest, [host, guest], { manages: 'project' }), '');
});

test('the guest that answers first takes the conversation over from the host', () => {
  const host = { id: 'h', host: true };
  const first = { id: 'a' };
  const second = { id: 'b' };
  assert.equal(takesOver([host, first, second]), first);
  assert.equal(takesOver([host, first, second], ['b', 'h', 'a']), second);
  assert.equal(takesOver([host, first, second], ['h']), first);
  assert.equal(takesOver([host]), undefined);
});
