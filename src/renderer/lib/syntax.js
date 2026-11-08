// Code in colour: the language a file or a code block is written in, and its code split into the
// parts that language has names for, such as a keyword, a string or a comment. chat.css colours
// each by its class (`.hljs-keyword` and the rest), in the theme's colours for code.
import hljs from '../../../node_modules/@highlightjs/cdn-assets/es/highlight.js';
import dockerfile from '../../../node_modules/@highlightjs/cdn-assets/es/languages/dockerfile.min.js';
import erb from '../../../node_modules/@highlightjs/cdn-assets/es/languages/erb.min.js';

// Besides the languages most code is written in, which the highlighter knows already: a Rails
// app's templates, and a Dockerfile.
hljs.registerLanguage('erb', erb);
hljs.registerLanguage('dockerfile', dockerfile);

/** Code longer than this stays as it is: colouring it would hold the window up. */
export const MOST_COLOURED = 200 * 1000;
/**
 * And so does code with a line longer than this, which is made by a program rather than written,
 * such as a minified script. Colouring takes longer the longer a word is, and grows fast with it.
 */
export const LONGEST_COLOURED = 1000;

/** Files known by their whole name, which has no ending to tell their language by. */
const NAMED = {
  Gemfile: 'ruby',
  Rakefile: 'ruby',
  Podfile: 'ruby',
  Brewfile: 'ruby',
  Dockerfile: 'dockerfile',
  Makefile: 'makefile',
};

/** Endings the highlighter has no name for, and the language of the files they end. */
const ENDINGS = { jbuilder: 'ruby', rake: 'ruby', ru: 'ruby' };

const PLAIN = hljs.getLanguage('plaintext');

/**
 * The language a block of code says it is written in, as the highlighter names it.
 * @param {string | null | undefined} name  such as `rb`, `ruby` or `Ruby`
 * @returns {string | null}  null for one it doesn't know, and for plain text, which has nothing to colour
 */
export function languageNamed(name) {
  const language = String(name ?? '').toLowerCase();
  const known = language && hljs.getLanguage(language);
  return known && known !== PLAIN ? language : null;
}

/**
 * The language a file is written in, by its name.
 * @param {string} path
 * @returns {string | null}  null for a file whose name doesn't tell
 */
export function languageOf(path) {
  const name = String(path ?? '')
    .split('/')
    .at(-1);
  if (Object.hasOwn(NAMED, name)) return NAMED[name];
  const dot = name.lastIndexOf('.');
  // A name that starts with its only dot, such as .gitignore, has no ending.
  if (dot <= 0) return null;
  const ending = name.slice(dot + 1).toLowerCase();
  return languageNamed(Object.hasOwn(ENDINGS, ending) ? ENDINGS[ending] : ending);
}

/**
 * Code as HTML, its parts in spans with the classes chat.css colours them by.
 * @param {string} code
 * @param {string} language  as `languageNamed` or `languageOf` gives it
 * @returns {string | null}  null for code too long to colour, or with a line too long
 */
export function codeHtml(code, language) {
  if (code.length > MOST_COLOURED || code.split('\n').some((line) => line.length > LONGEST_COLOURED)) return null;
  return hljs.highlight(code, { language, ignoreIllegals: true }).value;
}

/**
 * A run of a line's text that is all one part of its code.
 * @typedef {Object} CodePart
 * @property {string} text
 * @property {string | null} scope  the classes it is coloured by; null for what is no part with a name, such as white space
 */

// What the highlighter writes: a span that opens, one that closes, or text between them.
const MARKUP = /<span class="([^"]*)">|<\/span>|([^<]+)/g;
const ENTITY = /&(amp|lt|gt|quot|#x27);/g;
const CHARACTERS = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'" };

/**
 * Lines of code split into their parts. The lines are read as one text, as they follow each
 * other in their file, so that a part that goes on past the end of a line, such as a comment
 * of many lines, is known for what it is on each of them.
 * @param {string[]} lines
 * @param {string} language  as `languageNamed` or `languageOf` gives it
 * @returns {CodePart[][] | null}  the parts of each line, together as long as it is; null for code too long to colour (see `codeHtml`)
 */
export function codeParts(lines, language) {
  const markup = codeHtml(lines.join('\n'), language);
  if (markup === null) return null;
  /** @type {CodePart[][]} */
  const parts = [[]];
  // The classes of the spans the text is in. The innermost colours it, as it would in the page,
  // but for a span that only says in which language the code goes on inside it: that has no colour.
  const open = [];
  for (const [, opens, text] of markup.matchAll(MARKUP)) {
    if (opens !== undefined) open.push(opens);
    else if (text === undefined) open.pop();
    else {
      const scope = open.findLast((classes) => !classes.startsWith('language-')) ?? null;
      text
        .replace(ENTITY, (_, name) => CHARACTERS[name])
        .split('\n')
        .forEach((piece, i) => {
          if (i) parts.push([]);
          const line = parts.at(-1);
          const last = line.at(-1);
          if (!piece) return;
          if (last?.scope === scope) last.text += piece;
          else line.push({ text: piece, scope });
        });
    }
  }
  return parts;
}
