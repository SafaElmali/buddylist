import { test } from 'node:test';
import assert from 'node:assert/strict';

test('clipboard counts follow successful copies without sending their contents', async (t) => {
  const writes = [];
  const counts = [];
  const clipboardBefore = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  let refuseCopy = false;
  let refuseCount = false;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text) => {
        if (refuseCopy) throw new Error('Clipboard denied');
        writes.push(text);
      },
    },
  });
  globalThis.window = {
    messenger: {
      app: {
        copied: async (...args) => {
          if (refuseCount) throw new Error('Window closed');
          counts.push(args);
        },
      },
    },
  };
  t.after(() => {
    if (clipboardBefore) Object.defineProperty(navigator, 'clipboard', clipboardBefore);
    else delete navigator.clipboard;
    delete globalThis.window;
  });
  const { copyText, copyPath, copyBranch } = await import('../src/renderer/lib/copy-folder.js');

  const contact = { id: 'contact-1', name: 'Secret project', cwd: '/Users/me/private' };
  await copyPath(contact);
  await copyBranch(contact, 'secret-branch');
  await copyText('Private conversation', 'message');
  await copyText('/Users/me/private/file.js', 'file');
  assert.deepEqual(writes, [contact.cwd, 'secret-branch', 'Private conversation', '/Users/me/private/file.js']);
  assert.deepEqual(counts, [['path'], ['branch'], ['message'], ['file']]);

  refuseCopy = true;
  await assert.rejects(copyText('Not copied', 'message'), /Clipboard denied/);
  assert.equal(counts.length, 4);
  assert.equal(writes.length, 4);

  refuseCopy = false;
  refuseCount = true;
  await assert.doesNotReject(copyText('Still copied', 'message'));
  assert.equal(writes.at(-1), 'Still copied');
});
