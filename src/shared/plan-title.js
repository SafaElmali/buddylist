// What a plan is called: on its tab beside the conversation, and in the lines about it.

const MAX = 60;

/** A line without the Markdown around it: the heading marks, the emphasis, a link's address. */
const plain = (line) =>
  line
    .replace(/^#{1,6}(\s+|$)/, '')
    .replace(/\s+#+$/, '')
    .replace(/^([-*+]|\d+[.)])\s+/, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|~~|[*`]/g, '')
    // "Plan: Add a dark theme" is called "Add a dark theme": every one of them is a plan.
    .replace(/^(implementation\s+)?plan\s*[:—–-]\s+/i, '')
    .trim();

/**
 * @param {string} [markdown]  the plan as its agent wrote it
 * @returns {string} its first heading or, without one, its first line. "Plan" when it has neither
 */
export function planTitle(markdown = '') {
  const lines = [];
  let fenced = false;
  for (const line of String(markdown).split('\n')) {
    // A "# comment" in a code block is no heading.
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced && line.trim()) lines.push(line.trim());
  }
  const title = plain(lines.find((line) => /^#{1,6}\s/.test(line)) ?? lines[0] ?? '');
  if (!title) return 'Plan';
  return title.length > MAX ? `${title.slice(0, MAX - 1).trimEnd()}…` : title;
}
