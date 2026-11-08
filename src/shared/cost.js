// What a turn cost. A provider that reports money gives each result its
// session's running total, not the price of that turn (see the contract).

/**
 * @param {number} previous  the total the result before this one carried; 0 if there was none
 * @param {number} total     the total this result carries
 * @returns {number} US dollars this turn added
 */
export function turnCost(previous, total) {
  // A total that went down has started over: a new session.
  return total >= previous ? total - previous : total;
}

/**
 * A turn that said what it cost.
 * @typedef {Object} Turn
 * @property {number} time   when its result came
 * @property {number} usd    US dollars it added
 * @property {number} total  the running total its result carried
 * @property {string | undefined} id  the original result's id, also kept by forks
 * @property {string | undefined} speaker
 * @property {boolean} legacyCopy  copied by a version that did not keep the original result's id
 */

/**
 * What each turn of a conversation cost, oldest first. A guest in the conversation has a session,
 * and so a total, of its own: its results say whose they are in `speaker`.
 * @param {{ kind: string, time: number, id?: string, costOrigin?: string, costReset?: boolean, sessionReset?: boolean, text?: string, costUsd?: number, speaker?: string }[]} entries  oldest first
 * @returns {Turn[]}  only the turns whose result carried a cost
 */
export function turnCosts(entries) {
  /** speaker -> the total its latest result carried. The host's results name no speaker. */
  const totals = new Map();
  const turns = [];
  // Older forks have only this notice; newer ones mark the boundary explicitly too.
  const forkBoundary = (entry) =>
    entry.kind === 'notice' && (entry.costReset || /^Forked from .+’s conversation\.$/s.test(entry.text || ''));
  const forkAt = entries.findLastIndex(forkBoundary);
  for (const [index, entry] of entries.entries()) {
    if (forkBoundary(entry) || (entry.kind === 'notice' && entry.sessionReset)) totals.clear();
    const total = entry.costUsd;
    // A result without a cost (Codex, a crashed turn) says nothing about the total.
    if (entry.kind !== 'result' || !Number.isFinite(total) || !(total > 0)) continue;
    turns.push({
      time: entry.time,
      usd: turnCost(totals.get(entry.speaker) || 0, total),
      total,
      id: entry.costOrigin || entry.id,
      speaker: entry.speaker,
      legacyCopy: index < forkAt && !entry.costOrigin,
    });
    totals.set(entry.speaker, total);
  }
  return turns;
}
