// Upgrades conversation history saved by older versions. Claude Messenger 0.1
// stored raw Claude Code tool names instead of provider-neutral activities.
import { toActivity } from './activity.js';

// Before the Helpers tab, a call that asked for a helper was saved with what Claude Code
// handed Claude back at once: a note that the helper was started, not what it found.
const STARTED_NOTE = /^Async agent launched successfully\b/;

export function upgradeHistoryEntry(entry) {
  if (entry.kind === 'claude') return { ...entry, kind: 'assistant' };
  if (entry.kind === 'tool' && entry.activity?.kind === 'delegate' && STARTED_NOTE.test(entry.output || '')) {
    return { ...entry, output: '' };
  }
  if ((entry.kind === 'tool' || entry.kind === 'permission') && !entry.activity && (entry.name || entry.toolName)) {
    const { name, toolName, input, ...rest } = entry;
    return { ...rest, activity: toActivity(name || toolName, input) };
  }
  return entry;
}
