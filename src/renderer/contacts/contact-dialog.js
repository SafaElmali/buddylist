// "Add a Contact" / "Edit contact": a contact is an AI working in a folder.
// A new contact in a git repository always gets a worktree of its own, on a
// branch that is named for it, so the folder picked is never the one it changes.
// There it can be started from an issue or pull request on GitHub.
// A contact added from another one works on the same project. The next one added
// starts out like the last, on its project, which can still be changed for another.
// A team can join a new contact's conversation with it: the agents of its roles.
// A new contact asks for little: its service and name, where it works, and where on GitHub it starts. Its
// picture is its service's own. The rest starts out chosen for it, folded under "More options" with a
// line that says what: its model and effort level among it. Its model, level and mode are the ones Settings > New
// contacts picks, where it picks them.
// Where it works is a project, or This computer: no project at all, for questions, research and writing,
// in a new, empty folder of its own (see main/computer.js). On a git repository, Under says which of its managers
// oversees it, and adds one.
import { api } from '../lib/api.js';
import { el, errorText, html } from '../lib/dom.js';
import { comboButton } from '../lib/combo.js';
import { busyLine, confirmDialog, formDialog } from '../lib/dialog.js';
import { avatarChoices, openPicturePicker } from '../lib/picture-picker.js';
import { pictureHtml } from '../lib/pictures.js';
import { madeUpNickname, withoutPrefix } from '../../shared/branch-names.js';
import { newContactStart } from '../../shared/contact-defaults.js';
import { currentModel, defaultNamed, effortLabel } from '../../shared/models.js';
import { branchFor, describeItem, draftFor, nicknameFor } from '../../shared/github-item.js';
import { ADDS_MANAGER, managersAtWork, scopedManager, underFor } from '../../shared/managers.js';
import { itemList } from './item-list.js';
import { addAnotherManager, addManager, managerOfFolder, managerOfProject } from './manager-dialog.js';
import { optionsSummary } from './contact-options.js';
import { ItemLookup } from './item-lookup.js';
import { modelOption } from './model-choices.js';
import { effortPicker, modelPicker, servicePicker } from './model-picker.js';
import { askModels, modelsOf } from './models.js';
import { wherePicker } from './where-picker.js';
import { NICKNAME_MAX } from './rows.js';
import { heldHint } from '../history/held.js';

const folderName = (p) => p.split(/[\\/]/).filter(Boolean).pop() || p;

const WORKS_HERE = 'This contact can read and change files here, like running it in a terminal in this folder.';
/** Said of a contact on This computer, with where its folder will be once it is added. */
const onItsOwn = (folder) =>
  folder
    ? `No project: it works in a new, empty folder of its own, ${folder}.`
    : 'No project: it works in a new, empty folder of its own.';
// What the form is laid out for while it is on This computer, which has no folder to pick.
const COMPUTER = Symbol('This computer');
// What the form says while a contact is added: making its worktree takes seconds in a big repository.
const ADDING = 'Adding the contact...';
const STEPS = {
  fetch: 'Getting the newest commits...',
  checkout: 'Making its worktree. A big project takes a moment...',
};

const NO_REPOSITORY =
  'There is no git repository with a commit here, so this contact works in the folder itself, not in a worktree.';
/** Said of a contact in a repository: that it works in a worktree instead, and whose files that keeps it away from. */
const inWorktree = (sameProject) =>
  `Works in its own git worktree, so ${sameProject ? "other contacts' files are" : 'the folder itself is'} never touched.`;
const NEW_BRANCH = 'New branch';
// Said under the mode that asks nothing, as a conversation says before switching to it.
const RISKY = "It runs commands and changes files without asking. Only pick this for a folder you don't mind breaking.";
// What the GitHub field is for, said when the mouse is on it: the line under it is for what was found.
const GITHUB_ABOUT =
  "Names the contact and its branch after an issue, or works on a PR's own branch. Its text waits in the message box for you to send.";
// What the line under the GitHub field says while there is nothing found to name. Empty, it is hidden.
const GITHUB_HINTS = {
  unreadable: 'Pick one from the list, or type its number or paste its link.',
  looking: 'Looking it up on GitHub...',
};

// The name made up for the project is only a stand-in when the first message names the branch: the
// field then starts out empty, and is left that way for it. Otherwise it shows the name the branch keeps.
const startingBranch = (repo) => (repo.renameBranches ? '' : repo.suggested);
// Beside the name of a field that can be left as it is.
const OPTIONAL = html`<span class="optional">Optional</span>`;

/**
 * @typedef {Object} Repository
 * @property {string} name
 * @property {string} branch
 * @property {string | null} defaultBranch
 * @property {string} home
 * @property {string} suggested  the name made up for a new contact's branch
 * @property {string} branchPrefix  what the user wants in front of their branches; '' for nothing
 * @property {boolean} renameBranches  a new branch is named after the first message, so `suggested` is only a stand-in
 * @property {string} folder  where the project itself is: the folder, unless that is in a worktree of it
 */

/**
 * @param {object} opts
 * @param {import('../../providers/contract.js').ProviderDescriptor[]} opts.providers
 * @param {import('../../shared/groups.js').Group[]} [opts.groups]
 * @param {import('../../shared/teams.js').Team[]} [opts.teams]  the teams a new contact can be joined by
 * @param {import('../../shared/teams.js').Role[]} [opts.roles]  the roles the teams are made of, to name them by
 * @param {() => void} [opts.openTeams]  opens the teams in the Settings window; left out where there is none
 * @param {any} [opts.existing]  the contact being edited
 * @param {any} [opts.from]  the contact a new one starts from: same service, folder, group, model, effort
 *   level, mode and team. Settings > New contacts (`defaults`) can pick another model, level and mode
 * @param {import('../../shared/contact-defaults.js').ContactDefaultsByService} [opts.defaults]  what a new contact of
 *   each service starts out with, where Settings > New contacts picks it
 * @param {Repository | null} [opts.repo]
 *   `from`'s repository, if it has one: the new contact gets its own worktree of it instead of `from`'s folder
 * @param {string} [opts.folder]  the project folder a new contact starts out with: one opened, cloned or made just
 *   now, or with `from` the project that one works on, to add the next contact there or pick another
 * @param {boolean} [opts.computer]  a new contact starts out on This computer, with no project: the way This
 *   computer's + has it. So does one like a contact there, and one with no folder to start out with
 * @param {string} [opts.groupId]  the group a new contact starts out in when that is not `from`'s: the one whose +
 *   it is added with
 * @param {'github'} [opts.startAt]  the field to start in, where the form has it: the one for an issue or pull
 *   request, for a contact that is to be started from one. Otherwise the branch, which Enter takes as it is
 * @param {import('./manager-dialog.js').ProjectManager | null} [opts.project]  `from`'s project, with its managers,
 *   as the main process says it: Under offers the ones at work. A project picked in Works on is asked about then
 * @param {string} [opts.under]  the manager Under starts out with, by id: the one whose + it is added with. Without
 *   one, it follows the managers' scopes (see scopedManager) until a manager is picked in it
 * @param {AbortSignal} [opts.signal]  the explicit Add Contact flow; standalone Add manager cancels it
 * @returns {Promise<any>} the saved contact, or null
 */
export function contactDialog({
  providers,
  groups = [],
  teams = [],
  roles = [],
  openTeams,
  existing = null,
  from = null,
  repo = null,
  folder: opened = '',
  computer = false,
  groupId,
  startAt,
  project = null,
  under = '',
  defaults = {},
  signal,
}) {
  if (signal?.aborted) return Promise.resolve(null);
  const lifetime = new AbortController();
  const cancel = () => lifetime.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  // What the form starts out with.
  const seed = existing || from;
  const group = groupId ?? seed?.groupId;
  // On This computer: from its +, like a contact there, or with no folder to start out with. A folder opened just now
  // is a project's.
  let onComputer = !existing && !opened && (computer || seed?.place === 'computer' || !seed?.cwd);
  // There is no repository there, whatever the home folder of a contact on it is.
  if (onComputer) repo = null;
  // The folder it starts out with: a project's, or else the one `seed` works in. On This computer, none.
  const startsIn = opened || (onComputer ? '' : seed?.cwd || '');
  // Another contact on `from`'s repository: the project is settled, so there is no folder to pick.
  const sameProject = Boolean(from && repo);
  let provider = providers.find((p) => p.id === seed?.provider) || providers[0];
  // The model, level and mode it starts out with: the ones Settings picks, else `from`'s. On This computer the mode
  // is the service's own unless `from` is there too: it can reach anything there, so it asks before it acts until
  // the user says otherwise.
  const startFor = (there) => newContactStart({ provider, defaults, from, computer: there });
  const nameFor = (detail) => madeUpNickname(provider.name, detail);
  const nameOf = (id) => providers.find((p) => p.id === id)?.name ?? id;
  // What tells a branch from the user's others: the prefix they all share says nothing about this one.
  const branchDetail = (branch) => withoutPrefix(repo?.branchPrefix ?? '', branch);
  // The parts of the form that depend on the service.
  const modeOptions = () => {
    const { permissionMode } = startFor(onComputer);
    return provider.permissionModes.map(
      (m) => html`<option value="${m.id}" ${permissionMode === m.id ? 'selected' : ''}>${m.label}</option>`
    );
  };
  // A contact in a repository can start from an issue or pull request on GitHub, which names its branch
  // and itself.
  const githubField = () =>
    html`<label title="${GITHUB_ABOUT}"
      ><span class="field-label">GitHub issue or PR ${OPTIONAL}</span>
      <input
        type="text"
        name="github"
        maxlength="300"
        spellcheck="false"
        placeholder="Search open issues and PRs, or paste a link"
      />
      <span class="hint github-hint" hidden></span>
    </label>`;
  // What else it is asked: what to call its branch, and where to start it. Both can be left as they are.
  // With a folder to pick, the line under it says where the contact works; without one, the branch does.
  const branchFields = () =>
    html`<label
        ><span class="field-label"><span class="branch-caption">${NEW_BRANCH}</span>${OPTIONAL}</span>
        <input
          type="text"
          name="branch"
          maxlength="100"
          spellcheck="false"
          value="${startingBranch(repo)}"
          placeholder="${repo.renameBranches ? 'Named after your first message' : repo.suggested}"
        />
        ${sameProject ? html`<span class="hint" title="${repo.home}">${inWorktree(true)}</span>` : ''}
      </label>
      ${
        repo.defaultBranch
          ? html`<label
              >Start from
              <select name="base">
                <option value="default">${repo.defaultBranch}, as it is right now</option>
                <option value="current">
                  ${repo.branch}, where ${sameProject ? `${from.name} is` : 'the folder is'}
                </option>
              </select>
            </label>`
          : ''
      }`;
  // A team is named with who is in it: "With a reviewer (Reviewer)".
  const teamLabel = (team) => {
    const names = team.roles.flatMap((id) => roles.find((role) => role.id === id)?.name ?? []).join(', ');
    return names && names !== team.name ? `${team.name} (${names})` : team.name;
  };
  const teamOptions = (picked) =>
    html`<option value="">Nobody else</option>
      ${teams.map((t) => html`<option value="${t.id}" ${picked === t.id ? 'selected' : ''}>${teamLabel(t)}</option>`)}`;
  const teamSelect = html`<select name="team">
    ${teamOptions(from?.team)}
  </select>`;
  // Where there is a Settings window, the teams are a click away in it, as a folder is with Browse...
  // Without a team, the field waits out of sight for one made there.
  const teamField = html`<label class="team-field" ${teams.length ? '' : 'hidden'}
    ><span class="field-label">Team ${OPTIONAL}</span>
    ${
      openTeams
        ? html`<span class="row">
            ${teamSelect}
            <button type="button" class="btn edit-teams">Edit teams...</button>
          </span>`
        : teamSelect
    }
    <span class="hint"
      >They join its conversation with it, such as a reviewer for every
      change.${openTeams ? '' : ' Set in Settings.'}</span
    >
  </label>`;
  // Without a team yet, the way to one: a reviewer that joins every new conversation is a team of one.
  const noTeamField = html`<div class="no-team" ${teams.length ? 'hidden' : ''}>
    <span class="hint">No teams yet. A team brings other agents along, such as a reviewer for every change.</span>
    <button type="button" class="btn edit-teams">Set up a team...</button>
  </div>`;
  // A contact being edited works in a folder, typed or browsed for. A new one works on a project, or on This computer.
  const folderField = html`<label
    >Working folder
    <span class="row">
      <input type="text" name="cwd" spellcheck="false" value="${startsIn}" />
      <button type="button" class="btn browse">Browse...</button>
    </span>
    <span class="hint folder-hint">${WORKS_HERE}</span>
  </label>`;
  const whereField = html`<label
    >Works on
    <input type="hidden" name="cwd" value="${startsIn}" />
    <button type="button" class="combo where-combo" aria-haspopup="menu"></button>
    <span class="hint folder-hint">${onComputer ? onItsOwn('') : WORKS_HERE}</span>
  </label>`;
  const nicknameField = html`<label
    >Nickname
    <input
      type="text"
      name="name"
      maxlength="${NICKNAME_MAX}"
      value="${existing?.name || nameFor(repo ? branchDetail(repo.suggested) : from && folderName(startsIn))}"
    />
  </label>`;
  // Who it is. A new contact is its service and its name, and has its service's picture. One being edited
  // shows its picture beside its name, and a click on it picks another.
  const who = existing
    ? html`<div class="contact-who">
        <input type="hidden" name="avatar" value="${existing.avatar || provider.avatar}" />
        <button type="button" class="picture-button" aria-label="Display picture" aria-haspopup="menu"></button>
        <div class="contact-who-fields">${nicknameField}</div>
      </div>`
    : html`${
        providers.length > 1
          ? html`<label
              >Service
              <input type="hidden" name="provider" value="${provider.id}" />
              <button type="button" class="combo service-combo" aria-haspopup="menu"></button>
            </label>`
          : ''
      }
      ${nicknameField}`;
  const groupField = groups.length
    ? html`<label
        >Group
        <select name="groupId">
          <option value="">No group</option>
          ${groups.map((g) => html`<option value="${g.id}" ${group === g.id ? 'selected' : ''}>${g.name}</option>`)}
        </select>
      </label>`
    : '';
  // Which manager oversees it: the one whose + it is added with, the one whose scope takes it, or else none. Drawn
  // for the project it works on (see showUnder), which This computer and a folder outside a repository are not.
  const underHint = (id, scoped = false) => {
    const working = managersAtWork(project);
    const manager = working.find((one) => one.id === id);
    if (!manager) {
      return working.length
        ? 'Nobody oversees it. Pick a manager to have it oversee this one.'
        : 'Nobody oversees it. Add a manager to have one look at its changes.';
    }
    return scoped
      ? `${manager.name} oversees it, as its scope takes this one. Pick another to change that.`
      : `${manager.name} oversees it: it hears each time it changes files.`;
  };
  const underField = html`<label class="under-field" hidden
    >Under
    <select name="under"></select>
    <span class="hint under-hint"></span>
  </label>`;
  const modelField = html`<label
    >Model
    <input type="hidden" name="model" value="${existing ? existing.model || '' : startFor(onComputer).model}" />
    <button type="button" class="combo model-combo" aria-haspopup="menu"></button>
  </label>`;
  // The effort level a new contact starts out with, where its model takes any: the levels follow the model.
  const effortField = html`<label
    >Effort
    <input type="hidden" name="effort" value="" />
    <button type="button" class="combo effort-combo" aria-haspopup="menu"></button>
  </label>`;
  // A contact being edited is asked all it can change, which is little. A new one is asked who it is and
  // where it works, and the rest is folded away: a mode that asks nothing still says so outside the fold.
  const body = el(
    existing
      ? html`<form class="contact-form">
          ${who} ${groupField} ${folderField} ${modelField} ${busyLine(ADDING)}
          <div class="error" hidden></div>
        </form>`
      : html`<form class="contact-form">
          ${who} ${sameProject ? '' : whereField}
          <div class="github-fields">${repo ? githubField() : ''}</div>
          ${underField} ${teamField}
          <details class="more-options">
            <summary>More options<span class="options-summary"></span></summary>
            <div class="more-fields">
              ${groupField}
              <div class="branch-fields">${repo ? branchFields() : ''}</div>
              ${modelField} ${effortField}
              <label
                >When it wants to do something
                <select name="permissionMode">
                  ${modeOptions()}
                </select>
              </label>
              ${openTeams ? noTeamField : ''}
            </div>
          </details>
          <span class="hint warning mode-warning" hidden>${RISKY}</span>
          ${busyLine(ADDING)}
          <div class="error" hidden></div>
        </form>`
  );
  const form = /** @type {HTMLFormElement} */ (body);
  const fields = /** @type {any} */ (form.elements);
  // Each service is shown by its picture, in the field and in its list.
  if (fields.provider) servicePicker(form.querySelector('.service-combo'), fields.provider, providers);
  // A contact being edited has its picture as a button, which opens the pictures to pick from.
  const pictureButton = /** @type {HTMLButtonElement | null} */ (form.querySelector('.picture-button'));
  const showPicture = () => {
    const avatar = fields.avatar.value;
    const label = avatarChoices(provider).find((choice) => choice.avatar === avatar)?.label;
    pictureButton.innerHTML = pictureHtml({ avatar, size: 'medium' });
    pictureButton.title = label ? `${label}. Click to pick another picture.` : 'Click to pick another picture.';
  };
  if (pictureButton) {
    comboButton(pictureButton, () =>
      openPicturePicker(pictureButton, {
        choices: avatarChoices(provider),
        current: fields.avatar.value,
        pick: (avatar) => {
          fields.avatar.value = avatar;
          showPicture();
        },
      })
    );
    showPicture();
  }
  // A new contact's folder decides where it works: in a repository, a worktree of its own. On This computer it
  // has none, until it is added.
  const folder = () => (onComputer ? '' : fields.cwd.value.trim());
  // The project's folder: the other contact's, or the one picked here.
  const projectFolder = () => (sameProject ? from.cwd : folder());
  // "Default" says which model and effort level that comes to there.
  const showModel = modelPicker(form.querySelector('.model-combo'), fields.model, () => provider, {
    folder: projectFolder,
  });
  // A contact being edited has its effort level changed under its conversation, as one is that it was given.
  const showEffort = fields.effort
    ? effortPicker(form.querySelector('.effort-combo'), fields.effort, {
        provider: () => provider,
        model: () => fields.model.value.trim(),
        picked: startFor(onComputer).effort,
        folder: projectFolder,
      })
    : () => {};
  // The model picked says which levels there are. A hidden field says so with a change (see modelPicker).
  fields.model.addEventListener('change', () => showEffort());
  // What the service calls its models, and which levels each takes, arrive a moment later. If it can't say, the
  // names known so far stay. So does what its default model and effort level come to where the contact works,
  // which is asked again wherever it is moved to.
  const showModels = () => {
    showModel();
    showEffort();
    showOptions();
  };
  const learnHere = () => {
    showModels();
    return askModels(provider, projectFolder()).then(showModels, () => {});
  };
  const learnModels = () => askModels(provider, projectFolder()).then(showModels, () => {});
  learnModels();
  const fill = (node, options) => node.replaceChildren(...el(html`<div>${options}</div>`).children);
  const focusOn = (field) => {
    field.focus();
    field.select();
  };
  // Asked each time: the fields change with the folder, and only a repository has one for GitHub.
  // Otherwise the nickname, which Enter takes as it is.
  const firstField = () => (startAt === 'github' && fields.github) || fields.name;
  // Started from an issue or pull request, the form opens on the list of them.
  const begin = () => {
    if (!form.isConnected || lifetime.signal.aborted) return;
    const field = firstField();
    focusOn(field);
    if (field === fields.github) items?.open();
  };

  // The nickname names what tells this contact from the others, its branch or else
  // its folder, until the user types one of their own.
  let suggested = fields.name.value;
  const offerName = (name) => {
    if (fields.name.value && fields.name.value !== suggested) return;
    suggested = name;
    fields.name.value = name;
  };
  const suggestName = (detail) => offerName(nameFor(detail));

  let looked = { folder: '', found: Promise.resolve(null) };
  const repositoryOf = (path) => {
    if (path !== looked.folder) looked = { folder: path, found: api.contacts.repository(path).catch(() => null) };
    return looked.found;
  };
  // Where a new contact could work, for Works on: This computer, with the folder it would get there, and the projects
  // the user's contacts work on. They arrive a moment after the form opens.
  let places = { computer: null, projects: [] };
  const placesAsked = existing || sameProject ? null : api.contacts.places().catch(() => places);
  /** Says where it works on Works on, again (see wherePicker below). Without that, there is nothing to say it on. */
  let showWhere = () => {};
  // The folder the form was last laid out for, or This computer. One it starts out with is still to be looked at.
  const placeShown = () => (onComputer ? COMPUTER : folder());
  let shown = fields.cwd && !opened && !onComputer ? folder() : '';
  async function followFolder() {
    if (onComputer) return followComputer();
    const picked = folder();
    if (picked === shown) return;
    // And how many conversations were held there outside the app, such as in a terminal, for the hint to say, and
    // the project's managers, for Under.
    const [found, held, managed] = picked
      ? await Promise.all([repositoryOf(picked), api.history.heldIn(picked).catch(() => []), managerOfFolder(picked)])
      : [null, [], null];
    // Typed over while git was asked, or laid out by an earlier call.
    if (picked !== folder() || picked === shown) return;
    shown = picked;
    repo = found;
    fill(form.querySelector('.github-fields'), repo ? githubField() : '');
    fill(form.querySelector('.branch-fields'), repo ? branchFields() : '');
    forgetLookup();
    const hint = /** @type {HTMLElement} */ (form.querySelector('.folder-hint'));
    if (!picked) hint.textContent = WORKS_HERE;
    else
      hint.textContent = [repo ? inWorktree(false) : NO_REPOSITORY, heldHint(held, nameOf)].filter(Boolean).join(' ');
    // Where the worktree goes is there for the mouse: the path is long, and the line is about the folder.
    hint.title = repo ? repo.home : '';
    if (picked) suggestName(repo ? branchDetail(repo.suggested) : folderName(picked));
    followProject(managed);
    showPlace();
  }

  /** The form laid out for This computer: no repository, so no GitHub or branch, and the folder it would get. */
  async function followComputer() {
    if (shown === COMPUTER) return;
    places = (await placesAsked) ?? places;
    // Moved on to a folder while that was asked, or laid out by an earlier call.
    if (placeShown() !== COMPUTER || shown === COMPUTER) return;
    shown = COMPUTER;
    repo = null;
    fill(form.querySelector('.github-fields'), '');
    fill(form.querySelector('.branch-fields'), '');
    forgetLookup();
    const hint = /** @type {HTMLElement} */ (form.querySelector('.folder-hint'));
    hint.textContent = onItsOwn(places.computer?.folder);
    hint.title = '';
    suggestName(places.computer?.name ?? '');
    followProject(null);
    showPlace();
  }

  // What says where it works besides its fields: the title, and the mode, which is the service's own on This computer
  // until one is picked.
  let modePicked = false;
  function showPlace() {
    const titled = form.closest('.dialog')?.querySelector('.dialog-title');
    if (titled) titled.textContent = titleFor();
    if (!modePicked && fields.permissionMode) {
      fields.permissionMode.value = startFor(onComputer).permissionMode;
      showRisk();
    }
    showWhere();
    showOptions();
  }

  const titleFor = () => {
    if (existing) return `Edit ${existing.name}`;
    if (onComputer) return 'New Contact on This computer';
    return repo ? `New Contact in ${repo.name}` : 'Add a Contact';
  };

  // ---- started from an issue or pull request on GitHub ---------------------------------------
  // What the GitHub field says is looked up in the project's folder while the rest of the form
  // is filled in. The field is one of the worktree's: without a repository there is none.
  /** Has Under follow the managers' scopes again: set once Under is drawn (see followScopes). */
  let scoping = () => {};
  const lookup = new ItemLookup({
    ask: (text) => api.contacts.githubItem(projectFolder(), text),
    changed: showLookup,
  });
  // Under the field, the project's open pull requests and issues to choose one from.
  const listItems = () =>
    fields.github ? itemList(fields.github, (search) => api.contacts.githubItems(projectFolder(), search)) : null;
  let items = listItems();
  // What the form itself last put in the branch field: what it starts out with, or the name an
  // issue suggested. A field that says something else was typed in by hand, and is left alone.
  let suggestedBranch = repo ? startingBranch(repo) : '';
  const suggestBranch = (branch) => {
    if (fields.branch.value && fields.branch.value !== suggestedBranch) return;
    suggestedBranch = branch;
    fields.branch.value = branch;
  };
  // What the branch field said before a pull request took it over.
  let ownBranch = '';
  // The branch a new one gets: an empty field is the name made up for the project.
  const branchName = () => fields.branch.value.trim() || repo.suggested;
  // The name made up for the project is only a stand-in: the first message names the branch after the work.
  const isPlaceholder = () => !fields.branch.disabled && branchName() === repo.suggested;
  /** Says what the branch field holds: a pull request's own branch, which is not to be changed, or a new one. */
  const showCaption = () => {
    const pull = fields.branch.disabled;
    form.querySelector('.branch-caption').textContent = pull ? "The pull request's branch" : NEW_BRANCH;
    /** @type {HTMLElement} */ (form.querySelector('.branch-caption + .optional')).hidden = pull;
  };
  // The mode that asks nothing says what that means, as it does when it is picked in a conversation.
  const showRisk = () => {
    const mode = provider.permissionModes.find((m) => m.id === fields.permissionMode.value);
    /** @type {HTMLElement} */ (form.querySelector('.mode-warning')).hidden = !mode?.danger;
  };
  // The line beside "More options" says what is chosen under it. A contact being edited has none.
  const showOptions = () => {
    const summary = form.querySelector('.options-summary');
    if (!summary) return;
    const mode = provider.permissionModes.find((m) => m.id === fields.permissionMode.value);
    const base = fields.base?.value === 'default' ? repo.defaultBranch : repo?.branch;
    let branch = null;
    if (fields.branch) branch = fields.branch.disabled ? { pull: true } : { name: fields.branch.value.trim(), base };
    const { catalog } = modelsOf(provider, projectFolder());
    // The default, by the model it comes to where that is known: "Default model (Opus 5.5)".
    const usual = currentModel({ model: '', defaultModel: null }, catalog)?.label;
    summary.textContent = optionsSummary({
      branch,
      model: fields.model.value ? modelOption(catalog, fields.model.value).label : defaultNamed(usual, 'Default model'),
      effort: fields.effort.value && effortLabel(fields.effort.value),
      mode: mode?.short ?? mode?.label,
      group: groups.find((g) => g.id === fields.groupId?.value)?.name,
    });
  };

  /** The worktree's fields were laid out anew, for another folder: what was found for the last one is gone. */
  function forgetLookup() {
    suggestedBranch = repo ? startingBranch(repo) : '';
    ownBranch = '';
    lookup.typed('');
    items = listItems();
  }

  /**
   * Fills the form in from what the GitHub field's lookup says now, and takes it out
   * again when that no longer stands.
   * @param {import('./item-lookup.js').LookupState} state
   */
  function showLookup({ status, item, error }) {
    const line = /** @type {HTMLElement} */ (form.querySelector('.error'));
    line.textContent = status === 'failed' ? errorText(error) : '';
    line.hidden = status !== 'failed';
    // The folder was changed for one without a repository, and the field went with the others.
    if (!fields.github) return;

    const pull = item?.kind === 'pull' ? item : null;
    // A pull request brings its own branch: there is none to name, and nothing to start it from.
    if (pull && !fields.branch.disabled) ownBranch = fields.branch.value;
    if (pull) fields.branch.value = pull.branch;
    else if (fields.branch.disabled) fields.branch.value = ownBranch;
    fields.branch.disabled = Boolean(pull);
    if (fields.base) fields.base.disabled = Boolean(pull);
    // An issue names the branch after itself. Without one it is named after the project again.
    if (!pull) suggestBranch(item ? branchFor(item, repo.branchPrefix) : startingBranch(repo));
    showCaption();
    // The contact is named after what it is started from, and otherwise after its branch.
    if (item) offerName(nicknameFor(item));
    else suggestName(branchDetail(branchName()));
    showOptions();

    // A closed or merged one is named as that, and works like any other.
    const hint = /** @type {HTMLElement} */ (form.querySelector('.github-hint'));
    hint.textContent = item ? describeItem(item) : GITHUB_HINTS[status] || '';
    hint.hidden = !hint.textContent;
    // Its branch and its title may be in a manager's scope.
    scoping();
  }

  /** The worktree a new contact gets: on the branch of the pull request it starts from, or on a new one. */
  const worktreeFor = (item) =>
    item?.kind === 'pull'
      ? { pullRequest: { number: item.number, branch: item.branch, fork: item.fork } }
      : { branch: branchName(), base: fields.base?.value || 'current', placeholder: isPlaceholder() };

  // The main process says how far it is with the worktree, and the form passes it on.
  const busyText = form.querySelector('.busy-text');
  const stopListening = api.on.contactProgress((step) => {
    busyText.textContent = STEPS[step] || ADDING;
  });

  const result = formDialog({
    title: titleFor(),
    form,
    signal: lifetime.signal,
    ok: existing ? 'OK' : 'Add',
    save: async (signal) => {
      if (addingManager) return undefined;
      busyText.textContent = ADDING;
      // A folder typed just now has not been looked at yet.
      if (!existing && !sameProject) await followFolder();
      // Nor has an issue or pull request typed a moment ago. The form then shows what was found,
      // and stays open for the user to look at before anything is made of it.
      if (!(await lookup.settled())) return undefined;
      const { item } = lookup;
      const values = {
        name: fields.name.value.trim(),
        // The worktree is made from the project's folder.
        cwd: projectFolder(),
        model: fields.model.value.trim(),
        // A new contact has its service's picture.
        avatar: existing ? fields.avatar.value : provider.avatar,
        ...(fields.groupId && { groupId: fields.groupId.value || null }),
      };
      if (!values.cwd && !onComputer) throw new Error('Pick the folder this contact should work in.');
      if (existing && values.cwd !== existing.cwd) {
        const ok = await confirmDialog('Changing the folder starts a fresh conversation. Continue?');
        if (!ok) return undefined;
      }
      // Cancelled while the folder, or the issue or pull request, was still looked at: nothing is saved.
      if (signal.aborted) return undefined;
      if (existing) return api.contacts.update(existing.id, values);
      // Cancelled while the contact is on its way: its worktree is not made, or goes again, and it is never added.
      signal.addEventListener('abort', () => api.contacts.cancelAdd());
      return api.contacts.add({
        ...values,
        // On This computer, the folder is made for it.
        ...(onComputer && { computer: true }),
        provider: fields.provider?.value || provider.id,
        permissionMode: fields.permissionMode.value,
        // The model's own level, unless another was picked.
        ...(fields.effort.value && { effort: fields.effort.value }),
        ...(fields.branch && { worktree: worktreeFor(item) }),
        ...(fields.team?.value && { team: fields.team.value }),
        // The manager it is under, or none (''): only where it has Under.
        ...(underShown() && { under: fields.under.value }),
        // The issue or pull request waits in the new conversation's message box, unsent.
        ...(item && { draft: draftFor(item) }),
      });
    },
  });

  // Another service has its own picture, models and modes, and its own name.
  fields.provider?.addEventListener('change', () => {
    const previous = provider;
    provider = providers.find((p) => p.id === fields.provider.value);
    fill(fields.permissionMode, modeOptions());
    // Start from what the new service starts with, whatever was picked for the old one.
    const start = startFor(onComputer);
    fields.permissionMode.value = start.permissionMode;
    showRisk();
    fields.model.value = start.model;
    showModel();
    showEffort(start.effort);
    learnModels();
    if (fields.name.value.startsWith(previous.name)) {
      const followed = fields.name.value === suggested;
      fields.name.value = provider.name + fields.name.value.slice(previous.name.length);
      if (followed) suggested = fields.name.value;
    }
    showOptions();
  });

  // The worktree's fields come and go with the folder, so the form listens for them.
  form.addEventListener('input', (e) => {
    // Started from an issue or pull request, the contact is named after that, whatever its branch is called.
    if (e.target === fields.branch && !lookup.item) suggestName(branchDetail(branchName()));
    if (e.target === fields.github) lookup.typed(fields.github.value);
    if (e.target === fields.permissionMode) showRisk();
    // A mode picked by hand stays, wherever it works.
    if (e.target === fields.permissionMode) modePicked = true;
    showOptions();
  });
  // What is picked from a list, the model and the group, says so with a change.
  form.addEventListener('change', showOptions);
  // A contact started from another one can start out in its mode.
  if (!existing) showRisk();
  showOptions();

  // ---- Under: which of the project's managers oversees it ------------------------------------
  // Under follows the managers' scopes, as the branch and the issue or pull request say, until a manager is
  // picked in it, or it was added with a manager's +.
  let underPicked = Boolean(under);
  // The manager it shows, or '' for none: Add a manager... goes back to it, and it stays when that is cancelled.
  let underChosen = '';
  /** Whether it has Under: a new contact on a git repository. */
  function underShown() {
    return Boolean(fields.under) && !(/** @type {HTMLElement} */ (form.querySelector('.under-field')).hidden);
  }
  /** Under chooses a manager, by id, or none (''), and says what that means. */
  const chooseUnder = (id, scoped = false) => {
    fields.under.value = underChosen = id;
    form.querySelector('.under-hint').textContent = underHint(id, scoped);
  };
  const followScopes = () => {
    if (!underShown() || underPicked) return;
    const id = scopedManager(managersAtWork(project), {
      branch: fields.branch?.value.trim() ?? '',
      title: lookup.item?.title ?? '',
    });
    chooseUnder(id, Boolean(id));
  };
  /** Under drawn for the project it works on, with `wanted` chosen where it is one of its managers at work. */
  function showUnder(wanted) {
    if (!fields.under) return;
    const drawn = underFor(onComputer ? null : project, wanted);
    /** @type {HTMLElement} */ (form.querySelector('.under-field')).hidden = !drawn;
    if (!drawn) return;
    fill(
      fields.under,
      drawn.choices.map(({ value, label }) => html`<option value="${value}">${label}</option>`)
    );
    chooseUnder(drawn.value);
    followScopes();
  }
  /**
   * Under follows the project picked in Works on: another one's managers start it out again, and on the same one a
   * manager picked stays.
   * @param {import('./manager-dialog.js').ProjectManager | null} next  null for This computer
   */
  function followProject(next) {
    const same = (next?.key ?? '') === (project?.key ?? '');
    project = next;
    if (!same) underPicked = false;
    showUnder(same ? underChosen : '');
  }
  // Add a manager..., or Add another manager..., opens the dialog the project's menu does. The one added is chosen
  // in Under, and the new contact goes under it once it is added. Cancelled, Under stays as it was.
  let addingManager = false;
  async function addUnder() {
    fields.under.value = underChosen;
    if (addingManager || lifetime.signal.aborted) return;
    addingManager = true;
    try {
      const on = project;
      const added = await (managersAtWork(on).length ? addAnotherManager : addManager)(on, {
        providers,
        fromContact: lifetime.signal,
      });
      if (!added || lifetime.signal.aborted) return;
      const asked = await managerOfProject(on.key);
      // Works on moved to another project meanwhile.
      if (project !== on || lifetime.signal.aborted) return;
      project = asked ?? on;
      underPicked = true;
      showUnder(added);
      fields.under.focus();
    } finally {
      addingManager = false;
    }
  }
  fields.under?.addEventListener('change', () => {
    if (fields.under.value === ADDS_MANAGER) return void addUnder();
    underPicked = true;
    chooseUnder(fields.under.value);
  });
  form.addEventListener('input', (e) => {
    if (e.target === fields.branch) followScopes();
  });
  scoping = followScopes;
  showUnder(under);

  // ---- Team: the teams as Settings has them ------------------------------------------------------------------
  // Edit teams... and Set up a team... open Settings, over the form in this window (see putDialogsAside). A team
  // made, changed or deleted there is in the list once the form is back, and the one picked stays unless it went.
  // Settings changes for more than teams, such as another account put in use: the list is left alone then.
  const teamsOf = (settings) => JSON.stringify([settings.teams ?? [], settings.roles ?? []]);
  let teamsShown = teamsOf({ teams, roles });
  const showTeams = (settings) => {
    if (teamsOf(settings) === teamsShown) return;
    teamsShown = teamsOf(settings);
    teams = settings.teams ?? [];
    roles = settings.roles ?? [];
    fill(fields.team, teamOptions(fields.team.value));
    /** @type {HTMLElement} */ (form.querySelector('.team-field')).hidden = !teams.length;
    const noTeam = /** @type {HTMLElement | null} */ (form.querySelector('.no-team'));
    if (noTeam) noTeam.hidden = Boolean(teams.length);
  };
  const stopTeams = existing ? () => {} : api.on.settings(showTeams);
  for (const button of body.querySelectorAll('.edit-teams')) button.addEventListener('click', () => openTeams());
  // A contact being edited browses for another folder. A new one picks where it works from Works on.
  body.querySelector('.browse')?.addEventListener('click', async () => {
    const picked = await api.contacts.pickFolder(fields.cwd.value);
    if (picked) fields.cwd.value = picked;
    if (picked) learnHere();
  });
  // One typed in is a folder its default may come to another model in.
  if (existing) fields.cwd.addEventListener('change', learnHere);
  const whereButton = /** @type {HTMLButtonElement | null} */ (form.querySelector('.where-combo'));
  /** Lays the form out for where it works now: This computer, or a folder. The rest starts out chosen, and Enter takes it. */
  const moveTo = async (there, picked) => {
    onComputer = there;
    fields.cwd.value = picked;
    showWhere();
    learnHere();
    await followFolder();
    begin();
  };
  if (whereButton) {
    showWhere = wherePicker(whereButton, {
      chosen: () => ({ computer: onComputer, folder: fields.cwd.value }),
      projects: () => places.projects,
      pick: ({ computer: there, folder: picked }) => moveTo(there, picked),
      browse: async () => {
        const picked = await api.contacts.pickFolder(fields.cwd.value);
        if (picked) await moveTo(false, picked);
      },
    });
    // The projects arrive a moment later: the list has them, and This computer the folder it would get.
    placesAsked?.then((found) => {
      places = found;
      showWhere();
      if (onComputer && shown === COMPUTER) {
        /** @type {HTMLElement} */ (form.querySelector('.folder-hint')).textContent = onItsOwn(found.computer?.folder);
      }
    });
  }

  // Even the nickname can be left as it is.
  setTimeout(begin);
  // The folder it starts out with is looked at as one browsed for here, and This computer for the folder it gets.
  if (opened || onComputer) followFolder().then(begin);
  return result.finally(() => {
    lifetime.abort();
    signal?.removeEventListener('abort', cancel);
    stopListening();
    stopTeams();
  });
}
