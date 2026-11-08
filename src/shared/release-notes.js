// What is new in each version of buddylist, and where the changelog shows it. The changelog is
// written by hand in site/changelog.md: the website builds its page from it (scripts/site-changelog.js),
// a release takes its version's part as its description (scripts/release.js), and the app opens the
// page for See changes, What's new and Help > What's new (src/renderer).

/**
 * The public repository whose releases hold the installers, the update feed and their descriptions.
 * Source and releases share SafaElmali/buddylist (see docs/releases.md).
 */
export const RELEASES_REPO = 'SafaElmali/buddylist';

/** The website's page with every version and what is new in it. */
export const CHANGELOG_URL = 'https://buddylist.dev/changelog';

/** The id of a version's part of the changelog: "v0.2.9" for 0.2.9. */
export const releaseAnchor = (version) => `v${version}`;

/** A version's part of the changelog, such as https://buddylist.dev/changelog#v0.2.9. */
export const changelogUrl = (version) => `${CHANGELOG_URL}#${releaseAnchor(version)}`;

// "## v0.2.11 — 2026-10-12": a version, and the day it came out when the heading says.
const VERSION = /^##\s+v(\d+\.\d+\.\d+)(?:\s+[—–-]\s+(\d{4}-\d{2}-\d{2}))?\s*$/;
const LEVEL_TWO = /^##\s/;

/** Whether "2026-10-12" is a day of the calendar, which "2026-02-30" is not. */
const isDay = (day) => !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().startsWith(day);

/**
 * A version as the changelog has it.
 * @typedef {Object} Entry
 * @property {string} version     such as "0.2.11"
 * @property {string | null} day  when it came out, such as "2026-10-12": null when its heading doesn't say
 * @property {string} markdown    what is new in it, as written: empty when it says nothing
 */

/**
 * The versions in the changelog, in its order. Each "## v1.2.3" heading starts one, and what follows
 * it up to the next is what is new in it. What comes before the first, such as the title, is no
 * version's. Another "##" heading, a version twice or a day that isn't one is a mistake, and throws.
 * @param {string} markdown  site/changelog.md
 * @returns {Entry[]}
 */
export function changelogEntries(markdown) {
  const entries = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!LEVEL_TWO.test(line)) {
      entries.at(-1)?.lines.push(line);
      continue;
    }
    const heading = VERSION.exec(line.trim());
    if (!heading) throw new Error(`The changelog has a heading that isn't a version, such as "## v1.2.3": ${line}`);
    const [, version, day = null] = heading;
    if (day && !isDay(day)) throw new Error(`The changelog gives v${version} a day that isn't one: ${day}`);
    if (entries.some((entry) => entry.version === version)) throw new Error(`The changelog has v${version} twice`);
    entries.push({ version, day, lines: [] });
  }
  return entries.map(({ lines, ...entry }) => ({ ...entry, markdown: lines.join('\n').trim() }));
}
