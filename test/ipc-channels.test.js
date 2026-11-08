import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EVENTS, REQUESTS } from '../src/shared/ipc-channels.js';

// The sandboxed preload can't import the channel list, so it repeats the
// strings. Keep both sides in sync.
const preload = fs.readFileSync(new URL('../src/preload/index.cjs', import.meta.url), 'utf8');
const used = (fn) => new Set([...preload.matchAll(new RegExp(`${fn}\\('([^']+)'\\)`, 'g'))].map((m) => m[1]));

test('the preload exposes exactly the request channels the main process handles', () => {
  assert.deepEqual([...used('invoke'), ...used('invokeNow')].sort(), Object.values(REQUESTS).sort());
});

// What a page draws its first picture from is answered at once, on both sides.
test('what a page starts from is asked for with invokeNow, and answered with answerNow', () => {
  const ipc = fs.readFileSync(new URL('../src/main/ipc.js', import.meta.url), 'utf8');
  const answered = new Set([...ipc.matchAll(/answerNow\(REQUESTS\.(\w+)/g)].map((m) => REQUESTS[m[1]]));
  assert.deepEqual([...used('invokeNow')].sort(), [...answered].sort());
  assert.deepEqual([...answered].sort(), [REQUESTS.appInit, REQUESTS.chatInit, REQUESTS.packList].sort());
});

test('the preload subscribes to exactly the events the main process sends', () => {
  assert.deepEqual([...used('subscribe')].sort(), Object.values(EVENTS).sort());
});

test('every request channel has a handler', () => {
  const ipc = fs.readFileSync(new URL('../src/main/ipc.js', import.meta.url), 'utf8');
  for (const key of Object.keys(REQUESTS))
    assert.match(ipc, new RegExp(`REQUESTS\\.${key}\\b`), `no handler for ${key}`);
});

// The browser preview stands in for both sides: preview/bridge.js for the preload and
// preview/host.js for the main process. A channel missing there breaks the demo.
test("the preview's bridge exposes the same channels as the preload", () => {
  const bridge = fs.readFileSync(new URL('../preview/bridge.js', import.meta.url), 'utf8');
  const inBridge = (fn) => new Set([...bridge.matchAll(new RegExp(`${fn}\\('([^']+)'\\)`, 'g'))].map((m) => m[1]));
  assert.deepEqual([...inBridge('invoke')].sort(), Object.values(REQUESTS).sort());
  assert.deepEqual([...inBridge('subscribe')].sort(), Object.values(EVENTS).sort());
});

test("the preview's stand-in for the main process answers every request", () => {
  const host = fs.readFileSync(new URL('../preview/host.js', import.meta.url), 'utf8');
  for (const key of Object.keys(REQUESTS))
    assert.match(host, new RegExp(`\\[REQUESTS\\.${key}\\]`), `no handler for ${key}`);
});

/** window.messenger as a file spells it out: section -> name -> channel. */
function messengerApi(source) {
  const sections = [...source.matchAll(/(\w+): \{([^{}]*)\}/g)].map(([, section, body]) => [
    section,
    Object.fromEntries(
      [...body.matchAll(/(\w+): (?:invoke|invokeNow|subscribe)\('([^']+)'\)/g)].map(([, name, to]) => [name, to])
    ),
  ]);
  return Object.fromEntries(sections.filter(([, names]) => Object.keys(names).length));
}

// The windows are written against these names, and run on either side unchanged.
test("the preview's bridge gives the windows the same API as the preload, name for name", () => {
  const bridge = fs.readFileSync(new URL('../preview/bridge.js', import.meta.url), 'utf8');
  const api = messengerApi(preload);
  assert.deepEqual(messengerApi(bridge), api);
  assert.equal(Object.values(api).flatMap(Object.keys).length, Object.keys({ ...REQUESTS, ...EVENTS }).length);
});

test('archiving, restoring and searching are where the windows look for them', () => {
  const api = messengerApi(preload);
  assert.equal(api.contacts.archive, REQUESTS.contactArchive);
  assert.equal(api.contacts.restore, REQUESTS.contactRestore);
  assert.equal(api.history.search, REQUESTS.historySearch);
  assert.equal(api.on.historyQuery, EVENTS.historyQuery);
  assert.deepEqual(
    [REQUESTS.contactArchive, REQUESTS.contactRestore, REQUESTS.historySearch, EVENTS.historyQuery],
    ['contact:archive', 'contact:restore', 'history:search', 'history:query']
  );
});

test('Mark as unread and Mark as read are where the windows look for them', () => {
  const api = messengerApi(preload);
  assert.equal(api.contacts.setUnread, REQUESTS.contactSetUnread);
  assert.equal(REQUESTS.contactSetUnread, 'contact:set-unread');
});

test('the Helpers tab stops a helper where the main process answers', () => {
  const api = messengerApi(preload);
  assert.equal(api.chat.stopHelper, REQUESTS.chatStopHelper);
  assert.equal(REQUESTS.chatStopHelper, 'chat:stop-helper');
});

test('the Changes tab asks where the main process answers', () => {
  const api = messengerApi(preload);
  assert.equal(api.changes.list, REQUESTS.changesList);
  assert.equal(api.changes.commit, REQUESTS.changesCommit);
  assert.equal(api.changes.diff, REQUESTS.changesDiff);
  assert.equal(api.changes.threads, REQUESTS.changesThreads);
  assert.equal(api.changes.reply, REQUESTS.changesReply);
  assert.equal(api.changes.resolve, REQUESTS.changesResolve);
  assert.deepEqual(
    [
      REQUESTS.changesList,
      REQUESTS.changesCommit,
      REQUESTS.changesDiff,
      REQUESTS.changesThreads,
      REQUESTS.changesReply,
      REQUESTS.changesResolve,
    ],
    ['changes:list', 'changes:commit', 'changes:diff', 'changes:threads', 'changes:reply', 'changes:resolve']
  );
});

test('"Create PR manually" asks for its page where the main process answers', () => {
  const api = messengerApi(preload);
  assert.equal(api.contacts.pullRequestPage, REQUESTS.contactPullRequestPage);
  assert.equal(REQUESTS.contactPullRequestPage, 'contact:pull-request-page');
});

test('Restart on the update card asks where the main process answers', () => {
  const api = messengerApi(preload);
  assert.equal(api.app.restartToUpdate, REQUESTS.updateRestart);
  assert.equal(REQUESTS.updateRestart, 'update:restart');
});
