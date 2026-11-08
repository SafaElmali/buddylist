import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import DOMPurify from '../node_modules/dompurify/dist/purify.es.mjs';
import { marked } from '../node_modules/marked/lib/marked.esm.js';
import { stableLength, StreamingMarkdown } from '../src/renderer/lib/markdown.js';

/** What renders asked for the diagrams in them (see lib/diagrams.js), with what they rendered. */
let asked = [];

class Node {
  childNodes = [];
  innerHTML = '';
  querySelectorAll(selector) {
    if (selector.includes('mermaid')) asked.push({ selector, html: this.innerHTML });
    return [];
  }
  append(...children) {
    this.childNodes.push(...children);
  }
  appendChild(child) {
    this.childNodes.push(child);
    return child;
  }
  replaceChildren(...children) {
    this.childNodes = children;
  }
  insertAdjacentHTML(_position, html) {
    this.innerHTML += html;
  }
}

const globals = ['document', 'requestAnimationFrame', 'cancelAnimationFrame', 'NodeFilter'];
let saved;
let frames;
let savedSanitize;
beforeEach(() => {
  saved = globals.map((name) => globalThis[name]);
  frames = new Map();
  asked = [];
  let nextFrame = 0;
  globalThis.requestAnimationFrame = (fn) => {
    frames.set(++nextFrame, fn);
    return nextFrame;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  // These tests exercise streaming state. Sanitizer policy has its own tests in markdown.test.js.
  savedSanitize = DOMPurify.sanitize;
  DOMPurify.sanitize = (html) => html;
  globalThis.NodeFilter = { SHOW_TEXT: 4 };
  globalThis.document = {
    createElement: () => new Node(),
    createTreeWalker: () => ({ nextNode: () => null }),
    createTextNode: (data) => ({
      data,
      appendData(delta) {
        this.data += delta;
      },
    }),
  };
});
afterEach(() => {
  if (savedSanitize === undefined) delete DOMPurify.sanitize;
  else DOMPurify.sanitize = savedSanitize;
  globals.forEach((name, i) => {
    if (saved[i] === undefined) delete globalThis[name];
    else globalThis[name] = saved[i];
  });
});

function paint() {
  const pending = [...frames.values()];
  frames.clear();
  for (const fn of pending) fn();
}

test('a growing code block checks each completed line once and appends to the same text node', (t) => {
  t.mock.method(performance, 'now', () => 0);
  let checked = 0;
  const testPattern = RegExp.prototype.test;
  t.mock.method(RegExp.prototype, 'test', function (text) {
    if (this.source === '^\\s*(```|~~~)') checked++;
    return testPattern.call(this, text);
  });
  const stream = new StreamingMarkdown(new Node());
  stream.append('```js\n');
  paint();
  const code = stream.tail.childNodes[0].childNodes[0].childNodes[0];
  let expected = '';
  for (let i = 0; i < 1000; i++) {
    const line = `const value${i} = ${i};\n`;
    expected += line;
    stream.append(line);
    paint();
  }
  assert.equal(code.data, expected);
  assert.equal(stream.tail.childNodes[0].childNodes[0].childNodes[0], code);
  assert.equal(stream.doneLength, 0, 'an unfinished code block stays in the tail');
  assert.equal(checked, 1001, 'one fence check for each completed line, including the opening fence');
});

test('cuts stay correct through partial fences, nested blocks, blank lines and resumed text', (t) => {
  t.mock.method(performance, 'now', () => 0);
  const text = [
    '\n\nIntro.\n\n',
    '- item\n  ```js\n  nested\n\n  ```\n\n',
    'A file:\n````js\nconst text = "<script>";\n\nconst next = 2;\n````\n',
    'After.\n~~~\nother fence\n~~~\n\n',
    '| a | b |\n| - | - |\n| 1 | 2 |\n\nFinal paragraph.',
  ].join('');
  for (const step of [1, 3, 7, 64]) {
    const stream = new StreamingMarkdown(new Node());
    // A reattached window starts with what has already arrived.
    const initial = Math.min(step, text.length);
    stream.setText(text.slice(0, initial));
    paint();
    assert.equal(stream.doneLength, stableLength(text.slice(0, initial)));
    for (let at = initial; at < text.length; at += step) {
      stream.append(text.slice(at, at + step));
      paint();
      assert.equal(stream.doneLength, stableLength(stream.text), `${step} characters at a time, after ${at}`);
    }
    stream.append('!');
    assert.equal(frames.size, 1);
    stream.finish();
    assert.equal(frames.size, 0, 'finishing cancels the pending paint');
    assert.equal(stream.node.innerHTML, marked.parse(`${text}!`), 'the final whole-message render is unchanged');
  }
});

test('an unfinished long code line searches only the added text for its newline', (t) => {
  t.mock.method(performance, 'now', () => 0);
  const stream = new StreamingMarkdown(new Node());
  stream.append('```js\n');
  paint();
  let searched = 0;
  const indexOf = String.prototype.indexOf;
  t.mock.method(String.prototype, 'indexOf', function (needle, from) {
    // The code renderer also looks for its opening newline without a start offset.
    if (needle === '\n' && from !== undefined) searched += this.length - from;
    return indexOf.call(this, needle, from);
  });
  for (let i = 0; i < 2000; i++) {
    stream.append('x');
    paint();
  }
  stream.append('\n');
  paint();
  assert.equal(searched, 2001);
  assert.equal(stream.tail.childNodes[0].childNodes[0].childNodes[0].data, `${'x'.repeat(2000)}\n`);
});

test('a diagram is drawn once, as the block it is in is done: never while its fence is open', (t) => {
  t.mock.method(performance, 'now', () => 0);
  const reply = 'A diagram:\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nThat is all, still typ';
  const closed = reply.indexOf('B\n```\n') + 'B\n```\n'.length;
  for (const step of [1, 4, 64]) {
    asked = [];
    const stream = new StreamingMarkdown(new Node());
    for (let at = 0; at < reply.length; at += step) {
      stream.append(reply.slice(at, at + step));
      paint();
      const sent = Math.min(at + step, reply.length);
      assert.equal(asked.length, sent < closed ? 0 : 1, `${step} characters at a time, after ${sent}`);
    }
    assert.match(asked[0].html, /<code class="language-mermaid">flowchart TD\n {2}A --&gt; B\n<\/code>/);
    // The whole reply once it is done, where the window has the diagram drawn already.
    stream.finish();
    assert.equal(asked.length, 2);
  }
});
