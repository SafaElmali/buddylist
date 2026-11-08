// Signing in to the app from a phone or another computer (see src/main/remote/host.js): with the code Settings
// shows on the Mac, which a QR code brings along after the #, or with the remote password. The session comes back
// as a cookie this page can't read, and the app opens: at the conversation the phone was showing, if it was signed
// out in one.

/** Whether this is the copy added to the home screen, which keeps a sign-in of its own. */
const installed = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || /** @type {any} */ (navigator).standalone === true;

/** A code as Settings shows it (K7QM-29PX), or as a QR code has it (K7QM29PX). */
const CODE = /^[0-9a-z]{4}-?[0-9a-z]{4}$/i;
/** A conversation in the phone app (see phone/main.js), which a reload or a notification signed out opens with. */
const CONVERSATION = /^#\/c\/[^/\s#?]+$/;

/** The computer it signs in to, as the host names it (see web.js signInPage): your Mac, your PC or your computer. */
const noun = document.documentElement.dataset.noun;
const yours = `your ${['Mac', 'PC', 'computer'].includes(noun ?? '') ? noun : 'computer'}`;

/** What is said above the code of why the phone is here again (the app sends it with ?why=, see network-ipc.js). */
const WHY = {
  'signed-out': `This phone was signed out on ${yours}. Pair it again with a new code, or use the password.`,
  expired: 'Your sign-in ran out after 30 days without use. Pair again with a new code, or use the password.',
};

/** A fragment as text, or nothing for one that isn't. */
const decoded = (fragment) => {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return '';
  }
};

/** The conversation to open once signed in: only one of the app's, so the page never leads anywhere else. */
const conversationIn = (fragment) => (CONVERSATION.test(fragment) && decoded(fragment) ? fragment : '');

// Here, the phone was signed out: by its own Sign out, or by the Mac (see network-ipc.js). What it had typed and
// not sent goes with it: the phone's drafts, kept by src/renderer/phone/drafts.js under its DRAFTS_KEY.
try {
  sessionStorage.removeItem('buddylist:drafts');
} catch {
  // A browser that keeps nothing has nothing to drop.
}

// What the address brings: a code from a QR code, a conversation to go back to, and why the phone is here.
const query = new URLSearchParams(location.search);
const fromQr = decoded(location.hash.slice(1));
const code = CODE.test(fromQr) ? fromQr : '';
const then = conversationIn(location.hash) || conversationIn(query.get('then') ?? '');
const why = Object.hasOwn(WHY, query.get('why') ?? '') ? /** @type {keyof WHY} */ (query.get('why')) : null;
// The code never stays in the address, so it isn't kept in the history; where to go after, and why, do, so that a
// reload still has them.
const kept = new URLSearchParams({ ...(why && { why }), ...(then && { then }) }).toString();
history.replaceState(null, '', `${location.pathname}${kept ? `?${kept}` : ''}`);

const forms = {
  pair: /** @type {HTMLFormElement} */ (document.getElementById('pair')),
  'sign-in': /** @type {HTMLFormElement} */ (document.getElementById('sign-in')),
};

/** @param {'pair' | 'sign-in'} which */
function show(which) {
  for (const [name, form] of Object.entries(forms)) form.hidden = name !== which;
  forms[which].querySelector('input')?.focus();
}

for (const button of document.querySelectorAll('[data-show]'))
  button.addEventListener('click', () => show(/** @type {any} */ (button).dataset.show));

// Where the code and the password are, on the computer this signs in to.
document.getElementById('code-hint').textContent =
  `Type the code buddylist shows on ${yours}, under Settings > Remote access > Pair a phone (Pair another phone once one is paired).`;
document.getElementById('password-hint').textContent = `Enter the remote password set in buddylist on ${yours}.`;

// The copy on an iPhone's Home Screen has cookies of its own: it signs in once more, with a code of its own, which
// the Mac's button for a phone after the first one gives.
if (installed())
  document.getElementById('code-hint').textContent =
    `Sign in this Home Screen app: it keeps a sign-in of its own. On ${yours}, open Settings > Remote access, tap Pair another phone and type the new code here.`;

if (why) {
  const line = /** @type {HTMLElement} */ (document.getElementById('why'));
  line.textContent = WHY[why];
  line.hidden = false;
  const field = forms.pair.elements.code;
  field.setAttribute('aria-describedby', `why ${field.getAttribute('aria-describedby')}`);
}

/** " 3 tries left." after a wrong one, while there are any. */
const triesLeft = (left) => (left > 0 ? ` ${left} ${left === 1 ? 'try' : 'tries'} left.` : '');

/** How long a wait is, to the minute. */
const minutes = (seconds) =>
  Number.isFinite(seconds) && seconds > 0 ? `${Math.max(1, Math.ceil(seconds / 60))} min` : 'a few minutes';

/**
 * What the code form says the Mac said of a code (see pairing.js), as its answer gives a reason. Cancelled is any
 * code that no longer works: cancelled in Settings, never shown, or after its wrong tries, whose last one the Mac
 * answers as wrong with no tries left.
 */
const CODE_PROBLEM = {
  used: `That code was used already. Show a new one on ${yours}.`,
  expired: `That code ran out. Codes work for 5 minutes: show a new one on ${yours}.`,
  cancelled: `That code isn’t in use any more. Show a new one on ${yours}.`,
};
const LAST_WRONG_TRY = `That code stopped working after too many wrong tries. Show a new one on ${yours}.`;

/**
 * What a form says when the Mac didn't sign it in.
 * @param {'pair' | 'sign-in'} which
 * @param {number} status
 * @param {{ reason?: string, triesLeft?: number, retryAfterSeconds?: number }} said  what the Mac answered with
 * @param {string | null} retryAfter  its Retry-After header
 */
function problemOf(which, status, said, retryAfter) {
  if (status === 429) return `Too many tries. Try again in ${minutes(Number(said.retryAfterSeconds ?? retryAfter))}.`;
  if (status !== 401) return 'buddylist could not sign you in. Try again.';
  if (which === 'sign-in') return `That isn’t the password set on ${yours}.${triesLeft(said.triesLeft)}`;
  if (said.reason === 'wrong' && said.triesLeft === 0) return LAST_WRONG_TRY;
  if (said.reason === 'wrong')
    return `That isn’t the code on ${yours}. Check it and try again.${triesLeft(said.triesLeft)}`;
  return Object.hasOwn(CODE_PROBLEM, said.reason ?? '')
    ? CODE_PROBLEM[said.reason]
    : `That isn’t the code on ${yours}, or it expired. Show a new one there.`;
}

/**
 * Says what went wrong right under the form's field, which keeps what was typed, selected to type over.
 * @param {HTMLFormElement} form
 * @param {string} text  nothing, to say nothing
 */
function say(form, text) {
  const field = /** @type {HTMLInputElement} */ (form.querySelector('input'));
  const problem = /** @type {HTMLElement} */ (form.querySelector('.sign-in-problem'));
  const described = (field.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id && id !== problem.id);
  problem.textContent = text;
  if (!text) {
    field.removeAttribute('aria-invalid');
    field.setAttribute('aria-describedby', described.join(' '));
    return;
  }
  field.setAttribute('aria-invalid', 'true');
  field.setAttribute('aria-describedby', [...described, problem.id].join(' '));
  field.focus();
  field.select();
}

/** The code last posted, which typing in the box doesn't post again. */
let sent = '';

/**
 * Posts what a form has, and opens the app once it signed in.
 * @param {'pair' | 'sign-in'} which
 * @param {string} address
 * @param {Record<string, string>} body
 */
async function signIn(which, address, body) {
  const form = forms[which];
  const button = /** @type {HTMLButtonElement} */ (form.querySelector('button[type=submit]'));
  button.disabled = true;
  if (which === 'pair') sent = body.code;
  say(form, '');
  try {
    const response = await fetch(address, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, installed: installed() }),
    });
    if (response.ok) return location.replace(`/${then}`);
    const said = await response.json().catch(() => ({}));
    button.disabled = false;
    say(form, problemOf(which, response.status, said ?? {}, response.headers.get('retry-after')));
  } catch {
    button.disabled = false;
    say(form, 'buddylist can’t be reached. Is Tailscale connected?');
  }
}

forms.pair.addEventListener('submit', (event) => {
  event.preventDefault();
  signIn('pair', '/api/pair', { code: forms.pair.elements.code.value });
});

// A code sends itself once it is all there, at its 8th character, typed with its dash or spaces or without.
forms.pair.elements.code.addEventListener('input', () => {
  const typed = forms.pair.elements.code.value;
  const button = /** @type {HTMLButtonElement} */ (forms.pair.querySelector('button[type=submit]'));
  if (CODE.test(typed.replace(/\s/g, '')) && typed !== sent && !button.disabled)
    signIn('pair', '/api/pair', { code: typed });
});

forms['sign-in'].addEventListener('submit', (event) => {
  event.preventDefault();
  signIn('sign-in', '/api/login', { password: forms['sign-in'].elements.password.value });
});

// Opened from the QR code: the code is after the #, which never leaves this phone but in what is posted.
if (code) {
  forms.pair.elements.code.value = code;
  signIn('pair', '/api/pair', { code });
}
