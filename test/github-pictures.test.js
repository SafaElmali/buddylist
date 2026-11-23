import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { githubPicture, isWebPicture, NOT_SHOWN, reasonOf } from '../src/shared/web-pictures.js';
import { githubPictures, loadGithubPicture, ownRepository, windowAnswer } from '../src/main/github-pictures.js';
import { FULL_MOST_BYTES } from '../src/main/remote/pictures.js';

/** A real PNG, 2 by 1. */
function png() {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const sized = Buffer.alloc(4);
    sized.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([sized, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.alloc(7))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A gh that answers each `api` call as `answer` says, and keeps what it was asked. */
function fakeGh(answer = async () => png()) {
  const asked = [];
  const run = async (cwd, args, timeout, options) => (asked.push({ cwd, args, options }), answer(args));
  return { asked, run };
}
/** gh leaving as it does on an error from GitHub. */
const ghFailed = (stderr, code = 1) => Object.assign(new Error('Command failed'), { code, stderr });
/** A git whose origin is `remote` in every folder. */
const gitWith = (remote) => async (_cwd, args) => {
  assert.deepEqual(args, ['remote', 'get-url', 'origin']);
  if (remote === null) throw new Error('No such remote');
  return remote;
};
const OWN = gitWith('git@github.com:example/shop.git');
const reasonFrom = (promise) =>
  promise.then(
    () => assert.fail('it loaded'),
    (error) => error.reason
  );

test('a picture is on the web by its address: http or https, nothing else', () => {
  for (const address of ['https://example.com/a.png', 'http://example.com/a.png', ' HTTPS://example.com/a.png'])
    assert.equal(isWebPicture(address), true, address);
  for (const address of [
    'file:///tmp/a.png',
    '/tmp/a.png',
    'shots/a.png',
    'data:image/png;base64,AA',
    'blob:x',
    '',
    null,
  ])
    assert.equal(isWebPicture(address), false, String(address));
});

test('a GitHub picture is read from its page, its raw file or raw.githubusercontent.com, on github.com by https', () => {
  assert.deepEqual(githubPicture('https://github.com/example/shop/blob/4f2a9c1/proof/cart%20page.png?raw=true'), {
    repository: 'example/shop',
    rest: ['4f2a9c1', 'proof', 'cart page.png'],
  });
  assert.deepEqual(githubPicture('https://github.com/example/shop/raw/main/a.png'), {
    repository: 'example/shop',
    rest: ['main', 'a.png'],
  });
  assert.deepEqual(githubPicture('https://raw.githubusercontent.com/example/shop/refs/heads/main/docs/a.png'), {
    repository: 'example/shop',
    rest: ['refs', 'heads', 'main', 'docs', 'a.png'],
  });
  assert.deepEqual(githubPicture('https://GitHub.com/example/shop.js/blob/v1/a.png'), {
    repository: 'example/shop.js',
    rest: ['v1', 'a.png'],
  });
});

test('nothing else is a GitHub picture: no other host, no sign-in in the address, no way out of the repository', () => {
  for (const address of [
    'http://github.com/example/shop/blob/main/a.png',
    'https://github.com.example.com/example/shop/blob/main/a.png',
    'https://example.com/github.com/example/shop/blob/main/a.png',
    'https://api.github.com/repos/example/shop/contents/a.png',
    'https://gist.github.com/example/123/raw/a.png',
    'https://github.com/user-attachments/assets/0f0e6b2c-1111-2222-3333-444455556666',
    'https://private-user-images.githubusercontent.com/1/2.png?jwt=x',
    'https://avatars.githubusercontent.com/u/1',
    'https://user:secret@github.com/example/shop/blob/main/a.png',
    'https://github.com:8443/example/shop/blob/main/a.png',
    'https://github.com/example/shop/tree/main/a.png',
    'https://github.com/example/shop/blob/main',
    'https://github.com/example/shop/blob/main/../../other/a.png',
    'https://github.com/example/shop/blob/main/%2e%2e/a.png',
    'https://github.com/example/shop/blob/main//a.png',
    'https://github.com/example/sh%2Fop/blob/main/a.png',
    'https://raw.githubusercontent.com/example/shop/main',
    'file:///tmp/a.png',
    'not an address',
  ])
    assert.equal(githubPicture(address), null, address);
});

test('each reason a card gives is told from an error that is it, as a phone hears it; any other error is none', () => {
  for (const reason of Object.keys(NOT_SHOWN)) assert.equal(reasonOf(reason), reason);
  for (const other of [
    'Reconnecting to buddylist. Try again once connected.',
    'toString',
    'constructor',
    undefined,
    42,
  ])
    assert.equal(reasonOf(other), null, String(other));
});

test('the repository a folder is on GitHub comes from its origin, and only github.com counts', async () => {
  assert.equal(await ownRepository('/code/shop', { run: OWN }), 'example/shop');
  assert.equal(
    await ownRepository('/code/shop', { run: gitWith('https://github.com/Example/Shop.git') }),
    'Example/Shop'
  );
  assert.equal(await ownRepository('/code/shop', { run: gitWith('git@git.example.com:example/shop.git') }), null);
  assert.equal(await ownRepository('/code/shop', { run: gitWith('/srv/repos/shop.git') }), null);
  assert.equal(await ownRepository('/code/shop', { run: gitWith(null) }), null, 'a folder with no origin');
  assert.equal(await ownRepository('', { run: OWN }), null, 'This computer has no folder');
});

test('a picture of the conversation’s own repository is read through gh, raw, from github.com, and nothing else', async () => {
  const { asked, run } = fakeGh();
  const loaded = await loadGithubPicture(
    'https://github.com/example/shop/blob/4f2a9c1/proof/cart%20page.png?raw=true',
    { folder: '/code/shop', gh: run, git: OWN }
  );
  assert.equal(loaded.type, 'image/png');
  assert.deepEqual(loaded.bytes, png());
  assert.equal(loaded.name, 'cart page.png');
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].args, [
    'api',
    '--hostname',
    'github.com',
    '-H',
    'Accept: application/vnd.github.raw',
    'repos/example/shop/contents/proof/cart%20page.png?ref=4f2a9c1',
  ]);
  assert.deepEqual(asked[0].options, { encoding: 'buffer', maxBuffer: FULL_MOST_BYTES });
  assert.ok(!asked.some(({ args }) => args.includes('auth') || args.includes('token')), 'its sign-in is never read');
});

test('a picture of another repository is not read until the user asks: then it is', async () => {
  const { asked, run } = fakeGh();
  const address = 'https://raw.githubusercontent.com/example/design-kit/main/shots/coupon.png';
  assert.equal(await reasonFrom(loadGithubPicture(address, { folder: '/code/shop', gh: run, git: OWN })), 'ask');
  assert.equal(
    await reasonFrom(loadGithubPicture(address, { folder: '', gh: run, git: OWN })),
    'ask',
    'nor one in a conversation with no folder'
  );
  assert.equal(asked.length, 0, 'gh was never run');
  const loaded = await loadGithubPicture(address, { folder: '/code/shop', asked: true, gh: run, git: OWN });
  assert.equal(loaded.type, 'image/png');
  assert.deepEqual(asked[0].args.at(-1), 'repos/example/design-kit/contents/shots/coupon.png?ref=main');
});

test('a branch with slashes in its name is found by trying each place the path may start', async () => {
  const { asked, run } = fakeGh(async (args) => {
    if (!args.at(-1).endsWith('?ref=feature%2Fcart')) throw ghFailed('gh: Not Found (HTTP 404)');
    return png();
  });
  await loadGithubPicture('https://github.com/example/shop/blob/feature/cart/shots/a.png?raw=true', {
    folder: '/code/shop',
    gh: run,
    git: OWN,
  });
  assert.deepEqual(
    asked.map(({ args }) => args.at(-1)),
    [
      'repos/example/shop/contents/cart/shots/a.png?ref=feature',
      'repos/example/shop/contents/shots/a.png?ref=feature%2Fcart',
    ]
  );
});

test('what keeps a GitHub picture from loading is said: no gh, no sign-in, offline, not there, not a picture, too big', async () => {
  const address = 'https://github.com/example/shop/blob/main/a.png?raw=true';
  const reason = (answer) =>
    reasonFrom(loadGithubPicture(address, { folder: '/code/shop', gh: fakeGh(answer).run, git: OWN }));
  assert.equal(
    await reason(() => Promise.reject(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }))),
    'missing'
  );
  assert.equal(
    await reason(() => Promise.reject(ghFailed('To get started with GitHub CLI, please run:  gh auth login', 4))),
    'signed-out'
  );
  assert.equal(await reason(() => Promise.reject(ghFailed('gh: Bad credentials (HTTP 401)'))), 'signed-out');
  assert.equal(await reason(() => Promise.reject(ghFailed('error connecting to api.github.com'))), 'offline');
  assert.equal(await reason(() => Promise.reject(Object.assign(ghFailed(''), { killed: true }))), 'slow');
  assert.equal(await reason(() => Promise.reject(ghFailed('gh: Not Found (HTTP 404)'))), 'not-found');
  assert.equal(
    await reason(() => Promise.reject(ghFailed('gh: Resource protected by organization SAML enforcement (HTTP 403)'))),
    'refused'
  );
  assert.equal(
    await reason(() => Promise.reject(Object.assign(ghFailed(''), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }))),
    'too-big'
  );
  assert.equal(await reason(async () => Buffer.from('<!doctype html><title>Sign in to GitHub</title>')), 'not-picture');
  assert.equal(
    await reason(async () => Buffer.from('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12\n')),
    'not-picture',
    'a file kept in Git LFS comes back as its pointer'
  );
  assert.equal(
    await reasonFrom(
      loadGithubPicture('https://example.com/a.png', { folder: '/code/shop', gh: fakeGh().run, git: OWN })
    ),
    'web',
    'an address on another site is never handed to gh'
  );
});

test('only a picture one of the conversation’s replies shows is read, those still arriving too', async () => {
  const address = 'https://github.com/example/shop/blob/main/proof/cart.png?raw=true';
  const loads = [];
  const picture = githubPictures({
    history: () => [
      { kind: 'user', text: `![mine](${address.replace('cart', 'mine')})` },
      { kind: 'assistant', text: `Screenshots:\n\n![cart page](${address})` },
    ],
    live: () => ['![coupon](https://github.com/example/shop/blob/main/proof/coupon.png?raw=true)'],
    folderOf: (id) => (id === 'gone' ? null : '/code/shop'),
    load: async (...args) => (loads.push(args), { bytes: png(), type: 'image/png', name: 'cart.png' }),
  });
  await picture('c1', address, { asked: false });
  await picture('c1', 'https://github.com/example/shop/blob/main/proof/coupon.png?raw=true', { asked: true });
  assert.deepEqual(loads, [
    [address, { folder: '/code/shop', asked: false }],
    ['https://github.com/example/shop/blob/main/proof/coupon.png?raw=true', { folder: '/code/shop', asked: true }],
  ]);
  for (const other of [address.replace('cart', 'mine'), 'https://github.com/example/shop/blob/main/secret.png'])
    assert.equal(await reasonFrom(picture('c1', other, {})), 'not-here', other);
  assert.equal(await reasonFrom(picture('gone', address, {})), 'not-here');
  assert.equal(loads.length, 2);
});

test('the window is given the picture as a data: address, or why not: never what gh said, nor its sign-in', async () => {
  const answer = windowAnswer(async (_id, address) => {
    if (address.endsWith('other.png')) throw Object.assign(new Error('ask'), { reason: 'ask' });
    if (address.endsWith('broken.png'))
      throw Object.assign(new Error('what gh said, sign-in and all'), { stderr: 'sign-in and all' });
    return { bytes: png(), type: 'image/png', name: 'cart.png' };
  });
  assert.deepEqual(await answer('c1', 'https://github.com/example/shop/blob/main/cart.png', false), {
    picture: `data:image/png;base64,${png().toString('base64')}`,
    name: 'cart.png',
  });
  assert.deepEqual(await answer('c1', 'https://github.com/example/kit/blob/main/other.png', false), { problem: 'ask' });
  const failed = await answer('c1', 'https://github.com/example/shop/blob/main/broken.png', true);
  assert.deepEqual(failed, { problem: 'not-found' });
  assert.ok(!JSON.stringify(failed).includes('sign-in and all'));
});
