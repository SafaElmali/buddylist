import { fallbacksPage } from './fallbacks.js';
// The Settings pages of one project: an overview of where it is and how it is set
// up, its scripts, what its agents are told, where its worktrees start and what they
// get, its variables, and its manager. Every contact working on the project shares
// them, in whichever worktree.
import { api } from '../lib/api.js';
import { el, errorText, html } from '../lib/dom.js';
import { effortPicker, modelPicker, servicePicker } from '../contacts/model-picker.js';
import { askModels } from '../contacts/models.js';
import { CHECKS, NEW_WORKERS, WORKER_MODES, cleanWorkers, switchedTo } from '../../shared/managers.js';
import { newScriptId } from '../../shared/project-settings.js';
import { PROJECT_SETTINGS } from '../../shared/settings-pages.js';
import {
  button,
  choice,
  codeBox,
  field,
  fields,
  foldList,
  group,
  groupWithButton,
  listEditor,
  pageLinks,
  pickerField,
  row,
  toggle,
} from './controls.js';
import { addAnotherManager, addProjectManager } from '../contacts/manager-dialog.js';
import { managerServiceDialog } from '../contacts/manager-service-dialog.js';
import { environmentGroups } from './environment.js';
import { NOTHING_FOUND, fillGroup } from './fill-scripts.js';
import { instructionGroups } from './instructions.js';
import {
  environmentLine,
  everyProjectLine,
  instructionsLine,
  managerLine,
  scriptsLine,
  worktreesLine,
} from './project-lines.js';

/** @typedef {import('./main.js').PageContext} PageContext */

const isRepository = (project) => project.key.startsWith('git:');

// ---- Overview ------------------------------------------------------------------------------

/** A folder, with what opens it in Finder (or the file manager). */
const folder = (project, path, which, said) =>
  row(
    el(html`<span class="st-path" title="${path}">${path}</span>`),
    button('Open', () => api.projects.reveal(project.key, which).catch((err) => said(errorText(err), true)))
  );

/** @param {PageContext} ctx */
function overview({ project, settings: app, said, go }) {
  const { settings } = project;
  const working = project.contacts === 1 ? '1 contact works on it' : `${project.contacts || 'No'} contacts work on it`;
  // Outside a repository there are no worktrees to start, and no manager to oversee them.
  const repository = isRepository(project);
  return [
    // How it is set up comes first: it is what the page is opened for, and in a small window it is in view.
    group(
      'Set up',
      repository
        ? `${working}, each in a worktree of its own. Each line says how a page is set, and opens it.`
        : `A folder outside any git repository: ${working.replace('on it', 'in it')} as it is, so it has no worktrees and no manager. Each line says how a page is set, and opens it.`,
      pageLinks(
        [
          { id: 'scripts', label: 'Scripts', value: scriptsLine(settings) },
          { id: 'instructions', label: 'Instructions', value: instructionsLine(settings, app.instructions) },
          repository && { id: 'project-git', label: 'Worktrees', value: worktreesLine(settings) },
          { id: 'project-environment', label: 'Environment', value: environmentLine(settings) },
          {
            id: 'project-fallbacks',
            label: 'Fallbacks',
            value:
              settings.fallbacks == null
                ? 'Global rules'
                : settings.fallbacks.enabled
                  ? `${settings.fallbacks.entries.length} entries`
                  : 'Off for this project',
          },
          repository && { id: 'manager', label: 'Manager', value: managerLine(settings, project.managers) },
        ]
          .filter(Boolean)
          .map(({ id, ...line }) => ({ ...line, go: () => go(id) }))
      )
    ),
    group(
      repository ? 'Main checkout' : 'Folder',
      repository ? 'Where the project is. A contact’s worktree is made from it.' : 'Where the project is.',
      folder(project, project.root, 'root', said)
    ),
    project.worktrees &&
      group(
        'Worktrees',
        'Where its contacts’ worktrees are. Delete a contact to remove its worktree, not the folder.',
        folder(project, project.worktrees, 'worktrees', said)
      ),
  ];
}

// ---- Worktrees -----------------------------------------------------------------------------

/** @param {PageContext} ctx */
function git({ project, saveProject }) {
  const from = el('<div class="st-row"></div>');
  const remote = el('<div class="st-row"></div>');

  // The remote is asked which branches it has. Until it answers, and when it can't, what is picked stands alone.
  const draw = async () => {
    const known = await api.projects
      .remotes(project.key)
      .catch(() => ({ remotes: [], branches: [], defaultBranch: null }));
    // As they are now: picking a remote changes both.
    const { settings } = project;
    const using = settings.remote || 'origin';
    from.replaceChildren(
      choice({
        value: settings.base,
        label: 'Start new worktrees from',
        options: [
          { value: '', label: `The remote’s main line${known.defaultBranch ? ` (${known.defaultBranch})` : ''}` },
          ...known.branches.map((branch) => ({ value: branch, label: branch })),
        ],
        onSave: (base) => saveProject({ base }),
      })
    );
    remote.replaceChildren(
      choice({
        value: using,
        label: 'Remote',
        options: [...new Set(['origin', ...known.remotes])].map((name) => ({ value: name, label: name })),
        // Another remote has other branches: the one picked for the first no longer says anything.
        onSave: async (name) => {
          if (await saveProject({ remote: name === 'origin' ? '' : name, base: '' })) draw();
        },
      })
    );
  };
  draw();

  return [
    group(
      'Start new worktrees from',
      'Each new contact gets a worktree of its own, on a new branch that starts here. The branch is fetched first, so the contact starts from what the remote has now.',
      from
    ),
    group('Remote', 'Where that branch, and a pull request you start a contact from, is fetched from.', remote),
    filesToCopy({ project, saveProject }),
  ];
}

/** @param {Pick<PageContext, 'project' | 'saveProject'>} ctx */
function filesToCopy({ project, saveProject }) {
  const { settings } = project;
  const matching = el('<span class="st-hint"></span>');
  // Which files a new worktree would get, for the patterns as they are now.
  const look = async (patterns) => {
    if (!String(patterns).trim()) return (matching.textContent = '');
    matching.textContent = 'Looking...';
    try {
      const { count, files } = await api.projects.files(project.key, patterns);
      const more = count > files.length ? `, and ${count - files.length} more` : '';
      matching.textContent = count
        ? `${count === 1 ? '1 file matches' : `${count} files match`}: ${files.join(', ')}${more}`
        : 'No file in the main checkout matches yet.';
    } catch (err) {
      matching.textContent = errorText(err);
    }
  };
  look(settings.copyFiles.join('\n'));
  return group(
    'Files to copy',
    html`Files git does not keep that every new worktree needs a copy of, from the main checkout. One pattern on each
      line, such as <code>.env*</code>.`,
    codeBox({
      value: settings.copyFiles.join('\n'),
      label: 'Files to copy',
      placeholder: '.env*',
      rows: 3,
      onSave: async (patterns) => {
        if (await saveProject({ copyFiles: patterns })) look(patterns);
      },
    }),
    matching
  );
}

// ---- Environment ---------------------------------------------------------------------------

/** @param {PageContext} ctx */
function environment({ project, settings, saveProject }) {
  const shared = (settings.env ?? []).map((variable) => variable.name);
  return [
    ...environmentGroups({
      env: project.settings.env,
      envFiles: project.settings.envFiles,
      folder: project.root,
      save: saveProject,
    }),
    group(
      'From every project',
      shared.length
        ? 'Set under Every project > Environment. A variable of the same name above wins.'
        : 'Nothing yet. Variables set under Every project > Environment are passed to every project.',
      shared.length
        ? el(
            html`<ul class="st-names">
              ${shared.map((name) => html`<li>${name}</li>`)}
            </ul>`
          )
        : null
    ),
    group(
      'Always there',
      html`<code>PORT</code> is the contact’s own port, and <code>BUDDYLIST_ROOT_PATH</code> the project’s main
        checkout.`
    ),
  ];
}

// ---- Scripts -------------------------------------------------------------------------------

/** @param {PageContext} ctx */
function scripts(ctx) {
  const { project, saveProject } = ctx;
  const { settings, found } = project;
  // Leaving a box saves it asynchronously. Wait for that save before deciding what is empty.
  let saving = Promise.resolve(true);
  const saveScript = (patch) => (saving = saving.then(() => saveProject(patch)));
  return [
    fillGroup(ctx, () => saving),
    group(
      'Setup script',
      html`Runs in a contact’s new worktree, right after it is made: install what the project needs, or link it from the
        main checkout at <code>$BUDDYLIST_ROOT_PATH</code>. The contact’s conversation shows what it prints.`,
      codeBox({
        value: settings.setup,
        label: 'Setup script',
        // What Fill in from the project would put in it.
        placeholder: found.setup || NOTHING_FOUND,
        onSave: (setup) => saveScript({ setup }),
      })
    ),
    group(
      'Cleanup script',
      'Runs in a contact’s worktree before the worktree is removed: stop what the project left running, drop its database. It gets two minutes.',
      codeBox({
        value: settings.cleanup,
        label: 'Cleanup script',
        placeholder: found.cleanup || NOTHING_FOUND,
        onSave: (cleanup) => saveScript({ cleanup }),
      })
    ),
    group(
      'Run scripts',
      html`What the Run button starts in a contact’s folder: a dev server, a test watcher. The first one is the button’s
        own, and the others are under Tools in the conversation. Each contact has a port of its own in
        <code>$PORT</code>.`,
      listEditor({
        items: settings.scripts,
        fields: [
          { key: 'name', placeholder: 'Name' },
          {
            key: 'command',
            placeholder: found.run[0]?.command || NOTHING_FOUND,
            kind: 'code',
            label: 'Command',
          },
        ],
        add: 'Add script',
        empty: 'No run scripts yet. Add one, or press Run in a conversation to be asked.',
        // Its id from the start. One made when it is saved would be made again at every save, as the row
        // is sent without it, and a run of the script would no longer be found under its id.
        make: () => ({ id: newScriptId() }),
        onChange: (items) => saveScript({ scripts: items }),
      })
    ),
    group(
      'Preview URLs',
      html`Where a run is looked at. The first is the link in the run’s line, the others follow it. Leave it empty for
        <code>http://localhost:$PORT</code>. <code>$((PORT + 1))</code> names the ports after the contact’s own.`,
      listEditor({
        items: settings.previewUrls,
        fields: [
          { key: 'name', placeholder: 'Name' },
          { key: 'url', mono: true, placeholder: 'http://localhost:$PORT', label: 'Address' },
        ],
        add: 'Add preview URL',
        onChange: (items) => saveProject({ previewUrls: items }),
      })
    ),
  ];
}

// ---- Instructions --------------------------------------------------------------------------

/** @param {PageContext} ctx */
function instructions(ctx) {
  const { project, settings, saveProject, go } = ctx;
  return [
    ...instructionGroups(ctx, {
      told: () => project.settings.instructions,
      save: (instructions) => saveProject({ instructions }),
    }),
    // What every project is told comes first, and these after it, so they can add to it or say otherwise.
    group(
      'From every project',
      'Told before what each box here says, so this project’s own can add to it or say otherwise.',
      pageLinks([
        {
          label: 'Every project',
          value: everyProjectLine(settings.instructions),
          go: () => go('every-project-instructions'),
        },
      ])
    ),
  ];
}

// ---- Manager -------------------------------------------------------------------------------

/**
 * The model a Claude contact answers with, picked from the list "Add a Contact" has.
 * @param {import('../../providers/contract.js').ProviderDescriptor} claude
 * @param {string} value  '' for Claude's own default
 * @param {(model: string) => void} onSave
 */
function modelChoice(claude, value, onSave) {
  const input = /** @type {HTMLInputElement} */ (el(html`<input type="hidden" value="${value}" />`));
  const combo = /** @type {HTMLButtonElement} */ (
    el('<button type="button" class="combo model-combo" aria-label="Model" aria-haspopup="menu"></button>')
  );
  const show = modelPicker(combo, input, () => claude);
  // What Claude calls its models arrives a moment later. If it can't say, the names known so far stay.
  askModels(claude).then(show, () => {});
  input.addEventListener('change', () => onSave(input.value));
  return row(input, combo);
}

/**
 * New workers use and Permission mode: what the conversations a manager starts answer with. A service and model of your choosing are
 * picked with the pickers Add a Contact has, with an effort level where the model takes any.
 * @param {import('../../providers/contract.js').ProviderDescriptor[]} providers
 * @param {import('../../shared/managers.js').NewWorkers | undefined} kept
 * @param {(workers: import('../../shared/managers.js').NewWorkers) => void} onSave
 * @param {string} [managerService]  the manager's service: the modes a mode you pick is of, where the service is not one you pick
 */
export function newWorkersGroup(providers, kept, onSave, managerService = 'claude') {
  const workers = cleanWorkers(kept);
  let provider = (workers.use === 'picked' && providers.find((one) => one.id === workers.provider)) || providers[0];
  const service = pickerField('Service', {
    value: provider.id,
    kind: 'service',
    make: (combo, input) => servicePicker(combo, input, providers),
    onSave: (id) => {
      provider = providers.find((one) => one.id === id) ?? provider;
      model.input.value = '';
      model.show();
      effort.show('');
      learnModels();
      show();
      save();
    },
  });
  const model = pickerField('Model', {
    value: workers.use === 'picked' ? workers.model : '',
    kind: 'model',
    make: (combo, input) => modelPicker(combo, input, () => provider),
  });
  const effort = pickerField('Effort', {
    value: '',
    kind: 'effort',
    make: (combo, input) =>
      effortPicker(combo, input, {
        provider: () => provider,
        model: () => model.input.value,
        picked: (workers.use === 'picked' && workers.effort) || '',
      }),
  });
  const picked = fields(service.node, model.node, effort.node);
  // What the service calls its models, and which levels each takes, arrive a moment later.
  const learnModels = () =>
    askModels(provider).then(
      () => {
        model.show();
        effort.show();
      },
      () => {}
    );
  const hint = el('<p class="st-hint"></p>');
  const use = choice({
    value: workers.use,
    label: 'New workers use',
    options: NEW_WORKERS.map((one) => ({ value: one.id, label: one.label })),
    onSave: () => {
      show();
      save();
    },
  });
  // Permission mode: the modes of the service the workers are on. Where that is not one you pick, the manager's.
  const modeHint = el('<p class="st-hint"></p>');
  const modeService = () =>
    (use.value === 'picked' ? provider : providers.find((one) => one.id === managerService)) ?? provider;
  const modePick = /** @type {HTMLSelectElement} */ (el('<select class="input" aria-label="Mode"></select>'));
  const showModes = () => {
    const kept = modePick.value || (workers.mode === 'picked' ? workers.permissionMode : '') || '';
    modePick.replaceChildren(...modeService().permissionModes.map((one) => new Option(one.label, one.id)));
    modePick.value = modeService().permissionModes.some((one) => one.id === kept)
      ? kept
      : modeService().defaultPermissionMode;
  };
  const mode = choice({
    value: workers.mode ?? 'default',
    label: 'Permission mode',
    options: WORKER_MODES.map((one) => ({ value: one.id, label: one.label })),
    onSave: () => {
      show();
      save();
    },
  });
  const modeField = fields(field('Mode', modePick));
  const show = () => {
    hint.textContent = NEW_WORKERS.find((one) => one.id === use.value)?.hint ?? '';
    picked.hidden = use.value !== 'picked';
    modeHint.textContent = WORKER_MODES.find((one) => one.id === mode.value)?.hint ?? '';
    modeField.hidden = mode.value !== 'picked';
    if (!modeField.hidden) showModes();
  };
  const save = () => {
    const kept = {
      ...(mode.value === 'manager' && { mode: 'manager' }),
      ...(mode.value === 'picked' && { mode: 'picked', permissionMode: modePick.value }),
    };
    onSave(
      use.value === 'picked'
        ? {
            use: 'picked',
            provider: provider.id,
            model: model.input.value,
            ...(effort.input.value && { effort: effort.input.value }),
            ...kept,
          }
        : /** @type {import('../../shared/managers.js').NewWorkers} */ ({ use: use.value, ...kept })
    );
  };
  modePick.addEventListener('change', save);
  // The model picked says which levels there are, and the level stays only where the new one takes it.
  model.input.addEventListener('change', () => {
    effort.show();
    save();
  });
  effort.input.addEventListener('change', save);
  show();
  learnModels();
  const newWorkers = group(
    'New workers use',
    'What a conversation it starts answers with, such as one for a task it hands off. A model picked for overseeing, and the manager’s mode, are seldom what the work wants.',
    row(use),
    hint,
    picked
  );
  return [
    newWorkers,
    group(
      'Permission mode',
      'The mode the conversations it starts answer in. A mode you pick is your choice, and may ask less than the manager’s.',
      row(mode),
      modeHint,
      modeField
    ),
  ];
}

/**
 * What one of a project's managers is set up with, by its contact: one of the others, or else the first. With no
 * manager yet, what the first one starts with.
 * @param {import('../../main/project-settings.js').ProjectView} project
 * @param {string} [id]
 */
const settingsOf = (project, id) =>
  (id && project.settings.managers.find((one) => one.id === id)) || project.settings.manager;

/**
 * What a manager's line in the list says of it: whether it is on, its model, how many conversations are under it,
 * and its scope. A project manager's says how many managers it oversees.
 * @param {import('../../main/project-settings.js').ProjectView} project
 * @param {{ id: string, conversations: number, archived: boolean, leads?: boolean }} manager
 */
function managerSummary(project, manager) {
  const settings = settingsOf(project, manager.id);
  const managers = (project.managers ?? []).filter(
    (one) => !one.leads && !one.archived && settingsOf(project, one.id).on
  );
  const under = manager.leads
    ? `Project manager over ${managers.length === 1 ? '1 manager' : `${managers.length || 'no'} managers`}`
    : manager.conversations === 1
      ? '1 conversation'
      : `${manager.conversations || 'No'} conversations`;
  return [
    manager.archived ? 'Archived' : settings.on ? 'On' : 'Off',
    settings.provider || 'claude',
    settings.model || 'Default model',
    under,
    !manager.leads && settings.scope?.length ? `Scope ${settings.scope.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * What one manager is set up with, to change: whether it is on, its model, its scope, its sources, its checks,
 * its instructions and its brief. Each change is saved for it by its contact (see REQUESTS.projectUpdate).
 * @param {PageContext} ctx
 * @param {string} [id]  the manager, by its contact; the project's first, or the one it gets next, for none
 * @param {{ several?: boolean, lead?: boolean, changed?: () => void }} [opts]  `several`: the project has more than one.
 *   `lead`: it is the project's project manager, which oversees the managers: what it checks, its scope and its
 *   workers are none of its. `changed`: what it is set up with was saved
 */
function managerSettings(
  { project, providers, saveProject, said },
  id,
  { several = false, lead = false, changed = () => {} } = {}
) {
  // As it is when the change is made: the brief may have been saved by the manager meanwhile.
  const current = () => settingsOf(project, id);
  const change = async (patch) => {
    const saved = await saveProject({ manager: { ...current(), ...patch } });
    if (saved) changed();
    return saved;
  };
  const settings = current();

  // Where the manager is to be talked to, while it is on: a contact like any, on the list.
  const conversation = row(
    button('Open its conversation', async () => {
      const { contactId } = (await api.projects.manager({ project: project.key }).catch(() => null)) ?? {};
      if (id || contactId) api.chat.open(id || contactId);
    })
  );
  conversation.hidden = !settings.on;
  const turnedOn = toggle({
    label: lead
      ? 'It oversees the project’s managers'
      : several
        ? 'It oversees the conversations under it'
        : 'A manager oversees this project',
    hint: lead
      ? html`A contact on your list, in the main checkout, over the project’s managers at work. Tell it what to do, such
        as “send the coder manager’s finished jobs to the review manager”: it hands a worker’s job to a manager, which
        starts its own workers, and passes the verdict back. It hears from the managers alone, and asks you before each
        message. It changes no files itself.`
      : html`A contact on your list, in the main checkout. It learns what the project is building from the sources below
        and keeps a brief. Each time a conversation under it changes files, it looks at the changes and messages that
        conversation when something has to change. It changes no files itself. Put a conversation under it with Under in
        Add a Contact, the + on its row, or by dragging it onto its row.`,
    warning: lead
      ? 'It takes a turn for each answer and report of its managers, using the service selected below.'
      : 'It takes a turn after every change, using the service selected below.',
    checked: settings.on,
    // One that can't be turned on, such as for a main checkout that is gone, is off again.
    onChange: async (on) => {
      if (!(await change({ on }))) {
        turnedOn.querySelector('input').checked = !on;
        return;
      }
      conversation.hidden = !on;
      const who = lead ? 'project manager' : 'manager';
      said(
        on
          ? `${lead ? 'Project manager' : 'Manager'} joined ${project.name}.`
          : `The ${who} no longer oversees ${project.name}.`
      );
    },
  });
  turnedOn.append(conversation);

  let provider = providers.find((one) => one.id === (settings.provider || 'claude'));
  const modelRow = row();
  const showModel = () =>
    modelRow.replaceChildren(modelChoice(provider, current().model, (model) => change({ model })));
  showModel();
  const apply = button(
    'Switch service',
    async () => {
      apply.disabled = serviceButton.disabled = true;
      try {
        const picked = providers.find((one) => one.id === service.value);
        const latest = await api.projects.manager({ project: project.key });
        const manager = latest?.managers?.find((one) => one.id === (id || latest.contactId));
        if (!latest || (current().id && !manager)) throw new Error('This manager’s project can’t be read just now.');
        const from = providers.find((one) => one.id === (manager?.settings.provider || current().provider || 'claude'));
        const permissionMode = manager ? await managerServiceDialog(picked, from, manager.permissionMode) : undefined;
        if (permissionMode === null) return;
        // The manager may have saved its brief while the permission dialog was open.
        const fresh = manager && (await api.projects.manager({ project: project.key }));
        const kept = fresh?.managers?.find((one) => one.id === manager.id)?.settings;
        if (manager && !kept) throw new Error('This manager’s project can’t be read just now.');
        if (await change(switchedTo(kept || current(), picked.id, permissionMode))) {
          provider = picked;
          showModel();
          said(`Manager now uses ${provider.name}.`);
        }
      } catch (err) {
        said(errorText(err), true);
      } finally {
        service.value = current().provider || 'claude';
        showService();
        serviceButton.disabled = false;
        apply.disabled = service.value === (current().provider || 'claude');
      }
    },
    { kind: 'primary' }
  );
  apply.disabled = true;
  // Picked as Add a manager picks it, from the services with the app's tools. Switch service makes it so.
  const service = /** @type {HTMLInputElement} */ (el('<input type="hidden" />'));
  service.value = provider.id;
  const serviceButton = /** @type {HTMLButtonElement} */ (
    el('<button type="button" class="combo service-combo" aria-label="Manager service" aria-haspopup="menu"></button>')
  );
  const showService = servicePicker(
    serviceButton,
    service,
    providers.filter((one) => one.appTools)
  );
  service.addEventListener('change', () => {
    apply.disabled = service.value === (current().provider || 'claude');
  });

  const checks = el('<div class="st-toggles"></div>');
  const checkRole = document.documentElement.dataset.look === 'professional' ? 'switch' : 'checkbox';
  for (const check of CHECKS) {
    const node = el(
      html`<label class="st-toggle"
        ><input type="checkbox" role="${checkRole}" /><span
          ><b>${check.label}</b>
          <p class="st-hint">${check.hint}</p></span
        ></label
      >`
    );
    const box = /** @type {HTMLInputElement} */ (node.querySelector('input'));
    box.checked = settings.checks.includes(check.id);
    box.dataset.check = check.id;
    checks.append(node);
  }
  checks.addEventListener('change', () =>
    change({ checks: [...checks.querySelectorAll('input:checked')].map((box) => box.dataset.check) })
  );

  const conversationsOnly = (...parts) => (lead ? [] : parts);
  return [
    turnedOn,
    group(
      'Service',
      'Switching asks for a permission mode, stops the current turn and starts a fresh session. The conversation, brief, sources, checks and assigned conversations stay. The manager stays read-only in every mode. The model badge in its conversation switches it too.',
      row(service, serviceButton, apply)
    ),
    group(
      'Model',
      'The model it answers with. It takes a turn after every change, so a smaller one uses less of your plan. The model badge in its conversation changes it too.',
      modelRow
    ),
    ...(lead
      ? []
      : newWorkersGroup(providers, settings.workers, (workers) => change({ workers }), settings.provider || 'claude')),
    ...conversationsOnly(
      group(
        'Scope',
        html`The new conversations it starts out over in Add a Contact’s Under: one pattern on each line, for their
          branch, such as <code>safa/release/*</code>, or a ticket key, such as <code>COM-6*</code>, which an issue’s or
          pull request’s title can name too. The first manager whose scope takes one has it, and you can pick another.
          Nothing already under a manager moves.`,
        codeBox({
          value: (settings.scope ?? []).join('\n'),
          label: 'Scope',
          placeholder: 'safa/release/*',
          rows: 3,
          onSave: (scope) => change({ scope }),
        })
      )
    ),
    group(
      'Sources',
      'Where it learns what the project is building: PRDs, tickets, Slack channels and threads, designs, docs. Each with a name, a link, or both. It reads them with the selected service’s tools, such as Linear, Slack, Figma or Notion. Connect those tools to each service you use.',
      listEditor({
        items: settings.sources,
        fields: [
          { key: 'name', placeholder: 'Name' },
          { key: 'url', mono: true, placeholder: 'Link (optional)', label: 'Link' },
        ],
        add: 'Add source',
        empty: 'No sources yet. Add the PRD, the tickets, the Slack channel.',
        onChange: (sources) => change({ sources }),
      })
    ),
    ...conversationsOnly(
      group(
        'Checks',
        'What it looks for in each change. Add your own, a sentence each, such as how your project does something.',
        checks,
        listEditor({
          items: settings.ownChecks.map((text) => ({ text })),
          fields: [
            {
              key: 'text',
              placeholder: 'Uses the design system’s components, not plain HTML elements',
              kind: 'prose',
              label: 'Check',
            },
          ],
          add: 'Add check',
          onChange: (items) => change({ ownChecks: items.map(({ text }) => text) }),
        })
      )
    ),
    group(
      'Instructions',
      'What it is told on top, such as how strict to be.',
      codeBox({
        value: settings.rules,
        label: 'Instructions',
        placeholder: 'Only message about what breaks the ticket or the design. Leave naming to the reviewer.',
        rows: 3,
        prose: true,
        onSave: (rules) => change({ rules }),
      })
    ),
    group(
      'Brief',
      'What it knows of the project so far: the goals, the decisions, each ticket’s acceptance criteria, who works on what. It writes this itself as it reads the sources. Edit it to set something right, and it is told what you changed.',
      codeBox({
        value: settings.brief,
        label: 'Brief',
        placeholder: 'Empty until the manager reads the sources.',
        rows: 10,
        prose: true,
        onSave: (brief) => change({ brief }),
      })
    ),
  ];
}

/**
 * "Add another manager...", as the project's menu has it: the new one opens in its conversation, and the page
 * lists it.
 * @param {PageContext} ctx
 */
function addAnotherButton({ project, providers, reload }) {
  return button(
    'Add another manager...',
    async () => {
      await addAnotherManager({ key: project.key, name: project.name }, { providers, open: (id) => api.chat.open(id) });
      reload();
    },
    { kind: 'primary' }
  );
}

/**
 * "Add a project manager...", as the project's menu has it: the new one opens in its conversation, and the page
 * lists it, first.
 * @param {PageContext} ctx
 */
function addLeadButton({ project, providers, reload }) {
  return button('Add a project manager...', async () => {
    await addProjectManager({ key: project.key, name: project.name }, { providers, open: (id) => api.chat.open(id) });
    reload();
  });
}

/** The way to a project manager, for a project with a manager and none yet. @param {PageContext} ctx */
const leadGroup = (ctx) =>
  (ctx.project.managers ?? []).some((one) => one.leads) || !(ctx.project.managers ?? []).some((one) => !one.archived)
    ? []
    : [
        group(
          'Project manager',
          `A manager over ${ctx.project.name}’s managers, which hands a worker’s job from one to another as you tell it, and passes the verdict back.`,
          row(addLeadButton(ctx))
        ),
      ];

/**
 * A project's Manager page. With no manager yet, or one, what it is set up with, and the way to another. With
 * several, a line for each, which opens what it is set up with under it, one at a time: the one the page was
 * opened on, if any. Its project manager, if it has one, first.
 * @param {PageContext} ctx
 */
function manager(ctx) {
  const { project } = ctx;
  if (!isRepository(project)) {
    return [
      group(
        'No repository',
        `A manager oversees the worktrees of a git repository, and ${project.name} is a folder outside any.`
      ),
    ];
  }
  const people = [...(project.managers ?? [])].sort((a, b) => Number(Boolean(b.leads)) - Number(Boolean(a.leads)));
  if (people.length < 2) {
    const [only] = people;
    return [
      ...managerSettings(ctx, only?.id, { lead: Boolean(only?.leads) }),
      only &&
        group(
          'More managers',
          `Another manager oversees the conversations you put under it, such as ${project.name}’s release, with its own brief and sources.`,
          row(addAnotherButton(ctx))
        ),
      ...(only ? leadGroup(ctx) : []),
    ];
  }
  const list = foldList({
    items: () => people,
    name: (one) => one.name,
    summary: (one) => managerSummary(project, one),
    settings: (one, line) =>
      managerSettings(ctx, one.id, { several: true, lead: Boolean(one.leads), changed: line.label }),
    empty: 'No managers yet.',
  });
  if (ctx.manager) list.show(ctx.manager);
  return [
    groupWithButton(
      'Managers',
      'Each oversees the conversations under it, with its own brief, sources and checks. Open one to set it up.',
      addAnotherButton(ctx),
      list.node
    ),
    ...leadGroup(ctx),
  ];
}

/**
 * What each page of a project says under its title, and what is on it, by its id. Their names, and the
 * order the window lists them in, are in shared/settings-pages.js, where the palette (⌘K) finds them too.
 * @type {Record<string, Pick<import('./main.js').Page, 'lead' | 'render'>>}
 */
const CONTENT = {
  'project-fallbacks': {
    lead: 'Which backup services may continue this project’s interrupted requests, and whether it follows the global rules.',
    render: fallbacksPage,
  },
  overview: { lead: 'Where it is, who works on it, and how it is set up.', render: overview },
  'project-git': { lead: 'Where a new contact’s worktree starts, and what it gets.', render: git },
  'project-environment': {
    lead: 'Variables the scripts, terminals and agents of this project are started with.',
    render: environment,
  },
  scripts: {
    lead: 'Commands that run when a worktree is set up, when you press Run, and before a worktree is removed, and where a run is looked at.',
    render: scripts,
  },
  instructions: {
    lead: 'What the contacts working on this project are told on top of what you type.',
    render: instructions,
  },
  manager: {
    lead: 'A contact that oversees the conversations on this project that are put under it.',
    render: manager,
  },
};

/**
 * The pages of a project, in the order the window lists them under it.
 * @type {import('./main.js').Page[]}
 */
export const PROJECT_PAGES = PROJECT_SETTINGS.map((page) => ({ ...page, ...CONTENT[page.id] }));
