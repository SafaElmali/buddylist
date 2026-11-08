// The Remote access page: using buddylist from a phone, anywhere, through Tailscale. Until a phone has paired, it
// is five steps, one at a time: Tailscale on this Mac, Tailscale on the phone, remote access on with a password
// (for a browser that can't scan), Tailscale Serve for a private https address, and a code to pair the phone
// with. Each step that is done says what it came to, and the one to do now has its one button. Once a phone has
// paired, the page says whether a phone can reach this Mac, with a switch, and lists the devices signed in, what
// phones are notified of (see main/remote/push.js), keeping the Mac awake, and the setup folded away. It is drawn
// again whenever the main process says how remote access stands (see main/remote/access.js). What a phone may do is
// picked above its code, and changed on its row (see main/remote/routes.js).
import { api } from '../lib/api.js';
import { confirmDialog, formDialog, openDialog } from '../lib/dialog.js';
import { el, errorText, html, raw } from '../lib/dom.js';
import { dayAndTime, timeAgo, whenNext } from '../lib/format.js';
import { qrSvg } from '../../shared/qr.js';
import {
  ACCESS,
  ACCESS_LEVELS,
  codeEnded,
  connectedLine,
  deviceWhere,
  hostNoun,
  linksIn,
  macLine,
  portLine,
  setupSteps,
  shortName,
  TAILSCALE_DOWNLOAD,
  tailscaleLine,
  timeLeft,
} from '../../shared/remote-access.js';
import { button, group, row, toggle } from './controls.js';

/** @typedef {import('../../main/remote/access.js').RemoteView} RemoteView */
/** @typedef {import('../../shared/remote-access.js').SetupStep} SetupStep */

const MIN_PASSWORD_LENGTH = 12;
/** How often Tailscale is looked at while a step waits for it on this Mac or on the phone. */
const LOOK_EVERY_MS = 4000;

const svg = (body) =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const CHECK = svg('<path d="m3.4 8.4 3 2.9 6.2-6.6"/>');
const CHEVRON = svg('<path d="M6 3.5 10.5 8 6 12.5"/>');
const PHONE = svg('<rect x="4.4" y="1.6" width="7.2" height="12.8" rx="1.8"/><path d="M7.2 12.2h1.6"/>');
const EXTERNAL = svg(
  '<path d="M9.4 2.6h4v4M13.4 2.6 7.6 8.4M11.6 9.6v2.8a1.2 1.2 0 0 1-1.2 1.2H3.6a1.2 1.2 0 0 1-1.2-1.2V5.6a1.2 1.2 0 0 1 1.2-1.2h2.8"/>'
);

/** This Mac, Tailscale and a phone: the line between them is whole once a phone can reach the Mac. */
const art = (reachable) =>
  `<svg class="remote-art${reachable ? ' reachable' : ''}" viewBox="0 0 132 56" aria-hidden="true">
    <g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <rect x="4" y="10" width="40" height="27" rx="3"/><path d="M0 43h48"/>
      <rect x="106" y="6" width="22" height="42" rx="4.5"/><path d="M114 43h6"/>
    </g>
    <path class="remote-art-line" d="M54 26h44" fill="none" stroke-width="2" stroke-linecap="round"${reachable ? '' : ' stroke-dasharray="3 5"'}/>
    <circle class="remote-art-dot" cx="76" cy="26" r="5"/>
  </svg>`;

/** What a closed lid does to keeping awake, where the computer has one that matters: only a Mac. */
const LID = {
  darwin: ' A closed lid still sleeps unless the Mac is plugged in with a display.',
};

/** "today 9:18 AM": a day as said within a line, lower case where it is a word of its own. */
const daySaid = (when) => when.replace(/^(Today|Yesterday|Tomorrow)\b/, (day) => day.toLowerCase());

/** "set-up-tailscale-serve": what finds a button again once the page is drawn again. */
const keyOf = (label) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * A button that keeps the focus when the page is drawn again: it is found again by `key`, its label by default.
 * @param {string} label
 * @param {() => void} onClick
 * @param {{ kind?: 'primary' | 'danger', key?: string, icon?: string }} [options]
 */
function action(label, onClick, { kind, key = label, icon = '' } = {}) {
  const node = button(label, onClick, { kind });
  node.dataset.focus = keyOf(key);
  if (icon) node.append(el(icon));
  return node;
}

/** A button that reads as a link, for what is beside the step's one button. */
function linkButton(label, onClick) {
  const node = el(html`<button class="remote-link" type="button">${label}</button>`);
  node.dataset.focus = keyOf(label);
  node.addEventListener('click', onClick);
  return node;
}

/** Opens Tailscale's download page, in the browser. */
const getTailscale = (key = 'Get Tailscale', kind = undefined) =>
  action('Get Tailscale', () => api.app.openExternal(TAILSCALE_DOWNLOAD), { kind, key, icon: EXTERNAL });

/**
 * "Change password": typed twice, and every device signed out with it unless unticked.
 * @param {string} noun  what this computer is called (see hostNoun)
 */
function passwordDialog(noun) {
  const form = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="remote-password-form">
        <label
          >Password
          <input type="password" name="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" />
        </label>
        <label
          >Once more
          <input type="password" name="again" autocomplete="new-password" />
        </label>
        <p class="st-hint">At least ${MIN_PASSWORD_LENGTH} characters. Only a hash of it is kept, on this ${noun}.</p>
        <label class="remote-check"><input type="checkbox" name="signOut" checked /> Sign out every device</label>
        <div class="error" hidden></div>
      </form>`
    )
  );
  const { password, again, signOut } = /** @type {any} */ (form.elements);
  setTimeout(() => password.focus());
  return formDialog({
    title: 'Change password',
    form,
    ok: 'Save',
    save: () => {
      if (password.value !== again.value) throw new Error('The two passwords are not the same.');
      return api.remote.setPassword(password.value, { signOutAll: signOut.checked });
    },
  });
}

/** @param {import('./main.js').PageContext} ctx */
export function remotePage({ platform, said }) {
  if (platform === 'web')
    return [
      group('Only in the app', 'A phone reaches buddylist on your computer. The preview has no computer to reach.'),
    ];

  /** What this computer is called, everywhere the page names it: "Mac", "PC" or "computer". */
  const noun = hostNoun(platform);
  const page = el('<div class="st-remote"><p class="st-hint">Looking…</p></div>');
  /** @type {RemoteView | null} */
  let view = null;
  /**
   * The code shown, while it works: only this page has it. `url` is what its QR code opens: '' before Tailscale
   * Serve, when no phone could open it. @type {{ shown: string, url: string, expiresAt: number } | null}
   */
  let code = null;
  let ticking = 0;
  /** A code was just shown: the next drawing brings it into view. */
  let codeNew = false;
  /** What the phone the next code pairs may do, as picked above it. @type {import('../../shared/remote-access.js').AccessLevel} */
  let pairAccess = 'full';
  /** Tailscale looked at every few seconds, while a step waits for it. */
  let looking = 0;
  let lookingNow = false;
  /** The switch was turned on, and is kept so while it starts. */
  let turningOn = false;
  /** The user said the phone has Tailscale, where it can't be seen on the tailnet. */
  let phoneSaid = false;
  /** The setup is unfolded, once it is done. */
  let setupOpen = false;
  /** Why the last thing asked didn't work, said where it was asked. */
  let problem = '';
  /** The step to do now when the page was last drawn, or 'connected': the focus follows it to the next one. */
  let shownStep = '';
  /** How many times the page was told how it stands: a look at Tailscale that started before another is dropped. */
  let told = 0;
  /** @param {RemoteView} next */
  const stands = (next) => {
    view = next;
    told += 1;
  };

  /** Runs what was asked, says how it went, and draws the page as it is after it. */
  const act = async (doing, done = '') => {
    try {
      stands(await doing());
      problem = '';
      if (done) said(done);
    } catch (err) {
      problem = errorText(err);
      said(problem, true);
    }
    draw();
  };

  const stop = api.on.remote((next) => {
    if (!page.isConnected) return stop();
    stands(next);
    if (!next.pairing.active) code = null;
    draw();
  });
  api.remote
    .init()
    .then((first) => {
      stands(first);
      draw();
      // Tailscale may have changed while Settings was closed.
      return act(() => api.remote.tailscale('check'));
    })
    .catch((err) => {
      said(errorText(err), true);
      if (!view) page.replaceChildren(el(html`<p class="st-bad" role="alert">${errorText(err)}</p>`));
    });

  // The password boxes of the step that turns it on are kept as they are while the page is drawn again, as it is
  // whenever Tailscale is looked at: what was typed stays.
  const passwordForm = /** @type {HTMLFormElement} */ (
    el(
      html`<form class="remote-password-form remote-inline-form" novalidate>
        <div class="remote-fields">
          <label
            >Password
            <input
              class="input"
              type="password"
              name="password"
              autocomplete="new-password"
              minlength="${MIN_PASSWORD_LENGTH}"
              data-focus="password"
          /></label>
          <label
            >Once more <input class="input" type="password" name="again" autocomplete="new-password" data-focus="again"
          /></label>
        </div>
        <p class="st-hint">
          At least ${MIN_PASSWORD_LENGTH} characters. It signs in a browser that can’t scan a code: your phone pairs
          with a code instead. Only a hash of it is kept, on this ${noun}.
        </p>
        <p class="st-bad remote-problem" role="alert" hidden></p>
        <div class="st-row remote-actions">
          <button class="btn default" type="submit" data-focus="turn-on">Turn on</button>
        </div>
      </form>`
    )
  );
  const wrong = /** @type {HTMLElement} */ (passwordForm.querySelector('.remote-problem'));
  const tell = (text) => {
    wrong.textContent = text;
    wrong.hidden = !text;
  };
  // What was wrong goes once it is typed again.
  passwordForm.addEventListener('input', () => tell(''));
  /** Saving it, and turning it on with it: Enter again meanwhile does nothing. */
  let saving = false;
  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    const { password, again } = /** @type {any} */ (passwordForm.elements);
    if (password.value.length < MIN_PASSWORD_LENGTH)
      return tell(`The password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (password.value !== again.value) return tell('The two passwords are not the same.');
    tell('');
    saving = true;
    try {
      stands(await api.remote.setPassword(password.value, { signOutAll: true }));
      password.value = again.value = '';
      said('Password saved.');
      await turnOn();
    } catch (err) {
      tell(errorText(err));
    } finally {
      saving = false;
    }
  });

  function draw() {
    clearInterval(ticking);
    if (!page.isConnected) return keepLooking(false);
    if (!view) return;
    const focused = /** @type {HTMLElement | null} */ (document.activeElement);
    const wasHere = page.contains(focused);
    const key = wasHere ? (focused?.dataset.focus ?? '') : '';
    const steps = view.setUp ? [] : setupSteps(view, { phoneSaid, noun });
    const now = view.setUp ? 'connected' : (steps.find((step) => step.current)?.id ?? 'done');
    page.replaceChildren(...(view.setUp ? connected(view) : setup(view, steps)));
    // Done with a step, the focus goes on to the next one's button; otherwise it stays where it was, or, where that
    // is gone, as a code cancelled, goes to the step's first button.
    const moved = Boolean(shownStep) && now !== shownStep;
    shownStep = now;
    // The level picked for a code is beside it, not the step's own: the step's first box or button.
    const next = page.querySelector(
      '.remote-step.current .remote-panel input:not([name="pair-access"]), .remote-step.current .remote-panel .btn'
    );
    const again = key && !moved ? page.querySelector(`[data-focus="${key}"]`) : null;
    const shownCode = page.querySelector('[data-focus="new-code"]');
    /** @type {HTMLElement | null} */ (wasHere ? again || next || shownCode : null)?.focus({ preventScroll: codeNew });
    // A code just shown is seen whole: its QR code, how to use it and its time left, not only the button under it.
    if (codeNew) page.querySelector('.remote-pair')?.scrollIntoView({ block: 'nearest' });
    codeNew = false;
    keepLooking(now === 'mac' || now === 'phone');
  }

  /** Looks at Tailscale every few seconds while a step waits for it to be signed in, here or on the phone. */
  function keepLooking(on) {
    if (on && !looking) {
      looking = window.setInterval(() => {
        if (!page.isConnected) return keepLooking(false);
        if (lookingNow) return;
        lookingNow = true;
        const asked = told;
        api.remote
          .tailscale('check')
          .then((next) => {
            // Told something newer meanwhile, as the user going on: this look is out of date.
            if (told !== asked) return;
            stands(next);
            draw();
          })
          .catch(() => {})
          .finally(() => (lookingNow = false));
      }, LOOK_EVERY_MS);
    } else if (!on && looking) {
      clearInterval(looking);
      looking = 0;
    }
  }

  /** Turns remote access on: it has a password by now. */
  async function turnOn() {
    turningOn = true;
    await act(() => api.remote.update({ enabled: true }).finally(() => (turningOn = false)), 'Remote access is on.');
  }

  const turnOff = () => act(() => api.remote.update({ enabled: false }), 'Remote access is off.');

  /** Asks first, then runs the one command that sets Tailscale Serve up, and shows what it prints. */
  async function serve(v) {
    const body = el(
      html`<div>
        <p class="dialog-message">buddylist runs this, and shows what it prints:</p>
        <pre class="st-code remote-command">${v.tailscale.command}</pre>
      </div>`
    );
    const ok = await openDialog({
      title: 'Set up Tailscale Serve',
      body,
      buttons: [
        { label: 'Run it', value: true, default: true },
        { label: 'Cancel', value: false },
      ],
      dismissValue: false,
    }).result;
    if (ok) await act(() => api.remote.tailscale('serve'));
  }

  const showCode = (done = '') =>
    act(async () => {
      code = await api.remote.pair({ access: pairAccess });
      codeNew = true;
      return api.remote.init();
    }, done);

  /**
   * What the phone the next code pairs may do: Full, Answer only or Read only, with what that lets it do. Picked while
   * a code shows, that code is made anew for it: a code pairs with what was picked as it was shown.
   */
  function levelPicker() {
    const picker = el(
      html`<fieldset class="remote-levels">
        <legend>What a phone you pair may do</legend>
        <div class="remote-segments">
          ${ACCESS_LEVELS.map(
            (level) =>
              html`<label
                ><input type="radio" name="pair-access" value="${level}" data-focus="pair-${level}" /><span
                  >${ACCESS[level].label}</span
                ></label
              >`
          )}
        </div>
        <p class="st-hint">${ACCESS[pairAccess].says}</p>
      </fieldset>`
    );
    for (const radio of /** @type {HTMLInputElement[]} */ ([...picker.querySelectorAll('input')])) {
      radio.checked = radio.value === pairAccess;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        pairAccess = /** @type {import('../../shared/remote-access.js').AccessLevel} */ (radio.value);
        if (code) showCode(`New code: the phone it pairs is set to ${ACCESS[pairAccess].label}.`);
        else draw();
      });
    }
    return picker;
  }

  const cancelCode = () => {
    code = null;
    act(() => api.remote.cancelPair());
  };

  const check = (kind) => action('Check again', () => act(() => api.remote.tailscale('check')), { kind });

  const problemLine = () => (problem ? el(html`<p class="st-bad remote-problem" role="alert">${problem}</p>`) : null);

  // ---- setting it up -----------------------------------------------------------------------------

  /** @param {RemoteView} v @param {SetupStep[]} steps */
  function setup(v, steps) {
    const at = steps.findIndex((step) => step.current);
    const intro = el(
      html`<div class="remote-intro">
        ${raw(art(false))}
        <div>
          <p class="remote-intro-text">
            Your phone reaches this ${noun} through <b>Tailscale</b>, a private network between your own devices.
            Conversations stay on this ${noun}: no server of ours sees them.
          </p>
          <p class="st-hint">
            ${at < 1 ? `${steps.length} steps, about 5 minutes.` : `Step ${at + 1} of ${steps.length}`}
          </p>
        </div>
      </div>`
    );
    const list = el('<ol class="remote-steps" aria-label="Set up remote access"></ol>');
    list.append(...steps.map((step, i) => stepLine(v, step, i)));
    return [intro, list, v.devices.length ? devices(v) : null].filter(Boolean);
  }

  /** @param {RemoteView} v @param {SetupStep} step @param {number} i */
  function stepLine(v, step, i) {
    const kind = step.done ? 'done' : step.current ? 'current' : 'todo';
    const line = el(
      html`<li class="remote-step ${kind}">
        <span class="remote-step-dot" aria-hidden="true">${step.done ? raw(CHECK) : i + 1}</span>
        <div class="remote-step-main">
          <div class="remote-step-head">
            <h2 class="remote-step-title">
              <span class="remote-sr">${step.done ? 'Done: ' : step.current ? 'Now: ' : ''}</span>${step.title}
            </h2>
            ${step.done && step.summary ? html`<span class="remote-step-sum">${step.summary}</span>` : ''}
          </div>
        </div>
      </li>`
    );
    if (step.current) line.setAttribute('aria-current', 'step');
    const main = /** @type {HTMLElement} */ (line.querySelector('.remote-step-main'));
    if (step.done && step.id === 'on')
      /** @type {HTMLElement} */ (line.querySelector('.remote-step-head')).append(linkButton('Turn off', turnOff));
    if (step.done && step.id === 'address') main.append(...printed(v.tailscale.output));
    if (step.current) {
      const panel = el('<div class="remote-panel"></div>');
      panel.append(...stepPanel(v, step).filter(Boolean));
      if (problem && problem !== v.error) panel.append(problemLine());
      main.append(panel);
    }
    return line;
  }

  /** What the step to do now says, and its one button. @param {RemoteView} v @param {SetupStep} step */
  function stepPanel(v, step) {
    if (step.id === 'mac') {
      const { text, bad, offer } = macLine(v.tailscale, noun);
      return [
        el(html`<p class="${bad ? 'st-bad' : ''}">${text}</p>`),
        offer
          ? row(
              offer === 'download' ? getTailscale('Get Tailscale', 'primary') : null,
              check(offer === 'check' ? 'primary' : undefined)
            )
          : null,
        offer ? el('<p class="st-hint">This step ticks itself once Tailscale is signed in.</p>') : null,
      ];
    }
    if (step.id === 'phone') {
      const { login } = v.tailscale;
      const split = el(
        html`<div class="remote-split">
          <div class="remote-split-text">
            <p>
              No phone on your tailnet yet. Install Tailscale on your phone and sign
              in${login ? html` as <b>${login}</b>, as on this ${noun}` : ` to the same account as on this ${noun}`}.
            </p>
            <p class="st-hint">This step ticks itself once your phone shows up.</p>
          </div>
          <figure class="remote-get-qr">
            ${raw(qrSvg(TAILSCALE_DOWNLOAD, { label: 'QR code to get Tailscale' }))}
            <figcaption>Scan to get Tailscale</figcaption>
          </figure>
        </div>`
      );
      /** @type {HTMLElement} */ (split.querySelector('.remote-split-text')).append(
        row(
          check(),
          linkButton('My phone has it', () => {
            phoneSaid = true;
            draw();
          })
        )
      );
      return [split];
    }
    if (step.id === 'on') {
      if (!v.hasPassword) return [passwordForm];
      return [
        el('<p>Your phone signs in with a code. The password you set signs in a browser that can’t scan one.</p>'),
        v.error ? el(html`<p class="st-bad">${v.error}</p>`) : null,
        row(
          action(turningOn ? 'Turning on…' : 'Turn on', turnOn, { kind: 'primary', key: 'Turn on' }),
          linkButton('Change password…', changePassword)
        ),
      ];
    }
    if (step.id === 'address')
      return [
        el(
          '<p>Tailscale Serve gives buddylist an https address that only your own devices on Tailscale can open. buddylist runs this one command, and shows what it prints:</p>'
        ),
        ...serveControls(v),
      ];
    return pairing(v, { primary: true, label: 'Show code', intro: true });
  }

  /**
   * The command that sets Tailscale Serve up, the buttons for it, and what it printed. A port Serve has for something
   * else is said before it; with every one it could use taken, there is no command to run.
   * @param {RemoteView} v
   */
  function serveControls(v) {
    const { tailscale } = v;
    const nodes = [];
    if (tailscale.funnel) nodes.push(el(html`<p class="st-bad">${tailscaleLine(tailscale, noun).text}</p>`));
    if (tailscale.serveReason)
      nodes.push(
        el(
          html`<p class="st-bad">
            Reading Tailscale Serve’s settings failed: ${tailscale.serveReason.replace(/[\s.]+$/, '')}.
          </p>`
        ),
        row(check())
      );
    const ports = portLine(tailscale, noun);
    if (ports) nodes.push(el(html`<p class="${tailscale.httpsPort ? 'st-hint' : 'st-bad'}">${ports}</p>`));
    if (!tailscale.httpsPort) return [...nodes, ...printed(tailscale.output, { open: true })];
    nodes.push(el(html`<code class="st-mono remote-command">${tailscale.command}</code>`));
    if (!tailscale.certificates)
      nodes.push(
        el(
          '<p class="st-hint">The first time, Tailscale asks you to turn on HTTPS certificates for your tailnet, with a link it shows here.</p>'
        )
      );
    nodes.push(
      tailscale.busy
        ? row(
            el('<span class="st-hint">Setting up Tailscale Serve…</span>'),
            action('Cancel', () => act(() => api.remote.tailscale('cancel')), { key: 'Cancel serve' })
          )
        : row(
            action('Set up Tailscale Serve', () => serve(v), { kind: 'primary' }),
            action('Copy command', () => navigator.clipboard.writeText(tailscale.command).then(() => said('Copied.')))
          )
    );
    return [...nodes, ...printed(tailscale.output, { open: true })];
  }

  /**
   * What the last Serve command printed, with the links in it: open while its step is to do, and folded under the
   * step once it is done, one click away. Nothing where it printed nothing.
   * @param {string} output
   */
  function printed(output, { open = false } = {}) {
    if (!output) return [];
    const links = linksIn(output);
    const buttons = links.length
      ? row(...links.map((link) => action(`Open ${new URL(link).host}`, () => api.app.openExternal(link))))
      : null;
    const pre = el(html`<pre class="st-code remote-output">${output}</pre>`);
    if (open) return [pre, buttons].filter(Boolean);
    const fold = el(
      '<details class="remote-output-fold"><summary class="st-hint">What Tailscale printed</summary></details>'
    );
    fold.append(...[pre, buttons].filter(Boolean));
    return [fold];
  }

  /**
   * Pairing a phone: the button that shows a code, or the code itself, with its QR code and how to use it.
   * @param {RemoteView} v
   * @param {{ primary: boolean, label: string, intro?: boolean }} how
   */
  function pairing(v, { primary, label, intro = false }) {
    // Once set up, the phone just paired is in the list: only a code that didn't work is said.
    const ended = intro || v.pairing.ended !== 'used' ? codeEnded(v.pairing.ended) : '';
    if (!code)
      return [
        intro
          ? el('<p>On your phone, turn Tailscale on. Then show a code here and scan it with the camera.</p>')
          : null,
        ended ? el(html`<p class="st-hint">${ended}</p>`) : null,
        pauseLine(v),
        levelPicker(),
        row(action(label, () => showCode(), { kind: primary ? 'primary' : undefined })),
      ];
    const shown = code;
    const left = el(html`<p class="st-hint">Works once · expires in ${timeLeft(shown.expiresAt)}</p>`);
    ticking = window.setInterval(() => {
      if (!page.isConnected || shown.expiresAt <= Date.now()) {
        clearInterval(ticking);
        if (page.isConnected) {
          code = null;
          act(() => api.remote.init());
        }
        return;
      }
      left.textContent = `Works once · expires in ${timeLeft(shown.expiresAt)}`;
    }, 1000);
    const host = shown.url ? new URL(shown.url).host : '';
    const card = el(
      shown.url
        ? html`<div class="remote-pair">
            <div class="remote-qr">${raw(qrSvg(shown.url, { label: 'QR code to pair a phone' }))}</div>
            <div class="remote-pair-text">
              <ol class="remote-howto">
                <li>Turn Tailscale on in your phone.</li>
                <li>Point the camera at this code, and open the link.</li>
                <li>
                  To keep it on your Home Screen, tap Share in Safari, then <b>Add to Home Screen</b>. That copy signs
                  in once more, with a new code from <b>Pair another phone</b>.
                </li>
              </ol>
              <p class="st-hint">Can’t scan? Open <b class="remote-address">${host}</b> and type</p>
              <p class="remote-code" aria-label="Pairing code">${shown.shown}</p>
            </div>
          </div>`
        : html`<div class="remote-pair">
            <div class="remote-pair-text">
              <p class="st-hint">Set up the private address first: your phone can’t reach this ${noun} yet.</p>
              <p class="remote-code" aria-label="Pairing code">${shown.shown}</p>
            </div>
          </div>`
    );
    /** @type {HTMLElement} */ (card.querySelector('.remote-pair-text')).append(left);
    // Setting it up, there is no address to copy elsewhere on the page yet.
    const copy =
      intro && shown.url
        ? action('Copy address', () =>
            navigator.clipboard.writeText(new URL(shown.url).origin).then(() => said('Copied.'))
          )
        : null;
    return [
      levelPicker(),
      card,
      pauseLine(v),
      row(
        action('New code', () => showCode()),
        action('Cancel', cancelCode, { key: 'Cancel code' }),
        copy
      ),
    ];
  }

  /**
   * Where the password waits after too many wrong ones, beside pairing: a code still pairs a phone meanwhile.
   * @param {RemoteView} v
   */
  function pauseLine(v) {
    const pauses = v.signInPause ?? [];
    if (!pauses.length) return null;
    const at = (until) => new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const everyone = pauses.find(({ address }) => address === '*');
    const text = everyone
      ? `Too many wrong passwords. The password works again at ${at(everyone.until)}, on every device.`
      : `Too many wrong passwords from ${pauses.map(({ address }) => address).join(', ')}. The password works there again at ${at(Math.max(...pauses.map(({ until }) => until)))}.`;
    return el(html`<p class="st-hint st-bad" role="status">${text} A new code still pairs a phone.</p>`);
  }

  async function changePassword() {
    const saved = await passwordDialog(noun);
    if (saved) {
      stands(saved);
      said('Password saved.');
      draw();
    }
  }

  // ---- once it is set up ------------------------------------------------------------------------

  /** @param {RemoteView} v */
  function connected(v) {
    // Asked once, under how it stands, where it is seen as setting it up ends; the switch is there once answered.
    return [
      statusCard(v),
      v.keepAwakeAsked ? null : keepAwakeOffer(),
      devices(v),
      notifications(v),
      v.keepAwakeAsked
        ? group(
            `This ${noun}`,
            '',
            toggle({
              label: `Keep this ${noun} awake while remote access is on`,
              hint: `So your phone can reach it.${LID[platform] ?? ''}`,
              checked: v.keepAwake,
              onChange: (keepAwake) => act(() => api.remote.update({ keepAwake })),
            })
          )
        : null,
      setupFold(v),
    ].filter(Boolean);
  }

  /** Whether the computer should stay awake for the phone: it sleeps as it always does until the user says so. */
  function keepAwakeOffer() {
    return group(
      `Keep this ${noun} awake for your phone?`,
      `While remote access is on, buddylist can stop this ${noun} from sleeping by itself, so your phone can reach it while you’re away.${LID[platform] ?? ''} You can change this later on this page.`,
      row(
        action('Keep awake', () => act(() => api.remote.update({ keepAwake: true }), `This ${noun} stays awake.`), {
          kind: 'primary',
        }),
        action('Not now', () => act(() => api.remote.update({ keepAwake: false })), { key: 'Not now keep awake' })
      )
    );
  }

  /** Whether a phone can reach this Mac, or why not, with the switch and the address. @param {RemoteView} v */
  function statusCard(v) {
    const line = connectedLine(v, noun);
    const role = document.documentElement.dataset.look === 'professional' ? 'switch' : 'checkbox';
    const card = el(
      html`<section class="remote-card${line.reachable ? ' reachable' : ''}" aria-labelledby="remote-card-title">
        <div class="remote-card-head">
          ${raw(art(line.reachable))}
          <div class="remote-card-text">
            <h2 class="remote-card-title" id="remote-card-title">
              <span class="remote-led${line.reachable ? ' on' : line.bad ? ' bad' : ''}" aria-hidden="true"></span
              >${line.title}
            </h2>
            <p class="st-hint${line.bad ? ' st-bad' : ''}" role="status">${line.text}</p>
            ${
              line.seen
                ? html`<p class="st-hint remote-seen">
                    ${
                      line.seen.now
                        ? `${line.seen.name} is connected now.`
                        : `${line.seen.name} last reached this ${noun} ${timeAgo(line.seen.at)}.`
                    }
                  </p>`
                : ''
            }
          </div>
          <label class="st-toggle remote-switch"
            ><input type="checkbox" role="${role}" data-focus="switch" /><span><b>Remote access</b></span></label
          >
        </div>
      </section>`
    );
    const box = /** @type {HTMLInputElement} */ (card.querySelector('.remote-switch input'));
    box.checked = v.enabled || turningOn;
    box.addEventListener('change', () => (box.checked ? turnOn() : turnOff()));
    // Off, the address opens nothing: it is shown while it works.
    if (v.address && v.running) {
      const address = el(html`<div class="remote-address-row"><span class="remote-address">${v.address}</span></div>`);
      address.append(
        action('Copy', () => navigator.clipboard.writeText(v.address).then(() => said('Copied.')), {
          key: 'Copy address',
        })
      );
      card.append(address);
    }
    const offer =
      line.offer === 'download'
        ? getTailscale()
        : line.offer === 'check'
          ? check()
          : line.offer === 'serve'
            ? action('Set up again', () => {
                setupOpen = true;
                draw();
                /** @type {HTMLElement | null} */ (
                  page.querySelector('[data-focus="set-up-tailscale-serve"]')
                )?.focus();
              })
            : null;
    if (offer) card.append(row(offer));
    const wrong = problemLine();
    if (wrong) card.append(wrong);
    return card;
  }

  /**
   * What a device may do, to change on its row: it may do so from its next request, and its pages follow at once.
   * @param {RemoteView['devices'][number]} device
   */
  function accessSelect(device) {
    const now = device.access ?? 'full';
    const select = /** @type {HTMLSelectElement} */ (
      el(
        html`<select
          class="input remote-access"
          aria-label="What ${device.name} may do"
          data-focus="${keyOf(`access ${device.id}`)}"
        >
          ${ACCESS_LEVELS.map(
            (level) => html`<option value="${level}" ${level === now ? 'selected' : ''}>${ACCESS[level].label}</option>`
          )}
        </select>`
      )
    );
    select.addEventListener('change', () => {
      const level = /** @type {import('../../shared/remote-access.js').AccessLevel} */ (select.value);
      act(() => api.remote.setAccess(device.id, level), `${device.name} is set to ${ACCESS[level].label}.`);
    });
    return select;
  }

  /** The devices signed in, and pairing another. @param {RemoteView} v */
  function devices(v) {
    const now = Date.now();
    const lines = v.devices.map((device) => {
      const line = el(
        html`<div class="remote-device">
          <span class="remote-device-icon">${raw(PHONE)}</span>
          <div class="remote-device-info">
            <span class="remote-device-name">${device.name}</span>
            <span class="st-hint"
              >${deviceWhere(device, noun)} ·
              ${device.connected ? 'active now' : `used ${timeAgo(device.lastSeenAt, now)}`}${
                device.pushFailure
                  ? ` · notifications failing: ${device.pushFailure.reason.replace(/[\s.]+$/, '')}`
                  : device.notifications
                    ? ' · notifications on'
                    : ''
              }</span
            >
            <span class="st-hint remote-device-when"
              >Paired ${daySaid(dayAndTime(device.createdAt, now))} · signs out
              ${daySaid(whenNext(device.expiresAt, now))} unless used</span
            >
          </div>
        </div>`
      );
      line.append(
        accessSelect(device),
        action('Sign out', () => act(() => api.remote.signOut(device.id), `${device.name} is signed out.`), {
          key: `Sign out ${device.id}`,
        })
      );
      return line;
    });
    const list = el('<div class="remote-devices"></div>');
    list.append(...lines);
    const canPair = v.setUp && v.running && Boolean(v.address);
    const pair = canPair
      ? pairing(v, { primary: !lines.length, label: lines.length ? 'Pair another phone' : 'Pair a phone' })
      : [];
    const signOutAll =
      lines.length > 1
        ? action(
            'Sign out all',
            async () => {
              if (await confirmDialog('Sign out every device? Each pairs again to come back.', { ok: 'Sign out all' }))
                await act(() => api.remote.signOut(), 'Every device is signed out.');
            },
            { kind: 'danger' }
          )
        : null;
    // Sign out all goes in the row of the button that pairs another, where there is one.
    const last = pair.at(-1);
    if (signOutAll && last && !code) last.append(signOutAll);
    return group(
      v.setUp ? 'Phones and browsers' : 'Signed-in devices',
      'A device you don’t know? Sign it out, and change the password.',
      lines.length ? list : el('<p class="st-list-empty">No phones yet.</p>'),
      ...pair.filter(Boolean),
      signOutAll && (!last || code) ? row(signOutAll) : null
    );
  }

  /** @param {RemoteView} v */
  function notifications(v) {
    return group(
      'Notifications on your phone',
      'Turn them on in the phone app, with the bell. An iPhone gets them only in buddylist on its Home Screen, on iOS 16.4 or later. They go encrypted through your phone browser’s push service, which can’t read them.',
      toggle({
        label: `Only when I’m away from this ${noun}`,
        hint: 'When it’s locked, or you haven’t used it for 5 minutes. Off, they come while you’re here too, but not for the conversation you’re looking at.',
        checked: v.pushAwayOnly,
        onChange: (pushAwayOnly) => act(() => api.remote.update({ pushAwayOnly })),
      }),
      toggle({
        label: 'Show what was said',
        hint: 'Off, a notification says only who it is and what kind: needs you, finished or ran into a problem. On, it shows the message too, on your lock screen as well.',
        checked: v.pushText,
        onChange: (pushText) => act(() => api.remote.update({ pushText })),
      })
    );
  }

  /** Tailscale, the private address and the password, folded away once it is set up. @param {RemoteView} v */
  function setupFold(v) {
    const fold = el(
      html`<section class="st-group remote-setup${setupOpen ? ' open' : ''}">
        <button
          class="remote-fold"
          type="button"
          aria-expanded="${String(setupOpen)}"
          aria-controls="remote-setup-body"
          data-focus="setup"
        >
          ${raw(CHEVRON)}<b>Setup</b><span class="st-hint">Tailscale, private address, password</span>
        </button>
        <div class="remote-setup-body" id="remote-setup-body"></div>
      </section>`
    );
    fold.querySelector('.remote-fold').addEventListener('click', () => {
      setupOpen = !setupOpen;
      draw();
    });
    const body = /** @type {HTMLElement} */ (fold.querySelector('.remote-setup-body'));
    body.hidden = !setupOpen;
    if (!setupOpen) return fold;
    const { tailscale } = v;
    const mac = tailscale.state === 'running' ? null : macLine(tailscale, noun);
    const part = (title, ...nodes) => {
      const node = el(html`<div class="remote-setup-part"><h3>${title}</h3></div>`);
      node.append(...nodes.filter(Boolean));
      return node;
    };
    body.append(
      part(
        `Tailscale on this ${noun}`,
        mac
          ? el(html`<p class="st-hint${mac.bad ? ' st-bad' : ''}">${mac.text}</p>`)
          : el(
              html`<p class="st-hint">
                Signed in${tailscale.login ? html` as ${tailscale.login}` : ''} on
                ${shortName(tailscale.hostname) || `this ${noun}`}.
              </p>`
            ),
        row(
          mac?.offer === 'download' ? getTailscale('Get Tailscale setup') : null,
          action('Check again', () => act(() => api.remote.tailscale('check')), { key: 'Check again setup' })
        )
      ),
      part(
        'Private address',
        ...(tailscale.serving && !tailscale.funnel
          ? [
              el(html`<p class="st-hint">Tailscale Serve passes ${tailscale.serving.url} on to buddylist.</p>`),
              ...printed(tailscale.output),
              row(
                action('Stop serving', async () => {
                  const ok = await confirmDialog(
                    `Stop Tailscale Serve passing ${tailscale.serving?.url} on to buddylist? Your phone can’t reach it until you set it up again.`,
                    { title: 'Stop serving', ok: 'Stop serving' }
                  );
                  if (ok) await act(() => api.remote.tailscale('stop'), 'Tailscale Serve stopped.');
                })
              ),
            ]
          : serveControls(v))
      ),
      part(
        'Password',
        el('<p class="st-hint">Signs in a browser that can’t scan a code.</p>'),
        row(action('Change password…', changePassword))
      )
    );
    return fold;
  }

  return [page];
}
