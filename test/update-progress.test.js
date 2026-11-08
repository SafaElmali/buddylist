import { test } from 'node:test';
import assert from 'node:assert/strict';
import { busyContacts } from '../src/shared/busy-contacts.js';
import { downloadedAmount, readyOffer, updateStep } from '../src/shared/update-progress.js';

const UPDATE = { version: '0.2.12', current: '0.2.11', inPlace: true, ready: false, failed: false, progress: null };

test('a new version downloads, then macOS checks it, then it is ready', () => {
  assert.equal(updateStep(UPDATE), 'downloading', 'before the download says how big it is');
  assert.equal(updateStep({ ...UPDATE, progress: { transferred: 0, total: 229e6 } }), 'downloading');
  assert.equal(updateStep({ ...UPDATE, progress: { transferred: 142e6, total: 229e6 } }), 'downloading');
  assert.equal(updateStep({ ...UPDATE, progress: { transferred: 229e6, total: 229e6 } }), 'verifying');
  assert.equal(updateStep({ ...UPDATE, ready: true }), 'ready');
});

test('a download that failed says so, until it is going again', () => {
  assert.equal(updateStep({ ...UPDATE, failed: true }), 'failed');
  assert.equal(updateStep({ ...UPDATE, failed: false, progress: { transferred: 1e6, total: 229e6 } }), 'downloading');
});

test('a download that knows no size yet is not taken for a finished one', () => {
  assert.equal(updateStep({ ...UPDATE, progress: { transferred: 0, total: 0 } }), 'downloading');
});

test('how much is downloaded is in whole megabytes, as Finder counts them', () => {
  assert.equal(downloadedAmount({ transferred: 142_400_000, total: 229_422_979 }), '142 of 229 MB');
  assert.equal(downloadedAmount({ transferred: 0, total: 229_422_979 }), '0 of 229 MB');
  assert.equal(downloadedAmount({ transferred: 229_422_979, total: 229_422_979 }), '229 of 229 MB');
});

test('a small download, as one that fetches only what changed can be, has a tenth more', () => {
  assert.equal(downloadedAmount({ transferred: 1_250_000, total: 4_800_000 }), '1.3 of 4.8 MB');
  assert.equal(downloadedAmount({ transferred: 9_000_000, total: 12_000_000 }), '9 of 12 MB');
});

const KEPT = 'Your contacts and conversations are kept.';
const contact = (name, status, project = 'cart') => ({ id: `${project}/${name}`, name, project, status });

test('with nobody at work or waiting, a version that is ready offers only Restart', () => {
  const nobody = busyContacts([contact('Claude', 'online'), contact('Codex', 'offline')]);
  assert.deepEqual(readyOffer({ whenIdle: false }, nobody), {
    whenIdle: false,
    card: 'Restart to start using it.',
    dialog: `Restart to start using it. ${KEPT}`,
  });
  assert.equal(readyOffer({}, []).whenIdle, false, 'an update that never heard of When idle');
});

test('a contact at work makes When idle the button to press, and the text says who', () => {
  const offer = readyOffer({ whenIdle: false }, busyContacts([contact('Claude', 'busy'), contact('Codex', 'online')]));
  assert.equal(offer.whenIdle, true);
  assert.equal(offer.card, 'Claude is working. When idle installs it once it is done and you are away.');
  assert.equal(offer.dialog, `${offer.card} ${KEPT}`);
});

test('one waiting for you counts too, as the quit guard counts it', () => {
  const offer = readyOffer({ whenIdle: false }, busyContacts([contact('Codex', 'away', 'shop')]));
  assert.equal(offer.whenIdle, true);
  assert.equal(offer.card, 'Codex is waiting for you. When idle installs it once it is done and you are away.');
});

test('one is named as the quit guard names it, without its project: a started one already says its branch', () => {
  const started = contact('Claude (show-update-when-busy)', 'busy', 'buddylist');
  assert.match(readyOffer({}, [started]).card, /^Claude \(show-update-when-busy\) is working\. /);
  assert.match(readyOffer({}, [{ name: 'Claude', status: 'busy' }]).card, /^Claude is working\./);
});

test('several are counted, and what they do is said once', () => {
  const working = [contact('Claude', 'busy'), contact('Codex', 'busy', 'shop')];
  assert.equal(
    readyOffer({}, working).card,
    '2 contacts are working. When idle installs it once they are done and you are away.'
  );
  assert.match(
    readyOffer({}, [contact('Claude', 'away'), contact('Codex', 'away')]).card,
    /^2 contacts are waiting for you\./
  );
  assert.match(
    readyOffer({}, [contact('Claude', 'away'), contact('Codex', 'busy'), contact('Gemini', 'busy')]).card,
    /^3 contacts are working or waiting for you\./
  );
});

test('once When idle was picked it is not offered again, busy or not, and the text says what happens', () => {
  const picked = {
    whenIdle: false,
    card: 'It restarts by itself once you are away.',
    dialog: `It restarts by itself once you are away and no contact is working or waiting for you. ${KEPT}`,
  };
  assert.deepEqual(readyOffer({ whenIdle: true }, [contact('Claude', 'busy')]), picked);
  assert.deepEqual(readyOffer({ whenIdle: true }, []), picked);
});
