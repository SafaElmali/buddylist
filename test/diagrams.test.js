import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marked } from '../node_modules/marked/lib/marked.esm.js';
import {
  DIAGRAM_CLASS,
  diagramCode,
  drawnSize,
  failure,
  fenceClosed,
  FONT_SIZE,
  isDiagram,
  mermaidConfig,
} from '../src/renderer/lib/diagrams.js';
import { keepsClass } from '../src/renderer/lib/markdown.js';

/** The code blocks of a reply, as marked reads them. */
function blocks(reply) {
  const found = [];
  marked.walkTokens(marked.lexer(reply), (token) => {
    if (token.type === 'code') found.push(token);
  });
  return found;
}

const THEME = {
  dark: false,
  font: 'Tahoma, sans-serif',
  paper: '#f7f9fc',
  box: '#d6e5f9',
  boxEdge: '#8eb2e3',
  panel: '#fff',
  panelEdge: '#b8cbe6',
  ink: '#000',
  line: '#3d4f6a',
};

test('a code block is a diagram when it says it is written in Mermaid, in any case', () => {
  for (const language of ['mermaid', 'Mermaid', 'MERMAID']) assert.ok(isDiagram(language), language);
  for (const language of ['', 'js', 'mermaidjs', 'mmd', 'text']) assert.ok(!isDiagram(language), language);
});

test('a fence is closed by a fence of its own character, at least as long, with nothing after it', () => {
  for (const reply of [
    '```mermaid\nA-->B\n```',
    '```mermaid\nA-->B\n```\n\nAfter it.',
    '```mermaid\nA-->B\n```   \nRight after it.',
    '~~~mermaid\nA-->B\n~~~',
    '````mermaid\nA-->B\n`````',
    '```mermaid\nA-->B\n  ```',
  ]) {
    assert.ok(fenceClosed(blocks(reply)[0].raw), reply);
  }
});

test('a fence still being written is not closed, whatever Markdown makes of it', () => {
  for (const reply of [
    '```mermaid',
    '```mermaid\n',
    '```mermaid\nA-->B',
    '```mermaid\nA-->B\n',
    '```mermaid\nA-->B\n``',
    '````mermaid\nA-->B\n```\n',
    '~~~mermaid\nA-->B\n```\n',
    '```mermaid\nA-->B\n``` and words',
  ]) {
    const [block] = blocks(reply);
    assert.ok(block, reply);
    assert.ok(!fenceClosed(block.raw), reply);
  }
  assert.ok(!fenceClosed('    indented code'), 'an indented block has no fence');
});

test('a block inside a list item or a quote is closed as one of the reply itself is', () => {
  for (const reply of ['- one\n  ```mermaid\n  A-->B\n  ```\n- two', '> ```mermaid\n> A-->B\n> ```']) {
    assert.ok(fenceClosed(blocks(reply)[0].raw), reply);
  }
  assert.ok(!fenceClosed(blocks('- one\n  ```mermaid\n  A-->B\n')[0].raw));
});

test('only a closed diagram with something in it is marked to be drawn; its code is kept as written', () => {
  assert.equal(
    diagramCode('A --> B\nB -- "<b>yes</b>" --> C', '```mermaid\nA --> B\nB -- "<b>yes</b>" --> C\n```'),
    `<pre><code class="${DIAGRAM_CLASS}">A --&gt; B\nB -- &quot;&lt;b&gt;yes&lt;/b&gt;&quot; --&gt; C\n</code></pre>\n`
  );
  assert.equal(diagramCode('A --> B', '```mermaid\nA --> B\n'), '<pre><code>A --&gt; B\n</code></pre>\n');
  assert.equal(diagramCode('', '```mermaid\n```'), '<pre><code>\n</code></pre>\n');
  assert.equal(diagramCode('  \n', '```mermaid\n  \n```'), '<pre><code>  \n</code></pre>\n');
});

test('a reply marks a diagram for drawing once its fence is closed, and never before', () => {
  const reply = 'Here it is:\n\n```mermaid\nflowchart TD\n  A[Start] --> B{Done?}\n```\n\nThat is all.';
  for (let length = 1; length <= reply.length; length++) {
    const html = marked.parse(reply.slice(0, length));
    const closed = reply.slice(0, length).includes('B{Done?}\n```');
    assert.equal(html.includes(DIAGRAM_CLASS), closed, `after ${length} characters`);
  }
  assert.match(
    marked.parse(reply),
    new RegExp(
      `<pre><code class="${DIAGRAM_CLASS}">flowchart TD\n {2}A\\[Start\\] --&gt; B\\{Done\\?\\}\n</code></pre>`
    )
  );
});

test('the class of a diagram is the one class a reply’s code element keeps', () => {
  assert.ok(keepsClass('CODE', DIAGRAM_CLASS));
  for (const classes of [`${DIAGRAM_CLASS} modal`, 'language-js', 'hljs-keyword', 'diagram']) {
    assert.ok(!keepsClass('CODE', classes), classes);
  }
  for (const tag of ['PRE', 'DIV', 'FIGURE', 'IMG']) assert.ok(!keepsClass(tag, DIAGRAM_CLASS), tag);
});

test('Mermaid is strict, puts no error picture of its own anywhere, and draws in the window’s colours', () => {
  const config = mermaidConfig(THEME);
  assert.equal(config.securityLevel, 'strict');
  assert.equal(config.startOnLoad, false);
  assert.equal(config.suppressErrorRendering, true);
  assert.equal(config.theme, 'base');
  assert.equal(config.fontFamily, THEME.font);
  assert.equal(config.fontSize, FONT_SIZE);
  assert.deepEqual(config.themeVariables, {
    darkMode: false,
    background: THEME.paper,
    fontFamily: THEME.font,
    fontSize: `${FONT_SIZE}px`,
    primaryColor: THEME.box,
    primaryBorderColor: THEME.boxEdge,
    useGradient: false,
    primaryTextColor: THEME.ink,
    textColor: THEME.ink,
    lineColor: THEME.line,
    clusterBkg: THEME.panel,
    clusterBorder: THEME.panelEdge,
    edgeLabelBackground: THEME.panel,
  });
  assert.equal(mermaidConfig({ ...THEME, dark: true }).themeVariables.darkMode, true);
});

test('a diagram is as big as its view box, in whole pixels', () => {
  assert.deepEqual(drawnSize('0 0 523.5 400'), { width: 524, height: 400 });
  assert.deepEqual(drawnSize('-8 -8 360 545.2'), { width: 360, height: 546 });
  assert.deepEqual(drawnSize(' 0,0,120,80 '), { width: 120, height: 80 });
  for (const viewBox of [null, '', '0 0 0 400', '0 0 100', 'none', '0 0 -5 10']) {
    assert.equal(drawnSize(viewBox), null, String(viewBox));
  }
});

test('why a diagram could not be drawn is said in its first line, without the place it shows', () => {
  assert.equal(
    failure(new Error("Parse error on line 3:\n...A --> \n----^\nExpecting 'AMP', got 'EOF'")),
    'Parse error on line 3'
  );
  assert.equal(failure(new Error('Lexical error on line 1.')), 'Lexical error on line 1');
  assert.equal(failure('No diagram type detected'), 'No diagram type detected');
  assert.equal(failure(undefined), '');
  assert.equal(failure(new Error('x'.repeat(500))).length, 160);
});
