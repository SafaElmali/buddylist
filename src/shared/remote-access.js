// What Settings > Remote access says of how it stands (see main/remote/access.js for the view it is drawn from).

/** @typedef {import('../main/remote/access.js').RemoteView} RemoteView */

/** Where to get Tailscale, for this computer and the phone. */
export const TAILSCALE_DOWNLOAD = 'https://tailscale.com/download';

/** "studio-mac": this Mac's name on the tailnet, without the tailnet's. */
export const shortName = (hostname) => String(hostname || '').split('.')[0];

/** What the computer buddylist runs on is called, as a phone names it: "Mac", "PC" or "computer". */
export const hostNoun = (platform) => ({ darwin: 'Mac', win32: 'PC' })[platform] ?? 'computer';

/**
 * What a device may do from the phone app, chosen as it pairs and changed in Settings (see main/remote/routes.js):
 * everything; answer what its agents ask and stop them; or only look.
 * @typedef {'full' | 'answer' | 'read'} AccessLevel
 */

/** The levels, the most first. A password sign-in, and a device paired before there were levels, has full access. */
export const ACCESS_LEVELS = Object.freeze(/** @type {AccessLevel[]} */ (['full', 'answer', 'read']));

/** Each level as Settings names it, and what it lets a device do. */
export const ACCESS = Object.freeze({
  full: { label: 'Full', says: 'Sends messages, answers, stops, and can always allow.' },
  answer: {
    label: 'Answer only',
    says: 'Answers permissions, questions and plans, asking before edits, and stops. Sends nothing.',
  },
  read: { label: 'Read only', says: 'Sees Home and conversations. Answers and sends nothing.' },
});

/** The mode a plan is approved in that asks before each change (Claude's "Yes, ask before edits"): the one approval
 * Answer only may give, as any other has the agent do more unasked. */
export const ASKS_FIRST_MODE = 'default';

/**
 * A level as it was given: one there is, else the least, read only.
 * @param {unknown} value
 * @returns {AccessLevel}
 */
export const accessOf = (value) =>
  ACCESS_LEVELS.includes(/** @type {AccessLevel} */ (value)) ? /** @type {AccessLevel} */ (value) : 'read';

/**
 * @typedef {{ id: 'mac' | 'phone' | 'on' | 'address' | 'pair', title: string, done: boolean, current: boolean,
 *   summary: string }} SetupStep
 *   `summary`: what a step that is done came to, said on its line
 */

/**
 * Setting it up, in order, each step done or not; the first one not done is the one to do now. Tailscale on the
 * phone is seen when the phone is on the tailnet, online or not, and its line says which; where it can't be seen,
 * the user saying so does, and so does having gone on to turn remote access on.
 * @param {RemoteView} view
 * @param {{ phoneSaid?: boolean, noun?: string }} [said]  `phoneSaid`: the user said the phone has Tailscale. `noun`:
 *   what this computer is called (see hostNoun)
 * @returns {SetupStep[]}
 */
export function setupSteps(view, { phoneSaid = false, noun = 'computer' } = {}) {
  const { tailscale } = view;
  const phones = tailscale.phones ?? [];
  const phone = phones.find(({ online }) => online) ?? phones[0];
  const paired = view.devices.some((device) => device.via === 'tailscale');
  const name = shortName(tailscale.hostname) || `this ${noun}`;
  const steps = [
    {
      id: 'mac',
      title: `Install Tailscale on this ${noun}`,
      done: tailscale.state === 'running',
      summary: tailscale.login ? `Signed in as ${tailscale.login} on ${name}` : `Signed in on ${name}`,
    },
    {
      id: 'phone',
      title: 'Install Tailscale on your phone',
      done: Boolean(phone) || phoneSaid || view.running || paired,
      summary: phone
        ? `${phone.name} is on your tailnet${phone.online ? '' : ', offline now'}`
        : phoneSaid
          ? 'You said your phone has it'
          : '',
    },
    {
      id: 'on',
      title: 'Turn on remote access',
      done: view.running,
      summary: 'On, with a password for a browser that can’t scan',
    },
    {
      id: 'address',
      title: 'Give buddylist a private address',
      done: Boolean(view.address),
      summary: view.address,
    },
    { id: 'pair', title: 'Pair your phone', done: paired, summary: '' },
  ];
  const current = steps.find((step) => !step.done);
  return /** @type {SetupStep[]} */ (steps.map((step) => ({ ...step, current: step === current })));
}

/**
 * What the first step says while Tailscale isn't signed in on this computer, and what it offers to do.
 * @param {RemoteView['tailscale']} tailscale
 * @param {string} [noun]  what this computer is called (see hostNoun)
 * @returns {{ text: string, bad: boolean, offer: 'download' | 'check' | '' }}
 */
export function macLine(tailscale, noun = 'computer') {
  if (!tailscale.checked) return { text: 'Looking for Tailscale…', bad: false, offer: '' };
  if (tailscale.state === 'missing')
    return {
      text: `Tailscale isn’t on this ${noun} yet. Install it, open it, and sign in.`,
      bad: false,
      offer: 'download',
    };
  if (tailscale.state === 'stopped' && tailscale.reason)
    return {
      text: `Tailscale didn’t answer: ${tailscale.reason.replace(/[\s.]+$/, '')}. Make sure it’s open and connected, then check again.`,
      bad: true,
      offer: 'check',
    };
  if (tailscale.state === 'stopped')
    return {
      text: `Tailscale is on this ${noun}, but isn’t connected. Open it and connect.`,
      bad: false,
      offer: 'check',
    };
  return { text: `Open Tailscale on this ${noun} and sign in.`, bad: false, offer: 'check' };
}

/**
 * The phone that last reached this computer through Tailscale, and when: one connected now first. Null for none yet.
 * @param {RemoteView['devices']} devices
 * @returns {{ name: string, at: number, now: boolean } | null}
 */
function lastSeen(devices) {
  const phones = devices.filter((device) => device.via === 'tailscale');
  const [last] = [...phones].sort((a, b) => Number(b.connected) - Number(a.connected) || b.lastSeenAt - a.lastSeenAt);
  return last ? { name: last.name, at: last.lastSeenAt, now: Boolean(last.connected) } : null;
}

/**
 * The line at the top once it is set up: whether a phone can reach this computer, or why not, and what it offers to
 * do. Reachable is what the setup allows, not what a phone did: `seen` says which phone last reached it, and when.
 * @param {RemoteView} view
 * @param {string} [noun]  what this computer is called (see hostNoun)
 * @returns {{ title: string, text: string, bad: boolean, reachable: boolean, offer: 'download' | 'check' | 'serve' | '',
 *   seen: { name: string, at: number, now: boolean } | null }}
 */
export function connectedLine(view, noun = 'computer') {
  const line = {
    bad: false,
    reachable: false,
    offer: /** @type {'download' | 'check' | 'serve' | ''} */ (''),
    seen: null,
  };
  if (view.enabled && !view.running)
    return { ...line, title: 'Not running', text: view.error || 'Turn it off and on again.', bad: true };
  if (!view.enabled)
    return {
      ...line,
      title: 'Off',
      text: view.error || `Your phone can’t reach this ${noun} until you turn it on.`,
      bad: Boolean(view.error),
    };
  const { tailscale } = view;
  if (!tailscale.checked) return { ...line, title: 'On', text: 'Looking for Tailscale…' };
  if (tailscale.state !== 'running') {
    const { text, offer } = macLine(tailscale, noun);
    return { ...line, title: `On, but Tailscale isn’t connected on this ${noun}`, text, bad: true, offer };
  }
  if (tailscale.funnel)
    return { ...line, title: 'On, but Funnel is on', text: tailscaleLine(tailscale, noun).text, bad: true };
  if (!view.address && tailscale.serveReason)
    return {
      ...line,
      title: 'On, but buddylist couldn’t read Tailscale Serve',
      text: `Reading Tailscale Serve’s settings failed: ${tailscale.serveReason.replace(/[\s.]+$/, '')}. Check again.`,
      bad: true,
      offer: 'check',
    };
  if (!view.address)
    return {
      ...line,
      title: `On, but your phone can’t reach this ${noun}`,
      text: 'Tailscale Serve isn’t passing the private address on to buddylist. Set it up again.',
      bad: true,
      offer: 'serve',
    };
  return {
    ...line,
    title: 'On · ready for your phone',
    text: 'Open buddylist from your phone’s Home Screen, or the address below, with Tailscale on.',
    reachable: true,
    seen: lastSeen(view.devices),
  };
}

/**
 * Why Serve sets buddylist up on a port other than 443, before it is set up: the ones Serve has for something else
 * on this computer. '' where 443 is free.
 * @param {RemoteView['tailscale']} tailscale
 * @param {string} [noun]  what this computer is called (see hostNoun)
 */
export function portLine(tailscale, noun = 'computer') {
  const taken = tailscale.taken ?? [];
  if (!taken.length) return '';
  const ports = taken.length === 1 ? `Port ${taken[0]}` : `Ports ${taken.slice(0, -1).join(', ')} and ${taken.at(-1)}`;
  if (!tailscale.httpsPort)
    return `${ports} on this ${noun} are all served for something else. Free one with \`tailscale serve --https=<port> off\`, then check again.`;
  return `${ports} on this ${noun} ${taken.length === 1 ? 'is' : 'are'} already served for something else, so buddylist uses ${tailscale.httpsPort}.`;
}

/**
 * What Settings says of Tailscale under Setup, and what it offers to do.
 * @param {RemoteView['tailscale']} tailscale
 * @param {string} [noun]  what this computer is called (see hostNoun)
 * @returns {{ text: string, bad: boolean, offer: 'download' | 'check' | 'serve' | 'stop' | '' }}
 */
export function tailscaleLine(tailscale, noun = 'computer') {
  if (!tailscale.checked) return { text: 'Looking for Tailscale…', bad: false, offer: '' };
  if (tailscale.state === 'missing')
    return {
      text: `Tailscale isn’t installed. Install it on this ${noun} and on your phone, and sign in to the same account on both.`,
      bad: false,
      offer: 'download',
    };
  if (tailscale.state === 'stopped' && tailscale.reason)
    return {
      text: `Tailscale didn’t answer: ${tailscale.reason.replace(/[\s.]+$/, '')}. Make sure it’s open and connected on this ${noun}, then check again.`,
      bad: true,
      offer: 'check',
    };
  if (tailscale.state === 'stopped')
    return { text: `Tailscale isn’t running on this ${noun}. Open it and connect.`, bad: false, offer: 'check' };
  if (tailscale.state === 'signed-out')
    return { text: `Sign in to Tailscale on this ${noun}.`, bad: false, offer: 'check' };
  if (tailscale.funnel)
    return {
      text: 'Tailscale Funnel puts buddylist on the public internet, so remote access stays off until Funnel is off.',
      bad: true,
      offer: 'check',
    };
  if (tailscale.serving)
    return { text: `Tailscale Serve passes ${tailscale.serving.url} on to buddylist.`, bad: false, offer: 'stop' };
  return {
    text: `Signed in as ${tailscale.hostname || `this ${noun}`}. Tailscale Serve gives buddylist an https address on your tailnet, with one command:`,
    bad: false,
    offer: 'serve',
  };
}

/**
 * Where a device signed in from, as its line says: "Tailscale · 100.84.2.17 (safa@)", or "This Mac".
 * @param {{ via: string, address: string, login: string }} device
 * @param {string} [noun]  what this computer is called (see hostNoun)
 */
export const deviceWhere = ({ via, address, login }, noun = 'computer') =>
  via === 'tailscale'
    ? ['Tailscale', [address, login && `(${login})`].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
    : `This ${noun}`;

/** The links a command printed, such as the one Tailscale gives to turn HTTPS certificates on. */
export const linksIn = (output) => [...new Set(String(output || '').match(/https:\/\/[^\s"'<>]+/g) ?? [])];

/** "4:05": what is left of a code, in minutes and seconds. */
export function timeLeft(expiresAt, now = Date.now()) {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Why the code shown is gone, for the line where it was. */
export const codeEnded = (ended) =>
  ({
    used: 'Paired. Show another code to pair another phone.',
    wrong: 'The code was cancelled after 5 wrong tries. Show a new one.',
    expired: 'The code expired. Show a new one.',
  })[ended] ?? '';
