// The Teams page: roles, the agents kept to work alongside a contact, such as a reviewer that looks over
// every change, and teams of them, which join a new contact's conversation together (see shared/teams.js).
// Each role and each team is a line that says how it is set up, and opens its settings under it, one at a
// time. Every change is saved as it is made. Under them, how many turns the agents in a conversation take
// on one message (see shared/turn-limit.js).
import { choicePicker } from '../lib/combo.js';
import { confirmDialog } from '../lib/dialog.js';
import { el, html } from '../lib/dom.js';
import { effortPicker, modelPicker, servicePicker } from '../contacts/model-picker.js';
import { askModels } from '../contacts/models.js';
import { effortLabel } from '../../shared/models.js';
import { ANSWERS, ROLE_NAME_MAX, newRoleId, roleMode, roleModeChoices, roleModeNote } from '../../shared/teams.js';
import { DEFAULT_TURN_LIMIT, TURN_LIMITS } from '../../shared/turn-limit.js';
import {
  button,
  choice,
  codeBox,
  field,
  fields,
  foldList,
  group,
  groupWithButton,
  pickerField,
  row,
  textBox,
  toggle,
} from './controls.js';

/** @typedef {import('../../shared/teams.js').Role} Role */
/** @typedef {import('../../shared/teams.js').Team} Team */

/**
 * What a role's line says of how it is set up, such as "Codex · gpt-5.5 · High effort · Answers after
 * changes · Read only · Never asks". A model, an effort and a mode that are the default go unsaid, and so does a mode
 * Read only keeps it out of.
 * @param {Role} role
 * @param {import('../../providers/contract.js').ProviderDescriptor[]} providers
 */
export function roleSummary(role, providers) {
  const provider = providers.find((one) => one.id === role.provider) ?? providers[0];
  const mode =
    provider && role.permissionMode && roleMode(role, provider) === role.permissionMode
      ? provider.permissionModes.find(({ id }) => id === role.permissionMode)?.short
      : '';
  return [
    provider?.name,
    role.model,
    role.effort && `${effortLabel(role.effort)} effort`,
    ANSWERS.find(({ id }) => id === role.answers)?.short,
    role.readOnly && 'Read only',
    mode,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * What a team's line says: its roles, in the order they join.
 * @param {Team} team
 * @param {Role[]} roles
 */
export function teamSummary(team, roles) {
  const names = team.roles.map((id) => roles.find((role) => role.id === id)?.name).filter(Boolean);
  return names.join(', ') || 'No roles yet';
}

/**
 * What to ask before a change to a role that has its agent run commands unasked, as a conversation's mode badge asks:
 * a mode that never asks picked, in force (see roleMode), or Read only turned off under one, which then changes files
 * too. With Read only on, its commands still change no files, as its service keeps them in a sandbox that writes
 * nothing. Null where there is nothing to ask.
 * @param {Role} role  as it is
 * @param {Partial<Role>} patch  the change
 * @param {import('../../providers/contract.js').ProviderDescriptor} provider  the role's service
 * @returns {{ message: string, ok: string } | null}
 */
export function riskOfChange(role, patch, provider) {
  const next = { ...role, ...patch };
  const [was, is] = [roleMode(role, provider), roleMode(next, provider)];
  const unlocked = role.readOnly && !next.readOnly;
  if (!provider.permissionModes.find(({ id }) => id === is)?.danger || (is === was && !unlocked)) return null;
  const name = next.name || 'This role';
  return next.readOnly
    ? {
        message: `${name} will run commands without asking.\nRead only keeps them in a sandbox that can't change files.`,
        ok: 'Turn off prompts',
      }
    : {
        message: `${name} will run commands and change files without asking.\nOnly do this in a folder you don't mind breaking.`,
        ok: unlocked ? 'Turn off Read only' : 'Turn off prompts',
      };
}

/** A line of its own at the end of what is open, for the button that takes it out. @param {HTMLElement} remove */
const foot = (remove) => {
  const node = row(remove);
  node.classList.add('st-fold-foot');
  return node;
};

/** @param {import('./main.js').PageContext} ctx */
export function teamsPage(ctx) {
  const { providers, save } = ctx;
  // What the page shows, sent whole with each change. A role still without a name stays here, and is left
  // out of what is kept until it has one.
  /** @type {Role[]} */
  let roles = (ctx.settings.roles ?? []).map((role) => ({ ...role }));
  /** @type {Team[]} */
  let teams = (ctx.settings.teams ?? []).map((team) => ({ ...team, roles: [...team.roles] }));
  const named = () => roles.filter((role) => role.name.trim());

  // A role that was renamed or taken out changes what the teams are made of: they are drawn as they are kept now.
  const saveRoles = async () => {
    if (await save({ roles })) teams = (ctx.settings.teams ?? []).map((team) => ({ ...team, roles: [...team.roles] }));
    teamList.draw();
  };
  const saveTeams = () => save({ teams });

  /**
   * @param {Role} role
   * @param {{ label: () => void, redraw: () => void }} line
   */
  function roleSettings(role, { label, redraw }) {
    const provider = providers.find((one) => one.id === role.provider) ?? providers[0];
    const change = (patch) => {
      Object.assign(role, patch);
      label();
      return saveRoles();
    };
    // Picked as Add a Contact picks them. Another model keeps the level only where it takes it (see effortPicker).
    const model = pickerField('Model', {
      value: role.model,
      kind: 'model',
      make: (combo, input) => modelPicker(combo, input, () => provider),
      onSave: (id) => {
        effort.show();
        change({ model: id.trim(), effort: effort.input.value });
      },
    });
    const effort = pickerField('Effort', {
      value: role.effort,
      kind: 'effort',
      make: (combo, input) =>
        effortPicker(combo, input, { provider: () => provider, model: () => model.input.value, picked: role.effort }),
      onSave: (level) => change({ effort: level }),
    });
    // A change that has its agent run commands unasked is confirmed first, as a conversation's mode badge does.
    const allowed = async (patch) => {
      const risk = riskOfChange(role, patch, provider);
      return !risk || confirmDialog(risk.message, { ok: risk.ok });
    };
    // Picked from the service's modes, named as a contact's mode picker names them, after the default. What a mode
    // comes to is said under it.
    const modeNote = el('<p class="st-hint st-mode-note"></p>');
    const showMode = () => {
      mode.show();
      const note = roleModeNote(role, provider);
      modeNote.textContent = note?.text ?? '';
      modeNote.className = `${note?.warning ? 'st-warning' : 'st-hint'} st-mode-note`;
      modeNote.hidden = !note;
    };
    const mode = pickerField('Permission', {
      value: role.permissionMode,
      kind: 'mode',
      make: (combo, input) => choicePicker(combo, input, () => roleModeChoices(role, provider)),
      onSave: async (id) => {
        if (!(await allowed({ permissionMode: id }))) {
          mode.input.value = role.permissionMode;
          showMode();
          return;
        }
        change({ permissionMode: id });
        showMode();
      },
    });
    showMode();
    const readOnly = toggle({
      label: 'Read only',
      hint: 'It doesn’t change files, in any mode. Claude goes without the tools that write files, and Claude and Codex run its commands in a sandbox that writes nothing. Gemini and OpenCode work in Plan, and Hermes asks before changing a file and is told no.',
      checked: role.readOnly,
      // What the default comes to, and what the mode picked does, changes with it. Turned off under a mode that never
      // asks, it changes files unasked from then on: that is asked first, and it stays on if not.
      onChange: async (on) => {
        // The switch shows what holds while it is asked.
        const box = /** @type {HTMLInputElement} */ (readOnly.querySelector('input'));
        box.checked = role.readOnly;
        if (!(await allowed({ readOnly: on }))) return;
        box.checked = on;
        change({ readOnly: on });
        showMode();
      },
    });
    // What the service calls its models, and which levels each takes, arrive a moment later. If it can't say, the
    // names known so far stay.
    askModels(provider).then(
      () => {
        model.show();
        effort.show();
      },
      () => {}
    );
    return [
      field(
        'Name',
        textBox({
          value: role.name,
          placeholder: 'Such as Reviewer',
          label: 'Name',
          maxlength: ROLE_NAME_MAX,
          // Its line says the name as it is typed. It is kept once you leave the box.
          onInput: (value) => {
            role.name = value.trim();
            label();
          },
          onSave: (value) => change({ name: value.trim() }),
        })
      ),
      fields(
        providers.length > 1 &&
          pickerField('Service', {
            value: provider.id,
            kind: 'service',
            make: (combo, input) => servicePicker(combo, input, providers),
            // Another service has models, levels and modes of its own: its settings are drawn again for it. A mode
            // it hasn't goes back to the default.
            onSave: async (id) => {
              const next = providers.find((one) => one.id === id);
              const kept = next?.permissionModes.some((one) => one.id === role.permissionMode);
              await change({ provider: id, model: '', effort: '', permissionMode: kept ? role.permissionMode : '' });
              redraw();
            },
          }).node,
        model.node,
        effort.node
      ),
      // One to a line: what the modes say is long.
      fields(mode.node),
      modeNote,
      group(
        'Answers',
        'When it answers a message that mentions nobody. Mentioned with @, it always does.',
        row(
          choice({
            value: role.answers,
            label: 'Answers',
            options: ANSWERS.map(({ id, label: words }) => ({ value: id, label: words })),
            onSave: (answers) => change({ answers }),
          })
        )
      ),
      readOnly,
      group(
        'Instructions',
        'What it is told, after what its project tells every agent. A change holds from its next conversation.',
        codeBox({
          value: role.rules,
          label: 'Instructions',
          placeholder: 'Review what the others changed, and hand back what has to change.',
          rows: 4,
          prose: true,
          onSave: (rules) => change({ rules: rules.trim() }),
        })
      ),
      foot(
        button(
          'Remove role',
          () => {
            roles = roles.filter((one) => one !== role);
            roleList.draw();
            saveRoles();
          },
          { kind: 'danger' }
        )
      ),
    ];
  }

  /**
   * @param {Team} team
   * @param {{ label: () => void }} line
   */
  function teamSettings(team, { label }) {
    const checks = el('<div class="st-checks"></div>');
    const boxes = named().map((role) => {
      const check = el(html`<label class="st-check"><input type="checkbox" /><span>${role.name}</span></label>`);
      const box = /** @type {HTMLInputElement} */ (check.querySelector('input'));
      box.checked = team.roles.includes(role.id);
      checks.append(check);
      return { role, box };
    });
    // In the order the roles are listed in: the order they join in, and answer in.
    checks.addEventListener('change', () => {
      team.roles = boxes.filter(({ box }) => box.checked).map(({ role }) => role.id);
      label();
      saveTeams();
    });
    if (!boxes.length) checks.append(el('<span class="st-list-empty">Add a role above first.</span>'));
    const rename = (value) => {
      team.name = value.trim();
      label();
    };
    return [
      field(
        'Name',
        textBox({
          value: team.name,
          placeholder: 'Such as With a reviewer',
          label: 'Team name',
          maxlength: ROLE_NAME_MAX,
          onInput: rename,
          onSave: (value) => {
            rename(value);
            saveTeams();
          },
        })
      ),
      group('Roles', '', checks),
      foot(
        button(
          'Remove team',
          () => {
            teams = teams.filter((one) => one !== team);
            teamList.draw();
            saveTeams();
          },
          { kind: 'danger' }
        )
      ),
    ];
  }

  const roleList = foldList({
    items: () => roles,
    name: (role) => role.name || 'New role',
    summary: (role) => roleSummary(role, providers),
    settings: roleSettings,
    empty: 'No roles yet.',
  });
  const teamList = foldList({
    items: () => teams,
    name: (team) => team.name || 'New team',
    summary: (team) => teamSummary(team, roles),
    settings: teamSettings,
    empty: 'No teams yet.',
  });

  // A new one goes at the end, as the order is the one they join in, and opens with its name to type.
  const addRole = button(
    'Add role',
    () => {
      const role = {
        id: newRoleId(),
        name: '',
        provider: providers[0]?.id ?? '',
        model: '',
        effort: '',
        answers: 'always',
        readOnly: false,
        permissionMode: '',
        rules: '',
      };
      roles.push(role);
      roleList.show(role.id)?.querySelector('input').focus();
    },
    { kind: 'primary' }
  );
  const addTeam = button(
    'Add team',
    () => {
      const team = { id: newRoleId(), name: '', roles: [] };
      teams.push(team);
      teamList.show(team.id)?.querySelector('input').focus();
    },
    { kind: 'primary' }
  );

  return [
    groupWithButton(
      'Roles',
      'An agent to work alongside a contact. It joins under its name, which is how you and the others mention it.',
      addRole,
      roleList.node
    ),
    groupWithButton(
      'Teams',
      'Roles that join a new contact’s conversation together. Pick one under Team in Add a Contact.',
      addTeam,
      teamList.node
    ),
    group(
      'Fallbacks',
      'Choose automatic continuation, allowance conditions, and paid usage separately.',
      button('Open Fallbacks', () => ctx.go('fallbacks'))
    ),
    group(
      'Hand-offs',
      'How many turns the agents in a conversation take on one message of yours, hand-offs included. Then they wait for your next message.',
      row(
        choice({
          value: String(ctx.settings.turnLimit),
          label: 'Turns per message',
          options: TURN_LIMITS.map((limit) => ({
            value: String(limit),
            label: limit === DEFAULT_TURN_LIMIT ? `${limit} turns (default)` : `${limit} turns`,
          })),
          onSave: (limit) => save({ turnLimit: Number(limit) }),
        })
      )
    ),
  ];
}
