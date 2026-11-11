// A scripted stand-in for a real provider session, used by `npm run demo`
// and the web preview. Emits the same events without calling any AI, and
// only offers what the provider it stands in for offers.
import { selectQueued } from '../queued-message.js';
import crypto from 'node:crypto';
import { APP_TOOLS, appActivity, reportedBy } from '../../shared/app-tools.js';
import { checkInDue } from '../../shared/check-ins.js';
import { managerNoteOf } from '../../shared/managers.js';
import { mentions } from '../../shared/mentions.js';
import { splitOutputs } from '../../shared/terminal-mentions.js';
import { accountName, switchedMidTurn } from '../../shared/usage.js';
import { BaseSession } from '../base-session.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// "/review the last commit" -> "review". A path, such as "/Users/you/notes.md", is not a command.
const SLASH_COMMAND = /^\/([\w:-]+)(?=\s|$)/;

const REVIEW_DIFF =
  'diff --git a/src/cart.js b/src/cart.js\n' +
  '@@ -12,3 +12,3 @@ export function total(items) {\n' +
  '-  return items.reduce((sum, item) => sum + item.price, 0);\n' +
  '+  return items.reduce((sum, item) => sum + item.price * item.count, 0);\n' +
  ' }';

// The line /review found fault with, and the one that puts it right.
const FIX = {
  before: '  return items.reduce((sum, item) => sum + item.price * item.count, 0);',
  after: '  return items.reduce((sum, item) => sum + item.price * (item.count ?? 1), 0);',
};

const TEST_RUN =
  '✔ the total counts how many of each item there are\n' +
  '✔ an item without a count counts once\n' +
  'ℹ tests 2\nℹ pass 2\nℹ fail 0';

// The diagram it draws when asked for one: how the fixed cart adds up its total.
const CART_DIAGRAM = [
  '```mermaid',
  'flowchart TD',
  '  cart[Cart] --> item{Does the item have a count?}',
  '  item -- yes --> times[Add its price times its count]',
  '  item -- no --> once[Add its price once]',
  '  times --> total([Total])',
  '  once --> total',
  '```',
].join('\n');

// The check-in it sets when asked to check back: due once, at the next minute as a real one would be.
const CHECK_IN = {
  id: 'demo-check-in',
  schedule: '*/1 * * * *',
  recurring: false,
  prompt: 'Check how CI is doing and tell the user',
};
// How long it really takes to be due: long enough to see it waiting, short enough to wait for.
const CHECK_IN_DUE_MS = 8000;
const CI_CHECKS = 'build\tpass\t1m02s\ntest\tpass\t2m10s\nlint\tpass\t31s';

/**
 * What it leaves running when asked to run something in the background: a dev server, which runs
 * until it is stopped, and a watcher on CI, which ends once CI is done. Each prints its lines one
 * at a time, a line every LINE_MS.
 */
const BACKGROUND_JOBS = [
  {
    kind: 'command',
    command: 'npm run dev',
    label: 'Start the dev server',
    lines: [
      '> shop@1.0.0 dev',
      '> vite',
      '',
      '  VITE v6.0.0  ready in 312 ms',
      '',
      '  ➜  Local:   http://localhost:5173/',
      '10:42:07 [vite] page reload src/cart.js',
      '10:42:19 [vite] hmr update /src/cart.js',
    ],
  },
  {
    kind: 'watcher',
    command: 'gh run watch --exit-status',
    label: 'Watch the CI run',
    lines: ['Refreshing run status every 3 seconds.', '✓ build in 1m02s', '✓ lint in 31s', '✓ test in 2m10s'],
    endsAfterMs: 12000,
    summary: 'CI passed: build, lint and test.',
  },
];
const LINE_MS = 1500;

/**
 * The jobs it hands out when asked for helpers: what each helper is asked, the steps it takes
 * with what each prints, and what it reports. Paths are from the contact's folder.
 */
const HELPER_JOBS = [
  {
    label: 'Look through the tests',
    agent: 'Explore',
    prompt: 'Find the tests of the cart. Say what they cover, and what they leave out.',
    steps: [
      [{ kind: 'search', query: 'test/**/*.test.js', label: 'files' }, 'test/cart.test.js'],
      [{ kind: 'read', path: 'test/cart.test.js' }, ''],
      [{ kind: 'command', command: 'npm test', description: 'Run the tests' }, TEST_RUN],
    ],
    report: 'The cart has **2 tests**, and both pass. Nothing tries an empty cart yet.',
  },
  {
    label: 'Read how the total is worked out',
    agent: 'Explore',
    prompt: 'Read src/cart.js and say in a few lines how the total is worked out.',
    steps: [
      [{ kind: 'search', query: 'total(' }, 'src/cart.js:12:export function total(items) {'],
      [{ kind: 'read', path: 'src/cart.js' }, ''],
    ],
    report: '`total()` adds up **price × count** for every item. An item without a count is counted once.',
  },
];

/**
 * What a conversation it starts for a side task is asked to do. Its own scripted answer is the one to
 * a to-do list (TODO_JOB), which needs nobody to accept anything, so it is done in a few seconds.
 */
// A link in a message, as a manager takes one shared with it for a source.
const LINK = /https?:\/\/[^\s<>()]+/;

// What it writes in the brief as a project's manager, and what it asks of a conversation that changed files.
const BRIEF =
  'Goal: the cart adds up what is in it, whatever is in it.\n' +
  'Ticket SHOP-12: an item without a count counts once. Acceptance: the total is never NaN, with a test for it.\n' +
  'Decided in #shop on Slack: counts stay whole numbers.';
// And what it adds to the brief when a fresh session takes over from it.
const HANDED_OVER =
  'Where it stands: the conversation on SHOP-12 was asked for the test of an item without a count, and its ' +
  'answer comes to the next session. Next: check that test once it is in.';
// How the conversations a manager oversees are listed to it: each under its name, then its service and how it is,
// such as "Claude (cart) (Claude, idle)".
const LISTED = /^(.+) \([^()]*, [^()]*\)$/;
// What it says of a conversation the user tags, once it looked at it. A tag is how it names one, too.
const TAGGED_SAYS = (name) =>
  `@${name} is on SHOP-12. It counts an item without a count once now, but its changes have no test for that ` +
  'yet, which the ticket wants. Say so, and I will ask it for one.';
const MANAGER_ASKS =
  'SHOP-12 asks for a test of an item without a count, and I see none in your changes. Add one, as the ' +
  'acceptance criteria in the brief say.';
// What a project manager asks of the manager it hands a job to.
const HAND_OFF = 'Review it against its ticket’s acceptance criteria, and send me your verdict.';
// What a review worker is started with, and its verdict, which its manager sends up as it is.
const REVIEW = 'Review the job of ';
const REVIEW_PROMPT = (job) => `${REVIEW}${job} against its ticket, and say what must change.`;
const REVIEWED = (job) =>
  `Review of ${job}: changes needed. An item without a count makes the total NaN, and no test covers it. ` +
  'Count it once, and add that test.';
const VERDICT = /^Review of (.+?): (.+)$/m;

/**
 * The managers and workers a project manager's look at its teams names: "- shop manager (idle, …" and
 * "- Claude (cart) · under shop manager · …".
 * @param {string} output
 */
function teamsOf(output) {
  const lines = output.split('\n').filter((line) => line.startsWith('- '));
  return {
    managers: lines
      .filter((line) => !line.includes(' · '))
      .flatMap((line) => /^- (.+?) \([^,()]+, /.exec(line)?.[1] ?? []),
    workers: lines.filter((line) => line.includes(' · ')).map((line) => line.slice(2).split(' · ')[0]),
  };
}

// The scope it writes into a project's instructions when asked to: a section of its own, which it adds or replaces.
const SCOPE = [
  '## Scope',
  '- Open the pull request once the tests pass.',
  '- Merge it when its checks are green, without asking first.',
];

/**
 * The project's instructions with SCOPE in them: in place of a scope section they have, up to the next heading,
 * or after the rest.
 * @param {string} now
 */
function withScope(now) {
  const lines = now ? now.split('\n') : [];
  const at = lines.findIndex((line) => /^#+\s*scope\b/i.test(line));
  if (at === -1) return [...lines, ...(lines.length ? [''] : []), ...SCOPE].join('\n');
  const next = lines.findIndex((line, i) => i > at && /^#+\s/.test(line));
  const rest = next === -1 ? [] : ['', ...lines.slice(next)];
  return [...lines.slice(0, at), ...SCOPE, ...rest].join('\n');
}

const SIDE_TASK =
  'Put the cart total right.\n\n' +
  'An item that has no count makes the total NaN, in src/cart.js: count it once, and check that the tests pass. ' +
  'It is a few steps, so keep a to-do list as you go.';

/**
 * The job it works through with a to-do list when asked for one: each item with its words for doing
 * it, the call it takes and what that prints. Paths are from the contact's folder.
 */
const TODO_JOB = [
  {
    text: 'Read how the total is worked out',
    activeForm: 'Reading the cart',
    call: { kind: 'read', path: 'src/cart.js' },
    output: '',
  },
  {
    text: 'Count an item without a count once',
    activeForm: 'Fixing the total',
    call: { kind: 'edit', path: 'src/cart.js', changes: [FIX] },
    output: '',
  },
  {
    text: 'Run the tests',
    activeForm: 'Running the tests',
    call: { kind: 'command', command: 'npm test', description: 'Run the tests' },
    output: TEST_RUN,
  },
];

// What sounds like a big job gets everyone's highest effort level in an effort check, the rest their lowest.
const BIG_JOB = /\b(refactor|rewrite|redesign|migrat\w*|architecture|security)\b/i;

// What a scripted agent says of its MCP servers: one of each kind there is to see, and to act on.
const MCP_SERVERS = [
  {
    name: 'github',
    status: 'connected',
    address: 'https://api.githubcopilot.com/mcp/',
    origin: 'This project',
    tools: 41,
  },
  { name: 'figma', status: 'needs-auth', address: 'https://mcp.figma.com/mcp', origin: 'Plugin' },
  {
    name: 'figma-desktop',
    status: 'failed',
    error: 'ECONNREFUSED: Unable to connect. Is the computer able to access the url?',
    address: 'http://127.0.0.1:3845/mcp',
    origin: 'This folder, for you only',
  },
  {
    name: 'playwright',
    status: 'disabled',
    address: 'npx @playwright/mcp@latest',
    origin: 'Your Claude Code settings',
  },
];

// What a scripted agent says fills its context window, as its provider says it: Claude Code part by
// part, Codex only how much of it is used. The last part in use is the one that grows: its messages.
const CONTEXTS = {
  claude: {
    size: 1_000_000,
    parts: [
      { name: 'System prompt', tokens: 3_400, kind: 'used' },
      { name: 'System tools', tokens: 10_800, kind: 'used' },
      { name: 'Custom agents', tokens: 2_000, kind: 'used' },
      { name: 'Memory files', tokens: 3_200, kind: 'used' },
      { name: 'Skills', tokens: 9_900, kind: 'used' },
      { name: 'Messages', tokens: 213_500, kind: 'used' },
      { name: 'Autocompact buffer', tokens: 33_000, kind: 'reserved' },
    ],
  },
  codex: { size: 258_400, parts: [{ name: 'Used', tokens: 22_500, kind: 'used' }] },
};
// What a turn adds to its messages, and what /compact leaves of them.
const TURN_TOKENS = 4_200;
const COMPACTED_TOKENS = 12_000;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/**
 * A plan, with how long from now each of its limits starts over.
 * @typedef {{ plan: string, limits: { kind: string, model?: string, percent: number, resetsIn: number }[], extra: object }} DemoPlan
 */
// And of its plan's limits: the user's own login's, where it has others (see accounts.js).
/** @type {Record<string, DemoPlan>} */
export const PLANS = {
  claude: {
    plan: 'max',
    limits: [
      { kind: 'session', percent: 43, resetsIn: 79 * MINUTE },
      { kind: 'weekly', percent: 28, resetsIn: 5 * DAY + 7 * 60 * MINUTE },
      { kind: 'model', model: 'Fable', percent: 2, resetsIn: 5 * DAY + 7 * 60 * MINUTE },
    ],
    extra: { on: true, currency: 'USD', used: 12.4, limit: 50, percent: 24.8 },
  },
  codex: {
    plan: 'pro',
    limits: [{ kind: 'weekly', percent: 19, resetsIn: 3 * DAY + 2 * 60 * MINUTE }],
    extra: { on: true, credits: 1250 },
  },
};

/**
 * A plan's limits, each starting over a while from now.
 * @param {DemoPlan} plan
 * @returns {import('../contract.js').UsageLimit[]}
 */
export function planLimits(plan, now = Date.now()) {
  return plan.limits.map(({ resetsIn, ...limit }) => ({ ...limit, resetsAt: now + resetsIn }));
}

const NUMBERS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
// "three terminals", "2 new terminals", "a terminal": the word in front says how many.
const HOW_MANY = new RegExp(`\\b(\\d+|an?|${NUMBERS.join('|')})\\s+(?:\\w+\\s+)?terminals?\\b`, 'i');
// "... running npm test": what follows, to the end of the message, is typed into each of them.
const TO_RUN = /[\s,]+(?:running|to run|and run)\s+(.+)$/i;
// "for the dev server and one for the tests": what each tab is to say. Not "for me".
const NAMED = /\bfor\s+(?:(?:the|my|an?)\s+)?(?!(?:me|us)\b)(.+?)(?=\s*(?:,|\band\b|$))/gi;

/**
 * What a message asks the terminals tool for, as a real agent would call it: "two terminals
 * running npm test", "a terminal for the dev server and one for the tests".
 * @param {string} text
 * @returns {{ count: number, names: string[], command?: string }}
 */
export function terminalsAsked(text) {
  const said = text.trim().replace(/[.!?]+$/, '');
  const command = said.match(TO_RUN)?.[1].replace(/^`(.*)`$/, '$1');
  const what = command ? said.replace(TO_RUN, '') : said;
  const many = what.match(HOW_MANY)?.[1].toLowerCase();
  const count = Number(many) || NUMBERS.indexOf(many) + 1 || 1;
  const names = [...what.matchAll(NAMED)].map((named) => named[1].trim());
  return { count, names, ...(command && { command }) };
}

export class DemoSession extends BaseSession {
  // Messages not answered yet: one sent while a turn is running waits here for its own turn.
  #queue = [];
  /** @type {Promise<void> | null} the turns it is answering, while it is */
  #answering = null;
  /** The helpers at work, by the id of the call that asked for each: true once it was told to stop. */
  #helpers = new Map();
  /** The check-ins it set that are not due yet. They go when it closes. */
  #checkIns = new Set();
  /**
   * What it left running in the background, and what ran there and ended, by id: each with the lines it prints.
   * @type {Map<string, { task: import('../contract.js').BackgroundTask, lines: string[] }>}
   */
  #background = new Map();
  // Its MCP servers, as they are right now. None for a provider that can't say which it has.
  #mcp = [];
  // What fills its context window, and what its plan's limits are, as its provider says them.
  #window;
  #plan;
  /** @type {import('../contract.js').Account | null} the login it answers in, of a provider with more than one */
  #account = null;
  // The tokens its messages take up in its context window.
  #messages;

  /**
   * @param {object} opts
   * @param {import('../contract.js').SessionContact} opts.contact
   * @param {(event: import('../contract.js').SessionEvent) => void} opts.emit
   * @param {import('../contract.js').ProviderDescriptor} opts.descriptor  the provider being played
   * @param {(ms: number) => Promise<void>} [opts.sleep]  the typing pauses; replaceable in tests
   * @param {import('../../main/app-tools.js').AppTool[]} [opts.tools]  what the agent it plays can ask the
   *   app itself to do in this conversation. None for a provider that can't give its agent tools
   * @param {import('../contract.js').AccountSwitch} [opts.accounts]  the logins it can answer in, of a provider
   *   with more than one: it moves to the one in use as a real one does, once a turn is over
   * @param {(dir: string) => { email: string, orgName?: string, plan: DemoPlan } | null} [opts.login]  who one of those is, by its
   *   folder, and the plan it is on (see accounts.js)
   */
  constructor({ contact, emit, descriptor, sleep = wait, tools = [], accounts, login = () => null }) {
    super({ contact, emit });
    this.descriptor = descriptor;
    this.sleep = sleep;
    this.tools = tools;
    this.accounts = accounts;
    this.login = login;
    this.cancelled = false;
    if (descriptor.mcp) this.#mcp = MCP_SERVERS.map((server) => ({ ...server }));
    this.#window = CONTEXTS[descriptor.id] || CONTEXTS.claude;
    this.#plan = PLANS[descriptor.id] || PLANS.claude;
    this.#messages = this.#window.parts.findLast((part) => part.kind === 'used').tokens;
  }

  start() {
    if (this.state !== 'offline') return;
    this.#followAccount();
    this.contact.sessionId ||= crypto.randomUUID();
    // The provider's built-in output styles, if it has any. The first one stands
    // in for the user's own default until the contact is given another.
    const outputStyles = (this.descriptor.outputStyles || []).map((style) => style.id);
    // The first of its built-in models stands in for the one the user's own settings would choose.
    const usual = this.descriptor.modelSuggestions.find((model) => model.id);
    this.emit({
      type: 'ready',
      sessionId: this.contact.sessionId,
      model: this.contact.model || usual?.id || 'demo',
      permissionMode: this.contact.permissionMode,
      commands: this.descriptor.commonCommands,
      outputStyles,
      outputStyle: this.contact.outputStyle || outputStyles[0] || null,
    });
    this.setState('idle');
  }

  async #stream(text) {
    const key = crypto.randomUUID();
    this.emit({ type: 'text-start', key });
    let sent = '';
    for (const word of text.split(/(?<= )/)) {
      if (this.cancelled) break;
      sent += word;
      this.emit({ type: 'text-delta', key, text: word });
      await this.sleep(25);
    }
    this.emit({ type: 'text-end', key, text: sent });
  }

  #finish(started, stopped = false) {
    this.#tellLimits();
    this.emit({
      type: 'result',
      isError: false,
      stopped,
      errorText: '',
      durationMs: Date.now() - started,
      costUsd: 0,
    });
    this.#messages += TURN_TOKENS;
    this.#tellContext();
    this.setState('idle');
  }

  /** What fills its context window right now. @returns {import('../contract.js').ContextUsage} */
  #context() {
    const { size, parts: kept } = this.#window;
    const messages = kept.findLast((part) => part.kind === 'used');
    const parts = kept.map((part) => ({ ...part, ...(part === messages && { tokens: this.#messages }) }));
    const used = parts.filter((part) => part.kind === 'used').reduce((sum, part) => sum + part.tokens, 0);
    return { used, size, parts };
  }

  /** Says how full it is, as a real session does after a turn. Not for a provider that can't tell. */
  #tellContext() {
    if (!this.descriptor.usage) return;
    const { used, size } = this.#context();
    this.emit({ type: 'context', used, size });
  }

  /** The plan of a login: the one it answers in unless another is said. */
  #planOf(account = this.#account) {
    return (account && this.login(account.dir)?.plan) || this.#plan;
  }

  /** Says how much of them is used, as a real session hears during a turn. Not for a provider that can't tell. */
  #tellLimits(account = this.#account) {
    if (!this.descriptor.usage) return;
    const limits = planLimits(this.#planOf(account));
    this.emit({
      type: 'limits',
      limits,
      ...(account?.id && { account: account.id }),
    });
    return limits;
  }

  /** Goes on in the login in use, as a real one is started again in it. Not in the middle of a turn. */
  #followAccount() {
    if (this.accounts && !this.#answering) this.#account = this.accounts.current();
  }

  /** Another login was put in use: one in the middle of a turn says it finishes the turn in the one before. */
  accountSwitched() {
    const to = this.accounts?.current();
    if (!to || !this.#answering || !this.#account || this.#account.id === to.id) return;
    this.emit({ type: 'notice', text: switchedMidTurn(this.#account.name, to.name) });
  }

  async send({ text, asked, ...message }) {
    this.start();
    // In a conversation with other agents, `text` also relays what they said: the script goes
    // by what you asked. Quoting an @mention back would hand the turn on, so the @ is left out.
    this.#queue.push({ ...message, text: asked === undefined ? text : asked.replaceAll('@', '') });
    this.#tellWaiting();
    await this.#answer();
  }

  /** What waits is the messages sent while it answers. A check-in that is due is none the user sent. */
  #tellWaiting() {
    this.setWaiting(this.#answering ? this.#queue.filter((message) => !message.due).length : 0);
  }

  /** Answers the messages waiting, one turn each, unless it is answering them already. */
  async #answer() {
    if (this.#answering) return;
    this.#followAccount();
    this.#answering = (async () => {
      while (this.#queue.length) await this.#turn(this.#queue.shift());
    })();
    try {
      await this.#answering;
    } finally {
      this.#answering = null;
    }
  }

  async #turn({ text: sent, check, due }) {
    // What a terminal printed, handed over with the message, is read, not obeyed: the scenario is picked from
    // your own words, as the words "terminal" or "fix" in a build's output ask for nothing.
    const text = splitOutputs(sent).text || 'this output';
    this.cancelled = false;
    this.#tellWaiting();
    // A check-in that is due says so before it is answered, as a real one does.
    if (due) this.emit({ type: 'notice', text: checkInDue(text) });
    this.setState('working');
    const started = Date.now();
    await this.sleep(300);
    // A nudge during the pause ends the turn before any scenario starts.
    if (this.cancelled) return this.#finish(started, true);
    // Pick a scripted scenario from the message, so every kind of prompt can be tried.
    // An effort check only picks levels, whatever the message it is about would start.
    // A slash command goes first: what follows it is for the command, not a script of its own.
    const failure = text.match(/^demo (session limit|weekly limit|service unavailable)$/i)?.[1].toLowerCase();
    if (failure) {
      this.emit({
        type: 'result',
        isError: true,
        stopped: false,
        ...(failure === 'service unavailable'
          ? { failureKind: 'unavailable' }
          : { usageLimited: true, limitKind: failure.startsWith('weekly') ? 'weekly' : 'session' }),
        errorText: `Demo: ${failure}.`,
        durationMs: Date.now() - started,
        costUsd: 0,
      });
      this.setState('idle');
      return;
    }
    const command = text.match(SLASH_COMMAND)?.[1].toLowerCase();
    // Terminals are only there to ask for when the provider it plays can ask the app for them, and so
    // is another conversation.
    const terminals = this.tools.find((tool) => tool.name === APP_TOOLS.terminals);
    const conversation = this.tools.find((tool) => tool.name === APP_TOOLS.conversation);
    const sources = this.tools.some((tool) => tool.name === APP_TOOLS.sources);
    const instructions = this.tools.some((tool) => tool.name === APP_TOOLS.instructions);
    // A project's manager looks at the conversations it oversees.
    const team = this.tools.some((tool) => tool.name === APP_TOOLS.look);
    // And a project manager hands a worker's job from one manager to another.
    const lead = this.tools.some((tool) => tool.name === APP_TOOLS.tellManager);
    if (due) await this.#checkedBack();
    else if (check) await this.#effortCheck(text, check);
    else if (command) await this.#slashScenario(command);
    // A note from a conversation it started is no scenario of the user's, whatever words its reply has.
    else if (reportedBy(text)) await this.#heardBack(text);
    // Nor is a note from its project's manager, or one to a manager.
    else if (managerNoteOf(text)) await this.#managerScenario({ ...managerNoteOf(text), text });
    // A project manager asked to send a job on, or about its teams.
    else if (lead && /\b(send|hand|pass)\b/i.test(text)) await this.#handOffScenario(text);
    else if (lead && /(^|\s)@\S|\b(everyone|teams?)\b/i.test(text)) await this.#teamsScenario();
    // A conversation a manager started to review another's job.
    else if (text.startsWith(REVIEW)) await this.#reviewJobScenario(text);
    // A link shared with a project's manager is one of the project's sources.
    else if (sources && LINK.test(text)) await this.#sourceScenario(text);
    // A manager asked after a conversation it oversees, tagged, or after everyone, looks at them.
    else if (team && /(^|\s)@\S|\beveryone\b/i.test(text)) await this.#teamScenario(text);
    // A plan is only shown for providers that have a way to approve one.
    else if (/\bplan\b/i.test(text) && this.descriptor.planApprovals.length) await this.#planScenario();
    else if (/\bask me\b/i.test(text)) await this.#questionScenario();
    else if (/\bto-?do\b|\btask list\b/i.test(text)) await this.#todoScenario();
    else if (/\bfix/i.test(text)) await this.#fixScenario();
    else if (/\bdiagrams?\b/i.test(text)) await this.#diagramScenario();
    else if (terminals && /\bterminals?\b/i.test(text)) await this.#terminalsScenario(terminals, text);
    else if (instructions && /\binstructions\b/i.test(text)) await this.#instructionsScenario();
    else if (conversation && /\b(new conversation|side task)\b/i.test(text)) {
      await this.#conversationScenario(conversation, text);
    }
    // Subagents are only there for a provider whose agent has them.
    else if (this.descriptor.helpers && /\b(helpers?|subagents?)\b/i.test(text)) await this.#helpersScenario();
    // Check-ins too, for a provider whose agent sets them.
    else if (this.descriptor.checkIns && /\bcheck (back|in)\b/i.test(text)) await this.#checkInScenario();
    // And what is left running in the background, for one whose agent leaves anything there.
    else if (this.descriptor.background && /\bbackground\b/i.test(text)) await this.#backgroundScenario();
    else await this.#commandScenario(text);
    this.#finish(started, this.cancelled);
  }

  /**
   * An effort check, answered the way a real agent is asked to: a level behind each name, and why.
   * @param {string} text  what you asked
   * @param {NonNullable<import('../contract.js').OutgoingMessage['check']>} agents
   */
  async #effortCheck(text, agents) {
    const big = BIG_JOB.test(text);
    const picks = agents.map(({ name, levels }) => `@${name}(${big ? levels.at(-1) : levels[0]})`);
    await this.#stream(`${picks.join(' ')} ${big ? 'This one needs care.' : 'A small job, by the look of it.'}`);
  }

  /**
   * Says what it is about to do and asks first, as an invitation. Declined, the turn ends
   * there; with feedback instead, it asks what to do.
   * @param {string} toolId
   * @param {import('../contract.js').Activity} activity
   * @param {boolean} [canAlways]  whether "Always allow" is offered. Not for what the app does itself
   * @returns {Promise<boolean>} whether to go ahead
   */
  async #ask(toolId, activity, canAlways = true) {
    this.emit({ type: 'tool', toolId, activity, sub: false });
    const { decision } = await this.requestPermission({ kind: 'tool', activity, canAlways });
    if (['allow', 'always'].includes(decision)) return true;
    this.emit({ type: 'tool-result', toolId, isError: true, declined: true, output: 'Declined.' });
    if (decision === 'deny') this.cancelled = true;
    else if (!this.cancelled) await this.#stream('No problem, I won’t do that. What would you like to do instead?');
    return false;
  }

  async #commandScenario(text) {
    // One running as an agent you defined says so, as the real one answers in that agent's words.
    const as = this.contact.agent ? ` I’m your **${this.contact.agent}** agent, from .claude/agents.` : '';
    await this.#stream(`Hey! 👋${as} You said: **${text.slice(0, 80)}**. Let me peek at your project first.`);
    if (this.cancelled) return;
    const toolId = crypto.randomUUID();
    if (!(await this.#ask(toolId, { kind: 'command', command: 'ls -la', description: 'List project files' }))) return;
    this.emit({
      type: 'tool-result',
      toolId,
      isError: false,
      declined: false,
      output: 'README.md\npackage.json\nsrc/',
    });
    await this.#stream(
      'Here’s what I found:\n\n- `README.md`\n- `package.json`\n- `src/`\n\n' +
        `This is **demo mode**, so I’m not really connected. Run \`npm start\` to talk to the real ${this.descriptor.name}. :)`
    );
  }

  /** "fix": a one-line edit it asks about, with the change to read first, and then the tests. */
  async #fixScenario() {
    await this.#stream('On it. An item without a `count` breaks the total: that is one line to change.');
    if (this.cancelled) return;
    const editId = crypto.randomUUID();
    const edit = {
      kind: 'edit',
      path: `${this.contact.cwd}/src/cart.js`,
      description: 'Count an item without a count once',
      changes: [FIX],
    };
    if (!(await this.#ask(editId, edit))) return;
    this.emit({ type: 'tool-result', toolId: editId, isError: false, declined: false, output: '' });
    const testId = crypto.randomUUID();
    // Running the tests changes nothing, so there is nothing more to ask.
    const tests = { kind: 'command', command: 'npm test', description: 'Run the tests' };
    this.emit({ type: 'tool', toolId: testId, activity: tests, sub: false });
    await this.sleep(500);
    if (this.cancelled) return;
    this.emit({ type: 'tool-result', toolId: testId, isError: false, declined: false, output: TEST_RUN });
    await this.#stream(
      'Fixed: an item without a `count` now counts once, and the tests pass. (Y)\n\n' +
        `This is **demo mode**, so no file was really changed. Run \`npm start\` to let the real ${this.descriptor.name} at it. :)`
    );
  }

  /** "diagram": a reply with a diagram in it, written in Mermaid, as an agent draws one. */
  async #diagramScenario() {
    await this.#stream(
      'Here is how the cart adds up its total:\n\n' +
        `${CART_DIAGRAM}\n\n` +
        `Click the diagram to look at it closely. This is **demo mode**, so I drew it from a script. Run \`npm start\` to have the real ${this.descriptor.name} draw yours. :)`
    );
  }

  /**
   * "to-do" or "task list": a job of a few steps, worked through with a to-do list. The whole list is
   * told each time an item starts or is done, as an agent that keeps one tells it.
   */
  async #todoScenario() {
    await this.#stream('That is a few steps, so I’ll keep a to-do list as I go.');
    if (this.cancelled) return;
    const todos = TODO_JOB.map(({ text, activeForm }) => ({ text, activeForm, status: 'pending' }));
    const tell = () =>
      this.emit({
        type: 'tool',
        toolId: crypto.randomUUID(),
        activity: { kind: 'todo', todos: todos.map((todo) => ({ ...todo })) },
        sub: false,
      });
    tell();
    for (const [i, { call, output }] of TODO_JOB.entries()) {
      await this.sleep(900);
      if (this.cancelled) return;
      todos[i].status = 'in_progress';
      tell();
      const toolId = crypto.randomUUID();
      const activity = call.path ? { ...call, path: `${this.contact.cwd}/${call.path}` } : call;
      // A change is written out before it is made, as a real agent's is, and the window says so meanwhile.
      if (activity.kind === 'edit') {
        this.emit({ type: 'drafting', toolId, activity: { kind: 'edit', path: activity.path } });
        await this.sleep(1600);
        if (this.cancelled) return;
      }
      this.emit({ type: 'tool', toolId, activity, sub: false });
      await this.sleep(2400);
      // Stopped in the middle of an item, it stays in progress: that is where the list was left.
      if (this.cancelled) return;
      this.emit({ type: 'tool-result', toolId, isError: false, declined: false, output });
      todos[i].status = 'completed';
    }
    tell();
    await this.#stream(
      'All three done: an item without a `count` now counts once, and the tests pass. (Y)\n\n' +
        `This is **demo mode**, so no file was really changed. Run \`npm start\` to let the real ${this.descriptor.name} at it. :)`
    );
  }

  /**
   * "terminal": asks the app for terminals beside the conversation, as many as were asked for, with
   * the names they were given. One that is to run something is asked about first, with the command to read.
   * @param {import('../../main/app-tools.js').AppTool} tool
   * @param {string} text
   */
  async #terminalsScenario(tool, text) {
    const input = terminalsAsked(text);
    const activity = appActivity(tool.name, input);
    const toolId = crypto.randomUUID();
    if (!tool.ask(input)) this.emit({ type: 'tool', toolId, activity, sub: false });
    else if (!(await this.#ask(toolId, activity, false))) return;
    let output;
    let isError = false;
    try {
      output = await tool.run(input, this.appToolContext());
    } catch (err) {
      // Why not, in a sentence to pass on: the conversation's window is closed, say.
      output = err.message;
      isError = true;
    }
    this.emit({ type: 'tool-result', toolId, isError, declined: false, output });
    if (isError) return void (await this.#stream(output));
    const yours = activity.count === 1 ? 'It is your own shell' : 'They are your own shells';
    await this.#stream(`${output} ${yours}: I am not told what happens there. (Y)`);
  }

  /**
   * "new conversation": the side task goes to a conversation of its own, as the user asked. It starts
   * at once, under this one in the contact list, and this one hears from it each time it finishes a turn.
   * @param {import('../../main/app-tools.js').AppTool} tool
   */
  async #conversationScenario(tool, text) {
    // Codex works on it too, where the user asked for it.
    const withCodex = /\bcodex\b/i.test(text);
    await this.#stream(
      'The cart total can be put right on its own while we go on here, so I am starting a conversation for it' +
        (withCodex ? ', with Codex in it.' : '.')
    );
    if (this.cancelled) return;
    const input = { prompt: SIDE_TASK, asked_by_user: true, ...(withCodex && { invite: ['codex'] }) };
    const toolId = crypto.randomUUID();
    this.emit({ type: 'tool', toolId, activity: appActivity(tool.name, input), sub: false });
    let output;
    let isError = false;
    try {
      output = await tool.run(input, this.appToolContext());
    } catch (err) {
      output = err.message;
      isError = true;
    }
    this.emit({ type: 'tool-result', toolId, isError, declined: false, output });
    await this.#stream(
      isError
        ? output
        : 'It is under this one in your contact list, and I hear from it each time it finishes a turn. (Y)'
    );
  }

  /**
   * "instructions": reads what every conversation of the project is told, and saves them again with the scope
   * in them. The user reads that as a change, and saves it, edits it first, or doesn't.
   */
  async #instructionsScenario() {
    await this.#stream('Sure. I will read what every conversation of this project is told first.');
    if (this.cancelled) return;
    const read = await this.#useAppTool(APP_TOOLS.instructions, {});
    if (!read || read.isError) return void (await this.#stream(read?.output ?? 'I can’t reach them from here.'));
    // "The Every conversation instructions of shop:", then them. A project with none says so in a line.
    const now = read.output.includes('\n\n') ? read.output.slice(read.output.indexOf('\n\n') + 2) : '';
    await this.#stream('Here is the scope, for you to read. Nothing is saved until you say so.');
    if (this.cancelled) return;
    const saved = await this.#useAppTool(APP_TOOLS.instructions, { text: withScope(now) });
    if (this.cancelled || !saved) return;
    if (saved.isError) return void (await this.#stream('Okay, I left them as they were.'));
    if (saved.output.endsWith('Nothing was changed.')) return void (await this.#stream('They say that already.'));
    await this.#stream(
      saved.output.includes('with the user’s edits')
        ? 'Saved, with your edits. New conversations in this project start with them. (Y)'
        : 'Saved. New conversations in this project start with them. (Y)'
    );
  }

  /**
   * One of the app's tools, called as an agent calls it: the line for it, asked about first where the tool says
   * so, and what it answered. Null when this session doesn't have it.
   * @param {string} name
   * @param {Record<string, unknown>} input
   */
  async #useAppTool(name, input) {
    const tool = this.tools.find((one) => one.name === name);
    if (!tool) return null;
    const toolId = crypto.randomUUID();
    const activity = appActivity(name, input);
    if (!tool.ask(input)) this.emit({ type: 'tool', toolId, activity, sub: false });
    else if (!(await this.#ask(toolId, activity, false))) return { output: 'Declined.', isError: true, declined: true };
    let output;
    let isError = false;
    try {
      output = await tool.run(input, this.appToolContext());
    } catch (err) {
      output = err.message;
      isError = true;
    }
    this.emit({ type: 'tool-result', toolId, isError, declined: false, output });
    return { output, isError };
  }

  /**
   * A note to a project's manager, or from one. Turned on, it writes the brief, unless it was added with a copy of
   * another's: then it looks at its conversations. When a conversation it oversees
   * changed files, it looks at them and asks for the test the ticket wants. One that is asked says it is on it.
   * With its window full, it writes in the brief where it stands, and the fresh session looks at everyone.
   * @param {NonNullable<ReturnType<typeof managerNoteOf>> & { text: string }} note
   */
  async #managerScenario({ kind, name, text }) {
    // A project manager hears from its managers alone.
    if (this.tools.some((tool) => tool.name === APP_TOOLS.tellManager))
      return void (await this.#leadScenario(kind, name, text));
    if (kind === 'lead') return void (await this.#fromLead(name, text));
    if (kind === 'message') {
      return void (await this.#stream(`On it: I am adding the test **${name}** asked for. (Y)`));
    }
    if (kind === 'answered') {
      return void (await this.#stream(`@${name} is adding the test. I will look again once it changed files.`));
    }
    if (kind === 'settings') return void (await this.#stream('Noted: I go by the new settings from here on.'));
    // Tagged in a worker's conversation: it answers there, and its answer starts nothing.
    if (kind === 'tagged') {
      return void (await this.#stream(
        `${name} is on track: it does what its task asks. Add a test for it before the pull request, and tell me ` +
          'if it should change course: I can message it.'
      ));
    }
    if (kind === 'handover') {
      const saved = await this.#useAppTool(APP_TOOLS.brief, { text: `${BRIEF}\n${HANDED_OVER}` });
      return void (await this.#stream(
        saved && !saved.isError
          ? 'Handed over: the brief has where everything stands, for the next session. (Y)'
          : (saved?.output ?? 'I have no brief to keep here.')
      ));
    }
    if (kind === 'takeover') {
      await this.#stream('I have read the brief the last session left me. Now, where is everyone?');
      if (this.cancelled) return;
      await this.#useAppTool(APP_TOOLS.look, {});
      return void (await this.#stream('Picked up where the last session left off. (Y)'));
    }
    // Added with a copy of another manager's brief: it keeps that, and looks at whose conversations are its own.
    if (kind === 'start' && name) {
      await this.#stream(`I start from the brief ${name} kept. First, which conversations are mine?`);
      if (this.cancelled) return;
      await this.#useAppTool(APP_TOOLS.look, {});
      return void (await this.#stream(
        `What the brief says of who is on what is ${name}’s: I bring it up to date as mine get going. (Y)`
      ));
    }
    if (kind === 'start') {
      await this.#stream('I am reading the sources, and writing down what the project is building.');
      if (this.cancelled) return;
      const saved = await this.#useAppTool(APP_TOOLS.brief, { text: BRIEF });
      return void (await this.#stream(
        saved && !saved.isError
          ? 'The brief is written. You can read it in Settings, on the project’s Manager page. (Y)'
          : (saved?.output ?? 'I have no brief to keep here.')
      ));
    }
    await this.#useAppTool(APP_TOOLS.look, { name });
    if (this.cancelled) return;
    const sent = await this.#useAppTool(APP_TOOLS.message, { to: name, text: MANAGER_ASKS });
    // Declined: the turn ended there, or it asked what to do instead.
    if (sent?.declined) return;
    await this.#stream(
      sent && !sent.isError
        ? `@${name} follows the design, but the ticket wants a test it doesn’t have yet. I asked for it.`
        : (sent?.output ?? `@${name} changed files, and they look right.`)
    );
  }

  /**
   * A project's manager asked after a conversation it oversees, tagged as "@Claude (cart)", or after everyone. It
   * looks at them all, then at the one tagged, and names each conversation as a tag, for the window to show as one.
   * @param {string} text
   */
  async #teamScenario(text) {
    const listed = await this.#useAppTool(APP_TOOLS.look, {});
    if (this.cancelled || !listed) return;
    const names = listed.isError
      ? []
      : listed.output
          .split('\n\n')
          .map((block) => LISTED.exec(block.split('\n')[0])?.[1])
          .filter(Boolean);
    // None yet: what it was told says so.
    if (!names.length) return void (await this.#stream(listed.output));
    const people = names.map((name) => ({ id: name, name }));
    const [tagged] = mentions(text, people);
    if (!tagged) {
      const all = names.map((name) => `@${name}`).join(', ');
      return void (await this.#stream(`I oversee ${all}. Tag one with @, and I will look at what it changed.`));
    }
    await this.#useAppTool(APP_TOOLS.look, { name: tagged });
    if (this.cancelled) return;
    await this.#stream(TAGGED_SAYS(tagged));
  }

  /** A link shared with a project's manager: it is one of the project's sources from now on, named after its site. */
  async #sourceScenario(text) {
    const url = text.match(LINK)[0].replace(/[.,;:!?]+$/, '');
    const name = URL.canParse(url) ? new URL(url).hostname.replace(/^www\./, '') : 'Link';
    const saved = await this.#useAppTool(APP_TOOLS.sources, { add: [{ name, url }] });
    await this.#stream(
      saved && !saved.isError
        ? `I added it to the sources, and I will read it into the brief. (Y)`
        : (saved?.output ?? 'I keep no sources here.')
    );
  }

  /**
   * A note to a project manager: turned on, it looks at the teams; a manager's answer, it takes in; a manager's
   * report of a review, it passes on to the manager of the worker it is about, with that worker's job.
   * @param {string} kind
   * @param {string} name  the manager it is from
   * @param {string} text
   */
  async #leadScenario(kind, name, text) {
    if (kind === 'lead-start' || kind === 'takeover') return void (await this.#teamsScenario());
    if (kind === 'answered') return void (await this.#stream(`@${name} is on it.`));
    if (kind === 'cut') return void (await this.#stream(`@${name} stopped before it answered: it waits for you.`));
    const verdict = kind === 'report' && VERDICT.exec(text);
    if (!verdict) return void (await this.#stream('Noted.'));
    const [, job, said] = verdict;
    const looked = await this.#useAppTool(APP_TOOLS.teams, { conversation: job });
    if (this.cancelled || !looked) return;
    const owner = /^The job: .+?, under (.+)$/m.exec(looked.output)?.[1];
    if (!owner || owner === 'no manager') {
      return void (await this.#stream(
        `@${name} found that ${job} needs changes, and no manager oversees it: over to you.`
      ));
    }
    const sent = await this.#useAppTool(APP_TOOLS.tellManager, { to: owner, text: said, job });
    if (this.cancelled || !sent) return;
    await this.#stream(
      sent.isError
        ? sent.output
        : `@${name} found that @${job} needs changes. I passed the verdict to @${owner}, which tells it. (Y)`
    );
  }

  /** A project manager looks at its teams, and says who is on what. */
  async #teamsScenario() {
    const looked = await this.#useAppTool(APP_TOOLS.teams, {});
    if (this.cancelled || !looked) return;
    if (looked.isError) return void (await this.#stream(looked.output));
    const { managers } = teamsOf(looked.output);
    await this.#stream(
      managers.length
        ? `I oversee ${managers.map((one) => `@${one}`).join(' and ')}. Tell me whose job goes where, and I hand it on.`
        : 'There is no manager at work under me yet.'
    );
  }

  /**
   * "send @Claude (cart)'s job to @review manager": a project manager looks at the teams, and hands the job of the
   * conversation named on to the manager named, after asking.
   * @param {string} text
   */
  async #handOffScenario(text) {
    const looked = await this.#useAppTool(APP_TOOLS.teams, {});
    if (this.cancelled || !looked) return;
    if (looked.isError) return void (await this.#stream(looked.output));
    const { managers, workers } = teamsOf(looked.output);
    // Tagged with @, or named as they are.
    const named = (names) => [
      ...mentions(
        text,
        names.map((one) => ({ id: one, name: one }))
      ),
      ...names.filter((one) => text.toLowerCase().includes(one.toLowerCase())),
    ];
    const [job] = named(workers);
    const [to] = named(managers);
    if (!job || !to) return void (await this.#stream('Whose job, and to which manager? Tag both with @.'));
    const sent = await this.#useAppTool(APP_TOOLS.tellManager, { to, text: HAND_OFF, job });
    if (this.cancelled || !sent) return;
    await this.#stream(
      sent.isError ? sent.output : `Handed @${job}’s job to @${to}. I pass its verdict on once it is in.`
    );
  }

  /**
   * A message from the project manager to a manager: a job of another team's, which it starts a reviewer for, or a
   * verdict on its own worker's job, which it passes on to that worker. Anything else, it takes in.
   * @param {string} lead  the project manager
   * @param {string} text
   */
  async #fromLead(lead, text) {
    const job = /^The job: (.+?), under /m.exec(text)?.[1];
    if (job) {
      const conversation = this.tools.find((tool) => tool.name === APP_TOOLS.conversation);
      if (!conversation) return;
      // Started at once where the user approved the message, and else waiting for them.
      const asked = text.includes('The user approved this message');
      const started = await this.#useAppTool(APP_TOOLS.conversation, {
        prompt: REVIEW_PROMPT(job),
        asked_by_user: asked,
      });
      if (this.cancelled || !started) return;
      return void (await this.#stream(
        started.isError
          ? started.output
          : `I started a reviewer for @${job}’s job. ${lead} gets the verdict once it is in.`
      ));
    }
    const yours = /^It is about your worker (.+)\.$/m.exec(text)?.[1];
    if (!yours) return void (await this.#stream('Noted.'));
    const said = text.split('\n')[1] ?? '';
    const sent = await this.#useAppTool(APP_TOOLS.message, { to: yours, text: said });
    if (this.cancelled || !sent || sent.declined) return;
    await this.#stream(sent.isError ? sent.output : `I told @${yours} what the review found.`);
  }

  /** A conversation started to review another's job: its verdict. @param {string} text */
  async #reviewJobScenario(text) {
    const job = text.slice(REVIEW.length).replace(/ against its ticket.*$/s, '');
    await this.#stream(REVIEWED(job));
  }

  /** A note from a conversation it started: what came of it, passed on to the user. */
  async #heardBack(text) {
    const said = text.split('\n')[1]?.trim() ?? '';
    // A manager's reviewer, done: the verdict goes up to the project manager that handed the job on.
    if (VERDICT.test(said) && this.tools.some((tool) => tool.name === APP_TOOLS.report)) {
      const sent = await this.#useAppTool(APP_TOOLS.report, { text: said });
      if (this.cancelled || !sent) return;
      return void (await this.#stream(sent.isError ? sent.output : 'The review is in: I sent the verdict up. (Y)'));
    }
    await this.#stream(
      `**${reportedBy(text)}** is done${said ? `: “${said.length > 120 ? `${said.slice(0, 120)}…` : said}”` : '.'}\n\n` +
        'Have a look in its conversation when you like: it is under this one in your contact list.'
    );
  }

  /** "check back": sets itself a check-in instead of waiting, and answers it when it is due. */
  async #checkInScenario() {
    await this.#stream('CI takes a while, so I am setting myself a check-in rather than sitting here waiting.');
    if (this.cancelled) return;
    const toolId = crypto.randomUUID();
    const { schedule, recurring, prompt } = CHECK_IN;
    this.emit({
      type: 'tool',
      toolId,
      activity: { kind: 'schedule', action: 'set', schedule, recurring, prompt },
      sub: false,
    });
    this.emit({
      type: 'tool-result',
      toolId,
      isError: false,
      declined: false,
      output: `Scheduled task ${CHECK_IN.id}.`,
    });
    await this.#stream('I will check back within a minute and tell you how it went. Go and do something else. :)');
    // Listed once the turn is over, as Claude Code lists them.
    this.#checkIns.add(CHECK_IN.id);
    this.emit({ type: 'check-ins', checkIns: [CHECK_IN] });
    this.sleep(CHECK_IN_DUE_MS).then(() => {
      // It went with the session. A nudge leaves it, as it leaves a real one.
      if (!this.#checkIns.delete(CHECK_IN.id)) return;
      this.emit({ type: 'check-ins', checkIns: [] });
      this.#queue.push({ text: CHECK_IN.prompt, due: true });
      this.#answer();
    });
  }

  /** The check-in it set is due: it looks at CI, and says how it is doing. */
  async #checkedBack() {
    const toolId = crypto.randomUUID();
    // Looking changes nothing, so there is nothing to ask.
    const checks = { kind: 'command', command: 'gh pr checks', description: 'See how CI is doing' };
    this.emit({ type: 'tool', toolId, activity: checks, sub: false });
    await this.sleep(400);
    if (this.cancelled) return;
    this.emit({ type: 'tool-result', toolId, isError: false, declined: false, output: CI_CHECKS });
    await this.#stream(
      'Checked back: CI is green, all three checks pass. (Y)\n\n' +
        `This is **demo mode**, so the check-in was scripted. Run \`npm start\` for the real ${this.descriptor.name}'s. :)`
    );
  }

  /**
   * "background": starts a dev server and a watcher on CI, both in the background, and carries on.
   * The watcher ends by itself once CI is done. The dev server runs until it is stopped.
   */
  async #backgroundScenario() {
    await this.#stream(
      'I will start the dev server and keep an eye on CI, both in the background, so we can carry on.'
    );
    if (this.cancelled) return;
    for (const { kind, command, label, lines, endsAfterMs, summary } of BACKGROUND_JOBS) {
      const toolId = crypto.randomUUID();
      const id = `demo-${toolId.slice(0, 8)}`;
      this.emit({
        type: 'tool',
        toolId,
        activity: { kind: 'command', command, description: label, background: true },
        sub: false,
      });
      this.#background.set(id, {
        task: { id, kind, label, command, toolId, status: 'running', started: Date.now(), ended: null },
        lines,
      });
      this.emit({
        type: 'tool-result',
        toolId,
        isError: false,
        declined: false,
        output: `Running in the background with ID: ${id}.`,
      });
      this.#tellBackground();
      if (endsAfterMs) this.sleep(endsAfterMs).then(() => this.#endBackground(id, 'done', summary));
    }
    await this.#stream(
      'Both are running. The **Background** tab shows what each prints, and stops either.\n\n' +
        `This is **demo mode**, so they were scripted. Run \`npm start\` for the real ${this.descriptor.name}'s. :)`
    );
  }

  /** What it left running in the background changed: all of it is said again. */
  #tellBackground() {
    this.emit({ type: 'background', tasks: [...this.#background.values()].map(({ task }) => ({ ...task })) });
  }

  /**
   * One of them ended, unless it had already.
   * @param {string} id
   * @param {import('../contract.js').BackgroundTask['status']} status
   * @param {string} [summary]
   */
  #endBackground(id, status, summary) {
    const job = this.#background.get(id);
    if (job?.task.status !== 'running') return;
    Object.assign(job.task, { status, ended: Date.now(), ...(summary && { summary }) });
    this.#tellBackground();
  }

  /** "helpers": hands the job to two helpers at once, each with steps of its own, and sums up what they report. */
  async #helpersScenario() {
    await this.#stream('That is two things to look at, so I am asking two subagents. Each works on its own.');
    if (this.cancelled) return;
    const done = await Promise.all(HELPER_JOBS.map((job, i) => this.#helper(job, i)));
    if (this.cancelled) return;
    const back = done.filter(Boolean).length;
    await this.#stream(
      back === done.length
        ? 'Both are back: the tests pass, and the total counts every item. (Y)\n\n' +
            `This is **demo mode**, so the subagents were scripted. Run \`npm start\` for the real ${this.descriptor.name}'s. :)`
        : `You stopped ${back ? 'one of them' : 'them'}, so I only know part of it. Ask again whenever you like.`
    );
  }

  /**
   * One helper at work: the call that asks for it, its steps one after the other, and the
   * call's result when it ends, which is its report. The later of them takes its time, so
   * that they are seen working side by side.
   * @param {typeof HELPER_JOBS[number]} job
   * @param {number} nth
   * @returns {Promise<boolean>} whether it got to the end
   */
  async #helper({ steps, report, ...asked }, nth) {
    const toolId = crypto.randomUUID();
    const started = Date.now();
    const stopped = () => this.cancelled || this.#helpers.get(toolId);
    this.#helpers.set(toolId, false);
    this.emit({ type: 'tool', toolId, activity: { kind: 'delegate', ...asked }, sub: false });
    for (const [activity, output] of steps) {
      await this.sleep(1400 + nth * 600);
      if (stopped()) break;
      const stepId = crypto.randomUUID();
      const at = activity.path ? { ...activity, path: `${this.contact.cwd}/${activity.path}` } : activity;
      this.emit({ type: 'tool', toolId: stepId, activity: at, sub: true, helper: toolId });
      await this.sleep(2200 + nth * 900);
      // Stopped in the middle of a step, it never hears how that step went.
      if (stopped()) break;
      this.emit({ type: 'tool-result', toolId: stepId, isError: false, declined: false, output });
    }
    const cut = Boolean(stopped());
    this.#helpers.delete(toolId);
    this.emit({
      type: 'tool-result',
      toolId,
      isError: false,
      declined: false,
      output: cut ? '' : report,
      ...(cut && { stopped: true }),
      durationMs: Date.now() - started,
    });
    return !cut;
  }

  /** A slash command picked from Activities or typed: the two every provider is known for, then any other. */
  async #slashScenario(command) {
    const { name } = this.descriptor;
    if (command === 'compact') {
      // The line the provider's own session writes when it has compacted.
      this.emit({ type: 'notice', text: `${name} tidied up the conversation (compacted earlier messages).` });
      this.#messages = COMPACTED_TOKENS;
    } else if (command === 'review') {
      await this.#reviewScenario();
    } else {
      await this.#stream(
        `\`/${command}\` is one of ${name}’s own commands. This is **demo mode**, so there is nothing behind it here. ` +
          `Run \`npm start\` to use it with the real ${name}. :)`
      );
    }
  }

  async #reviewScenario() {
    const toolId = crypto.randomUUID();
    // Reading the changes alters nothing, so there is nothing to ask first.
    const activity = { kind: 'command', command: 'git diff', description: 'Look at the uncommitted changes' };
    this.emit({ type: 'tool', toolId, activity, sub: false });
    await this.sleep(500);
    if (this.cancelled) return;
    this.emit({ type: 'tool-result', toolId, isError: false, declined: false, output: REVIEW_DIFF });
    await this.#stream(
      'I looked at your uncommitted changes:\n\n' +
        '- `src/cart.js`: the total now counts how many of each item there are. (Y)\n' +
        '- An item without a `count` makes the total `NaN`. Fall back to 1.\n\n' +
        `This is **demo mode**, so the review is scripted. Run \`npm start\` for a real one from ${this.descriptor.name}. :)`
    );
  }

  async #planScenario() {
    await this.#stream('Let me think this through before touching anything.');
    if (this.cancelled) return;
    const plan =
      '## Add a dark theme\n\n1. Add color tokens for dark mode\n2. Switch them with `prefers-color-scheme`\n3. Check contrast on every screen';
    const response = await this.requestPermission({ kind: 'plan', activity: { kind: 'plan' }, plan });
    if (response.decision === 'approve-plan') {
      this.contact.permissionMode = response.mode;
      this.emit({ type: 'mode', mode: response.mode });
      await this.#stream('Great, starting on step 1. (Demo mode: nothing is actually changed.)');
    } else if (response.decision === 'feedback') {
      await this.#stream(`Got it, I’ll rework the plan: “${response.message}”`);
    }
  }

  async #questionScenario() {
    const questions = [
      {
        question: 'Which test runner should I use?',
        header: 'Tests',
        options: [
          { label: 'node:test', description: 'Built in, no dependencies' },
          { label: 'Vitest', description: 'Fast, Jest-compatible' },
        ],
        multiSelect: false,
      },
      {
        question: 'What should the tests cover?',
        header: 'Coverage',
        options: [
          { label: 'The happy path', description: 'What it does when all goes well' },
          { label: 'Edge cases', description: 'Empty input, long input, the odd one out' },
          { label: 'Errors', description: 'What it says when something goes wrong' },
        ],
        multiSelect: true,
      },
    ];
    const response = await this.requestPermission({ kind: 'question', activity: { kind: 'question' }, questions });
    if (response.decision === 'answer') {
      await this.#stream(`You picked **${Object.values(response.answers || {}).join(', ')}**. Nice choice (Y)`);
    } else if (response.decision === 'skip') {
      // Skipped, it goes on with its own picks, and says what they are.
      await this.#stream(
        'No preference? I’ll go with **node:test**, and cover **the happy path and edge cases**. Say if you’d like otherwise.'
      );
    }
  }

  async interrupt() {
    if (!this.isBusy) return;
    // A nudge stops the running turn and the messages still waiting for theirs.
    this.#queue.length = 0;
    this.setWaiting(0);
    this.cancelled = true;
    this.cancelPrompts();
    this.setState('idle');
  }

  // The turn ends at its next step, and the messages waiting stay in line for theirs.
  get queuedIds() {
    return this.#queue.filter((message) => !message.due).map((message) => message.id);
  }

  async sendNow(id) {
    if (this.cancelled || !selectQueued(this.#queue, id)) return;
    if (!this.#answering) return this.#answer();
    this.cancelled = true;
    this.cancelPrompts();
  }

  /** A message that waits in line is taken out of it, and never answered. One whose turn has come stays. */
  async cancel(id) {
    const at = this.#queue.findIndex((message) => message.id === id);
    if (at === -1) return false;
    this.#queue.splice(at, 1);
    this.#tellWaiting();
    return true;
  }

  /**
   * A script remembers nothing to forget: going back to before a message only stops what it is doing,
   * as a real one stops when it goes back. The turn it stops has had its say once this is done.
   */
  async rewind() {
    if (!this.descriptor.rewind) throw new Error(`${this.descriptor.name} can’t go back to an earlier message.`);
    this.#queue.length = 0;
    this.setWaiting(0);
    this.cancelled = true;
    this.cancelPrompts();
    await this.#answering?.catch(() => {});
    this.setState('idle');
  }

  /** A script has nothing to copy: the fork is a session of its own, which goes on with the script. */
  async fork() {
    if (!this.descriptor.fork) throw new Error(`${this.descriptor.name} can’t fork a conversation.`);
    return crypto.randomUUID();
  }

  // It ends at its next step, as a real one ends where it is.
  async stopHelper(toolId) {
    if (this.#helpers.has(toolId)) this.#helpers.set(toolId, true);
  }

  async stopBackground(id) {
    this.#endBackground(id, 'stopped');
  }

  /**
   * As many of its lines as it has printed by now, or had by the time it was stopped. One that
   * finished by itself printed them all.
   * @param {string} id
   */
  async backgroundOutput(id) {
    const job = this.#background.get(id);
    if (!job) return null;
    const { started, ended, status } = job.task;
    const by = Math.min(job.lines.length, 1 + Math.floor(((ended ?? Date.now()) - started) / LINE_MS));
    const printed = status === 'done' ? job.lines.length : by;
    return { output: `${job.lines.slice(0, printed).join('\n')}\n`, truncated: false };
  }

  async setPermissionMode(mode) {
    this.contact.permissionMode = mode;
  }

  async setModel(model) {
    this.contact.model = model;
  }

  async setEffort(effort) {
    this.effort = effort;
  }

  async setOutputStyle(style) {
    this.contact.outputStyle = style;
  }

  /** Asking starts the session, as it does a real one. Nothing is sent to it. */
  async mcpServers() {
    this.start();
    return this.#mcp.map((server) => ({ ...server }));
  }

  /**
   * Everything works out here: the one that failed connects, and signing in needs no browser.
   * @param {string} name
   * @param {import('../../shared/mcp.js').McpAction} action
   */
  async mcpAct(name, action) {
    const server = this.#mcp.find((known) => known.name === name);
    if (!server) throw new Error(`Server not found: ${name}`);
    await this.sleep(400);
    server.status = action === 'disable' ? 'disabled' : 'connected';
    delete server.error;
    if (server.status === 'connected') server.tools ||= 12;
  }

  /**
   * Asking starts the session and sends it nothing, as asking about its MCP servers does. The limits are of the
   * login in use, as a real one's are, also in the middle of a turn in the one before.
   */
  async usage() {
    if (!this.descriptor.usage || this.contact.model === 'demo-unknown-usage') return null;
    this.#followAccount();
    this.start();
    await this.sleep(300);
    const login = this.accounts?.current() || null;
    const plan = this.#planOf(login);
    this.#tellContext();
    const limits = this.#tellLimits(login);
    const who = login && this.login(login.dir);
    return {
      context: this.#context(),
      plan: plan.plan,
      limits: ['demo-exhausted', 'demo-paid-usage'].includes(this.contact.model)
        ? limits.map((limit) => ({ ...limit, percent: 100 }))
        : limits,
      extra: { ...plan.extra },
      // Simulate charging only when explicitly requested; the demo never calls a paid service.
      ...(this.contact.model !== 'demo-paid-usage' && { paidUsageBlocked: true }),
      ...(who && { account: accountName({ ...who, plan: plan.plan }) }),
    };
  }

  close() {
    this.#queue.length = 0;
    this.setWaiting(0);
    this.cancelled = true;
    this.cancelPrompts();
    if (this.#checkIns.size) {
      this.#checkIns.clear();
      this.emit({ type: 'check-ins', checkIns: [] });
    }
    // What it left running goes with it, as it goes with a real one.
    const running = [...this.#background.values()].filter(({ task }) => task.status === 'running');
    for (const { task } of running) Object.assign(task, { status: 'stopped', ended: Date.now() });
    if (running.length) this.#tellBackground();
    this.setState('offline');
  }
}
