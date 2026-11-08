import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SharedTab, sharedLabel, sharedOf } from '../src/renderer/chat/shared-tab.js';

/** A link as the page has it: written as `href`, made an address of from the window's own. */
const link = (href) => ({ url: new URL(href, 'file:///app/chat.html').href, href });
/** A message, as the conversation reads it back. */
const said = (id, { who = 'Safa', when = '2:14 PM', links = [], files = [], pictures = [] } = {}) => ({
  id,
  who,
  when,
  links: links.map(link),
  files,
  pictures,
});
/** What the tab lists, a card at a time: each card's title, and what is on it by kind and key, with the message. */
const listed = (messages) =>
  sharedOf(messages).map(({ title, items }) => [title, items.map(({ key, id }) => `${key} @${id}`)]);

// ---- what is shared, and on which card -------------------------------------------------------------

test('a link is a pull request or issue, a web page, or a file an agent linked by its path', () => {
  const messages = [
    said('m1', {
      who: 'Claude',
      links: [
        'https://github.com/SafaElmali/buddylist/pull/42',
        'https://docs.anthropic.com/en/api',
        'src/main/ipc.js:120',
        'https://github.com/SafaElmali/buddylist/issues/7',
        '/Users/me/proof.mp4',
      ],
    }),
  ];
  assert.deepEqual(listed(messages), [
    ['Pull requests and issues', ['SafaElmali/buddylist#42 @m1', 'SafaElmali/buddylist#7 @m1']],
    ['Links', ['https://docs.anthropic.com/en/api @m1']],
    ['Files', ['src/main/ipc.js @m1', '/Users/me/proof.mp4 @m1']],
  ]);
  const [github] = sharedOf(messages);
  assert.deepEqual(
    github.items.map((item) => item.pull),
    [true, false]
  );
});

test('what is no page or file is not listed: an e-mail address, a place on the page', () => {
  const messages = [said('m1', { links: ['mailto:me@example.com', '#setup', '?page=2', 'javascript:alert(1)'] })];
  assert.deepEqual(sharedOf(messages), []);
  assert.deepEqual(sharedOf([]), []);
});

test('what you sent is listed too: the files and folders you named, and the pictures', () => {
  const messages = [
    said('m1', {
      files: ['src/app.js', 'docs/'],
      pictures: ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'],
    }),
  ];
  assert.deepEqual(listed(messages), [
    ['Files', ['src/app.js @m1', 'docs/ @m1']],
    ['Pictures', ['data:image/png;base64,AAA @m1', 'data:image/png;base64,BBB @m1']],
  ]);
  // Each picture is known by its place among the message's, to open it.
  const [, pictures] = sharedOf(messages);
  assert.deepEqual(
    pictures.items.map((item) => item.picture),
    [0, 1]
  );
});

test('the newest is first, and what one message shared stays in the order it is in it', () => {
  const messages = [
    said('m1', { links: ['https://a.example.com/', 'https://b.example.com/'] }),
    said('m2', { links: ['https://c.example.com/', 'https://d.example.com/'] }),
  ];
  assert.deepEqual(listed(messages), [
    [
      'Links',
      [
        'https://c.example.com/ @m2',
        'https://d.example.com/ @m2',
        'https://a.example.com/ @m1',
        'https://b.example.com/ @m1',
      ],
    ],
  ]);
});

test('something shared again is listed once, as it was shared the last time', () => {
  const messages = [
    said('m1', { who: 'Safa', when: '2:14 PM', links: ['https://example.com/a'] }),
    said('m2', { who: 'Claude', when: '2:20 PM', links: ['https://example.com/b'] }),
    said('m3', { who: 'Claude', when: '2:31 PM', links: ['https://example.com/a', 'https://example.com/a'] }),
  ];
  const [links] = sharedOf(messages);
  assert.deepEqual(
    links.items.map(({ key, id, who, when }) => [key, id, who, when]),
    [
      ['https://example.com/a', 'm3', 'Claude', '2:31 PM'],
      ['https://example.com/b', 'm2', 'Claude', '2:20 PM'],
    ]
  );
});

test('a pull request is the same one on any of its pages, and opens the page that was shared last', () => {
  const messages = [
    said('m1', { links: ['https://github.com/o/r/pull/9'] }),
    said('m2', { links: ['https://github.com/o/r/pull/9/files#diff-1'] }),
  ];
  const [github] = sharedOf(messages);
  assert.equal(github.items.length, 1);
  assert.equal(github.items[0].id, 'm2');
  assert.equal(github.items[0].link.url, 'https://github.com/o/r/pull/9/files#diff-1');
});

test('a file linked and the same file sent are listed once, by its path', () => {
  const messages = [said('m1', { files: ['src/app.js'] }), said('m2', { who: 'Claude', links: ['src/app.js#L4-L9'] })];
  const [files] = sharedOf(messages);
  assert.deepEqual(
    files.items.map(({ key, id, link }) => [key, id, link?.href]),
    [['src/app.js', 'm2', 'src/app.js#L4-L9']]
  );
});

// ---- what a row says -----------------------------------------------------------------------------

const first = (message) => sharedOf([message])[0].items[0];

test('a web page reads as its site and page, without www, and its whole address is on the row', () => {
  assert.deepEqual(sharedLabel(first(said('m1', { links: ['https://www.example.com/docs/My%20Guide?x=1'] }))), {
    name: 'example.com/docs/My Guide',
    where: '',
    title: 'https://www.example.com/docs/My%20Guide?x=1',
  });
  assert.equal(sharedLabel(first(said('m1', { links: ['http://localhost:3000/'] }))).name, 'localhost:3000');
  // A % that escapes nothing stays as it is.
  assert.equal(sharedLabel(first(said('m1', { links: ['https://example.com/100%'] }))).name, 'example.com/100%');
});

test('a pull request or issue reads as GitHub writes it, and says which it is', () => {
  assert.deepEqual(sharedLabel(first(said('m1', { links: ['https://github.com/o/r/pull/9'] }))), {
    name: 'o/r#9',
    where: '',
    title: 'Pull request https://github.com/o/r/pull/9',
  });
  assert.equal(
    sharedLabel(first(said('m1', { links: ['https://github.com/o/r/issues/3'] }))).title,
    'Issue https://github.com/o/r/issues/3'
  );
});

test('a file reads as its name, in its folder, and its whole path is on the row', () => {
  assert.deepEqual(sharedLabel(first(said('m1', { files: ['src/main/ipc.js'] }))), {
    name: 'ipc.js',
    where: 'src/main',
    title: 'src/main/ipc.js',
  });
  assert.deepEqual(sharedLabel(first(said('m1', { files: ['docs/'] }))), { name: 'docs', where: '', title: 'docs/' });
  assert.deepEqual(sharedLabel(first(said('m1', { files: ['README.md'] }))), {
    name: 'README.md',
    where: '',
    title: 'README.md',
  });
  assert.equal(sharedLabel(first(said('m1', { links: ['/Users/me/proof.mp4'] }))).where, '/Users/me');
  assert.equal(sharedLabel(first(said('m1', { files: ['C:\\work\\app.js'] }))).where, 'C:\\work');
});

test('a picture is one', () => {
  assert.equal(sharedLabel(first(said('m1', { pictures: ['data:image/png;base64,AAA'] }))).name, 'Picture');
});

// ---- how a pull request shared here stands ---------------------------------------------------------

// The tab needs what it paints, not layout: each element keeps its markup, and the tab's own its children.
class SharedNode {
  addEventListener() {}
  replaceChildren(...children) {
    this.children = children;
  }
}

/** The pull request GitHub tells of, as main/contact-card.js reads it. */
const pr = (state, more = {}) => ({ number: 9, url: 'https://github.com/o/r/pull/9', title: 'Fix it', state, ...more });

/**
 * A Shared tab on show, over messages that can be changed, with a GitHub that answers as told.
 * @param {(url: string) => Promise<object | null>} answer
 */
function sharedTab(t, messages, answer) {
  const savedDocument = globalThis.document;
  globalThis.document = {
    createElement: () => {
      const node = new SharedNode();
      return {
        set innerHTML(markup) {
          node.markup = markup;
        },
        content: { firstElementChild: node },
      };
    },
  };
  t.after(() => {
    if (savedDocument === undefined) delete globalThis.document;
    else globalThis.document = savedDocument;
  });
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const pane = {
    selected: null,
    shows(id) {
      return this.selected === id;
    },
    open(tab) {
      this.selected = tab.id;
    },
  };
  const asked = [];
  const tab = new SharedTab(
    pane,
    { web: false },
    {
      said: () => messages,
      pullRequest: (url) => (asked.push(url), answer(url)),
    }
  );
  /** The tags each row wears, as "kind text", one row after another. */
  const tags = () =>
    tab.body.children
      .map(({ markup }) => markup)
      .join('')
      .split('class="shared-row"')
      .slice(1)
      .map((row) =>
        [...row.matchAll(/data-kind="(\w+)">[^]*?<\/svg>([^<]*)</g)].map(([, kind, text]) => `${kind} ${text}`)
      );
  const settled = () => new Promise(setImmediate);
  return { tab, pane, asked, tags, settled };
}

test('a pull request shared here wears the tags its contact would, once GitHub has said how it stands', async (t) => {
  const messages = [said('m1', { links: ['https://github.com/o/r/pull/9/files', 'https://github.com/o/r/issues/3'] })];
  const { tab, asked, tags, settled } = sharedTab(t, messages, async () =>
    pr('open', { checks: { failing: 2, pending: 1, passed: 4 }, conflict: true })
  );
  tab.show();
  // Until GitHub answers, the row is as it was; an issue is never asked about.
  assert.deepEqual(tags(), [[], []]);
  assert.deepEqual(asked, ['https://github.com/o/r/pull/9/files']);
  await settled();
  assert.deepEqual(tags(), [['conflict Conflict', 'failing 2 failing'], []]);
  assert.match(tab.body.children[0].markup, /title="Pull request #9 · merge conflict, 2 checks failing\nFix it"/);
});

test('each state reads as it does in the contact list', async (t) => {
  for (const [answer, expected] of [
    [pr('merged'), ['merged Merged']],
    [pr('closed'), ['closed Closed']],
    [pr('draft'), ['draft Draft']],
    [pr('open'), ['open Open']],
    [pr('open', { checks: { failing: 0, pending: 2, passed: 1 } }), ['running Running']],
    [pr('open', { checks: { failing: 0, pending: 0, passed: 3 } }), ['passed Passed']],
    [null, []],
  ]) {
    await t.test(expected[0] ?? 'no pull request', async (st) => {
      const { tab, tags, settled } = sharedTab(
        st,
        [said('m1', { links: ['https://github.com/o/r/pull/9'] })],
        async () => answer
      );
      tab.show();
      await settled();
      assert.deepEqual(tags(), [expected]);
    });
  }
});

test('GitHub is asked again a minute later, as the tab is painted again, and a merged one never', async (t) => {
  const messages = [said('m1', { links: ['https://github.com/o/r/pull/9'] })];
  const answers = [pr('open'), pr('open', { checks: { failing: 0, pending: 0, passed: 2 } }), pr('merged')];
  const { tab, asked, tags, settled } = sharedTab(t, messages, async () => answers[asked.length - 1]);
  tab.show();
  await settled();
  // The answer paints the tab again, which doesn't ask again: it was asked just now.
  assert.equal(asked.length, 1);
  t.mock.timers.setTime(59_000);
  tab.focused();
  assert.equal(asked.length, 1);
  t.mock.timers.setTime(60_000);
  tab.focused();
  await settled();
  assert.equal(asked.length, 2);
  assert.deepEqual(tags(), [['passed Passed']]);
  t.mock.timers.setTime(120_000);
  tab.changed();
  await settled();
  assert.deepEqual(tags(), [['merged Merged']]);
  t.mock.timers.setTime(10 * 60_000);
  tab.focused();
  assert.equal(asked.length, 3, 'merged is merged for good');
});

test('one pull request linked from several of its pages is asked about once', async (t) => {
  const messages = [
    said('m1', { links: ['https://github.com/o/r/pull/9'] }),
    said('m2', { links: ['https://github.com/o/r/pull/9#issuecomment-1', 'https://github.com/o/r/pull/10'] }),
  ];
  const { tab, asked } = sharedTab(t, messages, async () => pr('open'));
  tab.show();
  assert.deepEqual(asked, ['https://github.com/o/r/pull/9#issuecomment-1', 'https://github.com/o/r/pull/10']);
});

test('when GitHub cannot tell, the tags it last wore stand', async (t) => {
  const messages = [said('m1', { links: ['https://github.com/o/r/pull/9'] })];
  const offline = new Error('GitHub could not be reached.');
  const answers = [pr('closed'), offline];
  const { tab, asked, tags, settled } = sharedTab(t, messages, async () => {
    const answer = answers[asked.length - 1];
    if (answer instanceof Error) throw answer;
    return answer;
  });
  tab.show();
  await settled();
  t.mock.timers.setTime(60_000);
  tab.focused();
  await settled();
  assert.equal(asked.length, 2);
  assert.deepEqual(tags(), [['closed Closed']]);
});

test('a tab not on show asks nobody', async (t) => {
  const messages = [said('m1', { links: ['https://github.com/o/r/pull/9'] })];
  const { tab, asked } = sharedTab(t, messages, async () => pr('open'));
  tab.changed();
  tab.focused();
  assert.deepEqual(asked, []);
});
