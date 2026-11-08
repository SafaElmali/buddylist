import crypto from 'node:crypto';
import { handoverSource, handoverTarget, handoverModes } from '../shared/worker-handover.js';
import { effortsOf, modelCatalog } from '../shared/models.js';
import { PICTURE_DATA } from '../shared/pictures.js';

/** One request per worker lets the dialog report progress and retry only failures. */
export class WorkerHandover {
  #requests = new Map();
  #busy = new Set();

  constructor(conversations) {
    this.conversations = conversations;
  }

  #manager(id) {
    const { store, managing } = this.conversations;
    const manager = store.getContact(id);
    if (!manager?.manages || manager.archived || !managing.oversees(manager))
      throw new Error('This manager is no longer active.');
    return manager;
  }

  #row(host) {
    const state = this.conversations.workerHandoverState(host);
    const decision = handoverSource(host, state.participants, state.entries, state);
    const { source } = decision;
    const snapshot = crypto
      .createHash('sha256')
      .update(JSON.stringify([host, state.participants, state.entries.at(-1)?.id, state.busy]))
      .digest('hex');
    return {
      id: host.id,
      name: host.name,
      cwd: host.cwd,
      snapshot,
      provider:
        source?.provider.name ??
        (state.participants
          .filter((one) => !one.paused)
          .map((one) => one.provider.name)
          .join(', ') ||
          state.participants[0]?.provider.name),
      eligible: decision.eligible,
      reason: decision.reason,
      source,
    };
  }

  list(managerId) {
    const manager = this.#manager(managerId);
    const { store, managing } = this.conversations;
    // Include archived assignments so the dialog can explain why they cannot be selected.
    return store.contacts
      .filter(
        (host) =>
          !host.manages &&
          !host.guestOf &&
          (managing.managerOf(host)?.id === manager.id ||
            (host.archived && (host.tabOf ? store.getContact(host.tabOf)?.managedBy : host.managedBy) === manager.id))
      )
      .map((host) => this.#row(host));
  }

  continue(managerId, selection, target, requestId) {
    if (typeof requestId !== 'string' || !requestId || requestId.length > 100)
      return Promise.resolve({ status: 'failed', reason: 'Invalid continuation request. Reopen the dialog.' });
    const key = JSON.stringify([managerId, selection, target, requestId]);
    if (this.#requests.has(key)) return this.#requests.get(key).then((result) => ({ ...result, duplicate: true }));
    if (this.#busy.has(selection?.id))
      return Promise.resolve({ status: 'skipped', reason: 'Another handover is already checking this worker.' });
    this.#busy.add(selection?.id);
    const work = this.#continue(managerId, selection, target)
      .catch((error) => ({ status: 'failed', reason: String(error.message || error) }))
      .finally(() => this.#busy.delete(selection?.id));
    this.#requests.set(key, work);
    // Successful history changes also invalidate old selections after this bounded cache expires.
    if (this.#requests.size > 500) this.#requests.delete(this.#requests.keys().next().value);
    return work;
  }

  async #continue(managerId, selection, target) {
    const { store, providers, managing, history } = this.conversations;
    const check = () => {
      this.#manager(managerId);
      const host = store.getContact(selection?.id);
      if (!host || managing.managerOf(host)?.id !== managerId)
        return { reason: 'This conversation is no longer under this manager.' };
      const row = this.#row(host);
      if (!row.eligible) return { reason: row.reason };
      if (row.snapshot !== selection.snapshot) return { reason: 'This worker changed. Refresh and select it again.' };
      return { host, row };
    };
    let current = check();
    if (current.reason) return { status: 'skipped', reason: current.reason };
    const provider = providers.descriptor(target?.provider);
    if (provider.id !== target?.provider) throw new Error('Choose an available service.');
    const refused = handoverTarget(current.row.source, provider);
    if (refused) return { status: 'skipped', reason: refused };
    const setup = await providers.setup(provider.id);
    if (setup.state !== 'ready')
      throw new Error(setup.note || `${provider.name} readiness could not be verified. Check its sign-in in Settings.`);
    const model = typeof target.model === 'string' ? target.model.trim() : '';
    const effort = typeof target.effort === 'string' ? target.effort : '';
    const catalog = modelCatalog(
      provider,
      await providers.models(provider.id, { cwd: current.host.cwd, ...this.conversations.forAgent(current.host.cwd) })
    );
    if (effort && !effortsOf({ model }, provider, catalog).includes(effort))
      throw new Error('That effort is unavailable for this model. Choose it again.');
    // Original images are read locally. Missing originals must not become silent context loss.
    const entries = history.read(current.host.id);
    const latest = entries.findLast((entry) => entry.kind === 'user' && !entry.text?.startsWith('/'));
    const attached = entries.findLast((entry) => entry.kind === 'user' && entry.images);
    const images = [];
    for (const reference of attached?.originals ?? attached?.pictures ?? []) {
      const data = PICTURE_DATA.test(reference) ? reference : await history.pictures.read(reference);
      const match = data?.match(PICTURE_DATA);
      if (!match) throw new Error('An attached picture could not be read. Restore it before retrying.');
      images.push({ mediaType: `image/${match[1]}`, data: match[2] });
    }
    if (attached?.images && !images.length)
      throw new Error('An attached picture is unavailable. Restore it before retrying.');
    // No asynchronous boundary between this recheck and mutation/dispatch. A newly busy worker is never stopped.
    current = check();
    if (current.reason) return { status: 'skipped', reason: current.reason };
    return this.conversations.dispatchWorkerHandover(current.host, current.row.source, {
      provider,
      model,
      effort,
      modes: handoverModes(current.row.source, provider),
      images,
      latest,
    });
  }
}
