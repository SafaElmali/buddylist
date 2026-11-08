// Explicit continuation of a manager's stopped workers. No provider is called to write a recap.
import { fallbackPermissionModes } from './limit-fallbacks.js';

export function handoverSource(host, participants, entries, { busy, folderExists }) {
  const unavailable = (reason) => ({ eligible: false, reason });
  if (host.archived) return unavailable('Archived');
  if (!folderExists) return unavailable('Folder unavailable');
  if (busy) return unavailable('Working or waiting for approval');
  if (participants.some((one) => one.specialist && !one.paused && !one.afterChanges))
    return unavailable('Pause the active specialist before handing over');
  const general = participants.filter((one) => !one.specialist);
  const active = general.filter((one) => !one.paused);
  const last = entries.findLast((entry) => entry.kind === 'result');
  const lastAgent = general.find((one) => one.id === (last?.speaker ?? host.id));
  const source = lastAgent ?? active[0] ?? general[0];
  if (!source) return unavailable('Specialist agents need an individual handoff');
  const result = entries.findLast((entry) => entry.kind === 'result' && (entry.speaker ?? host.id) === source.id);
  const todos =
    entries.findLast((entry) => entry.activity?.kind === 'todo' && (entry.speaker ?? host.id) === source.id)?.activity
      .todos ?? [];
  if (!entries.some((entry) => entry.kind === 'user' && !entry.text?.startsWith('/')))
    return unavailable('No task to continue');
  const limited = result?.usageLimited;
  const stopped = result?.stopped || result?.isError;
  if (!limited && !stopped && result && !todos.some((todo) => todo.status !== 'completed'))
    return unavailable('Completed; no unfinished checklist');
  if (!limited && !stopped && !source.paused) return unavailable('Idle; pause this agent before handing over');
  return {
    eligible: true,
    reason: limited ? 'Usage limit' : stopped ? 'Stopped' : 'Paused',
    source: { ...source, otherActive: active.filter((one) => one.id !== source.id) },
    todos,
  };
}

export function handoverModes(source, target) {
  const modes = fallbackPermissionModes(source.provider, source.permissionMode, target);
  // Extra restrictions enforced by a session must survive as well as its visible mode.
  return source.readOnly ? modes.filter((mode) => mode === target.readOnlyMode) : modes;
}

export function handoverTarget(source, target) {
  if (!source) return 'No stopped agent to continue';
  if (source.provider.id === target.id) return `Already using ${target.name}`;
  if (source.otherActive?.some((one) => one.provider.id !== target.id) || source.otherActive?.length > 1)
    return 'Multiple active agents; pause the others first';
  if (!handoverModes(source, target).length) return 'No equally restrictive permission mode';
  return '';
}
