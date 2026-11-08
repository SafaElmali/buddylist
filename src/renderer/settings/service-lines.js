// What the lines of Services, Models and New contacts say of each service: how its program stands and which
// program it is, which models Add a Contact offers for it, such as "Opus 5.5, Sonnet 5.5, Haiku 5.5", and what a new
// contact of it starts out with, such as "Sonnet 5.5 · High effort · Asks first".
import { statusText } from '../onboarding/setup.js';
import { currentModel, defaultNamed, effortLabel } from '../../shared/models.js';

/**
 * @param {import('../../providers/setup.js').Setup & { custom?: boolean } | undefined} setup  how it stands; none
 *   while it is being asked
 * @param {string} path  the program typed in Settings; '' for the one the app finds
 */
export function serviceLine(setup, path) {
  if (!setup) return 'Checking installation...';
  if (setup.state === 'unknown') return `Couldn’t check · ${setup.note || 'Try Check again.'}`;
  if (setup.state === 'missing') return path ? `Not found · ${path}` : 'Not installed · Open for setup instructions';
  const status = statusText({ ...setup, custom: false }).text;
  const found = setup.bundled
    ? `Claude Code${setup.version ? ` ${setup.version}` : ''} · Bundled`
    : [setup.path || path || 'Automatically detected', setup.version && `v${setup.version}`]
        .filter(Boolean)
        .join(' · ');
  return `${status} · ${found}`;
}

/**
 * @param {{ catalog: { id: string, label: string }[], shown: string[] }} models  as modelsOf gives them
 */
export const modelsLine = ({ catalog, shown }) =>
  shown.map((id) => catalog.find((model) => model.id === id)?.label ?? id).join(', ') || 'Only its default model';

/** What New contacts says of a service that picks none of them. */
export const LIKE_ADDED_FROM = 'Like the contact it’s added from';

/**
 * @param {import('../../providers/contract.js').ProviderDescriptor} provider
 * @param {import('../../shared/contact-defaults.js').ContactDefaults} picked  as defaultsOf gives them
 * @param {import('../../providers/contract.js').ModelOption[]} catalog  every model known for it, as modelsOf gives them
 */
export function newContactLine(provider, { model, effort, permissionMode }, catalog) {
  const usual = currentModel({ model: '', defaultModel: null }, catalog)?.label;
  const named = model
    ? (catalog.find((one) => one.id === model)?.label ?? model)
    : defaultNamed(usual, 'Default model');
  const mode = provider.permissionModes.find(({ id }) => id === permissionMode);
  return (
    [
      model !== undefined && named,
      effort !== undefined && (effort ? `${effortLabel(effort)} effort` : 'Default effort'),
      mode && (mode.short ?? mode.label),
    ]
      .filter(Boolean)
      .join(' · ') || LIKE_ADDED_FROM
  );
}
