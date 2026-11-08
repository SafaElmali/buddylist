// The docs at buddylist.dev/docs: the guides in docs/ for the people who use buddylist, a page
// each, with every guide listed on the left and the page's headings on the right. Each guide is
// also served as written, at its address with .md, for anyone (or any agent) who would rather
// read Markdown. docs/landing-page.md#docs says how to add one.
import path from 'node:path';
import { Marked } from 'marked';
import { plainText } from './site-seo.js';

/**
 * The guides on the site, in the order the list on the left has them, under its headings.
 * `about` is what a search result and llms.txt say the page is.
 */
export const DOCS = [
  {
    heading: 'Start here',
    guides: [
      {
        file: 'getting-started.md',
        about:
          'Download buddylist for Mac, Windows or Linux, run the welcome wizard and start your first conversation with Claude Code, Codex, Gemini, OpenCode or Hermes.',
      },
      {
        file: 'welcome-wizard.md',
        about:
          'What a new install opens with: which of your agents are ready, signing in to Claude from the app, and adding your first project.',
      },
      {
        file: 'faq.md',
        about:
          'Answers to what people ask about buddylist: chatting with Codex or Gemini, GitHub and pull requests, group chats, shortcuts and privacy.',
      },
    ],
  },
  {
    heading: 'Conversations',
    guides: [
      {
        file: 'conversations.md',
        about:
          'Talking to a contact: saved quick messages, plans, unfinished to-dos, changed files, Create PR, chat tabs and message history.',
      },
      {
        file: 'group-conversations.md',
        about:
          'Invite more contacts into a conversation: a Claude beside a Codex or a Gemini, answering in turn, all at once, or the one you @ mention.',
      },
      {
        file: 'subagents.md',
        about:
          'The Subagents tab: which agents a Claude contact handed part of its work to, what each one is doing, and stopping one.',
      },
      {
        file: 'background.md',
        about:
          'The Background tab: the commands and watchers a Claude contact left running, such as a dev server, what each printed, and stopping one.',
      },
      {
        file: 'check-ins.md',
        about:
          'When a Claude contact checks back on its own: watching CI, looking at a deploy again later, or a task every weekday, and when each is due.',
      },
      {
        file: 'schedules.md',
        about:
          'Prompts that start a contact by themselves, on a cadence: every hour, weekdays at 9 or a cron of your own, missed runs, Max runs and Run now.',
      },
      {
        file: 'started-conversations.md',
        about:
          'Side tasks an agent starts, or a manager asked to fix something: how workers inherit settings, follow worker defaults and report back.',
      },
      {
        file: 'project-managers.md',
        about:
          'Managers on any service: copy settings and a brief, choose what workers use and their mode, check assigned conversations, keep the team when switching.',
      },
      {
        file: 'voice-clips.md',
        about:
          'Hold F2, say your message and let go: what you said is typed into the message box, turned into text on your computer by whisper.cpp.',
      },
    ],
  },
  {
    heading: 'Contacts and projects',
    guides: [
      {
        file: 'contact-list.md',
        about:
          'Contacts and projects: the command palette, quick send, worktrees, pull requests, archiving, spending totals and music status.',
      },
      {
        file: 'accounts.md',
        about:
          'See each Claude account’s allowance, optionally switch before a limit, and choose fallback services with explicit spending rules.',
      },
      {
        file: 'settings.md',
        about:
          "The Settings window: the app's own settings, what new contacts start with, and each project's scripts, environment variables, branches and instructions.",
      },
      {
        file: 'remote-access.md',
        about:
          'Use buddylist from your phone through Tailscale, with no server of ours: who waits for you, answers, Stop, notifications and what each phone may do.',
      },
    ],
  },
  {
    heading: 'Beside the conversation',
    guides: [
      {
        file: 'pull-request-stacks.md',
        about:
          'Read a pull request’s GitHub stack or its confirmed parents and dependents beside the conversation, understand uncertain relationships and pin the tab.',
      },
      {
        file: 'run-button.md',
        about:
          "Run your project's dev server or test watcher from a conversation, on a port of its own for each contact, with more scripts per project.",
      },
      {
        file: 'terminal.md',
        about:
          "Your own shell in a contact's folder, beside the conversation, as in a code editor: vim, htop and Ctrl+C work as they do in Terminal.",
      },
      {
        file: 'browser-tab.md',
        about:
          'A web page beside the conversation: the dev server your contact just started, or a page it linked to, without switching to another app.',
      },
    ],
  },
  {
    heading: 'Other agents',
    guides: [
      {
        file: 'codex.md',
        about:
          'Chat with Codex: buddylist runs the codex installed on your computer, with its own login, config.toml, AGENTS.md, hooks and MCP servers.',
      },
      {
        file: 'gemini.md',
        about:
          'Chat with Gemini: buddylist runs the Gemini CLI installed on your computer, with its own sign-in, settings.json, GEMINI.md and extensions.',
      },
      {
        file: 'opencode.md',
        about:
          'Chat with OpenCode: buddylist runs the opencode installed on your computer, with its own providers, opencode.json, AGENTS.md and commands.',
      },
      {
        file: 'hermes.md',
        about:
          'Chat with Hermes: buddylist runs the Hermes Agent installed on your computer, with its own providers, config.yaml, SOUL.md, memories and skills.',
      },
    ],
  },
  {
    heading: 'Make it yours',
    guides: [
      {
        file: 'msn-look.md',
        about:
          'The MSN Messenger look: Luna-blue windows, XP scrollbars, a glossy toolbar and display pictures, and its themes, each by day and at night.',
      },
      {
        file: 'professional-look.md',
        about:
          "The same app without the 2005 costume: flat panes, the system's own type, line icons, slate by day and ink at night.",
      },
      {
        file: 'display-pictures.md',
        about:
          "Use pictures of your own as the display pictures of you and your contacts, by dropping them into buddylist's pack folder.",
      },
    ],
  },
];

// The guide at the docs' own address.
const FIRST = 'getting-started.md';

// A link with a scheme, such as https: or mailto:, goes where it says.
const ADDRESS = /^[a-z][a-z\d+.-]*:/i;

const escape = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const markdown = new Marked({
  gfm: true,
  renderer: {
    // Each heading has its anchor, and below the title links to itself, as on the changelog.
    heading({ tokens, depth, id }) {
      const words = this.parser.parseInline(tokens);
      const linked = depth > 1 && !tokens.some((token) => token.type === 'link');
      return `<h${depth} id="${id}">${linked ? `<a href="#${id}">${words}</a>` : words}</h${depth}>\n`;
    },
  },
});

/**
 * A heading's anchor as GitHub makes it, so a link that works on GitHub works here too:
 * lower case, without punctuation, and a hyphen for each space.
 * @param {string} heading  its words
 */
export const anchorFor = (heading) =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');

/** Where a guide is on the site: Getting started is /docs/ itself. */
export const docPath = (file) => (file === FIRST ? '/docs/' : `/docs/${file.replace(/\.md$/, '')}`);

/** The guide's headings, each given its anchor. A second heading of the same words gets -1, as on GitHub. */
function headingsOf(tokens, file) {
  const seen = new Map();
  const headings = [];
  markdown.walkTokens(tokens, (token) => {
    if (token.type !== 'heading') return;
    const text = plainText(markdown.parseInline(token.text));
    const anchor = anchorFor(text);
    const times = seen.get(anchor) ?? 0;
    seen.set(anchor, times + 1);
    token.id = times ? `${anchor}-${times}` : anchor;
    headings.push({ depth: token.depth, id: token.id, text });
  });
  const first = tokens.find((token) => token.type !== 'space');
  if (first?.type !== 'heading' || first.depth !== 1) throw new Error(`docs/${file} doesn't start with a # title`);
  return headings;
}

/** Where a link in a guide goes on the site, or why it can't go there. */
function siteHref(href, page, pages) {
  if (ADDRESS.test(href)) return href;
  const [file, anchor] = href.split('#');
  const target = file ? pages.get(path.posix.join('docs', file)) : page;
  if (!target) {
    throw new Error(
      `docs/${page.file} links to ${href}, which isn't on the site: link to a guide in scripts/site-docs.js, or to a full address`
    );
  }
  if (anchor && !target.headings.some(({ id }) => id === anchor)) {
    throw new Error(`docs/${page.file} links to ${href}, but docs/${target.file} has no heading with that anchor`);
  }
  return file ? `${target.path}${anchor ? `#${anchor}` : ''}` : href;
}

/**
 * Every guide as a page, its links pointing at the pages they name. A link or picture the site
 * doesn't have stops the build, and so does a link to a heading a guide doesn't have.
 * @param {(file: string) => string} read  a guide's Markdown, by its name in docs/
 */
export function docPages(read) {
  const pages = DOCS.flatMap(({ heading, guides }) =>
    guides.map(({ file, about }) => {
      const tokens = markdown.lexer(read(file));
      const headings = headingsOf(tokens, file);
      return {
        file,
        about,
        group: heading,
        path: docPath(file),
        out: file === FIRST ? 'docs/index.html' : `docs/${file.replace(/\.md$/, '')}.html`,
        title: headings[0].text,
        headings,
        tokens,
      };
    })
  );
  const byFile = new Map(pages.map((page) => [`docs/${page.file}`, page]));
  for (const page of pages) {
    markdown.walkTokens(page.tokens, (token) => {
      if (token.type === 'link') token.href = siteHref(token.href, page, byFile);
      if (token.type === 'image' && !ADDRESS.test(token.href)) {
        throw new Error(`docs/${page.file} shows ${token.href}, which isn't on the site`);
      }
    });
  }
  return pages.map(({ tokens, ...page }, i) => ({
    ...page,
    html: markdown.parser(tokens),
    previous: pages[i - 1],
    next: pages[i + 1],
  }));
}

/** The list on the left: every guide under its heading, the one you are on marked. */
function navMarkup(pages, current) {
  return DOCS.map(({ heading }) => {
    const links = pages
      .filter((page) => page.group === heading)
      .map((page) => {
        const here = page === current ? ' aria-current="page"' : '';
        return `<li><a href="${page.path}"${here}>${escape(page.title)}</a></li>`;
      });
    return `<section class="docs-group"><p class="docs-group-head">${escape(heading)}</p><ul>${links.join('')}</ul></section>`;
  }).join('');
}

/** On the right, what is on the page: its headings under the title. A page with fewer than two has none. */
function tocMarkup({ headings }) {
  const shown = headings.filter(({ depth }) => depth === 2 || depth === 3);
  if (shown.length < 2) return '';
  const items = shown.map(
    ({ depth, id, text }) => `<li class="toc-${depth}"><a href="#${id}">${escape(text)}</a></li>`
  );
  return `<aside class="doc-toc" aria-labelledby="toc-head"><p class="doc-toc-head" id="toc-head">On this page</p><ul>${items.join('')}</ul></aside>`;
}

/** Under the page, the guides before and after it in the list. */
function pagerMarkup({ previous, next }) {
  const link = (page, rel, label) =>
    page ? `<a class="doc-${rel}" href="${page.path}" rel="${rel}"><span>${label}</span>${escape(page.title)}</a>` : '';
  return `<nav class="doc-pager" aria-label="More guides">${link(previous, 'prev', 'Previous')}${link(next, 'next', 'Next')}</nav>`;
}

/**
 * The tokens site/docs.html is filled in with for one page.
 * @param {ReturnType<typeof docPages>[number]} page
 * @param {ReturnType<typeof docPages>} pages
 */
export const docTokens = (page, pages) => ({
  DOC_TITLE: () => escape(page.title),
  DOC_ABOUT: () => escape(page.about),
  DOC_PATH: () => page.path,
  DOC_SOURCE: () => `/docs/${page.file}`,
  DOC_NAV: () => navMarkup(pages, page),
  DOC_BODY: () => page.html,
  DOC_PAGER: () => pagerMarkup(page),
  DOC_TOC: () => tocMarkup(page),
});
