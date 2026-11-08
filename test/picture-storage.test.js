import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Pictures } from '../src/main/storage/pictures.js';
import { History } from '../src/main/storage/history.js';
import { sentPictures } from '../src/shared/pictures.js';
import { loadPicture, pictureSource } from '../src/renderer/lib/picture-source.js';

const preview = 'data:image/webp;base64,UklGRg==';
const original = `data:image/png;base64,${Buffer.from('original pixels, alpha and metadata').toString('base64')}`;
const temporary = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-pictures-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('original bytes are stored once without re-encoding, and references survive moving the profile', async (t) => {
  const dir = temporary(t);
  const pictures = new Pictures(path.join(dir, 'before'));
  for (const type of ['png', 'jpeg', 'gif', 'webp']) {
    const source = original.replace('image/png', `image/${type}`);
    const reference = pictures.keep(source);
    assert.equal(pictures.keep(source), reference);
    assert.equal(pictures.keep(reference), reference);
    assert.equal(await pictures.read(reference), source);
  }
  assert.equal(fs.readdirSync(pictures.dir).length, 4);
  const reference = pictures.keep(original);
  fs.renameSync(pictures.dir, path.join(dir, 'after'));
  assert.equal(await new Pictures(path.join(dir, 'after')).read(reference), original);
});

test('saved originals survive archive, fork, restart and deletion of the source conversation', async (t) => {
  const dir = temporary(t);
  const history = new History(dir);
  const entry = history.append('first', { kind: 'user', text: 'look', pictures: [preview], originals: [original] });
  const archived = history.archive('first', { cwd: '/work' });
  const entries = history.readArchived('first', archived.id).entries;
  history.begin('fork', entries);
  history.purge('first');
  history.flush();
  const reopened = new History(dir);
  assert.equal(reopened.read('fork')[0].originals[0], entry.originals[0]);
  assert.equal(await reopened.pictures.read(entry.originals[0]), original);
  // Old data needs no migration and does not acquire a false claim of an original.
  reopened.append('old', { kind: 'user', text: 'before originals', pictures: [preview] });
  assert.equal(reopened.read('old')[0].originals, undefined);
  reopened.purge('fork');
  await assert.rejects(
    reopened.pictures.read(entry.originals[0]),
    /no longer available/,
    'the last contact releases its originals'
  );
});

test('references cannot name arbitrary local files or unsupported content', async (t) => {
  const pictures = new Pictures(temporary(t));
  for (const source of ['file:///etc/passwd', 'picture:../../secret.png', 'data:text/html;base64,AAAA', null]) {
    assert.equal(pictures.keep(source), null);
    await assert.rejects(pictures.read(source), /not a saved picture/);
  }
  await assert.rejects(pictures.read(`picture:${'a'.repeat(64)}.png`), /no longer available/);
});

test('a failed thumbnail or invalid original never shifts another image’s original', () => {
  const sent = sentPictures([
    { mediaType: 'image/png', data: original.split(',')[1], preview: null },
    { mediaType: 'text/html', data: 'AAAA', preview },
    { mediaType: 'image/jpeg', data: 'BBBB', preview },
  ]);
  assert.deepEqual(sent.pictures, [original, preview, preview]);
  assert.deepEqual(sent.originals, [original, null, 'data:image/jpeg;base64,BBBB']);
});

test('a screenshot’s provider-sized derivative never replaces its lossless display source', () => {
  const sent = sentPictures([{ mediaType: 'image/jpeg', data: 'BBBB', preview, original }]);
  assert.deepEqual(sent, { pictures: [preview], originals: [original] });
});

test('viewer resolves originals lazily and explicitly identifies preview-only history and missing files', async (t) => {
  const pictures = new Pictures(temporary(t));
  const reference = pictures.keep(original);
  const reads = [];
  globalThis.window = { messenger: { app: { readPicture: (ref) => (reads.push(ref), pictures.read(ref)) } } };
  t.after(() => delete globalThis.window);
  assert.deepEqual(await loadPicture({ src: reference, preview }), { src: original, previewOnly: false });
  assert.deepEqual(reads, [reference]);
  assert.equal(await pictureSource(reference), original, 'copy/download and resending get the same source');
  assert.deepEqual(await loadPicture({ preview }), { src: preview, previewOnly: true });
  assert.deepEqual(await loadPicture({ src: `picture:${'b'.repeat(64)}.png`, preview }), {
    src: preview,
    previewOnly: true,
  });
  assert.deepEqual(await loadPicture('file:///work/agent.png'), { src: 'file:///work/agent.png', previewOnly: false });
  await assert.rejects(loadPicture(`picture:${'b'.repeat(64)}.png`), /no longer available/);
});
