import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import module from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mediaToDownload } from '../src/main/media.js';
import { REQUESTS } from '../src/shared/ipc-channels.js';
import { mediaKind } from '../src/shared/media.js';
import { tempDir } from './fixtures/temp-dir.js';

// What a right-click on a picture, a video or a sound offers, and what Download saves: as it was sent or
// written, to the file the save dialog names. Only Electron is replaced, and the dialog answers from a list.
const electron = `data:text/javascript,${encodeURIComponent(`
  export const handlers = new Map();
  export const ipcMain = { handle: (name, fn) => handlers.set(name, fn), on() {} };
  export const app = { getVersion: () => '0.0.0', getPath: (name) => '/Users/me/' + name };
  export const nativeTheme = { on() {} };
  export const BrowserWindow = { fromWebContents: () => null };
  export const dialog = {};
  export const nativeImage = {}, screen = {}, shell = {};
`)}`;
let registerIpc;
let handlers;
let dialog;
if (module.registerHooks) {
  const hook = module.registerHooks({
    resolve(name, context, next) {
      return name === 'electron' ? { url: electron, shortCircuit: true } : next(name, context);
    },
  });
  try {
    ({ registerIpc } = await import('../src/main/ipc.js'));
    ({ handlers, dialog } = await import(electron));
  } finally {
    hook.deregister();
  }
}
const opts = { skip: !registerIpc };

// The menus are the conversation window's: nothing in them reaches for the page as they load.
const { mediaItems } = await import('../src/renderer/lib/media-menu.js');
const { fileMenu } = await import('../src/renderer/chat/changes-view.js');

const tmp = () => fs.realpathSync(tempDir('bl-media-'));
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
const labels = (items) => items.map((item) => (item.separator ? '-' : item.label));

// ---- what it is -----------------------------------------------------------------------------------

test('a file is a picture, a video or a sound by its extension, in any case, and a data: address by its type', () => {
  for (const [address, kind] of [
    ['/tmp/shot.png', 'image'],
    ['shots/Shot.JPEG', 'image'],
    ['file:///Users/me/My%20Shot.webp', 'image'],
    // A file: address can say more after its name.
    ['file:///Users/me/shot.png?2', 'image'],
    ['C:\\proof\\run.MP4', 'video'],
    ['/tmp/proof.mov', 'video'],
    ['/tmp/voice.m4a', 'audio'],
    ['data:image/png;base64,iVBOR', 'image'],
    [`picture:${'a'.repeat(64)}.png`, 'image'],
    ['data:image/svg+xml,%3Csvg%3E', 'image'],
    ['DATA:VIDEO/MP4;base64,AAAA', 'video'],
    ['data:audio/mpeg;base64,AAAA', 'audio'],
  ]) {
    assert.equal(mediaKind(address), kind, address);
  }
});

test('anything else is none of them: a text file, a folder, a web page, a data: address of text, or nothing', () => {
  for (const address of [
    '/tmp/notes.md',
    'src/app.js',
    'shots/',
    'png',
    '/tmp/shot.png.txt',
    'file:///tmp/a.txt#shot.png',
    'data:text/plain,shot.png',
    'data:application/pdf;base64,AAAA',
    // An extension the lookup has no kind for, and one an object has of its own.
    '/tmp/a.constructor',
    '/tmp/a.toString',
    '',
    null,
    undefined,
  ]) {
    assert.equal(mediaKind(address), null, String(address));
  }
});

// ---- what Download saves ----------------------------------------------------------------------------

test('a picture in its data: address is downloaded as its bytes, named for its kind and type', () => {
  const png = mediaToDownload(`data:image/png;base64,${PNG.toString('base64')}`);
  assert.equal(png.kind, 'image');
  assert.equal(png.name, 'image.png');
  assert.deepEqual(png.bytes, PNG);
  assert.equal(mediaToDownload('data:image/jpeg;base64,AAAA').name, 'image.jpg');
  assert.equal(mediaToDownload('data:video/quicktime;base64,AAAA').name, 'video.mov');
  assert.equal(mediaToDownload('data:audio/mpeg;base64,AAAA').name, 'audio.mp3');
  assert.equal(mediaToDownload('data:image/webp;charset=binary;base64,AAAA').name, 'image.webp');
});

test('a diagram, written into its address as escaped text, is downloaded as that text', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>a → b</text></svg>';
  const diagram = mediaToDownload(`data:image/svg+xml,${encodeURIComponent(svg)}`);
  assert.equal(diagram.name, 'image.svg');
  assert.equal(diagram.bytes.toString('utf8'), svg);
  // One whose escapes are broken says nothing that could be saved.
  assert.equal(mediaToDownload('data:image/svg+xml,%E0%A4%A'), null);
});

test('a file is downloaded from where it is, under its own name', () => {
  const file = path.join(tmp(), 'My Proof.mp4');
  assert.deepEqual(mediaToDownload(pathToFileURL(file).href), { kind: 'video', name: 'My Proof.mp4', path: file });
});

test('nothing is downloaded from another computer, a web page, a text file or an address that is no address', () => {
  for (const address of [
    'file://server/share/shot.png',
    'file:////server/share/shot.png',
    'https://example.com/shot.png',
    'pack:emoticons/smile.png',
    'file:///tmp/notes.md',
    'data:text/plain,hello',
    '/tmp/shot.png',
    '',
    undefined,
  ]) {
    assert.equal(mediaToDownload(address), null, String(address));
  }
});

/** The real handler, with the save dialog answering `answers` in turn. */
function downloads(t, answers) {
  const asked = [];
  dialog.showSaveDialog = async (_win, options) => {
    asked.push(options);
    return answers.shift() ?? { canceled: true };
  };
  t.after(() => delete dialog.showSaveDialog);
  const systemVersion = process.getSystemVersion;
  process.getSystemVersion = () => 'test';
  try {
    registerIpc({ analytics: { counting: (_name, fn) => fn }, pathReady: Promise.resolve() });
  } finally {
    if (systemVersion) process.getSystemVersion = systemVersion;
    else delete process.getSystemVersion;
  }
  const download = (address) => handlers.get(REQUESTS.mediaDownload)({ sender: {} }, address);
  return { asked, download };
}

test('Download saves a picture sent to the file the save dialog names, in Downloads to start with', opts, async (t) => {
  const dir = tmp();
  const to = path.join(dir, 'kept.png');
  const { asked, download } = downloads(t, [{ canceled: false, filePath: to }]);
  assert.equal(await download(`data:image/png;base64,${PNG.toString('base64')}`), true);
  assert.deepEqual(fs.readFileSync(to), PNG);
  assert.deepEqual(asked, [{ title: 'Download image', defaultPath: path.join('/Users/me/downloads', 'image.png') }]);
});

test('Download copies a file a link leads to, as it is', opts, async (t) => {
  const dir = tmp();
  const from = path.join(dir, 'proof.mp4');
  fs.writeFileSync(from, 'the whole run');
  const to = path.join(dir, 'saved', 'proof copy.mp4');
  fs.mkdirSync(path.dirname(to));
  const { asked, download } = downloads(t, [{ canceled: false, filePath: to }]);
  assert.equal(await download(pathToFileURL(from).href), true);
  assert.equal(fs.readFileSync(to, 'utf8'), 'the whole run');
  assert.equal(asked[0].title, 'Download video');
  assert.equal(asked[0].defaultPath, path.join('/Users/me/downloads', 'proof.mp4'));
});

test('a download called off in the save dialog saves nothing, and answers false', opts, async (t) => {
  const dir = tmp();
  const { download } = downloads(t, [{ canceled: true, filePath: '' }]);
  assert.equal(await download(`data:image/png;base64,${PNG.toString('base64')}`), false);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('a file saved over itself is left as it was', opts, async (t) => {
  const file = path.join(tmp(), 'shot.png');
  fs.writeFileSync(file, PNG);
  const { download } = downloads(t, [{ canceled: false, filePath: file }]);
  assert.equal(await download(pathToFileURL(file).href), true);
  assert.deepEqual(fs.readFileSync(file), PNG);
});

test('a file that is gone says so before any dialog, and what is no media asks nothing', opts, async (t) => {
  const { asked, download } = downloads(t, []);
  const gone = path.join(tmp(), 'proof.mp4');
  await assert.rejects(download(pathToFileURL(gone).href), /proof\.mp4 is not there any more/);
  assert.equal(await download('file:///tmp/notes.md'), false);
  assert.equal(await download('https://example.com/shot.png'), false);
  assert.deepEqual(asked, []);
});

// ---- what a right-click offers ------------------------------------------------------------------------

test('a picture can be copied and downloaded, a video or a sound downloaded, and anything else offers neither', () => {
  assert.deepEqual(labels(mediaItems('data:image/png;base64,AAAA')), ['Copy image', 'Download image...']);
  assert.deepEqual(labels(mediaItems('file:///tmp/proof.mp4')), ['Download video...']);
  assert.deepEqual(labels(mediaItems('file:///tmp/voice.mp3')), ['Download audio...']);
  assert.deepEqual(mediaItems('file:///tmp/notes.md'), []);
  // A file that is gone is offered as it is, but can't be.
  assert.ok(mediaItems('file:///tmp/shot.png', { disabled: true }).every((item) => item.disabled));
});

test('a picture of the conversation offers Reply with this picture first, and only a picture does', () => {
  const replied = [];
  const reply = () => replied.push('reply');
  const items = mediaItems('data:image/png;base64,AAAA', { reply });
  assert.deepEqual(labels(items), ['Reply with this picture', 'Copy image', 'Download image...']);
  assert.match(items[0].icon, /<svg/);
  items[0].action();
  assert.deepEqual(replied, ['reply']);
  assert.deepEqual(labels(mediaItems('file:///tmp/proof.mp4', { reply })), ['Download video...']);
  // Where it can't be, as in an archived contact's conversation, it is not there.
  assert.deepEqual(labels(mediaItems('data:image/png;base64,AAAA', { reply: null })), [
    'Copy image',
    'Download image...',
  ]);
});

test('a saved attachment downloads its original bytes instead of its reference or preview', async (t) => {
  const reference = `picture:${'a'.repeat(64)}.png`;
  const original = 'data:image/png;base64,b3JpZ2luYWw=';
  const downloaded = [];
  globalThis.window = {
    messenger: {
      app: {
        readPicture: async (ref) => {
          assert.equal(ref, reference);
          return original;
        },
        download: async (source) => downloaded.push(source),
      },
    },
  };
  t.after(() => delete globalThis.window);
  await mediaItems(reference)
    .find(({ label }) => label === 'Download image...')
    .action();
  assert.deepEqual(downloaded, [original]);
});

test('a file of the folder that is a picture offers to copy it and download it after what any file offers', () => {
  const where = { root: '/Users/me/app', reveal: 'Show in Finder' };
  const actions = { attach() {}, copy() {}, open() {} };
  assert.deepEqual(labels(fileMenu({ path: 'shots/home.png' }, where, actions)), [
    'Add to message',
    'Copy',
    '-',
    'Open file',
    'Show in Finder',
    '-',
    'Copy image',
    'Download image...',
  ]);
  assert.deepEqual(labels(fileMenu({ path: 'src/app.js' }, where, actions)), [
    'Add to message',
    'Copy',
    '-',
    'Open file',
    'Show in Finder',
  ]);
  // A deleted one is no longer there to copy; and the web preview has no files.
  const deleted = fileMenu({ path: 'shots/home.png', status: 'deleted' }, where, actions);
  assert.ok(deleted.slice(-2).every((item) => item.disabled));
  assert.ok(!labels(fileMenu({ path: 'shots/home.png' }, { ...where, reveal: null }, actions)).includes('Copy image'));
});
