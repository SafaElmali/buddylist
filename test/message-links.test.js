import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkMenu } from '../src/renderer/chat/browser.js';
import { messageLinkItems } from '../src/renderer/chat/message-links.js';
import { messageItems } from '../src/renderer/chat/pins.js';

/**
 * What a right-click on a link of the conversation offers, with what each item did: a web page's menu as the
 * conversation window makes it, a file's as All files would, and the clipboard.
 */
function rightClick(url, href, { local = true } = {}) {
  const done = [];
  const items = messageLinkItems(
    { url, href },
    {
      web: (page) =>
        linkMenu(
          page,
          {
            beside: (open) => done.push(['beside', open]),
            external: (open) => done.push(['external', open]),
            copy: (text) => done.push(['copy', text]),
          },
          { clicks: 'external' }
        ),
      file: local ? (path) => [{ label: 'Open file', action: () => done.push(['open', path]) }] : null,
      copy: (text) => done.push(['copy', text]),
    }
  );
  return { items, labels: items.map((item) => (item.separator ? '-' : item.label)), done };
}

test('a link to a web page offers to open it, as a click does, and to copy its whole address', () => {
  const { items, labels, done } = rightClick(
    'https://example.com/docs/start?tab=2',
    'https://example.com/docs/start?tab=2'
  );
  assert.deepEqual(labels, ['Open beside the conversation', 'Open in your browser', '-', 'Copy link address']);
  assert.equal(items.find((item) => item.bold)?.label, 'Open in your browser', 'what a click does, in bold');
  items.at(-1).action();
  assert.deepEqual(done, [['copy', 'https://example.com/docs/start?tab=2']], 'the address, not the words shown');
});

test('a link to an e-mail address offers to copy the address alone', () => {
  const href = 'mailto:fake@example.com?subject=Hello%20there';
  const { items, labels, done } = rightClick(href, href);
  assert.deepEqual(labels, ['Copy email address']);
  items[0].action();
  assert.deepEqual(done, [['copy', 'fake@example.com']], 'no mailto:, and nothing of the subject');
});

test('a link to a file on this computer offers what a right-click on the file offers', () => {
  const { items, labels, done } = rightClick('file:///Users/example/app/src/app.js', 'src/app.js:12');
  assert.deepEqual(labels, ['Open file']);
  items[0].action();
  assert.deepEqual(done, [['open', 'src/app.js']], 'the file, without the line it points at');
});

test('where files aren’t this computer’s, as in the web preview, or a link leads nowhere to copy, it offers nothing', () => {
  assert.deepEqual(rightClick('file:///Users/example/app/src/app.js', 'src/app.js', { local: false }).labels, []);
  for (const href of ['#top', 'mailto:', 'mailto:?subject=Hi', 'javascript:void(0)']) {
    assert.deepEqual(rightClick(`file:///Users/example/app/${href}`, href).labels, [], href);
  }
});

test('a right-click on an e-mail address in a reply offers to copy it before pinning the reply', () => {
  const href = 'mailto:fake@example.com';
  const { items } = rightClick(href, href);
  assert.deepEqual(
    messageItems([[], items], { id: 'm1', pinned: false }, () => {}).map((item) => item.label ?? '-'),
    ['Copy email address', '-', 'Pin message']
  );
});
