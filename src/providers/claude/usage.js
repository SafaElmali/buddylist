// How full Claude Code's context window is, and how much of the plan's limits is used, in
// the app's words. What /context and /usage show in a terminal.
import os from 'node:os';
import { within } from '../within.js';
import { InputQueue } from './input-queue.js';
import { query } from './sdk.js';

// How long a Claude Code started only to say what a login's plan has used is waited for.
const PLAN_PATIENCE_MS = 20000;

// Claude Code's rows by what they are. Its free space is what the others leave, and the
// tools it only loads when asked for are not in the window.
const PART_KINDS = { used: 'used', buffer: 'reserved' };

/**
 * @param {import('@anthropic-ai/claude-agent-sdk').SDKControlGetContextUsageResponse} answer
 * @returns {import('../contract.js').ContextUsage}
 */
export function toContext({ totalTokens, rawMaxTokens, maxTokens, categories = [] }) {
  return {
    used: totalTokens,
    size: rawMaxTokens || maxTokens,
    parts: categories.flatMap(({ name, tokens, kind }) =>
      PART_KINDS[kind] && tokens > 0 ? [{ name, tokens, kind: PART_KINDS[kind] }] : []
    ),
  };
}

/**
 * How full the window is, from an answer that wasn't counted part by part: what the last
 * request to the model took, with its reply. Null when there was none to go by, as right
 * after the conversation was compacted: Claude Code's own estimate of the parts runs high.
 * @param {import('@anthropic-ai/claude-agent-sdk').SDKControlGetContextUsageResponse} answer
 * @returns {{ used: number, size: number } | null}
 */
export function toFill({ apiUsage: last, rawMaxTokens, maxTokens }) {
  if (!last) return null;
  const used = last.input_tokens + last.cache_creation_input_tokens + last.cache_read_input_tokens + last.output_tokens;
  return { used, size: rawMaxTokens || maxTokens };
}

/** @param {string | null | undefined} iso */
function toTime(iso) {
  const time = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(time) ? null : time;
}

/**
 * A time Claude Code says in seconds, as the API does, in milliseconds. Null where it doesn't say.
 * @param {number | null | undefined} at
 */
export const fromSeconds = (at) => (at ? (at < 1e12 ? at * 1000 : at) : null);

/**
 * The session's and the week's limits, from what Claude Code says of them with every request
 * (`rate_limit_info`): how much of each is used as a share of 1. The SDK doesn't promise to
 * say so: none where it doesn't.
 * @param {import('@anthropic-ai/claude-agent-sdk').SDKRateLimitInfo | undefined} info
 * @returns {import('../contract.js').UsageLimit[]}
 */
export function toWindows(info) {
  const windows = /** @type {any} */ (info)?.unifiedWindows;
  return [
    ['session', windows?.five_hour],
    ['weekly', windows?.seven_day],
  ].flatMap(([kind, window]) => {
    const utilization = window?.utilization;
    const percent = utilization * 100;
    // Keep provider precision (and over-limit readings). Rounding belongs in the display:
    // rounding here would turn a still-available 99.9% into an exhausted allowance.
    return Number.isFinite(utilization) && Number.isFinite(percent) && percent >= 0
      ? [{ kind, percent, resetsAt: fromSeconds(window.resetsAt) }]
      : [];
  });
}

/** One limit, from a window that says how much of it is used. */
function limit(kind, window, model, includeUnknown = false) {
  if (!window || (!includeUnknown && !Number.isFinite(window.utilization))) return [];
  return [
    {
      kind,
      ...(model && { model }),
      percent: Number.isFinite(window.utilization) ? window.utilization : null,
      resetsAt: toTime(window.resets_at),
    },
  ];
}

/**
 * The plan's limits: the session's, the week's, then the week's for single models. None
 * where the login has no plan (an API key, say).
 * @param {import('@anthropic-ai/claude-agent-sdk').SDKControlGetUsageResponse | null} answer
 * @returns {import('../contract.js').UsageLimit[]}
 */
export function toLimits(answer, { includeUnknown = false } = {}) {
  const read = (kind, window, model) => limit(kind, window, model, includeUnknown);
  const windows = answer?.rate_limits_available && answer.rate_limits;
  if (!windows) return [];
  // Claude Code leaves some models out of the ones it names. The plan's own list has them all.
  const listed = /** @type {any} */ (windows).limits;
  const rows = Array.isArray(listed) ? listed : [];
  const listedLimit = (kind, rowKind) =>
    rows
      .flatMap((row) =>
        row?.kind === rowKind ? read(kind, { utilization: row.percent, resets_at: row.resets_at }) : []
      )
      .slice(0, 1);
  const models = [
    ...read('model', windows.seven_day_opus, 'Opus'),
    ...read('model', windows.seven_day_sonnet, 'Sonnet'),
    ...(windows.model_scoped || []).flatMap((window) => read('model', window, window.display_name)),
    ...rows.flatMap((row) =>
      row?.kind === 'weekly_scoped'
        ? read('model', { utilization: row.percent, resets_at: row.resets_at }, row.scope?.model?.display_name)
        : []
    ),
  ];
  const session = read('session', windows.five_hour);
  const weekly = read('weekly', windows.seven_day);
  const named = new Set();
  return [
    ...(session.length ? session : listedLimit('session', 'session')),
    ...(weekly.length ? weekly : listedLimit('weekly', 'weekly_all')),
    // Once each, and only the ones that say whose they are.
    ...models
      .map((window) => (includeUnknown && !window.model ? { ...window, model: 'Unspecified model' } : window))
      .filter(({ model }) => model && !named.has(model) && named.add(model)),
  ];
}

/**
 * What the login spends once the plan's limits are reached: its extra usage, which /usage calls usage
 * credits. Claude Code says the amounts in cents, or in as many decimal places as it says. Null where it
 * says nothing of it, as for an API key.
 * @param {import('@anthropic-ai/claude-agent-sdk').SDKControlGetUsageResponse | null} answer
 * @returns {import('../contract.js').ExtraUsage | null}
 */
export function toExtra(answer) {
  const extra = /** @type {any} */ (answer?.rate_limits_available && answer.rate_limits?.extra_usage);
  if (typeof extra?.is_enabled !== 'boolean') return null;
  if (!extra.is_enabled) return { on: false, ...(extra.disabled_reason && { reason: extra.disabled_reason }) };
  const unit = 10 ** (extra.decimal_places ?? 2);
  const amount = (minor) => (typeof minor === 'number' ? minor / unit : null);
  const used = amount(extra.used_credits);
  const limit = amount(extra.monthly_limit);
  // As /usage works it out where Claude Code doesn't say.
  const percent = extra.utilization ?? (limit > 0 ? Math.min(100, ((used ?? 0) / limit) * 100) : 100);
  return { on: true, currency: extra.currency || 'USD', used, limit, ...(limit !== null && { percent }) };
}

/**
 * Whose login the limits are of: its email address and organization, where Claude Code says. One email can be
 * signed in to a personal plan and an organization's: the organization tells them apart. '' where it doesn't say,
 * as for an API key.
 * @param {any} q  the SDK's query
 * @returns {Promise<{ email: string, orgName: string }>}
 */
export async function accountOf(q) {
  try {
    const info = await q.accountInfo();
    return { email: info?.email || '', orgName: info?.organization || '' };
  } catch {
    return { email: '', orgName: '' };
  }
}

/**
 * Asks Claude Code what /usage shows. It answers, but the SDK doesn't promise to keep the
 * question: one that can't be asked it leaves the limits out.
 * @param {any} q  the SDK's query
 * @returns {Promise<import('@anthropic-ai/claude-agent-sdk').SDKControlGetUsageResponse | null>}
 */
export async function planUsage(q, { onError = () => {} } = {}) {
  try {
    // Without the look through this computer's transcripts that /usage also does: only the limits are shown.
    return await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
  } catch (error) {
    onError(error);
    return null;
  }
}

/**
 * What /usage says of a login's plan, and whose it is, from a Claude Code started in it only to be asked: it
 * reads no message and is closed again, as the models are listed. `plan` is null where it couldn't say.
 * Rejects when it takes too long.
 * @param {object} opts
 * @param {NodeJS.ProcessEnv} opts.env  what it is started with: the login's folder, where it is not the user's own
 * @param {string} [opts.cliPath]
 * @param {typeof query} [opts.queryFn]  the SDK's query(); replaceable in tests
 * @param {number} [opts.patienceMs]
 * @returns {Promise<{ plan: import('@anthropic-ai/claude-agent-sdk').SDKControlGetUsageResponse | null, account: { email: string, orgName: string }, error?: Error }>}
 */
export async function planOf({ env, cliPath, queryFn = query, patienceMs = PLAN_PATIENCE_MS }) {
  const input = new InputQueue();
  const options = { cwd: env.HOME || env.USERPROFILE || os.homedir(), env, persistSession: false };
  if (cliPath) options.pathToClaudeCodeExecutable = cliPath;
  const asked = queryFn({ prompt: input, options });
  try {
    let error;
    const [plan, account] = await within(
      Promise.all([
        planUsage(asked, {
          onError: (err) => {
            error = err;
          },
        }),
        accountOf(asked),
      ]),
      patienceMs,
      'Claude Code'
    );
    return { plan, account, ...(error && { error }) };
  } finally {
    input.close();
    asked.close();
  }
}
