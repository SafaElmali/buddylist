// The Schedules page: prompts that start a new contact by themselves, on a cadence, while the app is open (see
// main/schedules.js). A line for each, as Settings' other lists have them, with its name, when it runs and when
// next, and the switch that turns it on or off. Opened, it says where its runs work, who answers, how it last ran
// and how many runs it had, with Run now, Edit... and Delete. New schedule..., and Edit..., open the same dialog as
// Contacts > New schedule... does.
import { api } from '../lib/api.js';
import { confirmDialog } from '../lib/dialog.js';
import { el, errorText, html } from '../lib/dom.js';
import { dayAndTime, whenNext } from '../lib/format.js';
import { THIS_COMPUTER } from '../../shared/projects.js';
import { cadenceWords, scheduleName } from '../../shared/schedules.js';
import { scheduleDialog } from '../contacts/schedule-dialog.js';
import { button, foldList, groupWithButton, row } from './controls.js';

/** @typedef {import('../../main/schedules.js').ScheduleView} ScheduleView */

const folderName = (p) => p.split(/[\\/]/).filter(Boolean).pop() || p;

/**
 * What a schedule's line says after its name: when it runs, and when next, or that it is off.
 * "On weekdays at 9:00 AM · Next: Tomorrow 9:00 AM".
 * @param {ScheduleView} schedule
 * @param {number} [now]
 */
export function scheduleLine(schedule, now = Date.now()) {
  const { maxRuns, runs, next, lastError } = schedule;
  const done = maxRuns !== null && runs >= maxRuns;
  let state = 'Off';
  if (next !== null) state = `Next: ${whenNext(next, now)}`;
  else if (done) state = `Off after ${runs} of ${maxRuns} runs`;
  return [cadenceWords(schedule.cron), state, lastError && 'Last run failed'].filter(Boolean).join(' · ');
}

/**
 * What an open line says of a schedule, a fact to a row: where its runs work, who answers them, its last run and
 * how many runs it had. Its last run's error too, where it could not start.
 * @param {ScheduleView} schedule
 * @param {import('../../providers/contract.js').ProviderDescriptor[]} providers
 * @param {number} [now]
 * @returns {{ label: string, value: string, warning?: boolean }[]}
 */
export function scheduleFacts(schedule, providers, now = Date.now()) {
  const provider = providers.find((one) => one.id === schedule.provider);
  const mode = provider?.permissionModes.find((one) => one.id === schedule.permissionMode);
  const service = [provider?.name ?? schedule.provider, schedule.model, mode?.short ?? mode?.label].filter(Boolean);
  const { maxRuns, runs } = schedule;
  return [
    { label: 'Project', value: schedule.computer ? THIS_COMPUTER : folderName(schedule.cwd) },
    { label: 'Service', value: service.join(' · ') },
    { label: 'Last run', value: schedule.lastRunAt === null ? 'Not yet' : dayAndTime(schedule.lastRunAt, now) },
    { label: 'Runs', value: maxRuns === null ? `${runs}, with no end` : `${runs} of ${maxRuns}` },
    ...(schedule.lastError ? [{ label: 'Last run failed', value: schedule.lastError, warning: true }] : []),
  ];
}

/**
 * The page drawn last, told when the schedules change: a run started, or one was changed in another window. Listened
 * for once, from the first time the page is drawn.
 */
let shownPage = null;
let listening = false;

/** Makes `kept` say what `view` says, as the same object: the list's lines read the one they were drawn with. */
const refresh = (kept, view) => {
  for (const key of Object.keys(kept)) if (!(key in view)) delete kept[key];
  Object.assign(kept, view);
};

/** @param {import('./main.js').PageContext} ctx */
export function schedulesPage(ctx) {
  const { providers, said } = ctx;
  /** @type {ScheduleView[]} */
  let schedules = [];
  /** Each line's switch, by its schedule: a run that turns one off turns its switch off too. */
  let switches = new Map();
  /** Says the open line's facts again. */
  let showFacts = () => {};
  const look = () => (document.documentElement.dataset.look === 'professional' ? 'switch' : 'checkbox');

  /** Runs a request, and says how it went in the bar at the bottom. @returns {Promise<boolean>} */
  const asking = async (request, done) => {
    try {
      await request();
      said(done);
      return true;
    } catch (err) {
      said(errorText(err), true);
      return false;
    }
  };

  const edit = async (schedule) => {
    const saved = await scheduleDialog({ providers, defaults: ctx.settings.contactDefaults, existing: schedule });
    if (saved) took(saved);
  };

  const list = foldList({
    items: () => schedules,
    name: scheduleName,
    summary: (schedule) => scheduleLine(schedule),
    aside: (schedule) => {
      const toggle = el(
        html`<label class="st-toggle" title="Turn it on or off"
          ><input type="checkbox" role="${look()}" aria-label="${scheduleName(schedule)} is on"
        /></label>`
      );
      const box = /** @type {HTMLInputElement} */ (toggle.querySelector('input'));
      box.checked = schedule.on;
      box.addEventListener('change', async () => {
        const on = box.checked;
        const ok = await asking(() => api.schedules.setOn(schedule.id, on), on ? 'Turned on.' : 'Turned off.');
        if (!ok) box.checked = !on;
      });
      switches.set(schedule.id, box);
      return toggle;
    },
    settings: (schedule) => {
      const facts = el('<dl class="st-facts"></dl>');
      showFacts = () => {
        facts.replaceChildren(
          ...scheduleFacts(schedule, providers).flatMap(({ label, value, warning }) => [
            el(html`<dt>${label}</dt>`),
            el(html`<dd class="${warning ? 'st-warning' : ''}">${value}</dd>`),
          ])
        );
      };
      showFacts();
      const runNow = button('Run now', async () => {
        runNow.disabled = true;
        runNow.textContent = 'Starting...';
        await asking(() => api.schedules.runNow(schedule.id), `${scheduleName(schedule)} started a run.`);
        runNow.disabled = false;
        runNow.textContent = 'Run now';
      });
      const remove = button(
        'Delete',
        async () => {
          const ok = await confirmDialog(
            `Delete the schedule “${scheduleName(schedule)}”? The contacts its runs started stay.`,
            { title: 'Delete schedule', ok: 'Delete' }
          );
          if (ok) await asking(() => api.schedules.remove(schedule.id), 'Deleted.');
        },
        { kind: 'danger' }
      );
      return [
        facts,
        row(
          runNow,
          button('Edit...', () => edit(schedule)),
          remove
        ),
      ];
    },
    empty: 'No schedules yet. New schedule... adds one: a prompt that starts a contact by itself, every so often.',
  });

  /**
   * The schedules as they are now. The same ones are said again where they are, so what is in focus stays there;
   * others are drawn anew.
   * @param {ScheduleView[]} views
   */
  const show = (views) => {
    const same = views.length === schedules.length && views.every((view, at) => view.id === schedules[at].id);
    if (!same) {
      schedules = views;
      switches = new Map();
      showFacts = () => {};
      list.draw();
      return;
    }
    views.forEach((view, at) => refresh(schedules[at], view));
    list.relabel();
    for (const view of views) {
      const box = switches.get(view.id);
      if (box) box.checked = view.on;
    }
    showFacts();
  };
  /** One saved in the dialog, before the windows are told: its line is opened. @param {ScheduleView} saved */
  const took = (saved) => {
    const known = schedules.some((one) => one.id === saved.id);
    show(known ? schedules.map((one) => (one.id === saved.id ? saved : one)) : [...schedules, saved]);
    list.show(saved.id);
  };
  shownPage = (views) => {
    if (list.node.isConnected) show(views);
  };
  if (!listening) api.on.schedules((views) => shownPage?.(views));
  listening = true;
  api.schedules.list().then(show, (err) => said(errorText(err), true));

  const add = button(
    'New schedule...',
    async () => {
      const saved = await scheduleDialog({ providers, defaults: ctx.settings.contactDefaults });
      if (saved) took(saved);
    },
    { kind: 'primary' }
  );
  return [
    groupWithButton(
      'Schedules',
      'Each run is a new contact, named after the schedule and the time, with the prompt sent at once. Runs happen while buddylist is open: one missed while it was closed runs once when it opens.',
      add,
      list.node
    ),
  ];
}
