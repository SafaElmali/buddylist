// The phone app's service worker, served at /sw.js for the whole app (see src/main/remote/host.js). It shows the
// notifications the Mac sends (src/main/remote/push.js), even with the app closed, puts how many wait for you on the
// app's icon, and opens the conversation a notification is about when it is tapped. A permission the phone may answer
// has Decline too, where the phone shows buttons on a notification (Android): it declines on the Mac, or opens the
// card where it can't.
//
// It also keeps a copy of the app itself (its page, scripts, styles, icons and packages), so the app opens with the
// Mac out of reach (asleep, or Tailscale off) and says so, with Retry (see connection.js). Nothing the Mac says is
// kept: requests, the sign-in page, sounds and pictures go to it as ever.
//
// A page runs on one version of the app, whole, never on some files of each: its scripts import each other by name,
// and an old one next to a new one can break them all. So it is decided once a page, as it opens: a page the Mac
// gives runs on the Mac's files only, however long the Mac takes (were the Mac to stop half way, the page waits, and
// opens whole once it is back: a reload, from the kept copy, says it can't reach the Mac); a page from the kept copy,
// because the Mac failed or was silent for a few seconds, runs on that copy only, its conversation opened minutes
// later too. And the kept copy is made whole, in one go, from the page, every module it imports and what it may ask
// for later (LATER), before it takes the place of the last one: a page that opened from the Mac renews it (now and
// then) in the background.

const worker = /** @type {any} */ (self);

/** The copies of the app, each whole: "buddylist-app-v<when it was made>". */
const COPY = 'buddylist-app-v';
/** Which copy is the latest whole one, and which pages run on which copy (a page's id: the copy's name). */
const META = 'buddylist-app-meta';
const META_ADDRESS = '/__buddylist-app';
/** How long the Mac may be silent on a page before the kept copy opens it. */
const WAIT_MS = 4000;
/** How often the kept copy is renewed, at most, as pages open from the Mac. */
const RENEW_MS = 60_000;
/** The app's own files, by address: the page, the messenger, and the phone's scripts, styles and packages. */
const APP = [
  /^\/$/,
  /^\/remote\/messenger\.js$/,
  /^\/src\/renderer\/(?:phone|lib|styles)\//,
  /^\/src\/renderer\/remote\/network-ipc\.js$/,
  /^\/src\/renderer\/chat\/stop-key\.js$/,
  /^\/src\/shared\//,
  /^\/node_modules\/(?:marked|dompurify|@highlightjs)\//,
];
const isApp = (url) => url.origin === worker.location.origin && APP.some((address) => address.test(url.pathname));
/** What a page may ask for later that it doesn't name: the palettes, as the theme changes on the Mac (main.js). */
const LATER = ['/src/renderer/styles/palettes.css'];

/** How long a page that opened from a kept copy keeps it, at least: one still opening isn't listed as open yet. */
const PAGE_MS = 5 * 60_000;

/** @type {{ latest: string | null, pages: Record<string, { copy: string, at: number }> } | null} kept in Cache
 * Storage: a phone stops an idle worker */
let meta = null;
async function readMeta() {
  if (meta) return meta;
  const saved = await (await caches.open(META)).match(META_ADDRESS);
  meta = saved ? await saved.json() : { latest: null, pages: {} };
  return meta;
}
/** Changes to `meta`, one after the other, each saved before the next: none undoes another's. */
let changing = Promise.resolve();
function change(fn) {
  const done = changing.then(async () => {
    await readMeta();
    const result = await fn(meta);
    await (await caches.open(META)).put(META_ADDRESS, new Response(JSON.stringify(meta)));
    return result;
  });
  changing = done.catch(() => {});
  return done;
}

/** A page opening: the Mac's, or, should it fail or be silent for WAIT_MS, the latest kept copy's. */
async function openPage(event) {
  const answer = fetch(event.request);
  const late = new Promise((resolve) => setTimeout(() => resolve(null), WAIT_MS));
  const first = await Promise.race([answer.catch(() => null), late]);
  if (first) {
    if (first.ok) renewSoon();
    return first;
  }
  const kept = await change(async ({ latest, pages }) => {
    const page = latest && (await (await caches.open(latest)).match('/'));
    if (page) pages[event.resultingClientId] = { copy: latest, at: Date.now() };
    return page;
  });
  return kept ?? answer.catch(() => Response.error());
}

/** A file a page asks for: from the copy it opened from, or, a page the Mac gave, from the Mac (see the top). */
async function forPage(event) {
  await changing;
  const copy = (await readMeta()).pages[event.clientId]?.copy;
  if (!copy) return fetch(event.request);
  return (await (await caches.open(copy)).match(event.request)) ?? Response.error();
}

/** The addresses a page names (see phonePage in web.js), and those a script imports, by name or with import(). */
const named = (html) => [...html.matchAll(/(?:href|src)="(\/[^"]+)"/g)].map(([, address]) => address);
const imported = (source) =>
  [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"\n]+)['"]/g)].map(([, address]) => address);

let renewedAt = -Infinity;
let renewing = null;
/** The kept copy made anew, whole, in the background: at most each RENEW_MS. */
function renewSoon() {
  if (renewing || Date.now() - renewedAt < RENEW_MS) return renewing;
  renewedAt = Date.now();
  renewing = renew()
    .catch(() => {})
    .finally(() => (renewing = null));
  return renewing;
}

/** A whole copy of the app as the Mac serves it now: kept as the latest only once every file of it is in. */
async function renew() {
  const name = `${COPY}${Date.now()}`;
  const copy = await caches.open(name);
  try {
    const page = await fetch('/', { cache: 'no-cache' });
    if (!page.ok || page.redirected) throw new Error('Not the app: a sign-in, or an error.');
    const html = await page.clone().text();
    await copy.put('/', page);
    const seen = new Set();
    // What the page names has to be there. What a script imports is found by reading it, comments too: a module
    // a browser would load has its extension, and one that isn't there was only mentioned.
    let wave = [
      ...named(html).map((address) => ({ address, named: true })),
      ...LATER.map((address) => ({ address, named: false })),
    ];
    while (wave.length) {
      const next = [];
      await Promise.all(
        wave.map(async ({ address, named: needed }) => {
          const url = new URL(address, worker.location.origin);
          if (!isApp(url) || seen.has(url.pathname)) return;
          seen.add(url.pathname);
          const response = await fetch(url.pathname, { cache: 'no-cache' });
          if (response.status === 404 && !needed) return;
          if (!response.ok) throw new Error(`${url.pathname}: ${response.status}`);
          if (/\.m?js$/.test(url.pathname))
            for (const spec of imported(await response.clone().text()))
              if (/^\.{1,2}\/|^\//.test(spec) && /\.m?js$/.test(spec))
                next.push({ address: new URL(spec, url).pathname, named: false });
          await copy.put(url.pathname, response);
        })
      );
      wave = next;
    }
  } catch (error) {
    await caches.delete(name);
    throw error;
  }
  await change((saved) => (saved.latest = name));
  await letGo();
}

/** Lets go of the copies no page runs on but the latest, and of what an earlier worker kept. A page counts until
 * it is closed and PAGE_MS old: one still opening isn't among those a worker can list. */
async function letGo() {
  const open = new Set(
    (await worker.clients.matchAll({ type: 'window', includeUncontrolled: true })).map(({ id }) => id)
  );
  const used = await change(({ latest, pages }) => {
    for (const [page, { at }] of Object.entries(pages))
      if (!open.has(page) && Date.now() - at > PAGE_MS) delete pages[page];
    return new Set([latest, ...Object.values(pages).map(({ copy }) => copy)]);
  });
  for (const name of await caches.keys())
    if ((name.startsWith(COPY) && !used.has(name)) || name.startsWith('buddylist-shell')) await caches.delete(name);
}

worker.addEventListener('install', (event) => {
  worker.skipWaiting();
  event.waitUntil(renewSoon());
});
worker.addEventListener('activate', (event) =>
  event.waitUntil(
    letGo()
      .catch(() => {})
      .then(() => worker.clients.claim())
  )
);
worker.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !isApp(new URL(request.url))) return;
  event.respondWith(request.mode === 'navigate' ? openPage(event) : forPage(event));
});

/** The number on the app's icon, where the phone shows one: none at 0. */
const showBadge = (count) => {
  const app = /** @type {any} */ (navigator);
  if (!app.setAppBadge) return Promise.resolve();
  return (count > 0 ? app.setAppBadge(count) : app.clearAppBadge()).catch(() => {});
};

worker.addEventListener('push', (event) => {
  let note = {};
  try {
    note = event.data?.json() ?? {};
  } catch {
    // Not one of the Mac's: it still says something, as a phone requires of every push.
  }
  const { decline } = note;
  const declinable = typeof decline?.contactId === 'string' && typeof decline.requestId === 'string';
  event.waitUntil(
    Promise.all([
      worker.registration.showNotification(note.title || 'buddylist', {
        body: note.body || '',
        // One a conversation: a newer one takes the older one's place, and still alerts.
        tag: note.tag || 'buddylist',
        renotify: true,
        icon: '/src/renderer/phone/icons/icon-192.png',
        data: { url: note.url || '/', ...(declinable && { decline, title: note.title }) },
        // Decline only, never Allow: the notification doesn't show what would be allowed.
        ...(declinable && { actions: [{ action: 'decline', title: 'Decline' }] }),
      }),
      showBadge(Number(note.badge) || 0),
    ])
  );
});

/** The sign-in page, and the addresses that lead to it (see host.js): a page there has no ear for "open". */
const signingIn = (url) => /^\/(login|pair)$|^\/src\/renderer\/remote\/login\.html$/.test(new URL(url).pathname);

/**
 * Opens the app at a notification's address: in the window it has open, which goes to that conversation, or in a
 * new one. A window signed out goes to the address itself, which the sign-in page keeps, to open once signed in.
 * @param {string} url
 */
async function openApp(url) {
  const target = new URL(url, worker.location.origin);
  if (target.origin !== worker.location.origin) return;
  const windows = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = windows.find((client) => new URL(client.url).origin === target.origin);
  if (!open) return worker.clients.openWindow(target.href);
  await open.focus().catch(() => {});
  if (!signingIn(open.url)) return open.postMessage({ type: 'open', hash: target.hash });
  // Signed out: the window goes to the conversation, which the sign-in page keeps, still saying why it is there.
  const why = new URL(open.url).searchParams.get('why');
  if (why) target.searchParams.set('why', why);
  // A page this worker doesn't control can't be led: a new window is.
  await open.navigate(target.href).catch(() => worker.clients.openWindow(target.href));
}

/**
 * Decline, from a notification: the Mac declines that permission, as Decline on its card does, and nothing opens.
 * Answered already, a quiet notification says so. Refused (the phone may not answer), signed out, out of reach or
 * anything else: the card opens, to answer there.
 * @param {{ contactId: string, requestId: string }} request
 * @param {{ url: string, title?: string, tag?: string }} note
 */
async function declineFrom({ contactId, requestId }, { url, title, tag }) {
  let answer;
  try {
    answer = await fetch('/api/decline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contactId, requestId }),
    });
  } catch {
    return openApp(url);
  }
  if (answer.status === 204) return undefined;
  if (answer.status !== 409) return openApp(url);
  return worker.registration.showNotification('Already answered elsewhere', {
    body: title || '',
    tag: tag || 'buddylist',
    silent: true,
    icon: '/src/renderer/phone/icons/icon-192.png',
    data: { url },
  });
}

worker.addEventListener('notificationclick', (event) => {
  const { notification } = event;
  notification.close();
  const { url = '/', decline, title } = notification.data ?? {};
  event.waitUntil(
    event.action === 'decline' && decline ? declineFrom(decline, { url, title, tag: notification.tag }) : openApp(url)
  );
});

/** Tells the app's open pages how a renewal went: they ask the Mac again, and say so (see notifications.js). */
async function tell(ok) {
  const windows = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const page of windows) page.postMessage({ type: 'push-changed', ok });
}

// The browser renewed its subscription: the Mac is given the new one, without a first note this time. Whether it
// took it, the open pages are told; a page opened later finds the Mac's and this browser's apart, and mends it.
worker.addEventListener('pushsubscriptionchange', (event) => {
  const renew = async () => {
    const key = event.oldSubscription?.options?.applicationServerKey;
    const subscription =
      event.newSubscription ??
      (key && (await worker.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })));
    if (!subscription) return false;
    const answer = await fetch('/api/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...subscription.toJSON(), renewed: true }),
    });
    return answer.ok;
  };
  event.waitUntil(renew().then(tell, () => tell(false)));
});
