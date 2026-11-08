// The news that a newer version is out, and what it and Help > Check for updates open.
// A copy that can replace itself (Update.inPlace) downloads the new version in the background
// without a word, and a card says so once it is ready: Restart puts it in place. While that would
// interrupt a contact at work or waiting for you, Restart when idle comes first: it has the app do
// that by itself once they are done and you are away. Help > Check for updates shows that
// download as it goes. A copy that can't, such as one opened from the
// disk image, says on a line that the version is out, and how to get a copy that can. What is
// new in a version is on the website's changelog.
import { api } from '../lib/api.js';
import { $, el, errorText, html } from '../lib/dom.js';
import { confirmDialog, infoDialog, messageBody, openDialog } from '../lib/dialog.js';
import { busyContacts } from '../../shared/busy-contacts.js';
import { changelogUrl } from '../../shared/release-notes.js';
import { downloadedAmount, KEPT, readyOffer, updateStep } from '../../shared/update-progress.js';
import { DOWNLOAD_PAGE } from '../../shared/web-pages.js';

const TITLE = 'Software Update';
const WHEN_IDLE_HINT = 'Restart by itself once you are away and no contact is working or waiting for you';
const IS_MAC = navigator.platform.toLowerCase().includes('mac');

/** @typedef {import('../../main/updates.js').Update} Update */
/** @typedef {import('../../shared/busy-contacts.js').ContactView} ContactView */

/** @type {Update | null} */
let found = null;
/** The version whose card was closed: it is not shown again while this window is open. */
let dismissed = null;
/** Who a restart would interrupt, as this window's contacts last said. */
let busy = /** @type {ContactView[]} */ ([]);
/** What draws an open Software Update dialog again when that changes. */
const onBusy = new Set();

/** @param {ContactView[]} contacts */
const busyKey = (contacts) => JSON.stringify(contacts.map(({ name, project, status }) => [name, project, status]));

/** @param {Update} update */
const available = ({ version, current }) => `buddylist ${version} is available. You have ${current}.`;

/** @param {import('../../main/updates.js').UpdateCheck} check  one that found nothing newer */
const checkAnswer = ({ ok, current }) =>
  ok
    ? `You have the latest version of buddylist (${current}).`
    : 'buddylist could not check for updates. Try again in a while.';

/**
 * See changes and What's new: the version's part of the changelog, in the browser.
 * @param {Update} update
 */
const seeChanges = (update) => api.app.openExternal(changelogUrl(update.version));

/**
 * The line's Update... and Help > Check for updates, on a copy that can't update itself: how to get
 * one that can. On a Mac that is the copy in Applications, opened from there.
 * @param {Update} update
 */
async function howToUpdate(update) {
  const how = IS_MAC
    ? 'buddylist updates itself once it is in Applications. Quit buddylist, drag it into Applications ' +
      'and open it from there. Or get the new version from the download page.'
    : 'Get the new version from the download page.';
  const open = await confirmDialog(`${available(update)}\n\n${how} ${KEPT}`, {
    title: TITLE,
    ok: 'Download page',
    cancel: 'Close',
  });
  if (open) api.app.openExternal(DOWNLOAD_PAGE);
}

/**
 * Restart: the main process asks first while contacts are at work, and then the app quits and
 * opens again as the new version. Nothing happens while the question is answered with Cancel.
 * @param {HTMLButtonElement} [button]  the card's Restart, kept from a second press meanwhile: the
 *   dialog's is gone by then, and a conversation's window has no card
 */
async function restart(button) {
  if (button) button.disabled = true;
  try {
    await api.app.restartToUpdate();
  } catch (err) {
    infoDialog(TITLE, messageBody(errorText(err)));
  } finally {
    if (button) button.disabled = false;
  }
}

/**
 * Restart when idle: the main process restarts by itself once nobody is at work or at the computer
 * (see idle-restart.js). The card and the dialog say so once it tells them.
 */
async function restartWhenIdle() {
  try {
    await api.app.restartWhenIdle();
  } catch (err) {
    infoDialog(TITLE, messageBody(errorText(err)));
  }
}

/** @param {Update} update */
const downloadingText = ({ version, current }) => ({
  headline: `Downloading buddylist ${version}`,
  detail: `You have ${current}.`,
  close: 'Hide',
  go: null,
});

/**
 * What the dialog says at each step, what its first button is called, and its last one: none
 * while the download goes on.
 * @type {Record<import('../../shared/update-progress.js').UpdateStep, (update: Update) =>
 *   { headline: string, detail: string, close: string, go: string | null }>}
 */
const STEPS = {
  downloading: downloadingText,
  verifying: downloadingText,
  failed: ({ version }) => ({
    headline: `buddylist ${version} didn't download`,
    detail: 'Check your connection and try again. buddylist also tries again by itself later.',
    close: 'Close',
    go: 'Try again',
  }),
  ready: (update) => ({
    headline: `buddylist ${update.version} is ready`,
    detail: readyOffer(update, busy).dialog,
    close: update.whenIdle ? 'Close' : 'Later',
    go: 'Restart',
  }),
};

/**
 * The line under the bar: how much is here, or what goes on without a number.
 * @param {import('../../shared/update-progress.js').UpdateStep} step
 * @param {Update} update
 */
const amountText = (step, { progress }) => {
  if (step === 'verifying') return 'Almost ready...';
  return progress?.total ? downloadedAmount(progress) : 'Starting...';
};

/**
 * Help > Check for updates on a copy that updates itself: the new version's download as it goes,
 * then Restart once it is ready, and When idle first while contacts are busy. Hide leaves it
 * downloading, and the card says when it is ready. See changes is a link: four buttons don't fit
 * the contact list's width.
 * @param {Update} found  what the check found
 */
function updateDialog(found) {
  const body = el(
    html`<div class="update-form">
      <p class="update-headline"></p>
      <p class="update-detail">
        <span class="update-detail-text"></span>
        <button class="link update-changes" type="button">See changes</button>
      </p>
      <div class="update-progress">
        <progress max="1"></progress>
        <span class="update-amount"></span>
      </div>
    </div>`
  );
  const dialog = openDialog({
    title: TITLE,
    body,
    buttons: [
      { label: 'Hide', value: null },
      { label: 'When idle', value: null },
      { label: 'Restart', value: null, default: true },
    ],
  });
  const [close, idle, goButton] = /** @type {NodeListOf<HTMLButtonElement>} */ (
    dialog.node.querySelectorAll('.buttons .btn')
  );
  idle.title = WHEN_IDLE_HINT;
  // Try again leaves the dialog open, so it is replaced by a button that does.
  const go = /** @type {HTMLButtonElement} */ (goButton.cloneNode(true));
  goButton.replaceWith(go);
  const bar = /** @type {HTMLProgressElement} */ (body.querySelector('progress'));

  let update = found;
  /** @type {import('../../shared/update-progress.js').UpdateStep | null} */
  let step = null;
  let idleFirst = false;
  let closed = false;

  /** @param {Update | null} next */
  function show(next) {
    if (closed) return;
    // Nothing newer any more, such as after a restart elsewhere: nothing to show.
    if (!next?.inPlace) return dialog.close(null);
    update = next;
    const now = updateStep(update);
    const text = STEPS[now](update);
    const offersIdle = now === 'ready' && readyOffer(update, busy).whenIdle;
    body.querySelector('.update-headline').textContent = text.headline;
    body.querySelector('.update-detail-text').textContent = text.detail;
    const downloading = now === 'downloading' || now === 'verifying';
    body.querySelector('.update-progress').hidden = !downloading;
    if (downloading) {
      const { progress } = update;
      // A bar with no value keeps moving: for what has no number yet, and for macOS's check.
      if (now === 'downloading' && progress?.total) bar.value = progress.transferred / progress.total;
      else bar.removeAttribute('value');
      body.querySelector('.update-amount').textContent = amountText(now, update);
    }
    close.textContent = text.close;
    // Only while Restart would interrupt someone, and once picked, the dialog says so instead.
    idle.hidden = !offersIdle;
    idle.classList.toggle('default', offersIdle);
    go.classList.toggle('default', !offersIdle);
    go.hidden = !text.go;
    go.textContent = text.go ?? '';
    go.disabled = false;
    // Enter is for what the step is about, once: not again with every bit of the download. And
    // for When idle while contacts are busy, or Restart once they are done, but not Restart just
    // because When idle was picked.
    const turned = offersIdle !== idleFirst && !update.whenIdle;
    if (now !== step || turned) (offersIdle ? idle : text.go ? go : close).focus({ preventScroll: true });
    step = now;
    idleFirst = offersIdle;
  }

  const showBusy = () => show(update);
  body.querySelector('.update-changes').addEventListener('click', () => seeChanges(update));
  idle.addEventListener('click', restartWhenIdle);
  go.addEventListener('click', async () => {
    if (step === 'ready') {
      dialog.close(null);
      return restart();
    }
    // A check tries a download that failed again at once.
    go.disabled = true;
    show((await api.app.checkForUpdates()).update);
  });
  const unsubscribe = api.on.update(show);
  onBusy.add(showBusy);
  dialog.result.then(() => {
    closed = true;
    unsubscribe();
    onBusy.delete(showBusy);
  });

  show(found);
  return dialog.result;
}

/**
 * Shows the card once a new version is ready, and the line on a copy that can't update itself.
 * A copy that can says nothing while it downloads the new version.
 * @param {Update | null} update
 */
export function showUpdate(update) {
  found = update;
  const ready = Boolean(update?.ready);
  $('#update').hidden = !update || update.inPlace;
  $('#update-ready').hidden = !ready || dismissed === update.version;
  if (!update) return;
  $('#update-version').textContent = update.version;
  $('#update-ready-version').textContent = update.version;
  const offer = readyOffer(update, busy);
  $('#update-ready-next').textContent = offer.card;
  $('#update-when-idle').hidden = !offer.whenIdle;
  $('#update-when-idle').classList.toggle('default', offer.whenIdle);
  $('#update-restart').classList.toggle('default', !offer.whenIdle);
}

/**
 * Who a restart would interrupt, from this window's contacts as they change: the card and an open
 * dialog offer When idle while anyone is. Only a change in who that is, or in what they do, draws
 * them again, not every step an agent takes.
 * @param {ContactView[]} contacts  every contact, as the contact list shows it
 */
export function showContacts(contacts) {
  const next = busyContacts(contacts);
  if (busyKey(next) === busyKey(busy)) return;
  busy = next;
  if (found) showUpdate(found);
  for (const show of onBusy) show();
}

/** Help > Check for updates: asks now, and answers either way. A download that failed is tried again. */
export async function checkForUpdates() {
  const check = await api.app.checkForUpdates();
  const { update } = check;
  if (update?.inPlace) return updateDialog(update);
  if (update) return howToUpdate(update);
  return infoDialog(TITLE, messageBody(checkAnswer(check)));
}

/** What the line and the card do when clicked. */
export function mountUpdate() {
  // The line: the same answer as Help > Check for updates, about the version it names.
  $('#update-how').addEventListener('click', () => found && howToUpdate(found));
  $('#update-whats-new').addEventListener('click', () => found && seeChanges(found));
  $('#update-changes').addEventListener('click', () => found && seeChanges(found));
  $('#update-restart').addEventListener(
    'click',
    (e) => found?.ready && restart(/** @type {HTMLButtonElement} */ (e.currentTarget))
  );
  $('#update-when-idle').title = WHEN_IDLE_HINT;
  $('#update-when-idle').addEventListener('click', () => found?.ready && restartWhenIdle());
  $('#update-dismiss').addEventListener('click', () => {
    dismissed = found?.version ?? null;
    $('#update-ready').hidden = true;
  });
}
