// The changelog page's versions, built from site/changelog.md (see docs/landing-page.md#changelog).
// The file is written by hand in this repository, so its Markdown is shown as written: the page only
// cuts a change into sentences, to fold what follows the first one, and never changes its words.

import { Lexer, Marked } from 'marked';
import { changelogEntries, releaseAnchor, RELEASES_REPO } from '../src/shared/release-notes.js';

const RELEASES_PAGE = `https://github.com/${RELEASES_REPO}/releases`;
const markdown = new Marked({ gfm: true });
/** The same, with a link left as its words: for what is drawn inside a summary, which is a button. */
const unlinked = new Marked(
  { gfm: true },
  {
    renderer: {
      link({ tokens }) {
        return this.parser.parseInline(tokens);
      },
    },
  }
);

/** "Oct 12, 2026" for "2026-10-12", and "Oct 12" without the year. */
const shortDate = (day, year = true) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    ...(year && { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** A change whose title says it gathers small ones: its sentences are listed one a line. */
const FIXES = /^(?:smaller|small|minor|other)?\s*fixes$/i;
/** A change folds only when what it hides is worth a click. */
const FOLD_MIN = 60;
/** Where a sentence can end: its stop, any closing quote or bracket, and the space after it. */
const STOP = /([.!?…]+)([)"'”’\]]*)(\s+)/g;
/** "e.g." and the like end a word, not the sentence. */
const ABBREVIATION = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf)$/i;
/** A sentence that leans on the one before it ("It…", "Before, …") stays with it in a list of fixes. */
const LEANS_BACK =
  /^(?:(?:It|Its|It[’']s|They|Their|Them|This|That|These|Those|Both|Either|Neither|Also|And|But|Or|So|Then|Instead|Otherwise)\b|Before,)/;

/** Whether a run of stops ends a sentence: a menu item's "..." or "…" doesn't, "...." does. */
const ends = (stop) => /^(?:\.|\.{4}|…\.|[!?]+)$/.test(stop);

/** What a reader sees first of an inline token, or nothing for the end of the text. */
const firstSeen = (token) => (token ? (token.type === 'text' ? token.raw : (token.text ?? token.raw)) : '');

/**
 * Inline Markdown in sentences, cut only in its plain text: never inside code, a link or bold.
 * A sentence ends at ".", "!" or "?" with a space after it and no small letter next, so menu
 * items ("Add a manager... works"), versions (v0.2.7), files (package.json) and "e.g." stay whole.
 * @param {string} text  inline Markdown, such as a change's text after its title
 * @returns {string[] | null}  null when the lexer's pieces don't add up to the text, so it can't be cut safely
 */
export function sentences(text) {
  const source = text.trim();
  if (!source) return [];
  const tokens = Lexer.lexInline(source);
  if (tokens.map((token) => token.raw).join('') !== source) return null;
  const cuts = [];
  let at = 0;
  tokens.forEach((token, i) => {
    const after = tokens[i + 1];
    if (token.type === 'text') {
      for (const { 0: whole, 1: stop, index } of token.raw.matchAll(STOP)) {
        const before = token.raw.slice(0, index);
        const rest = token.raw.slice(index + whole.length) || firstSeen(after);
        if (!rest || !ends(stop) || ABBREVIATION.test(before) || /^\p{Ll}/u.test(rest)) continue;
        cuts.push(at + index + whole.length - whole.match(/\s+$/)[0].length);
      }
    }
    at += token.raw.length;
  });
  const pieces = [];
  let from = 0;
  for (const cut of cuts) {
    pieces.push(source.slice(from, cut).trim());
    from = cut;
  }
  pieces.push(source.slice(from).trim());
  return pieces.filter(Boolean);
}

/**
 * A change as written, "**What changed** — what it means for you.": its title and its sentences.
 * A change without a title, as early versions have, is only sentences.
 * @param {string} text  the change's Markdown, without the list's "- "
 * @returns {{ title: string | null, text: string, sentences: string[] | null }}
 */
export function changeParts(text) {
  const titled = /^\*\*(?<title>[^*]+)\*\*\s+[—–]\s+(?<rest>[\s\S]*)$/.exec(text.trim());
  const { title = null, rest = text.trim() } = titled?.groups ?? {};
  return { title, text: rest, sentences: sentences(rest) };
}

/** Sentences one a line, each with any that lean on it ("It also…") kept beside it. */
export function fixLines(list) {
  const lines = [];
  for (const sentence of list) {
    if (lines.length && LEANS_BACK.test(sentence)) lines[lines.length - 1] += ` ${sentence}`;
    else lines.push(sentence);
  }
  return lines;
}

/** What a change is called in a list of them: its title, or else its first sentence. */
export function changeName(text) {
  const { title, text: rest, sentences: list } = changeParts(text);
  if (title) return title;
  // Without its stop, but with a menu item's dots: "Remove project...." is "Remove project...".
  const first = list?.[0] ?? rest;
  return /(?<!\.\.)\.$|\.{4}$/.test(first) ? first.slice(0, -1) : first;
}

/**
 * One change as a row of its version's card: its title, its first sentence, and the rest folded
 * under More. Small fixes are listed a line each instead. A change that can't be cut is shown whole.
 */
function changeMarkup(item) {
  if (item.tokens.length !== 1 || item.tokens[0].type !== 'text') {
    return `<li class="change">${markdown.parser(item.tokens)}</li>`;
  }
  const { title, text, sentences: list } = changeParts(item.text);
  const head = title ? `<strong class="change-title">${markdown.parseInline(title)}</strong>` : '';
  if (title && FIXES.test(title) && list?.length > 1) {
    const fixes = fixLines(list).map((line) => `<li>${markdown.parseInline(line)}</li>`);
    return `<li class="change">${head}<ul class="change-fixes">${fixes.join('')}</ul></li>`;
  }
  const [lead, ...more] = list ?? [];
  const folded = more.join(' ');
  const leadMarkup = lead && markdown.parseInline(lead);
  if (folded.length < FOLD_MIN || leadMarkup.includes('<a ')) {
    return `<li class="change">${head}<p class="change-text">${markdown.parseInline(text)}</p></li>`;
  }
  return [
    '<li class="change"><details class="change-fold">',
    `<summary>${head}<span class="change-text">${leadMarkup}</span></summary>`,
    `<p class="change-text">${markdown.parseInline(folded)}</p>`,
    '</details></li>',
  ].join('');
}

/** What is new in a version: its changes as rows, and anything else as the Markdown has it. */
const cards = new Marked(
  { gfm: true },
  {
    renderer: {
      list(token) {
        if (token.ordered) return false;
        return `<ul class="changes">${token.items.map(changeMarkup).join('')}</ul>\n`;
      },
    },
  }
);

/** The changes listed in a version's notes. */
const changesIn = (tokens) => tokens.filter(({ type }) => type === 'list').flatMap(({ items }) => items);

/**
 * One version as a card: a line that says which, when and how many changes, then their names
 * while it is closed and what is new in it once open. Only the newest starts open.
 */
function versionMarkup({ version, day, markdown: notes }, open) {
  const id = releaseAnchor(version);
  const changes = changesIn(markdown.lexer(notes));
  const when = day ? `<time datetime="${day}">${shortDate(day)}</time>` : '';
  const count = changes.length
    ? `<span class="release-count">${changes.length} ${changes.length === 1 ? 'change' : 'changes'}</span>`
    : '';
  const names = changes.length
    ? `<span class="release-names" aria-hidden="true">${changes
        .map(({ text }) => `<span>${unlinked.parseInline(changeName(text))}</span>`)
        .join('')}</span>`
    : '';
  const what = notes
    ? `<div class="release-notes">${cards.parse(notes)}</div>`
    : `<p class="release-notes">Its downloads are <a href="${RELEASES_PAGE}/tag/${id}">on GitHub</a>.</p>`;
  return [
    `<article class="release" id="${id}"><details class="release-fold"${open ? ' open' : ''}>`,
    `<summary class="release-head"><span class="release-line"><h2>${id}</h2>${when}${count}</span>${names}</summary>`,
    `${what}</details></article>`,
  ].join('');
}

/** Every version, a link each, to jump to: beside the cards on a wide screen, over them on a phone. */
function versionsNav(shown) {
  const links = shown.map(({ version, day }) => {
    const id = releaseAnchor(version);
    const when = day ? `<time datetime="${day}">${shortDate(day, false)}</time>` : '';
    return `<li><a href="#${id}">${id}${when}</a></li>`;
  });
  return [
    '<nav class="changelog-versions" aria-label="Versions">',
    '<p class="changelog-versions-head">Versions</p>',
    `<ol>${links.join('')}</ol>`,
    '</nav>',
  ].join('');
}

/** Opening or closing every card at once, which only changelog.js can do: shown by it. */
const FOLD_ALL =
  '<p class="changelog-tools" hidden><button type="button" data-fold="open">Expand all</button><button type="button" data-fold="close">Collapse all</button></p>';

/**
 * Only published stable releases, in the changelog's order. Preparing package.json or
 * creating a tag alone does not publish a version, including gaps between released versions.
 * @param {string} changelog  site/changelog.md
 * @param {string[]} published  versions from GitHub's non-draft, stable releases
 */
export function changelogMarkup(changelog, published = []) {
  const versionsOut = new Set(published);
  const shown = changelogEntries(changelog).filter(({ version }) => versionsOut.has(version));
  if (!shown.length) return '<p class="changelog-note">No version is out yet.</p>';
  const versions = shown.map((entry, i) => versionMarkup(entry, i === 0)).join('\n');
  return `${versionsNav(shown)}\n<div class="changelog-list">${FOLD_ALL}\n${versions}\n</div>`;
}
