// A service to continue with when another reports that its usage allowance is used up.
import { continueTodosMessage } from './todo-handoff.js';

/** Providers that currently report a confirmed usage-limit result. */
export const LIMIT_REPORTERS = ['claude', 'codex'];

// Cross-service approvals are deliberately conservative. These levels describe the broadest
// actions a mode can allow without asking: read, ask, edits, workspace commands, unrestricted.
// OpenCode Build depends on local configuration, and every Hermes mode runs ordinary commands
// without asking, so neither is a substitute for an ask-first or auto-edit permission grant.
const MODE_ACCESS = {
  claude: { plan: 0, default: 1, acceptEdits: 2, bypassPermissions: 4 },
  codex: { 'read-only': 0, ask: 1, auto: 3, 'full-access': 4 },
  gemini: { plan: 0, default: 1, autoEdit: 2, yolo: 4 },
  opencode: { plan: 0, build: 4 },
  hermes: { default: 4, accept_edits: 4, dont_ask: 4 },
};

/**
 * Whether one of a service's modes lets its agent do no more without asking than another of its modes. Unknown
 * services and modes are looser than anything.
 * @param {string} provider  the service's id
 * @param {string} mode
 * @param {string} than
 */
export function noLooser(provider, mode, than) {
  const access = MODE_ACCESS[provider]?.[mode];
  const ceiling = MODE_ACCESS[provider]?.[than];
  return typeof access === 'number' && typeof ceiling === 'number' && access <= ceiling;
}

/**
 * Known target modes that are no looser than the limited agent's mode, preferred first.
 * Unknown providers and modes fail closed. Codex's workspace grant becomes ask-first across services: file-edit modes
 * elsewhere do not preserve its sandbox boundary.
 * @param {import('../providers/contract.js').ProviderDescriptor} from
 * @param {string} mode
 * @param {import('../providers/contract.js').ProviderDescriptor} to
 * @returns {string[]}
 */
export function fallbackPermissionModes(from, mode, to) {
  if (!MODE_ACCESS[from.id] || !from.permissionModes.some((option) => option.id === mode)) return [];
  const ceiling = from.id === 'codex' && mode === 'auto' ? 1 : MODE_ACCESS[from.id]?.[mode];
  if (typeof ceiling !== 'number') return [];
  const access = (id) => MODE_ACCESS[to.id]?.[id];
  return to.permissionModes
    .map((option) => option.id)
    .filter((id) => typeof access(id) === 'number' && access(id) <= ceiling)
    .sort((a, b) => access(b) - access(a));
}

/**
 * The mode an agent of a service works in where it must change no files, as every guest of a manager's conversation
 * does, by the same measure: its service's mode that changes none. Claude has none it can stay in, as its plan mode
 * ends each turn in a plan to approve, so it asks before acting and its session takes away the tools that write
 * files (see `readOnly` on SessionContact). Null for a service with neither: every mode of Hermes runs commands
 * without asking.
 * @param {import('../providers/contract.js').ProviderDescriptor} provider
 * @returns {string | null}
 */
export function readOnlyPermissionMode(provider) {
  const access = (id) => MODE_ACCESS[provider.id]?.[id];
  if (provider.readOnlyMode && access(provider.readOnlyMode) === 0) return provider.readOnlyMode;
  return provider.permissionModes.find((option) => access(option.id) === 1)?.id ?? null;
}

/** @param {unknown} patch @param {string[]} providers */
export function cleanLimitFallbacks(patch, providers) {
  const value = patch?.limitFallbacks;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return {
    limitFallbacks: Object.fromEntries(
      Object.entries(value).filter(
        ([from, to]) =>
          LIMIT_REPORTERS.includes(from) && providers.includes(from) && providers.includes(to) && from !== to
      )
    ),
  };
}

/** @param {{ from: string, to: string, todos: import('../providers/contract.js').Todo[] }} about */
export function limitContinuation(about) {
  return (
    continueTodosMessage(about) ||
    `@${about.to} Continue the user's unfinished request in this conversation. Inspect the existing changes first, verify what is already complete, and pick up where the previous agent stopped. Track any remaining work in your own checklist.`
  );
}
