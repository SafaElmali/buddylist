import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Listening, parseHeard } from '../src/main/listening.js';
import { Store } from '../src/main/storage/store.js';
import { MemoryStore } from '../preview/memory-storage.js';

const song = (player, title = 'A song', artist = 'An artist') => ({ player, title, artist });
const line = (player, title = 'A song', artist = 'An artist') =>
  `${JSON.stringify({ ...song(player, title, artist), playing: true })}\n`;

function setup(platform = 'darwin') {
  const changes = [];
  const children = [];
  const listening = new Listening({
    platform,
    onChange: (value) => changes.push(value),
    spawn(command, args, options) {
      assert.equal(command, 'osascript');
      assert.deepEqual(args.slice(0, 3), ['-l', 'JavaScript', '-e']);
      assert.deepEqual(options.stdio, ['pipe', 'pipe', 'ignore']);
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => (child.killed = true);
      children.push(child);
      return child;
    },
  });
  return { listening, changes, children };
}

test('only known players and usable track metadata become a listening status', () => {
  for (const invalid of ['', 'not json', 'null', '[]', '{}', '{"player":"Other"}']) {
    assert.equal(parseHeard(invalid), null);
  }
  assert.deepEqual(parseHeard(line('Spotify', '  A song  ', ' Artist ')), {
    player: 'Spotify',
    song: song('Spotify', 'A song', 'Artist'),
  });
  assert.deepEqual(parseHeard(line('Music', 'Radio', null)), {
    player: 'Music',
    song: song('Music', 'Radio', ''),
  });
  for (const payload of [
    { playing: false, title: 'An old track' },
    { playing: 'true', title: 'Not playing' },
    { playing: true, title: 3 },
    { playing: true, title: '  ' },
  ]) {
    assert.deepEqual(parseHeard(JSON.stringify({ player: 'Spotify', ...payload })), {
      player: 'Spotify',
      song: null,
    });
  }
});

test('listening is opt-in, starts just once, and stops the helper when switched off', () => {
  const { listening, changes, children } = setup();
  assert.equal(listening.song, null);
  listening.setEnabled(false);
  assert.equal(children.length, 0);
  listening.setEnabled(true);
  listening.setEnabled(true);
  assert.equal(children.length, 1);
  children[0].stdout.write(line('Spotify'));
  assert.deepEqual(listening.song, song('Spotify'));
  listening.setEnabled(false);
  assert.equal(children[0].killed, true);
  assert.equal(children[0].stdin.writableEnded, true);
  assert.equal(listening.song, null);
  assert.deepEqual(changes, [song('Spotify'), null]);
});

test('other platforms never start a music helper', () => {
  for (const platform of ['linux', 'win32']) {
    const { listening, children, changes } = setup(platform);
    listening.setEnabled(true);
    assert.deepEqual(children, []);
    assert.deepEqual(changes, []);
  }
});

test('split and batched announcements work; duplicates and malformed lines do not notify', () => {
  const { listening, children, changes } = setup();
  listening.setEnabled(true);
  const stream = children[0].stdout;
  const heard = line('Spotify', '夜に駆ける', 'YOASOBI');
  const bytes = Buffer.from(heard);
  const split = bytes.indexOf(Buffer.from('夜')) + 1;
  stream.write(bytes.subarray(0, split));
  assert.equal(listening.song, null);
  stream.write(bytes.subarray(split));
  stream.write(`noise\n${heard}${line('Spotify', '<Song :)>', '<Artist>')}`);
  assert.deepEqual(changes, [song('Spotify', '夜に駆ける', 'YOASOBI'), song('Spotify', '<Song :)>', '<Artist>')]);
  listening.setEnabled(false);
});

test('the latest playing app wins, and pausing it restores the other player or personal message', () => {
  const { listening, children, changes } = setup();
  listening.setEnabled(true);
  const stream = children[0].stdout;
  stream.write(line('Spotify'));
  stream.write(line('Music', 'Another song'));
  assert.deepEqual(listening.song, song('Music', 'Another song'));
  stream.write('{"player":"Music","playing":false}\n');
  assert.deepEqual(listening.song, song('Spotify'));
  stream.write('{"player":"Spotify","playing":false}\n');
  assert.equal(listening.song, null);
  stream.write('{"player":"Music","playing":false}\n');
  assert.equal(changes.length, 4);
  listening.setEnabled(false);
});

test('late data and exit from a stopped helper cannot replace the new helper’s song', () => {
  const { listening, children } = setup();
  listening.setEnabled(true);
  const old = children[0];
  old.stdout.write(line('Spotify'));
  listening.setEnabled(false);
  old.stdout.write(line('Spotify', 'Late song'));
  assert.equal(listening.song, null);
  listening.setEnabled(true);
  children[1].stdout.write(line('Music'));
  old.stdout.write(line('Spotify', 'Late song'));
  old.emit('exit', 0);
  assert.deepEqual(listening.song, song('Music'));
  listening.setEnabled(false);
});

test('helper failure clears stale music and allows listening to start again', () => {
  for (const event of ['error', 'exit']) {
    const { listening, children, changes } = setup();
    listening.setEnabled(true);
    children[0].stdout.write(line('Spotify'));
    children[0].emit(event, event === 'error' ? new Error('helper failed') : 1);
    assert.equal(listening.song, null);
    assert.deepEqual(changes, [song('Spotify'), null]);
    children[0].stdout.write(line('Spotify', 'Late song'));
    assert.equal(listening.song, null);
    listening.setEnabled(true);
    assert.equal(children.length, 2);
    listening.setEnabled(false);
  }
});

test('the preference survives restart while the saved personal message stays intact', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-listening-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir, { defaultProvider: 'claude' });
  assert.equal(store.settings.showListening, false);
  assert.equal(new MemoryStore().settings.showListening, false);
  store.updateProfile({ personalMessage: 'Back soon' });
  store.updateSettings({ showListening: true });
  const reopened = new Store(dir, { defaultProvider: 'claude' });
  assert.equal(reopened.settings.showListening, true);
  assert.equal(reopened.profile.personalMessage, 'Back soon');
  // Existing installs get the same opt-in default.
  const file = path.join(dir, 'messenger.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete saved.settings.showListening;
  fs.writeFileSync(file, JSON.stringify(saved));
  assert.equal(new Store(dir, { defaultProvider: 'claude' }).settings.showListening, false);
});
