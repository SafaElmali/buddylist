// "Add a manager": a project's manager in one small dialog, from the project's right-click menu, the Contacts menu,
// Assign to manager... of a conversation on a project with none, or Under in Add a Contact, where Settings has it a
// few pages deep. It turns the manager on as the Manager page's switch does, with a light model and the first place
// it learns from, and opens its conversation. From the Contacts menu it can be any repository on the disk, one no
// contact works in yet too. "Add another manager" adds one more to a project that has one, by the name given, for
// the conversations put under it.
import { api } from '../lib/api.js';
import { el, errorText, html } from '../lib/dom.js';
import { formDialog, infoDialog, messageBody } from '../lib/dialog.js';
import { cantManage, MANAGER_MODEL, projectManagerName, turnedOn, withoutManager } from '../../shared/managers.js';
import { modelPicker, servicePicker } from './model-picker.js';
import { askModels } from './models.js';
import { creatingManager } from './creation-flow.js';

/** @typedef {import('../../providers/contract.js').ProviderDescriptor} ProviderDescriptor */

/**
 * A project with its manager, as the main process says it (see REQUESTS.projectManager in main/ipc.js).
 * @typedef {Object} ProjectManager
 * @property {string} key
 * @property {string} name
 * @property {boolean} repository  only a repository has worktrees for a manager to oversee
 * @property {import('../../shared/managers.js').ManagerSettings} settings
 * @property {string | null} contactId  its manager, turned on or not; null while it has none
 * @property {{ id: string, name: string, archived: boolean, leads?: boolean, settings: import('../../shared/managers.js').ManagerSettings }[]} [managers]
 *   every manager of the project, its first first
 */

/**
 * What the dialog needs of the window it is in.
 * @typedef {Object} Adding
 * @property {ProviderDescriptor[]} providers  the available services
 * @property {(contactId: string) => void} [open]  shows the manager's conversation; left out, it stays closed
 * @property {AbortSignal} [fromContact]  only Under supplies this to return to its existing Add Contact draft
 * @property {string} [folder]  where the picker starts for a repository on the disk: where projects were last put
 */

const OPTIONAL = html`<span class="optional">Optional</span>`;

/** The services a manager can be of: the ones with the app's tools. @param {ProviderDescriptor[]} providers */
const managing = (providers) => providers.filter((provider) => provider.appTools);

const serviceField = (selected = 'claude') =>
  html`<label
    >Service
    <input type="hidden" name="provider" value="${selected}" />
    <button type="button" class="combo service-combo" aria-haspopup="menu"></button>
  </label>`;

/** Service and Model: picking a service starts Model at its usual one. Answers what draws both anew. */
function serviceModel(form, providers) {
  const fields = form.elements;
  const provider = () => providers.find((one) => one.id === fields.provider.value);
  const showService = servicePicker(form.querySelector('.service-combo'), fields.provider, managing(providers));
  const show = modelPicker(form.querySelector('.model-combo'), fields.model, provider);
  const learn = () => {
    showService();
    show();
    askModels(provider()).then(show, () => {});
  };
  fields.provider.addEventListener('change', () => {
    fields.model.value = fields.provider.value === 'claude' ? MANAGER_MODEL : '';
    learn();
  });
  learn();
  return learn;
}

/** Project's last choice, which picks a repository on the disk. No project's key is like it. */
const ANOTHER = 'another';

/** How long a manager's name can be, as a contact's nickname. */
const NAME_MAX = 40;

/**
 * The project a contact works on, with its manager. Null where that can't be said.
 * @param {string} contactId
 * @returns {Promise<ProjectManager | null>}
 */
export const managerOf = (contactId) => api.projects.manager({ contactId }).catch(() => null);

/**
 * The same for a project by its key: one nobody works on any more has no contact to ask by.
 * @param {string} key
 * @returns {Promise<ProjectManager | null>}
 */
export const managerOfProject = (key) => api.projects.manager({ project: key }).catch(() => null);

/**
 * The same for the project a folder is in: one picked in Add a Contact's Works on, or on the disk, which no contact
 * may work in yet. Looked at anew.
 * @param {string} folder
 * @returns {Promise<ProjectManager | null>}
 */
export const managerOfFolder = (folder) => api.projects.manager({ folder }).catch(() => null);

/**
 * A repository for a manager, picked on the disk: no contact needs to work in it yet. Null when given up. Throws,
 * for the user, for a folder that can't have one (see cantManage).
 * @param {string} folder  where the picker starts
 * @returns {Promise<ProjectManager | null>}
 */
async function pickRepository(folder) {
  const picked = await api.contacts.pickFolder(folder, 'manager');
  if (!picked) return null;
  const project = await managerOfFolder(picked);
  const problem = cantManage(project);
  if (problem) throw new Error(problem);
  return project;
}

/**
 * The dialog. Add manager turns the manager on, and closes it with the manager's contact.
 * @param {ProjectManager[]} projects  the ones it can be added to: one, settled already, or several to pick from
 * @param {string} key  the one picked to begin with
 * @param {ProviderDescriptor[]} providers
 * @param {() => Promise<ProjectManager | null>} [pick]  finds another, on the disk: given, Project is always there,
 *   with "Another repository..." last
 * @param {{ id: string, name: string }} [under]  the conversation it was added for, from its Assign to manager...:
 *   it goes under the manager
 * @param {AbortSignal} [signal]  the lifetime of this creation flow
 * @returns {Promise<string | null>}  the manager's contact; null when cancelled
 */
function managerDialog(projects, key, providers, pick, under, signal) {
  const start = projects.find((project) => project.key === key) ?? projects[0];
  const settled = projects.length === 1 && !pick;
  const offered = [...projects];
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="manager-form">
        <p class="dialog-message">
          ${
            under
              ? html`${start.name} has no manager yet. Add one, and ${under.name} goes under it: a contact that looks at
                the changes of each conversation under it, each time it changes files, and tells it what has to change.
                It changes no files itself.`
              : html`A contact that oversees the conversations on ${settled ? start.name : 'a project'} you put under
                it: with Under in Add a Contact, the + on its row, or by dragging them onto it. Each time one of them
                changes files, it looks at the changes and tells it what has to change. It changes no files itself.`
          }
        </p>
        ${
          settled
            ? ''
            : html`<label
                >Project
                <select name="project">
                  ${projects.map(
                    (project) =>
                      html`<option value="${project.key}" ${project === start ? 'selected' : ''}>
                        ${project.name}
                      </option>`
                  )}
                  ${pick ? html`<option value="${ANOTHER}">Another repository...</option>` : ''}
                </select>
              </label>`
        }
        ${serviceField(start.settings.provider || 'claude')}
        <label
          >Model
          <input
            type="hidden"
            name="model"
            value="${start.settings.model || (!start.settings.provider || start.settings.provider === 'claude' ? MANAGER_MODEL : '')}"
          />
          <button type="button" class="combo model-combo" aria-haspopup="menu"></button>
          <span class="hint"
            >It takes a turn after every change, using the selected service: a lighter model uses less of your
            plan.</span
          >
        </label>
        <label
          ><span class="field-label">First source ${OPTIONAL}</span>
          <input
            type="text"
            name="link"
            maxlength="2000"
            spellcheck="false"
            placeholder="A link to the PRD, a ticket or a Slack thread"
          />
          <span class="hint"
            >Where it learns what the project is building. Share more in its conversation, or add them on its Manager
            page in Settings.</span
          >
        </label>
        <div class="error" hidden></div>
      </form>`
    )
  );
  const fields = /** @type {any} */ (form.elements);
  serviceModel(form, providers);

  // "Another repository...": the one picked on the disk is offered with the others, and picked. Given up, or one
  // that can't have a manager, Project stays at the one before.
  const error = /** @type {HTMLElement} */ (form.querySelector('.error'));
  let before = start.key;
  fields.project?.addEventListener('change', async () => {
    if (fields.project.value !== ANOTHER) {
      before = fields.project.value;
      return;
    }
    fields.project.value = before;
    error.hidden = true;
    try {
      const project = await pick();
      if (!project) return;
      if (!offered.some((one) => one.key === project.key)) {
        offered.push(project);
        fields.project
          .querySelector(`option[value="${ANOTHER}"]`)
          .before(el(html`<option value="${project.key}">${project.name}</option>`));
      }
      fields.project.value = before = project.key;
    } catch (err) {
      error.textContent = errorText(err);
      error.hidden = false;
    }
  });

  const result = formDialog({
    title: settled ? `Add a manager to ${start.name}` : 'Add a manager',
    form,
    signal,
    ok: 'Add manager',
    save: async (saving) => {
      const project = offered.find((one) => one.key === fields.project?.value) ?? start;
      // The request the Manager page's switch makes, which starts the manager, or brings its contact back.
      await api.projects.update(project.key, {
        manager: turnedOn(project.settings, {
          provider: fields.provider.value,
          model: fields.model.value,
          link: fields.link.value,
        }),
      });
      const managerId = (await api.projects.manager({ project: project.key }))?.contactId ?? null;
      if (managerId && under && !saving.aborted) await api.contacts.assign(under.id, managerId, 'menu');
      return managerId;
    },
  });
  setTimeout(() => form.isConnected && fields.link.focus());
  return result;
}

/**
 * Start from's choices, in the dialog for another manager: each of the project's managers, with its brief and
 * without, and last nothing. Its value is how much is copied and from whom, such as "brief:<id>"; '' for nothing.
 * @param {NonNullable<ProjectManager['managers']>} managers
 */
const startFromField = (managers) =>
  html`<label
    >Start from
    <select name="from">
      ${managers.flatMap((one) => [
        html`<option value="brief:${one.id}">${one.name}’s settings and brief</option>`,
        html`<option value="settings:${one.id}">${one.name}’s settings</option>`,
      ])}
      <option value="">Nothing: a fresh start</option>
    </select>
    <span class="hint"
      >A copy of its sources, checks and instructions, and of its brief if you like, as they are now: each manager keeps
      its own from then on. Scope is never copied.</span
    >
  </label>`;

/**
 * What Start from picked: the manager to start from, by id, and whether with its brief. Nothing without the field.
 * @param {string} [value]
 */
function startFrom(value = '') {
  const [copy, from = ''] = value.split(':');
  return { from, withBrief: Boolean(from) && copy === 'brief' };
}

/**
 * The dialog for another manager. Add manager adds it, and closes it with the manager's contact. It starts from the
 * settings and brief of the project's first manager, with its service and model, unless Start from says otherwise.
 * @param {ProjectManager} project
 * @param {ProviderDescriptor[]} providers
 * @param {NonNullable<ProjectManager['managers']>} managers  the ones it can start from
 * @param {AbortSignal} signal  the lifetime of this creation flow
 * @returns {Promise<string | null>}  the manager's contact; null when cancelled
 */
function anotherManagerDialog(project, providers, allManagers, signal) {
  // A project manager oversees managers: there is nothing of it for a manager of conversations to start from.
  const managers = allManagers.filter((one) => !one.leads);
  const offered = new Set(managing(providers).map((provider) => provider.id));
  /** The service and model a manager starts with: the one's it starts from, where that service is offered here. */
  const usesOf = (from) => {
    const settings = managers.find((one) => one.id === from)?.settings;
    const provider = settings?.provider || 'claude';
    return settings && offered.has(provider)
      ? { provider, model: settings.model }
      : { provider: 'claude', model: MANAGER_MODEL };
  };
  const uses = usesOf(managers[0]?.id);
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="manager-form">
        <p class="dialog-message">
          Another manager on ${project.name}, for some of its conversations: the ones you put under it, with Under in
          Add a Contact, the + on its row, or by dragging them onto it. It oversees those alone.
        </p>
        <label
          >Name
          <input type="text" name="name" maxlength="${NAME_MAX}" spellcheck="false" placeholder="release manager" />
        </label>
        <label
          ><span class="field-label">Scope ${OPTIONAL}</span>
          <input type="text" name="scope" maxlength="2000" spellcheck="false" placeholder="safa/release/*, COM-6*" />
          <span class="hint"
            >Branches, or ticket keys, separated by commas: Add a Contact starts a new contact under it when they take
            its branch, or its issue or pull request.</span
          >
        </label>
        ${managers.length ? startFromField(managers) : ''} ${serviceField(uses.provider)}
        <label
          >Model
          <input type="hidden" name="model" value="${uses.model}" />
          <button type="button" class="combo model-combo" aria-haspopup="menu"></button>
          <span class="hint"
            >It takes a turn after every change, using the selected service: a lighter model uses less of your
            plan.</span
          >
        </label>
        <label
          ><span class="field-label">First source ${OPTIONAL}</span>
          <input
            type="text"
            name="link"
            maxlength="2000"
            spellcheck="false"
            placeholder="A link to the PRD, a ticket or a Slack thread"
          />
        </label>
        <div class="error" hidden></div>
      </form>`
    )
  );
  const fields = /** @type {any} */ (form.elements);
  const learn = serviceModel(form, providers);
  // Service and Model follow the manager it starts from, and can still be changed.
  fields.from?.addEventListener('change', () => {
    const { provider, model } = usesOf(startFrom(fields.from.value).from);
    fields.provider.value = provider;
    fields.model.value = model;
    learn();
  });
  const result = formDialog({
    title: `Add another manager to ${project.name}`,
    form,
    signal,
    ok: 'Add manager',
    save: () =>
      api.projects.addManager(project.key, {
        name: fields.name.value,
        provider: fields.provider.value,
        scope: fields.scope.value,
        model: fields.model.value,
        link: fields.link.value,
        ...startFrom(fields.from?.value),
      }),
  });
  setTimeout(() => form.isConnected && fields.name.focus());
  return result;
}

/**
 * "Add another manager..." in a project's menu, and at the end of Add a Contact's Under: the dialog for that project,
 * then the new manager's conversation.
 * @param {ProjectManager} project
 * @param {Adding} adding
 * @returns {Promise<string | null>}  the manager's contact; null when cancelled
 */
export function addAnotherManager(project, { providers, open, fromContact }) {
  return creatingManager(async (signal) => {
    // Asked anew, for what each manager is set up with now: Settings knows them by name alone.
    const managers = ((await managerOfProject(project.key))?.managers ?? []).filter((one) => !one.archived);
    if (signal.aborted) return null;
    const contactId = await anotherManagerDialog(project, providers, managers, signal);
    if (contactId && !signal.aborted) open?.(contactId);
    return contactId;
  }, fromContact);
}

/**
 * The dialog for a project's project manager: a manager over its managers, which hands their work on as the user asks.
 * Add project manager adds it, and closes it with its contact. It starts from nothing, on Claude with the light model
 * a manager starts with: it oversees managers, so what it checks, its scope and its workers are none of its.
 * @param {ProjectManager} project
 * @param {ProviderDescriptor[]} providers
 * @param {AbortSignal} signal  the lifetime of this creation flow
 * @returns {Promise<string | null>}  its contact; null when cancelled
 */
function projectManagerDialog(project, providers, signal) {
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="manager-form">
        <p class="dialog-message">
          A manager over ${project.name}’s managers. Tell it what to do, such as “send the coder manager’s finished jobs
          to the review manager”: it hands the job on, the managers start their own workers, and it passes the verdict
          back. It changes no files, and asks you before each message it sends.
        </p>
        <label
          >Name
          <input
            type="text"
            name="name"
            maxlength="${NAME_MAX}"
            spellcheck="false"
            placeholder="${projectManagerName(project.name)}"
          />
        </label>
        ${serviceField()}
        <label
          >Model
          <input type="hidden" name="model" value="${MANAGER_MODEL}" />
          <button type="button" class="combo model-combo" aria-haspopup="menu"></button>
          <span class="hint"
            >It hears from the managers alone, never of every change their workers make: a lighter model is
            enough.</span
          >
        </label>
        <label
          ><span class="field-label">First source ${OPTIONAL}</span>
          <input
            type="text"
            name="link"
            maxlength="2000"
            spellcheck="false"
            placeholder="A link to the PRD, a ticket or a Slack thread"
          />
        </label>
        <div class="error" hidden></div>
      </form>`
    )
  );
  const fields = /** @type {any} */ (form.elements);
  serviceModel(form, providers);
  const result = formDialog({
    title: `Add a project manager to ${project.name}`,
    form,
    signal,
    ok: 'Add project manager',
    save: () =>
      api.projects.addManager(project.key, {
        lead: true,
        name: fields.name.value,
        provider: fields.provider.value,
        model: fields.model.value,
        link: fields.link.value,
      }),
  });
  setTimeout(() => form.isConnected && fields.name.focus());
  return result;
}

/**
 * "Add a project manager..." in a project's menu, and on its Manager page in Settings: the dialog for that project,
 * then the project manager's conversation.
 * @param {ProjectManager} project
 * @param {Adding} adding
 * @returns {Promise<string | null>}  its contact; null when cancelled
 */
export function addProjectManager(project, { providers, open, fromContact }) {
  return creatingManager(async (signal) => {
    const contactId = await projectManagerDialog(project, providers, signal);
    if (contactId && !signal.aborted) open?.(contactId);
    return contactId;
  }, fromContact);
}

/**
 * "Add a manager..." in a project's menu, and at the end of Add a Contact's Under: the dialog for that project, then
 * the manager's conversation.
 * @param {ProjectManager} project
 * @param {Adding} adding
 * @returns {Promise<string | null>}  the manager's contact; null when cancelled
 */
export function addManager(project, { providers, open, fromContact }) {
  return creatingManager(async (signal) => {
    const contactId = await managerDialog([project], project.key, providers, undefined, undefined, signal);
    if (contactId && !signal.aborted) open?.(contactId);
    return contactId;
  }, fromContact);
}

/**
 * Assign to manager... of a conversation whose project has no manager: the dialog for its project, which puts it
 * under the manager it adds, then the manager's conversation. A project that can't have one, such as a folder
 * outside a repository, says why instead.
 * @param {{ id: string, name: string }} contact
 * @param {Adding} adding
 */
export function addManagerFor(contact, { providers, open }) {
  return creatingManager(async (signal) => {
    const project = await managerOf(contact.id);
    if (signal.aborted) return null;
    const problem = cantManage(project);
    if (problem) {
      await infoDialog('Assign to manager', messageBody(problem));
      return null;
    }
    const contactId = await managerDialog([project], project.key, providers, undefined, contact, signal);
    if (contactId && !signal.aborted) open?.(contactId);
    return contactId;
  });
}

/**
 * "Add a manager..." in the Contacts menu: the dialog for any repository a contact works on that has no manager,
 * the selected contact's to begin with, or for one on the disk. With none of the first, the one on the disk is
 * picked before the dialog opens.
 * @param {any[]} contacts  the contact list's
 * @param {any | null} selected
 * @param {Adding} adding
 */
export function addManagerToAny(contacts, selected, { providers, open, folder = '' }) {
  return creatingManager(async (signal) => {
    const asked = await Promise.all(contacts.map((contact) => managerOf(contact.id)));
    if (signal.aborted) return null;
    const projects = withoutManager(asked);
    const pick = () => pickRepository(folder);
    if (!projects.length) {
      try {
        const picked = await pick();
        if (!picked || signal.aborted) return null;
        projects.push(picked);
      } catch (err) {
        await infoDialog('Add a manager', messageBody(errorText(err)));
        return null;
      }
    }
    const contactId = await managerDialog(
      projects,
      asked[contacts.indexOf(selected)]?.key ?? '',
      providers,
      pick,
      undefined,
      signal
    );
    if (contactId && !signal.aborted) open?.(contactId);
    return contactId;
  });
}

/**
 * "Turn off manager", as the Manager page's switch turns it off: its contact stays, with its conversation.
 * @param {ProjectManager} project
 */
export function turnOffManager(project) {
  return api.projects
    .update(project.key, { manager: { ...project.settings, on: false } })
    .catch((err) => infoDialog('buddylist', messageBody(errorText(err))));
}
