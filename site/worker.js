// The Cloudflare Worker behind the landing page. The page's files are served
// from dist/site/ after redirecting the old hostname; this also answers its feedback form.
//
//   POST /api/feedback  a form: kind, message, email, system, from and screenshot  ->  { ok: true }
//
// Feedback, bugs and requests are kept in the FEEDBACK namespace, from the page's form and
// from the app's Help menu alike. A report is `feedback:<when>-<id>`, and the picture that
// came with it `screenshot:<when>-<id>.<type>`. `npm run feedback` lists the reports.
//
// The Workers runtime treats every export of this file as a request handler, so
// the only export is the default one.
import { cleanFeedback, PROBLEMS, SCREENSHOT_MAX, SCREENSHOT_TYPES } from '../src/shared/feedback.js';

const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'strict-transport-security': 'max-age=2592000',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    },
  });
const refuse = (error, status) => json({ ok: false, error }, status);

// A report is its words and at most one picture.
const FEEDBACK_BODY_MAX = SCREENSHOT_MAX + 64 * 1024;
// How much of a message the list of reports shows. A key's metadata is at most 1024 bytes.
const SAYS_MAX = 80;

/** A report that broke a rule, with the sentence the page shows for it. */
const turnDown = (problem, status = 400) => json({ ok: false, error: problem, message: PROBLEMS[problem] }, status);

async function takeFeedback(request, env) {
  // The page posts from its own address and the app has none to give. No other page may post
  // through its visitors.
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== new URL(request.url).origin) return refuse('forbidden', 403);

  // Only a picture makes a report this large.
  if (Number(request.headers.get('content-length')) > FEEDBACK_BODY_MAX) return turnDown('screenshot-too-large', 413);

  let form;
  try {
    form = await request.formData();
  } catch {
    return refuse('invalid-form', 400);
  }

  // People never see the "website" field. Bots fill it in, and get a polite nothing.
  if (form.get('website')) return json({ ok: true });

  // The app says where a report comes from since 0.2.34. One from before has no page address and
  // the user agent of Node's own fetch, which neither a browser nor a bot posting the page sends.
  const fields = Object.fromEntries(form);
  if (!fields.from && origin === null && request.headers.get('user-agent') === 'node') fields.from = 'app';

  const { report, problem } = cleanFeedback(fields);
  if (problem) return turnDown(problem, problem === 'screenshot-too-large' ? 413 : 400);

  // Keys sort by when they were sent, so the list reads oldest first.
  const sentAt = new Date().toISOString();
  const id = `${sentAt}-${crypto.randomUUID().slice(0, 8)}`;
  const { screenshot, ...words } = report;
  const picture = screenshot && `screenshot:${id}.${SCREENSHOT_TYPES[screenshot.type]}`;
  if (picture) {
    await env.FEEDBACK.put(picture, await screenshot.arrayBuffer(), { metadata: { type: screenshot.type } });
  }
  await env.FEEDBACK.put(`feedback:${id}`, JSON.stringify({ ...words, sentAt, screenshot: picture }), {
    metadata: {
      kind: report.kind,
      from: report.from,
      says: report.message.slice(0, SAYS_MAX),
      screenshot: Boolean(picture),
    },
  });
  return json({ ok: true });
}

const FORMS = { '/api/feedback': takeFeedback };

/**
 * Whether this sender has posted this form too often in the last minute. FORM_LIMIT
 * (wrangler.jsonc) counts each form and each address apart, in each Cloudflare location.
 */
async function tooOften(request, env, form) {
  const sender = request.headers.get('cf-connecting-ip') ?? '';
  const { success } = await env.FORM_LIMIT.limit({ key: `${form}:${sender}` });
  return !success;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'agent-messenger.tsafaelmali-b18.workers.dev' || url.hostname === 'www.buddylist.dev') {
      url.protocol = 'https:';
      url.host = 'buddylist.dev';
      return Response.redirect(url.href, 308);
    }

    const answer = FORMS[url.pathname];
    if (!answer) return env.ASSETS.fetch(request);
    if (request.method !== 'POST') return refuse('method-not-allowed', 405);
    if (await tooOften(request, env, url.pathname)) return turnDown('too-many', 429);
    return answer(request, env);
  },
};
