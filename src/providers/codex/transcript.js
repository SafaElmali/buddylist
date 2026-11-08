// Codex's persisted thread items, read as the same entries its live sessions show.
// Text stays untrusted data: the conversation renderer handles it as any other reply.
import { truncateOutput } from '../base-session.js';
import { toTools, toResult } from './activity.js';

export const ENTRY_LIMIT = 2000;

/** Keep the newest entries, saying when earlier messages were left out. */
export function newestEntries(entries, limit = ENTRY_LIMIT, earlier = false) {
  const kept = entries.slice(-limit);
  if ((!earlier && entries.length <= limit) || !kept.length) return kept;
  return [
    { id: `${kept[0].id}:earlier`, time: kept[0].time, kind: 'notice', text: 'Earlier messages are not shown.' },
    ...kept,
  ];
}

/**
 * @param {{ id: string, createdAt: number, turns: any[] }} thread  oldest turn first
 * @param {{ limit?: number }} [opts]
 * @returns {import('../../main/storage/history.js').HistoryEntry[]}
 */
export function toEntries(thread, { limit = ENTRY_LIMIT } = {}) {
  const entries = [];
  for (const turn of thread.turns || []) {
    const time = (turn.startedAt ?? thread.createdAt ?? 0) * 1000;
    const add = (id, entry) => entries.push({ id: `${thread.id}:${turn.id}:${id}`, time, ...entry });
    for (const item of turn.items || []) {
      if (item.type === 'userMessage') {
        const text = (item.content || [])
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n\n');
        const images = (item.content || []).filter((part) => ['image', 'localImage'].includes(part.type)).length;
        // Never fetch remote images or open local paths from a transcript.
        if (text.trim() || images) add(item.id, { kind: 'user', text, images });
      } else if (item.type === 'agentMessage' && item.text?.trim()) {
        add(item.id, { kind: 'assistant', text: item.text });
      } else if (item.type === 'contextCompaction') {
        add(item.id, { kind: 'notice', text: 'Codex tidied up the conversation (compacted earlier messages).' });
      } else {
        const result = toResult(item);
        for (const { toolId, activity } of toTools(item)) {
          add(toolId, { kind: 'tool', toolId, activity, sub: false, ...result, output: truncateOutput(result.output) });
        }
      }
    }
    if (turn.status === 'failed' && turn.error?.message) add('error', { kind: 'error', text: turn.error.message });
    if (turn.status === 'interrupted') add('stopped', { kind: 'result', stopped: true });
  }
  return newestEntries(entries, limit);
}
