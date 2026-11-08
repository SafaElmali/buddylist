// "Clone GitHub repo" and "Create project": two ways to a project that is not
// on this computer yet. Both answer with the project's folder, for a contact to
// be added in. And the three ways Add project lists, in every window that has it.
import { api } from '../lib/api.js';
import { el, errorText, html } from '../lib/dom.js';
import { busyLine, formDialog } from '../lib/dialog.js';
import {
  matchingRepositories,
  parseRepository,
  PROJECT_NAME_MAX,
  projectFolderName,
  REPOSITORY_HELP,
} from '../../shared/projects.js';

/** @typedef {import('../../shared/projects.js').RecentRepository} RecentRepository */

/** Where the project goes: a folder to type, or to browse for. */
const parentField = (caption, folder) =>
  html`<label
    >${caption}
    <span class="row">
      <input type="text" name="parent" spellcheck="false" value="${folder}" />
      <button type="button" class="btn browse">Browse...</button>
    </span>
  </label>`;

function browseForParent(form) {
  const { parent } = /** @type {any} */ (form.elements);
  form.querySelector('.browse').addEventListener('click', async () => {
    const picked = await api.contacts.pickFolder(parent.value, 'parent');
    if (picked) parent.value = picked;
  });
}

/** What the form's busy line says about the save that starts now. */
function say(form, text) {
  form.querySelector('.busy-text').textContent = text;
}

/**
 * What Add project's choices do (see projectItems in list-menu.js): each finds the project's
 * folder, a folder that is here, a clone or a new one, and then goes on with it.
 * @param {() => string} folder  where the last project went, offered again
 * @param {(folder: string | null) => void} then  the project's folder, or null when it was given up
 */
export function projectWays(folder, then) {
  const way = (find) => async () => then(await find(folder()));
  return {
    openProject: way((at) => api.contacts.pickFolder(at)),
    cloneProject: way((at) => cloneDialog({ folder: at })),
    quickStart: way((at) => quickStartDialog({ folder: at })),
  };
}

/**
 * "Clone GitHub repo": an address to clone, typed or picked from the user's own repositories.
 * @param {{ folder: string }} opts  `folder`: where the last project went, offered again
 * @returns {Promise<string | null>}  the cloned project's folder, or null
 */
export function cloneDialog({ folder }) {
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="project-form">
        <label
          >Repository URL
          <input type="text" name="repository" spellcheck="false" placeholder="https://github.com/user/repo.git" />
        </label>
        <label
          >Recent repositories
          <input type="text" name="search" spellcheck="false" placeholder="Search repositories..." />
        </label>
        <div class="repo-list" role="listbox" aria-label="Recent repositories">
          <div class="repo-note">Looking on GitHub...</div>
        </div>
        ${parentField('Location', folder)} ${busyLine('Cloning...')}
        <div class="error" hidden></div>
      </form>`
    )
  );
  const fields = /** @type {any} */ (form.elements);
  const list = /** @type {HTMLElement} */ (form.querySelector('.repo-list'));
  /** @type {RecentRepository[]} */
  let repos = [];

  const note = (text) => list.replaceChildren(el(html`<div class="repo-note">${text}</div>`));
  function showRepositories() {
    const found = matchingRepositories(repos, fields.search.value);
    if (!found.length)
      return note(repos.length ? 'No repository matches that.' : 'You have no repositories on GitHub.');
    list.replaceChildren(
      ...found.map((repo) => {
        const row = el(
          html`<button
            type="button"
            class="repo${repo.address === fields.repository.value.trim() ? ' selected' : ''}"
            role="option"
            title="${repo.address}"
          >
            <span class="repo-name"
              >${repo.slug}${repo.private ? html`<span class="repo-tag">private</span>` : ''}</span
            >
            ${repo.description && html`<span class="repo-description">${repo.description}</span>`}
          </button>`
        );
        row.addEventListener('click', () => {
          fields.repository.value = repo.address;
          showRepositories();
        });
        return row;
      })
    );
  }
  // Without gh the list stays away, and an address can still be typed.
  api.projects.repositories().then(
    (found) => {
      repos = found;
      showRepositories();
    },
    (err) => note(errorText(err))
  );
  fields.search.addEventListener('input', showRepositories);
  fields.repository.addEventListener('input', showRepositories);
  // Enter in the search box is not yet a wish to clone.
  fields.search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });
  browseForParent(form);

  const result = formDialog({
    title: 'Clone GitHub repo',
    form,
    ok: 'Clone repo',
    save: () => {
      const repository = fields.repository.value.trim();
      const reference = parseRepository(repository);
      if (!reference) throw new Error(REPOSITORY_HELP);
      say(form, `Cloning ${reference.name}. A big repository takes a while...`);
      return api.projects.clone({ repository, parent: fields.parent.value });
    },
  });
  setTimeout(() => fields.repository.focus());
  return result;
}

/**
 * "Create project": a new folder with a git repository in it and, if wanted, a private one on GitHub.
 * @param {{ folder: string }} opts  `folder`: where the last project went, offered again
 * @returns {Promise<string | null>}  the new project's folder, or null
 */
export function quickStartDialog({ folder }) {
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="project-form">
        <label
          >Project name
          <input type="text" name="name" maxlength="${PROJECT_NAME_MAX}" spellcheck="false" />
          <span class="hint name-hint"></span>
        </label>
        ${parentField('Parent folder', folder)}
        <label class="choice">
          <input type="checkbox" name="github" checked />
          Create a private GitHub repository
        </label>
        ${busyLine('Creating it...')}
        <div class="error" hidden></div>
      </form>`
    )
  );
  const fields = /** @type {any} */ (form.elements);
  const hint = /** @type {HTMLElement} */ (form.querySelector('.name-hint'));
  // The folder is named the way GitHub would name the repository, and says so as it is typed.
  function showName() {
    const name = projectFolderName(fields.name.value);
    const what = fields.github.checked ? 'folder and repository' : 'folder';
    hint.textContent = name
      ? `Creates the ${what} ${name}, with a first commit.`
      : 'It gets a git repository of its own.';
  }
  form.addEventListener('input', showName);
  showName();
  browseForParent(form);

  const result = formDialog({
    title: 'Create project',
    form,
    ok: 'Create',
    save: () => {
      say(form, fields.github.checked ? 'Creating it here and on GitHub...' : 'Creating it...');
      return api.projects.create({
        name: fields.name.value,
        parent: fields.parent.value,
        github: fields.github.checked,
      });
    },
  });
  setTimeout(() => fields.name.focus());
  return result;
}
