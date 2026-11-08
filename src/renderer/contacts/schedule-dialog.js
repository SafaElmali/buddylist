// "New schedule" / "Edit schedule": a prompt that starts a new contact by itself, on a cadence, while the app is
// open (see main/schedules.js). It asks for the prompt, the project its runs work on, or This computer, and how
// often: a preset with its time and day, or a cron of your own, with what that comes to in words and when it runs
// next. And how many runs it has, if not all of them. Its service is the first there is, unless you pick another,
// and its model, effort level and mode are the ones Settings > New contacts picks for that service, folded under
// "More options" as Add a Contact has them.
import { api } from '../lib/api.js';
import { el, html } from '../lib/dom.js';
import { formDialog } from '../lib/dialog.js';
import { whenNext } from '../lib/format.js';
import { newContactStart } from '../../shared/contact-defaults.js';
import { cronProblem, nextRun } from '../../shared/cron.js';
import { currentModel, defaultNamed, effortLabel } from '../../shared/models.js';
import {
  DEFAULT_TIME,
  MAX_RUNS_MAX,
  PRESETS,
  SCHEDULE_NAME_MAX,
  WEEKDAYS,
  cadenceWords,
  presetCron,
  presetOf,
} from '../../shared/schedules.js';
import { optionsSummary } from './contact-options.js';
import { modelOption } from './model-choices.js';
import { effortPicker, modelPicker, servicePicker } from './model-picker.js';
import { askModels, modelsOf } from './models.js';
import { wherePicker } from './where-picker.js';

const OPTIONAL = html`<span class="optional">Optional</span>`;
// Said under the mode that asks nothing, as Add a Contact says it.
const RISKY = "It runs commands and changes files without asking. Only pick this for a folder you don't mind breaking.";
const IN_PROJECT = 'Each run is a new contact, in a worktree of its own where the project is a git repository.';
const ON_COMPUTER = 'Each run is a new contact, in a new, empty folder of its own.';

/**
 * What Max runs says under it.
 * @param {string} typed  what is in its box
 */
export const maxRunsHint = (typed) => {
  const runs = Number(typed);
  if (!typed.trim()) return 'It runs until you turn it off.';
  if (!Number.isInteger(runs) || runs < 1) return 'A whole number from 1 up, or empty for no end.';
  return runs === 1 ? 'It turns itself off after its first run.' : `It turns itself off after ${runs} runs.`;
};

/**
 * What the line under the cron says: when it runs, in words, and when next.
 * @param {string} cron
 * @param {number} [now]
 * @returns {{ words: string, next: string, problem: boolean }}
 */
export function cadenceLine(cron, now = Date.now()) {
  const problem = cronProblem(cron, now);
  if (problem) return { words: problem, next: '', problem: true };
  return { words: `${cadenceWords(cron)}.`, next: `Next run: ${whenNext(nextRun(cron, now), now)}`, problem: false };
}

/**
 * @param {object} opts
 * @param {import('../../providers/contract.js').ProviderDescriptor[]} opts.providers
 * @param {import('../../shared/contact-defaults.js').ContactDefaultsByService} [opts.defaults]  Settings > New contacts
 * @param {import('../../shared/schedules.js').Schedule | null} [opts.existing]  the schedule being edited
 * @returns {Promise<import('../../main/schedules.js').ScheduleView | null>}  the one saved, or null for Cancel
 */
export function scheduleDialog({ providers, defaults = {}, existing = null }) {
  let provider = providers.find((one) => one.id === existing?.provider) ?? providers[0];
  let onComputer = existing?.computer === true;
  const startFor = () => newContactStart({ provider, defaults, computer: onComputer });
  const start = existing
    ? { model: existing.model, effort: existing.effort, permissionMode: existing.permissionMode }
    : startFor();
  const cron = existing?.cron ?? presetCron('weekdays');
  const shape = presetOf(cron);
  const modeOptions = () =>
    provider.permissionModes.map(
      (m) => html`<option value="${m.id}" ${start.permissionMode === m.id ? 'selected' : ''}>${m.label}</option>`
    );
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="contact-form schedule-form">
        <label
          ><span class="field-label">Name ${OPTIONAL}</span>
          <input
            type="text"
            name="name"
            maxlength="${SCHEDULE_NAME_MAX}"
            value="${existing?.name ?? ''}"
            placeholder="Named after the prompt"
          />
        </label>
        <label
          >Prompt
          <textarea name="prompt" rows="4" placeholder="What should the agent do each run?"></textarea>
        </label>
        <label
          >Project
          <input type="hidden" name="cwd" value="${existing?.cwd ?? ''}" />
          <button type="button" class="combo where-combo" aria-haspopup="menu"></button>
          <span class="hint where-hint">${onComputer ? ON_COMPUTER : IN_PROJECT}</span>
        </label>
        <label
          >Cadence
          <span class="cadence-row">
            <select name="preset" aria-label="Cadence">
              ${PRESETS.map(
                ({ id, label }) =>
                  html`<option value="${id}" ${shape.preset === id ? 'selected' : ''}>${label}</option>`
              )}
            </select>
            <select name="weekday" aria-label="Day">
              ${WEEKDAYS.map(
                ({ value, label }) =>
                  html`<option value="${value}" ${shape.weekday === value ? 'selected' : ''}>${label}</option>`
              )}
            </select>
            <input type="time" name="time" value="${shape.time}" aria-label="Time" />
          </span>
          <input type="text" class="cron-input" name="cron" spellcheck="false" value="${cron}" aria-label="Cron" />
          <span class="hint cadence-words"><span class="cadence-said"></span><span class="next-run"></span></span>
        </label>
        <label
          ><span class="field-label">Max runs ${OPTIONAL}</span>
          <input
            type="number"
            name="maxRuns"
            min="1"
            max="${MAX_RUNS_MAX}"
            step="1"
            placeholder="Unlimited"
            value="${existing?.maxRuns ?? ''}"
          />
          <span class="hint max-runs-hint"></span>
        </label>
        ${
          providers.length > 1
            ? html`<label
                >Service
                <input type="hidden" name="provider" value="${provider.id}" />
                <button type="button" class="combo service-combo" aria-haspopup="menu"></button>
              </label>`
            : ''
        }
        <details class="more-options">
          <summary>More options<span class="options-summary"></span></summary>
          <div class="more-fields">
            <label
              >Model
              <input type="hidden" name="model" value="${start.model}" />
              <button type="button" class="combo model-combo" aria-haspopup="menu"></button>
            </label>
            <label
              >Effort
              <input type="hidden" name="effort" value="" />
              <button type="button" class="combo effort-combo" aria-haspopup="menu"></button>
            </label>
            <label
              >When it wants to do something
              <select name="permissionMode">
                ${modeOptions()}
              </select>
            </label>
          </div>
        </details>
        <span class="hint warning mode-warning" hidden>${RISKY}</span>
        <div class="error" hidden></div>
      </form>`
    )
  );
  const fields = /** @type {any} */ (form.elements);
  // A textarea's words are its value, which markup would have to escape and keep line breaks in.
  fields.prompt.value = existing?.prompt ?? '';
  const $ = (selector) => /** @type {HTMLElement} */ (form.querySelector(selector));

  // ---- where its runs work --------------------------------------------------------------------
  const folder = () => (onComputer ? '' : fields.cwd.value);
  let places = { computer: null, projects: [] };
  const showWhere = wherePicker(/** @type {HTMLButtonElement} */ ($('.where-combo')), {
    chosen: () => ({ computer: onComputer, folder: fields.cwd.value }),
    projects: () => places.projects,
    pick: ({ computer, folder: picked }) => moveTo(computer, picked),
    browse: async () => {
      const picked = await api.contacts.pickFolder(fields.cwd.value);
      if (picked) moveTo(false, picked);
    },
  });
  api.contacts.places().then(
    (found) => {
      places = found;
      showWhere();
    },
    () => {}
  );
  function moveTo(computer, picked) {
    onComputer = computer;
    fields.cwd.value = computer ? '' : picked;
    $('.where-hint').textContent = onComputer ? ON_COMPUTER : IN_PROJECT;
    showWhere();
    learnModels();
  }

  // ---- how often --------------------------------------------------------------------------------
  /** The time and the day show where the preset has them: Custom cron says both in the cron. */
  const showPreset = () => {
    const preset = fields.preset.value;
    fields.time.hidden = preset === 'custom' || preset === 'hourly';
    fields.weekday.hidden = preset !== 'weekly';
  };
  const showCadence = () => {
    const { words, next, problem } = cadenceLine(fields.cron.value);
    $('.cadence-said').textContent = words;
    $('.next-run').textContent = next;
    $('.cadence-words').classList.toggle('warning', problem);
  };
  // A preset, or its time or day, writes the cron. Custom leaves it as it is, to be changed by hand.
  const fromPreset = () => {
    showPreset();
    const preset = fields.preset.value;
    if (preset === 'custom') fields.cron.focus();
    else fields.cron.value = presetCron(preset, { time: fields.time.value, weekday: Number(fields.weekday.value) });
    showCadence();
  };
  // A cron typed by hand is shown as the preset it is, and as Custom cron otherwise.
  const fromCron = () => {
    const found = presetOf(fields.cron.value);
    fields.preset.value = found.preset;
    if (found.preset !== 'custom') {
      fields.time.value = found.time;
      fields.weekday.value = String(found.weekday);
    }
    showPreset();
    showCadence();
  };
  fields.preset.addEventListener('change', fromPreset);
  fields.time.addEventListener('change', fromPreset);
  fields.weekday.addEventListener('change', fromPreset);
  fields.cron.addEventListener('input', fromCron);
  // An empty time box, as a time cleared by hand leaves it, is the time a new one starts with.
  fields.time.addEventListener('blur', () => {
    if (!fields.time.value) fields.time.value = DEFAULT_TIME;
  });
  showPreset();
  showCadence();

  const showMaxRuns = () => ($('.max-runs-hint').textContent = maxRunsHint(fields.maxRuns.value));
  fields.maxRuns.addEventListener('input', showMaxRuns);
  showMaxRuns();

  // ---- who answers ------------------------------------------------------------------------------
  if (fields.provider)
    servicePicker(/** @type {HTMLButtonElement} */ ($('.service-combo')), fields.provider, providers);
  const showModel = modelPicker(/** @type {HTMLButtonElement} */ ($('.model-combo')), fields.model, () => provider, {
    folder,
  });
  const showEffort = effortPicker(/** @type {HTMLButtonElement} */ ($('.effort-combo')), fields.effort, {
    provider: () => provider,
    model: () => fields.model.value.trim(),
    picked: start.effort,
    folder,
  });
  const showRisk = () => {
    const mode = provider.permissionModes.find((m) => m.id === fields.permissionMode.value);
    $('.mode-warning').hidden = !mode?.danger;
  };
  // The line beside "More options" says what is chosen under it.
  const showOptions = () => {
    const { catalog } = modelsOf(provider, folder());
    const mode = provider.permissionModes.find((m) => m.id === fields.permissionMode.value);
    const usual = currentModel({ model: '', defaultModel: null }, catalog)?.label;
    $('.options-summary').textContent = optionsSummary({
      branch: null,
      model: fields.model.value ? modelOption(catalog, fields.model.value).label : defaultNamed(usual, 'Default model'),
      effort: fields.effort.value && effortLabel(fields.effort.value),
      mode: mode?.short ?? mode?.label,
    });
  };
  const showModels = () => {
    showModel();
    showEffort();
    showOptions();
  };
  function learnModels() {
    askModels(provider, folder()).then(showModels, () => {});
  }
  fields.model.addEventListener('change', () => showEffort());
  // Another service starts from what Settings > New contacts picks for it.
  fields.provider?.addEventListener('change', () => {
    provider = providers.find((p) => p.id === fields.provider.value) ?? providers[0];
    const next = startFor();
    fields.permissionMode.replaceChildren(
      ...provider.permissionModes.map((m) => new Option(m.label, m.id, false, m.id === next.permissionMode))
    );
    fields.model.value = next.model;
    showModel();
    showEffort(next.effort);
    showRisk();
    learnModels();
  });
  fields.permissionMode.addEventListener('change', showRisk);
  form.addEventListener('change', showOptions);
  showRisk();
  showModels();
  learnModels();

  setTimeout(() => (existing ? fields.name : fields.prompt).focus());
  return formDialog({
    title: existing ? 'Edit schedule' : 'New schedule',
    form,
    ok: existing ? 'Save' : 'Create schedule',
    save: async (signal) => {
      const values = {
        name: fields.name.value.trim(),
        prompt: fields.prompt.value.trim(),
        cwd: folder(),
        ...(onComputer && { computer: true }),
        cron: fields.cron.value.trim(),
        provider: provider.id,
        model: fields.model.value.trim(),
        effort: fields.effort.value,
        permissionMode: fields.permissionMode.value,
        maxRuns: fields.maxRuns.value.trim(),
      };
      if (signal.aborted) return undefined;
      return existing ? api.schedules.update(existing.id, values) : api.schedules.add(values);
    },
  });
}
