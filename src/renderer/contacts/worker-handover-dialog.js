import { handoverTarget, handoverModes } from '../../shared/worker-handover.js';
import { api } from '../lib/api.js';
import { openDialog, infoDialog, messageBody } from '../lib/dialog.js';
import { el, errorText, html } from '../lib/dom.js';
import { effortPicker, modelPicker, servicePicker } from './model-picker.js';
import { askModels, setModelSettings } from './models.js';

/** The same dialog from the contact list, conversation sidebar and manager's Team menu. */
export async function workerHandoverDialog(manager, { providers, settings }) {
  let workers;
  try {
    workers = await api.projects.handoverWorkers(manager.id);
  } catch (error) {
    return infoDialog('Continue workers', messageBody(errorText(error)));
  }
  let provider = providers.find((one) => one.id === 'codex') || providers[0];
  setModelSettings(settings);
  const form = el(
    html`<form class="contact-form handover-form">
      <p class="dialog-message">Stopped workers under <b>${manager.name}</b>.</p>
      <label
        >Service<input type="hidden" name="provider" value="${provider.id}" />
        <button type="button" class="combo service-combo" aria-haspopup="menu" aria-label="Service"></button
      ></label>
      <div class="handover-models">
        <label
          >Model<input type="hidden" name="model" value="" />
          <button type="button" class="combo model-combo" aria-haspopup="menu" aria-label="Model"></button
        ></label>
        <label
          >Effort<input type="hidden" name="effort" value="" />
          <button type="button" class="combo effort-combo" aria-haspopup="menu" aria-label="Effort"></button
        ></label>
      </div>
      <p class="hint">Keeps folders, changes and history. Pauses the previous agent; permissions never broaden.</p>
      <label class="choice"><input type="checkbox" data-every />Select all eligible workers</label>
      <ul class="delete-names assign-names handover-workers" aria-label="Managed workers"></ul>
      <p class="hint handover-summary" role="status" aria-live="polite"></p>
      <div class="error" role="alert" hidden></div>
    </form>`
  );
  const fields = form.elements;
  const list = form.querySelector('.handover-workers');
  const every = form.querySelector('[data-every]');
  const summary = form.querySelector('.handover-summary');
  const error = form.querySelector('.error');
  const previousFocus = document.activeElement;
  const dialog = openDialog({
    title: 'Continue workers with…',
    body: form,
    buttons: [{ label: 'Close', value: null }],
  });
  dialog.node.querySelector('[role="dialog"]').setAttribute('aria-modal', 'true');
  const buttons = dialog.node.querySelector('.buttons');
  // Progress stays visible even when the target controls or a long worker list need to scroll.
  buttons.before(summary);
  const submit = el('<button class="btn default" type="submit">Continue</button>');
  const retry = el('<button class="btn" type="button" hidden>Retry failed</button>');
  const refresh = el('<button class="btn" type="button">Refresh</button>');
  form.id = `handover-${crypto.randomUUID()}`;
  submit.setAttribute('form', form.id);
  buttons.prepend(submit, retry, refresh);
  let closed = false;
  let running = false;
  const results = new Map();
  const requests = new Map();
  const selected = new Set();
  const reason = (worker) => (!worker.eligible ? worker.reason : handoverTarget(worker.source, provider));
  const eligible = () => workers.filter((worker) => !reason(worker) && !results.has(worker.id));
  const update = () => {
    const available = eligible();
    const count = available.filter((worker) => selected.has(worker.id)).length;
    every.checked = available.length > 0 && count === available.length;
    every.indeterminate = count > 0 && count < available.length;
    every.disabled = running || !available.length;
    submit.disabled = running || !count;
    submit.textContent = running ? 'Continuing…' : `Continue${count ? ` (${count})` : ''}`;
    retry.hidden = ![...results.values()].some((result) => result.status === 'failed');
    retry.disabled = running;
    refresh.disabled = running;
    if (!running) {
      const done = [...results.values()];
      summary.textContent = done.length
        ? `${done.filter((one) => one.status === 'continued').length} continued · ${done.filter((one) => one.status === 'skipped').length} skipped · ${done.filter((one) => one.status === 'failed').length} failed. Continued means sent; follow its progress in the conversation.`
        : available.length
          ? `${count} selected · Sign-in checked before sending.`
          : 'No eligible workers for this service. Working, completed and archived conversations stay as they are.';
    }
  };
  const draw = () => {
    list.replaceChildren(
      ...workers.map((worker) => {
        const result = results.get(worker.id);
        const blocked = reason(worker);
        const mode = !blocked && handoverModes(worker.source, provider)[0];
        const modeLabel = provider.permissionModes.find((one) => one.id === mode)?.label;
        const row = el(
          html`<li data-worker="${worker.id}">
            <label class="choice">
              <input
                type="checkbox"
                ${blocked || result || running ? 'disabled' : ''}
                ${selected.has(worker.id) && !blocked && !result ? 'checked' : ''}
              />
              <span
                ><b>${worker.name}</b><span class="hint">${worker.provider} · ${worker.reason}</span>
                <span class="hint handover-result"
                  >${result ? `${result.status === 'continued' ? 'Continued' : result.status === 'failed' ? 'Failed' : 'Skipped'} · ${result.reason}` : blocked || `→ ${provider.name} · ${modeLabel}`}</span
                ></span
              >
            </label>
          </li>`
        );
        row.querySelector('input').addEventListener('change', (event) => {
          if (event.target.checked) selected.add(worker.id);
          else selected.delete(worker.id);
          update();
        });
        return row;
      })
    );
    if (!workers.length) list.append(el('<li class="hint">This manager has no worker conversations yet.</li>'));
    update();
  };
  const selectEligible = () => {
    selected.clear();
    for (const worker of eligible()) selected.add(worker.id);
    draw();
  };
  servicePicker(form.querySelector('.service-combo'), fields.provider, providers);
  const folder = () => workers[0]?.cwd || manager.cwd;
  const showModel = modelPicker(form.querySelector('.model-combo'), fields.model, () => provider, { folder });
  const showEffort = effortPicker(form.querySelector('.effort-combo'), fields.effort, {
    provider: () => provider,
    model: () => fields.model.value.trim(),
    folder,
  });
  const learn = () =>
    askModels(provider, folder()).then(
      () => {
        if (!closed && !running) {
          showModel();
          showEffort();
        }
      },
      () => {}
    );
  learn();
  fields.provider.addEventListener('change', () => {
    provider = providers.find((one) => one.id === fields.provider.value);
    fields.model.value = '';
    showModel();
    showEffort('');
    learn();
    selectEligible();
  });
  fields.model.addEventListener('change', () => showEffort());
  every.addEventListener('change', () => {
    selected.clear();
    if (every.checked) for (const worker of eligible()) selected.add(worker.id);
    draw();
  });
  const reload = async () => {
    error.hidden = true;
    try {
      workers = await api.projects.handoverWorkers(manager.id);
      for (const [id, result] of results) if (result.status === 'skipped') results.delete(id);
      selectEligible();
    } catch (err) {
      error.textContent = errorText(err);
      error.hidden = false;
    }
  };
  refresh.addEventListener('click', reload);
  const run = async (batch) => {
    if (running || closed || !batch.length) return;
    running = true;
    error.hidden = true;
    const target = { provider: provider.id, model: fields.model.value.trim(), effort: fields.effort.value };
    for (const control of form.querySelectorAll('button, select')) control.disabled = true;
    draw();
    for (const worker of batch) {
      if (closed) break;
      summary.textContent = `Checking ${worker.name}… Closing stops the remaining queue; this worker may still continue.`;
      // A transport failure retries the same request; a returned failure gets a fresh check next time.
      const request = requests.get(worker.id) || {
        selection: { id: worker.id, snapshot: worker.snapshot },
        target,
        id: crypto.randomUUID(),
      };
      requests.set(worker.id, request);
      try {
        results.set(
          worker.id,
          await api.projects.continueWorker(manager.id, request.selection, request.target, request.id)
        );
        requests.delete(worker.id);
      } catch (err) {
        results.set(worker.id, { status: 'failed', reason: errorText(err) });
      }
      if (!closed) draw();
    }
    running = false;
    if (!closed) {
      for (const control of form.querySelectorAll('button, select')) control.disabled = false;
      showEffort();
      draw();
      (retry.hidden ? buttons.lastElementChild : retry).focus();
    }
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    run(eligible().filter((worker) => selected.has(worker.id)));
  });
  retry.addEventListener('click', async () => {
    if (running) return;
    const failed = new Set([...results].filter(([, result]) => result.status === 'failed').map(([id]) => id));
    // Refresh server snapshots for returned failures, while uncertain transport requests retain their IDs.
    try {
      const fresh = await api.projects.handoverWorkers(manager.id);
      workers = fresh;
      await run(fresh.filter((worker) => failed.has(worker.id)));
    } catch (err) {
      error.textContent = errorText(err);
      error.hidden = false;
    }
  });
  dialog.node.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.node.querySelectorAll('button, input, select')].filter(
      (node) => !node.disabled && node.type !== 'hidden' && !node.hidden
    );
    const first = focusable[0],
      last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  selectEligible();
  form.querySelector('.service-combo').focus();
  dialog.result.then(() => {
    closed = true;
    if (previousFocus?.isConnected) previousFocus.focus();
  });
  return dialog.result;
}
