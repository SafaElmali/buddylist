// How connecting to GitHub reads: the line under your name in the contact list while
// GitHub's CLI is not connected, and the steps of the "Connect to GitHub" dialog.
import { linkRanges } from './links.js';

/** What the line under your name says instead of a count. */
export const CONNECT_TEXT = 'Connect to GitHub to see your pull requests';

const CONNECT_TITLES = {
  missing: 'The GitHub CLI is not installed',
  'signed-out': 'You are not signed in to GitHub',
};

/**
 * What pointing at that line adds: what stands between the app and GitHub.
 * @param {import('../main/review-requests.js').ReviewSummary['connect']} connect
 */
export const connectTitle = (connect) => CONNECT_TITLES[connect] ?? CONNECT_TITLES['signed-out'];

/**
 * Where a sign-in started from the dialog stands.
 * asking: GitHub's CLI has not said a code yet. code: there is one to take to GitHub's page.
 * waiting: the page was opened, and GitHub has not heard the code yet. failed: it did not go through.
 * @typedef {'asking' | 'code' | 'waiting' | 'failed'} ConnectStep
 */

/**
 * @param {object} signIn
 * @param {string} [signIn.code]     the one-time code, once there is one
 * @param {boolean} [signIn.opened]  GitHub's page was opened from the dialog
 * @param {string} [signIn.problem]  why it did not go through
 * @returns {ConnectStep}
 */
export function connectStep({ code, opened, problem }) {
  if (problem) return 'failed';
  if (!code) return 'asking';
  return opened ? 'waiting' : 'code';
}

/**
 * A message cut where its web addresses are, so that each can be drawn as a link.
 * @param {string} message
 * @returns {{ text: string, link: boolean }[]}  in order, nothing empty
 */
export function messageParts(message) {
  const parts = [];
  let at = 0;
  for (const { start, end } of linkRanges(message)) {
    parts.push({ text: message.slice(at, start), link: false }, { text: message.slice(start, end), link: true });
    at = end;
  }
  parts.push({ text: message.slice(at), link: false });
  return parts.filter((part) => part.text);
}
