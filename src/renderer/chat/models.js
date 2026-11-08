// The model, effort and fast mode badges of the conversation window, the list its model
// is picked from, and the Effort menu. Nothing in here touches the page, so
// all of it is tested without a window.
import {
  EFFORT_BY_FIRST,
  MODELS_OWN_LEVEL,
  currentModel,
  defaultNamed,
  effortLabel,
  effortsOf,
  modelCatalog,
} from '../../shared/models.js';

/** @typedef {import('../../providers/contract.js').Participant} Participant */
/** @typedef {import('../../providers/contract.js').ModelOption} ModelOption */
/** @typedef {import('../lib/menu.js').MenuItem} MenuItem */
/** @typedef {{ catalog: ModelOption[], shown: string[] }} Models  every model known, and the ids of the ones to offer */

/**
 * The models someone can be given: the ones its session said it has, from a
 * provider that can only say so in a conversation, else what the window knows
 * of its provider's.
 * @param {Participant} who
 * @param {Models} known  the provider's own, as "Add a Contact" has them
 * @returns {Models}
 */
export function modelsFor(who, known) {
  if (!who.models.length) return known;
  // A session's list is offered whole: it is what can be set there, and there is no choosing from it.
  return { catalog: modelCatalog(who.provider, who.models), shown: who.models.map((model) => model.id) };
}

/**
 * The model someone answers with: its name where the list has it, else what
 * the contact was given.
 * @param {Participant} who
 * @param {ModelOption[]} catalog
 */
export const modelName = (who, catalog) => currentModel(who, catalog)?.label || who.model || 'Default model';

/** What the effort badge says of a level left to the model, where nobody says which that is. */
const DEFAULT_EFFORT = 'Default effort';

/**
 * The effort level someone answers with, as its badge next to the model's says
 * it. Left to the model, the badge says so, with the level that comes to where the
 * list says: "Default (High)". Null when there is none to choose: its model takes
 * no effort level, or its provider has none.
 * @param {Participant} who
 * @param {ModelOption[]} catalog
 */
export function effortName(who, catalog) {
  if (!effortsOf(who, who.provider, catalog).length) return null;
  if (who.effort) return effortLabel(who.effort);
  const usual = currentModel(who, catalog)?.defaultEffort;
  return usual ? defaultNamed(effortLabel(usual)) : DEFAULT_EFFORT;
}

/**
 * What the effort badge says when pointed at: also when the level is one the agents
 * picked for this conversation, and not the contact's own.
 * @param {Participant} who
 * @param {string | null} level  as its badge names it
 */
export function effortTitle(who, level) {
  if (!who.effort) return level && level !== DEFAULT_EFFORT ? `Effort: ${level}` : 'Effort: left to the model';
  return who.effortPicked ? `Effort: ${level}, picked for it in this conversation` : `Effort: ${level}`;
}

/**
 * The effort levels to choose from, with the current one checked: "Default" first, which leaves
 * it to the model, and is checked while it is. It names the level that comes to, where the
 * list says, and says it is the model's own where not. Empty when there is none to choose.
 * @param {Participant} who
 * @param {ModelOption[]} catalog
 * @param {(id: string | null) => void} choose
 * @returns {MenuItem[]}
 */
export function effortItems(who, catalog, choose) {
  const efforts = [...effortsOf(who, who.provider, catalog)];
  if (!efforts.length) return [];
  // The current level can be one the provider's usual ones leave out.
  if (who.effort && !efforts.includes(who.effort)) efforts.push(who.effort);
  const usual = currentModel(who, catalog)?.defaultEffort;
  return [
    {
      label: defaultNamed(usual && effortLabel(usual)),
      ...(!usual && { hint: MODELS_OWN_LEVEL }),
      checked: !who.effort,
      action: () => choose(null),
    },
    ...efforts.map((id) => ({ label: effortLabel(id), checked: id === who.effort, action: () => choose(id) })),
  ];
}

// ---- fast mode ---------------------------------------------------------------------------------

/** Why Claude Code says fast mode can't come on, by its reasons (see FastModeStatus), as the badge's title says it. */
const FAST_MODE_BLOCKED = {
  free: 'it needs a paid plan',
  extra_usage_disabled: 'it needs usage credits, and they are off for this account',
  network_error: 'Claude Code couldn’t check whether it’s available',
  not_first_party: 'it only works with an Anthropic login',
  disabled_by_env: 'an environment variable turns it off',
  preference: 'your organization turned it off',
  model_not_allowed: 'this model can’t have it',
  unknown: 'it’s unavailable right now',
};

// Some Codex catalog descriptions name only speed. Fast also consumes more usage:
// https://learn.chatgpt.com/docs/agent-configuration/speed
function codexFastDescription(model) {
  const description = model?.fastDescription || 'Faster answers';
  return /usage|credits|cost|price/i.test(description) ? description : `${description}; increased usage`;
}

/**
 * The fast mode badge: whether it is pressed, whether something holds fast mode back while it
 * is, and what it says when pointed at. Null for a model without fast mode, which has no badge.
 * @param {Participant} who
 * @param {ModelOption[]} catalog
 * @returns {{ pressed: boolean, held: boolean, title: string, disabled?: boolean } | null}
 */
export function fastModeBadge(who, catalog) {
  const model = currentModel(who, catalog);
  if (who.provider.id === 'codex') {
    if (!model?.fast) {
      const reason =
        model?.fastUnavailable || 'Codex has not reported Fast mode for this model. Refresh Models or update Codex.';
      return {
        pressed: Boolean(who.fastMode),
        held: Boolean(who.fastMode),
        disabled: !who.fastMode,
        title: `Fast mode unavailable. ${reason}${who.fastMode ? ' Turn off the saved preference here.' : ''}`,
      };
    }
    const state = who.fastModeInherited ? 'from your Codex settings' : who.fastMode ? 'on' : 'off';
    return {
      pressed: Boolean(who.fastMode),
      held: false,
      title: `Fast mode: ${state}. ${codexFastDescription(model)}`,
    };
  }
  if (!model?.fast) return null;
  if (!who.fastMode) return { pressed: false, held: false, title: 'Fast mode: off. Faster answers, at a higher price' };
  const { state, reason } = who.fastModeStatus || {};
  if (state === 'cooldown') {
    return { pressed: true, held: true, title: 'Fast mode: paused after a rate limit. It comes back on by itself' };
  }
  const why = state === 'off' && FAST_MODE_BLOCKED[reason];
  if (why)
    return { pressed: true, held: true, title: `Fast mode is on, but ${why}: Claude answers at its usual speed` };
  return { pressed: true, held: false, title: 'Fast mode: on. Faster answers, at a higher price' };
}

/** Fast mode's menu row and, when unavailable, its explanation. Shared by hosts, managers and guests. */
export function fastModeItems(who, catalog, choose, label = 'Fast mode') {
  const badge = fastModeBadge(who, catalog);
  if (!badge) return [];
  const model = currentModel(who, catalog);
  const codex = who.provider.id === 'codex';
  return [
    {
      label,
      checked: badge.pressed,
      ...(badge.disabled && { disabled: true }),
      ...(codex && {
        hint: !model?.fast
          ? 'Unavailable'
          : [who.fastModeInherited && 'From Codex settings', codexFastDescription(model)].filter(Boolean).join(' · '),
      }),
      action: () => !badge.disabled && choose(!who.fastMode),
    },
    ...(codex && !model?.fast ? [{ label: badge.title, note: true }] : []),
  ];
}

// ---- the badge under the conversation ----------------------------------------------------------

/**
 * A contact on its own has one badge under the conversation for its model, its effort level and
 * fast mode: "Opus 5.5 · High", with a bolt while fast mode is on. An effort level left to the
 * model goes unsaid. Pointed at, it says all three, and for a project's manager its service first.
 * Its menu is the Conversation menu's entries for them, after a manager's services (see badgeItems).
 * @param {Participant} who
 * @param {ModelOption[]} catalog
 * @param {{ service?: boolean }} [opts]  `service`: it is a project's manager, whose service the badge switches
 * @returns {{ label: string, bolt: boolean, held: boolean, title: string }}
 *   `held`: fast mode is on, but something holds it back
 */
export function answeringBadge(who, catalog, { service = false } = {}) {
  const name = modelName(who, catalog);
  const level = effortName(who, catalog);
  const fast = fastModeBadge(who, catalog);
  return {
    label: who.effort && level ? `${name} · ${level}` : name,
    bolt: Boolean(fast?.pressed),
    held: Boolean(fast?.held),
    title: [service && `Service: ${who.provider.name}`, `Model: ${name}`, level && effortTitle(who, level), fast?.title]
      .filter(Boolean)
      .join('\n'),
  };
}

/**
 * The services a project's manager can answer with, as its model badge lists them: each that can give it the
 * app's tools, with its own ticked. Picking another switches it (see switchProvider in main/conversations.js).
 * None for any other contact: it keeps its service, and a chat with another is a new contact or a chat tab.
 * @param {{ manages?: string }} contact  the conversation's
 * @param {Participant} who  its host, as the badge is its
 * @param {{ id: string, name: string, avatar: string, appTools?: boolean }[]} providers  every service there is
 * @param {(provider: { id: string, name: string }) => void} choose
 * @param {(avatar: string) => string} [icon]  a service's picture, as menus show it
 * @returns {MenuItem[]}
 */
export function serviceItems(contact, who, providers, choose, icon = () => '') {
  if (!contact.manages) return [];
  return providers
    .filter((provider) => provider.appTools)
    .map((provider) => ({
      label: provider.name,
      icon: icon(provider.avatar),
      checked: provider.id === who.provider.id,
      // Its own is no switch.
      action: () => provider.id !== who.provider.id && choose(provider),
    }));
}

/**
 * What the badge under the conversation opens: a manager's services, then the Conversation menu's entries for the
 * model, the effort level and fast mode. Null where that is the model alone: the badge goes straight to the list of
 * models then.
 * @param {MenuItem[]} services  see serviceItems
 * @param {MenuItem[]} answering  the Conversation menu's entries, the model's first
 * @returns {MenuItem[] | null}
 */
export function badgeItems(services, answering) {
  if (services.length) return [...services, { separator: true }, ...answering];
  return answering.length > 1 ? answering : null;
}

// ---- the agents picking their effort themselves ----------------------------------------------
// `effortBy` on a conversation's contact says who picks the effort levels before a message is
// answered: one of the agents in it, by its id, or whoever answers first. Unset, you do. A
// contact on its own picks for itself, so there it is only on or off.

/**
 * Who picks the effort levels, as the menu says it next to its entry.
 * @param {Participant[]} participants
 * @param {string | null} [effortBy]
 */
export function effortByLabel(participants, effortBy) {
  if (!effortBy) return 'Off';
  return participants.find((p) => p.id === effortBy)?.name || 'Whoever answers first';
}

/**
 * The choice of who picks the effort levels: nobody but you, whoever answers first, or one
 * of the agents here. The current one is checked.
 * @param {Participant[]} participants
 * @param {string | null | undefined} effortBy
 * @param {(who: string | null) => void} choose
 * @returns {MenuItem[]}
 */
export function effortByItems(participants, effortBy, choose) {
  const current = participants.some((p) => p.id === effortBy) ? effortBy : effortBy && EFFORT_BY_FIRST;
  const item = (label, who) => ({ label, checked: who === (current || null), action: () => choose(who) });
  return [
    item('Off', null),
    item('Whoever answers first', EFFORT_BY_FIRST),
    ...participants.map((p) => item(p.name, p.id)),
  ];
}

/**
 * The Effort menu's entry for it: a list to choose who picks from, with several agents here,
 * and for a contact on its own a tick to turn it on or off.
 * @param {Participant[]} participants
 * @param {string | null | undefined} effortBy
 * @param {(who: string | null) => void} choose
 * @returns {MenuItem}
 */
export function effortByEntry(participants, effortBy, choose) {
  if (participants.length > 1) {
    return {
      label: `Let the agents decide: ${effortByLabel(participants, effortBy)}`,
      submenu: effortByItems(participants, effortBy, choose),
    };
  }
  return {
    label: `Let ${participants[0].name} decide`,
    checked: Boolean(effortBy),
    action: () => choose(effortBy ? null : EFFORT_BY_FIRST),
  };
}

/**
 * The line in the conversation that says who picks the effort levels from now on.
 * @param {Participant[]} participants
 * @param {string | null} effortBy
 */
export function effortByNotice(participants, effortBy) {
  const [host] = participants;
  if (participants.length === 1) {
    return effortBy
      ? `${host.name} picks its own effort level now, before it starts on a message.`
      : 'The effort level is yours to set again.';
  }
  if (!effortBy) return 'The effort levels are yours to set again.';
  const who = participants.find((p) => p.id === effortBy)?.name || 'whoever answers first';
  return `The agents pick their own effort levels now: ${who} does, before they start on a message.`;
}
