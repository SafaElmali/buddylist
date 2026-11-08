// Quotes in a message, as Markdown writes them: "> what was said", a line at a time. Replying
// to part of a message quotes it so, and the words under the quote answer it.

/** A quoted line starts with ">", after at most three spaces. One space after it is part of the mark. */
const QUOTED = /^ {0,3}> ?/;

/**
 * Whether the place `at` in a message is on a quoted line: words someone else said.
 * @param {string} text
 * @param {number} at
 */
export const quotedAt = (text, at) => QUOTED.test(text.slice(text.lastIndexOf('\n', at - 1) + 1, at + 1));

/**
 * Words as a quote: each line with "> " in front. Blank lines around them go, and several
 * between paragraphs are one.
 * @param {string} text
 */
export function quoteOf(text) {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.trimEnd());
  const kept = [];
  for (const line of lines) {
    // No blank line first, or after another.
    if (!line && !kept.at(-1)) continue;
    kept.push(line);
  }
  if (kept.at(-1) === '') kept.pop();
  return kept.map((line) => (line ? `> ${line}` : '>')).join('\n');
}

/**
 * What the message box holds once `text` is quoted in it: the quote under what was there,
 * and a line under the quote for the answer.
 * @param {string} typed  what is in the box
 * @param {string} text   the words to quote
 */
export function withQuote(typed, text) {
  const before = typed.trimEnd();
  return `${before ? `${before}\n\n` : ''}${quoteOf(text)}\n\n`;
}

/**
 * A message as the quotes in it and the words around them, in order. A quote is its lines
 * without their "> ". The blank lines around a quote are its edges, and go with it.
 * @param {string} text
 * @returns {{ quote: boolean, text: string }[]}
 */
export function quoteRuns(text) {
  /** @type {{ quote: boolean, lines: string[] }[]} */
  const runs = [];
  for (const line of text.split('\n')) {
    const mark = QUOTED.exec(line);
    const quote = Boolean(mark);
    const said = mark ? line.slice(mark[0].length) : line;
    const last = runs.at(-1);
    if (last?.quote === quote) last.lines.push(said);
    else runs.push({ quote, lines: [said] });
  }
  return runs
    .map(({ quote, lines }) => ({ quote, text: lines.join('\n').replace(/^\n+|\n+$/g, '') }))
    .filter((run) => run.text);
}
