/**
 * A turn that ended because this computer couldn't reach its provider at all: no answer came back, as when the
 * internet is down and the provider's name doesn't resolve, or the connection is refused or cut. It is told apart
 * from an outage the provider itself answers with (overloaded, a 5xx): another service is no help without the
 * internet, so no fallback takes over (see `failureKind` in contract.js), and the turn's line says what to do.
 */

/** The socket and DNS error codes a request that got no answer ends with, as Claude Code and Node name them. */
const NO_ANSWER = [
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'ConnectionRefused',
  'ConnectionClosed',
  'FailedToOpenSocket',
  'UND_ERR_SOCKET',
  'ERR_SOCKET_CLOSED',
];

const NAMED = new RegExp(`\\((?:${NO_ANSWER.join('|')})\\)`);

/**
 * Whether an error names one of them, as Claude Code's "Can't reach the API server — check your internet or DNS
 * (ENOTFOUND)" and "Connection dropped (ECONNRESET)" do.
 * @param {string} text
 */
export const namesNoAnswer = (text) => NAMED.test(text);

/**
 * What a turn's line says when it ended so: the provider's own words, then that the internet looks down. Without a
 * full stop at the end, as the line puts one after it.
 * @param {string} text
 */
export const offlineText = (text) =>
  [text.trim().replace(/[.\s]+$/, ''), 'Your internet connection looks down: send it again once it’s back']
    .filter(Boolean)
    .join('. ');
