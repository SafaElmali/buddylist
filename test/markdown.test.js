import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marked } from '../node_modules/marked/lib/marked.esm.js';
import { addCodeCopies } from '../src/renderer/lib/code-copy.js';
import { el, html } from '../src/renderer/lib/dom.js';
import { page } from './fixtures/dom.js';
import {
  isMarkdownFile,
  keepsClass,
  placeSources,
  SANITIZE_OPTIONS,
  stableLength,
} from '../src/renderer/lib/markdown.js';

test('a reply keeps no styles, ids, classes, data- attributes, form controls, dialogs or SVG', () => {
  const { USE_PROFILES, FORBID_TAGS, FORBID_ATTR, ALLOW_DATA_ATTR } = SANITIZE_OPTIONS;
  assert.deepEqual(USE_PROFILES, { html: true }, 'HTML only: no SVG or MathML');
  for (const tag of ['style', 'dialog', 'form', 'input', 'button', 'textarea', 'select', 'option', 'label']) {
    assert.ok(FORBID_TAGS.includes(tag), `<${tag}> is taken out`);
  }
  for (const attribute of ['id', 'class', 'style']) {
    assert.ok(FORBID_ATTR.includes(attribute), `${attribute}="…" is taken out`);
  }
  assert.equal(ALLOW_DATA_ATTR, false, 'data-… attributes are taken out');
});

test('of what Markdown writes, nothing is taken out: a code block keeps its colours, and task lists their ticks', () => {
  const reply = [
    '# Title\n\nSome **bold**, _em_, ~~gone~~ and `code`,\non two lines.',
    '[a link](https://example.com) and https://example.com/bare',
    '![a picture](https://example.com/a.png "titled")',
    '- one\n  - nested\n- two\n\n3. three\n4. four',
    '- [x] done\n- [ ] to do',
    '> quoted\n\n---',
    '```js\nconst a = 1;\n```',
    '| a | b |\n|:-|-:|\n| 1 | 2 |',
  ].join('\n\n');
  const html = marked.parse(reply);
  assert.match(html, /<li>☑ done<\/li>\s*<li>☐ to do<\/li>/);
  assert.doesNotMatch(html, /<input/);
  const takenOut = [...html.matchAll(/<(\w+)([^>]*)>/g)].flatMap(([, tag, attributes]) => [
    ...(SANITIZE_OPTIONS.FORBID_TAGS.includes(tag) ? [`<${tag}>`] : []),
    ...[...attributes.matchAll(/([\w-]+)="([^"]*)"/g)]
      .filter(([, name]) => SANITIZE_OPTIONS.FORBID_ATTR.includes(name) || name.startsWith('data-'))
      .filter(([, name, value]) => !(name === 'class' && keepsClass(tag.toUpperCase(), value)))
      .map(([attribute]) => attribute),
  ]);
  assert.deepEqual(takenOut, []);
  assert.match(
    html,
    /<pre><code><span class="hljs-keyword">const<\/span> a = <span class="hljs-number">1<\/span>;\n<\/code><\/pre>/
  );
});

test('a code block in a language there are no colours for is written as it always was, and loses its language', () => {
  for (const [reply, code] of [
    ['```zzz\nx < y\n```', '<code class="language-zzz">x &lt; y\n</code>'],
    ['```text\nplain\n```', '<code class="language-text">plain\n</code>'],
    ['```\nnone\n```', '<code>none\n</code>'],
  ]) {
    assert.equal(marked.parse(reply), `<pre>${code}</pre>\n`);
  }
  assert.ok(!keepsClass('CODE', 'language-zzz'), "the code's own class is no colour's");
});

test('a code block names its language in the first word after its fence, in any case', () => {
  assert.match(
    marked.parse('```Ruby title="x.rb"\nputs 1\n```'),
    /^<pre><code>puts <span class="hljs-number">1<\/span>/
  );
});

test("a reply keeps a class only on a span, and only one its code's colours are drawn with", () => {
  for (const classes of ['hljs-keyword', 'hljs-title class_', 'hljs-title class_ inherited__', 'language-ruby']) {
    assert.ok(keepsClass('SPAN', classes), classes);
  }
  for (const classes of ['modal', 'statusbar', 'hljs-keyword modal', 'modal hljs-keyword', 'language-x y', '']) {
    assert.ok(!keepsClass('SPAN', classes), `"${classes}" is taken out`);
  }
  for (const tag of ['DIV', 'CODE', 'PRE', 'A']) assert.ok(!keepsClass(tag, 'hljs-keyword'), tag);
});

test('streaming Markdown is cut only at blank lines outside code fences', () => {
  assert.equal(stableLength('just one paragraph'), 0);
  const text = 'First paragraph.\n\nSecond, still typ';
  assert.equal(text.slice(0, stableLength(text)), 'First paragraph.\n\n');
  const fenced = 'Intro.\n\n```js\nconst a = 1;\n\nconst b = 2;\n';
  assert.equal(fenced.slice(0, stableLength(fenced)), 'Intro.\n\n', 'never cuts inside an open code block');
  const closed = 'Intro.\n\n```js\nx\n```\n\nAfter';
  assert.equal(closed.slice(0, stableLength(closed)), 'Intro.\n\n```js\nx\n```\n\n');
});

test('a code block of the reply is a place to cut on either side, blank line or not', () => {
  const opening = 'Here is the file:\n```js\nconst a = 1;\nconst b';
  assert.equal(opening.slice(0, stableLength(opening)), 'Here is the file:\n', 'it ends what came before it');
  const closed = 'Here is the file:\n```js\nconst a = 1;\n```\nThat is all, still typ';
  assert.equal(
    closed.slice(0, stableLength(closed)),
    'Here is the file:\n```js\nconst a = 1;\n```\n',
    'what comes after it starts afresh'
  );
  for (const fence of ['````', '~~~']) {
    const other = `Text\n${fence}\nx\n${fence}\nMore`;
    assert.equal(other.slice(0, stableLength(other)), `Text\n${fence}\nx\n${fence}\n`, fence);
  }
  // A fence that isn't at the start of its line is part of a list item or a quote.
  const inList = '- one\n  ```js\n  x\n  ```\n- two';
  assert.equal(stableLength(inList), 0);
  const unfinished = 'Text\n```js';
  assert.equal(stableLength(unfinished), 0, 'not before the fence while its line is still being written');
});

test('looking for the cut from where the text was cut before finds the same one', () => {
  const reply = [
    '\n\nA reply that starts with blank lines.\n\n',
    '- one\n- two\n\n\n\nThree blank lines before this.\n\n',
    '```js\nconst a = 1;\n\nconst b = 2;\n```\n\n',
    'Text.\n~~~\nfenced\n\n~~~\n\n   ```\nindented fence\n\n   ```\nright after it\n\n',
    'Before it:\n```sh\nnpm test\n```\nRight after it.\n- a list\n  ```\n  in it\n  ```\n\n',
    '| a | b |\n| - | - |\n| 1 | 2 |\n\nThe end, still typ',
  ].join('');
  // As it streams in, a few characters at a time: each cut is looked for from the one before.
  for (const step of [1, 3, 7, 64]) {
    let done = 0;
    for (let length = step; length < reply.length + step; length += step) {
      const text = reply.slice(0, length);
      done = stableLength(text, done);
      assert.equal(done, stableLength(text), `after ${text.length} characters, ${step} at a time`);
    }
    assert.equal(reply.slice(done), 'The end, still typ');
  }
});

test('a text is not cut after a blank line it starts with, but after one that follows a cut', () => {
  assert.equal(stableLength('\nFirst'), 0);
  assert.equal(stableLength('One.\n\n'), 6);
  assert.equal(stableLength('One.\n\n\nTwo'), 7);
  assert.equal(stableLength('One.\n\n\nTwo', 6), 7, 'cut after "One." before, the next blank line is no first line');
});

test('a file is Markdown by its ending, in any case', () => {
  for (const path of ['README.md', 'docs/plans/auth.markdown', 'NOTES.MD', '/Users/me/app/COM-630-plan.md']) {
    assert.equal(isMarkdownFile(path), true, path);
  }
  for (const path of ['app.js', 'md', 'notes.mdx', 'README.md.bak', '', undefined]) {
    assert.equal(isMarkdownFile(path), false, String(path));
  }
});

/** An element of a reply, as the sanitizing hands it over: its attributes as written. */
function element(nodeName, attributes = {}) {
  return {
    nodeName,
    attributes,
    hasAttribute: (name) => name in attributes,
    getAttribute: (name) => attributes[name] ?? null,
    setAttribute: (name, value) => (attributes[name] = value),
    removeAttribute: (name) => delete attributes[name],
  };
}

test('a picture of a reply is loaded from the contact’s folder, before the window has it', () => {
  const folder = '/Users/me/app';
  const card = element('IMG', { src: 'shots/c.png', alt: 'The card' });
  placeSources(/** @type {any} */ (card), folder);
  assert.deepEqual(card.attributes, { src: 'file:///Users/me/app/shots/c.png', alt: 'The card' });
  const shot = element('IMG', { src: 'https://example.com/a.png' });
  placeSources(/** @type {any} */ (shot), folder);
  assert.deepEqual(shot.attributes, { src: 'https://example.com/a.png' }, 'a web address is as it was');
});

test('only a picture’s address is changed: a link, and a picture with none, are as they were', () => {
  const link = element('A', { href: 'shots/c.png' });
  placeSources(/** @type {any} */ (link), '/Users/me/app');
  assert.deepEqual(link.attributes, { href: 'shots/c.png' }, 'a link is opened from the folder when clicked');
  const empty = element('IMG', { alt: 'nothing' });
  placeSources(/** @type {any} */ (empty), '/Users/me/app');
  assert.deepEqual(empty.attributes, { alt: 'nothing' });
  const relative = element('IMG', { src: 'shots/c.png' });
  placeSources(/** @type {any} */ (relative));
  assert.deepEqual(relative.attributes, { src: 'shots/c.png' }, 'with no folder, as in a file a tab shows');
});

test('a picture, a video or a sound on another computer is not loaded: what names it is taken out', () => {
  for (const src of ['//server/a.png', '\\\\server\\a.png', '/\\server/a.png', 'file://server/a.png']) {
    const picture = element('IMG', { src, alt: 'A picture' });
    placeSources(/** @type {any} */ (picture), '/Users/me/app');
    assert.deepEqual(picture.attributes, { alt: 'A picture' }, src);
    const unnamed = element('IMG', { src });
    placeSources(/** @type {any} */ (unnamed));
    assert.deepEqual(unnamed.attributes, {}, `${src}, in a reply with no folder`);
  }
  const video = element('VIDEO', { src: '//server/a.mp4', poster: 'file://server/a.png', controls: '' });
  placeSources(/** @type {any} */ (video), '/Users/me/app');
  assert.deepEqual(video.attributes, { controls: '' });
  const sound = element('SOURCE', { src: '\\\\server\\a.mp3', type: 'audio/mpeg' });
  placeSources(/** @type {any} */ (sound));
  assert.deepEqual(sound.attributes, { type: 'audio/mpeg' });
  const cell = element('TD', { background: '//server/a.png' });
  placeSources(/** @type {any} */ (cell));
  assert.deepEqual(cell.attributes, {}, 'a table’s background loads by itself too');
});

test('a srcset that names another computer anywhere in it is taken out whole', () => {
  const picture = element('IMG', {
    src: 'https://example.com/a.png',
    srcset: 'https://example.com/a.png 1x,//server/b.png 2x',
  });
  placeSources(/** @type {any} */ (picture));
  assert.deepEqual(picture.attributes, { src: 'https://example.com/a.png' });
  const source = element('SOURCE', { srcset: '\\\\server\\a.png' });
  placeSources(/** @type {any} */ (source));
  assert.deepEqual(source.attributes, {});
  const kept = element('IMG', { srcset: 'https://example.com/a.png 1x, https://example.com/b.png 2x' });
  placeSources(/** @type {any} */ (kept));
  assert.deepEqual(kept.attributes, { srcset: 'https://example.com/a.png 1x, https://example.com/b.png 2x' });
});

test('a video or a sound on the web, or on this computer, is loaded as it was written', () => {
  const video = element('VIDEO', { src: 'https://example.com/a.mp4', poster: '/tmp/a.png' });
  placeSources(/** @type {any} */ (video), '/Users/me/app');
  assert.deepEqual(video.attributes, { src: 'https://example.com/a.mp4', poster: '/tmp/a.png' });
});

const pressCopy = async (button) => {
  button.click();
  await new Promise(setImmediate);
};

test('each code block copies only its own text, preserving whitespace and literal markup', async (t) => {
  page(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = '\tconst text = "<tag> & :)";\n\n  next();  \n';
  const second = 'npm test\n';
  const root = el(
    html`<div>
      <p>Intro with <code>inline</code>.</p>
      <pre><code>${first}</code></pre>
      <blockquote>
        <pre><code>${second}</code></pre>
      </blockquote>
      <pre><code class="language-mermaid">flowchart TD
A --> B</code></pre>
    </div>`
  );
  const copied = [];
  addCodeCopies(root, async (text) => copied.push(text));
  addCodeCopies(root, async () => assert.fail('a second pass must not attach another handler'));
  const buttons = root.querySelectorAll('.code-copy');
  assert.equal(buttons.length, 2, 'inline code and diagrams have no extra control');
  assert.equal(root.querySelectorAll('.code-block').length, 2, 'wrapping twice leaves one control per block');
  assert.equal(buttons[0].type, 'button');
  assert.equal(buttons[0].getAttribute('aria-label'), 'Copy code');
  await pressCopy(buttons[0]);
  assert.deepEqual(copied, [first]);
  assert.equal(buttons[0].textContent.trim(), 'Copied');
  assert.equal(buttons[0].getAttribute('aria-label'), 'Code copied');
  assert.equal(buttons[1].getAttribute('aria-label'), 'Copy code', 'feedback belongs to just the pressed block');
  await pressCopy(buttons[1]);
  assert.deepEqual(copied, [first, second]);
  t.mock.timers.tick(1500);
  assert.equal(buttons[0].getAttribute('aria-label'), 'Copy code');
});

test('copy reads the latest code, including highlighted spans, without stealing pointer focus', async (t) => {
  const document = page(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const root = el(
    html`<div>
      <pre><code><span class="hljs-keyword">const</span> a = 1;
</code></pre>
    </div>`
  );
  const input = document.createElement('textarea');
  document.body.append(input, root);
  input.focus();
  const copied = [];
  addCodeCopies(root, async (text) => copied.push(text));
  const button = root.querySelector('button');
  assert.equal(button.fire('mousedown').defaultPrevented, true);
  assert.equal(document.activeElement, input);
  await pressCopy(button);
  root.querySelector('code').append('const b = 2;\n');
  await pressCopy(button);
  assert.deepEqual(copied, ['const a = 1;\n', 'const a = 1;\nconst b = 2;\n']);
});

test('a clipboard failure offers a retry, and never claims the code was copied', async (t) => {
  page(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const root = el(
    html`<div>
      <pre><code>hello</code></pre>
    </div>`
  );
  let attempts = 0;
  addCodeCopies(root, async () => {
    if (++attempts === 1) throw new Error('Clipboard unavailable');
  });
  const button = root.querySelector('button');
  await pressCopy(button);
  assert.equal(button.getAttribute('aria-label'), 'Could not copy code. Try again');
  assert.equal(button.querySelector('span').textContent, 'Try again');
  await pressCopy(button);
  assert.equal(attempts, 2);
  assert.equal(button.getAttribute('aria-label'), 'Code copied');
});

test('repeated presses wait for the clipboard write before reporting success', async (t) => {
  page(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const root = el(
    html`<div>
      <pre><code></code></pre>
    </div>`
  );
  let finish;
  const copied = [];
  addCodeCopies(root, (text) => {
    copied.push(text);
    return new Promise((resolve) => (finish = resolve));
  });
  const button = root.querySelector('button');
  await pressCopy(button);
  await pressCopy(button);
  assert.deepEqual(copied, [''], 'an empty block is still copyable; only one write is in flight');
  assert.equal(button.getAttribute('aria-label'), 'Copy code');
  finish();
  await new Promise(setImmediate);
  assert.equal(button.getAttribute('aria-label'), 'Code copied');
});
