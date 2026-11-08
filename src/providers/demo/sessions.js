// The conversations the demo's Claude Code had in a terminal before the app: a few in made-up project
// folders, listed and read as Claude Code's own are (see ../claude/sessions.js). Two of the folders are
// made, empty, for a contact to be added in; the third is gone, as a deleted project's is. Going on with
// one goes on with the scripted contact.
import fs from 'node:fs';
import path from 'node:path';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * One conversation, `ago` before now: what was asked, what was run and what was answered.
 * @param {object} held
 * @param {string} held.id
 * @param {string} held.cwd
 * @param {number} held.ago
 * @param {string} held.question
 * @param {string} held.answer
 * @param {string} [held.command]
 * @param {string} [held.title]
 * @param {string} [held.branch]
 */
function conversation({ id, cwd, ago, question, answer, command = 'npm test', title, branch }) {
  const start = Date.now() - ago;
  const time = (minute) => start + minute * 60 * 1000;
  return {
    id,
    cwd,
    startedAt: time(0),
    endedAt: time(3),
    preview: question,
    ...(title && { title }),
    ...(branch && { branch }),
    entries: [
      { id: `${id}:0`, time: time(0), kind: 'user', text: question, images: 0 },
      {
        id: `${id}:1`,
        time: time(1),
        kind: 'tool',
        toolId: `${id}-t`,
        activity: { kind: 'command', command },
        sub: false,
      },
      { id: `${id}:2`, time: time(3), kind: 'assistant', text: answer },
    ],
  };
}

/**
 * @param {string} root  where the made-up project folders go
 * @returns {import('../contract.js').Elsewhere}
 */
export function demoElsewhere(root, provider = 'claude') {
  const name = provider === 'codex' ? 'Codex' : 'Claude Code';
  const shop = path.join(root, 'shop');
  const blog = path.join(root, 'blog');
  for (const folder of [shop, blog]) fs.mkdirSync(folder, { recursive: true });
  const held =
    provider === 'codex'
      ? [
          conversation({
            id: '0199cc00-0000-7000-8000-000000000001',
            cwd: shop,
            ago: HOUR,
            title: 'Keyboard checkout',
            branch: 'feat/keyboard-checkout',
            question: 'Make the checkout work with just a keyboard',
            command: 'npm test -- keyboard',
            answer:
              'The checkout now follows a predictable tab order, with a visible focus ring. The keyboard tests pass.',
          }),
          conversation({
            id: '0199cc00-0000-7000-8000-000000000002',
            cwd: blog,
            ago: 3 * DAY,
            title: 'Search the posts',
            branch: 'feat/search',
            question: 'Add search to the blog',
            command: 'npm test -- search',
            answer: 'Search now matches post titles and summaries, including accented words.',
          }),
        ]
      : [
          conversation({
            id: '7f3c2a10-5b1e-4c8a-9d2f-1a6e0b4c8d01',
            cwd: shop,
            ago: 2 * HOUR,
            title: 'Stripe idempotency keys',
            branch: 'fix/double-charge',
            question:
              'Payments sometimes charge twice when the network flakes. Can you add idempotency keys to the Stripe calls?',
            command: 'npm test -- payments',
            answer:
              'Each charge now sends an `Idempotency-Key` made from the order id, so a retry is the same charge. Tests pass.',
          }),
          conversation({
            id: '2b9d4e61-0c7a-4f3b-8e15-6d2a9c0f7b02',
            cwd: shop,
            ago: DAY + 3 * HOUR,
            title: 'Checkout in German',
            branch: 'main',
            question: 'Translate the checkout into German',
            command: 'npx i18next-scanner',
            answer: 'Added `de.json` and wired `i18next` into the checkout.',
          }),
          conversation({
            id: 'c41e8b27-9a3d-4e6f-b0c5-8f1d2e7a6b03',
            cwd: shop,
            ago: 4 * DAY,
            branch: 'main',
            question: 'why is the cart test flaky?',
            command: 'npm test -- cart --repeat 20',
            answer: 'It depends on the order two promises settle in. I made it wait for both.',
          }),
          conversation({
            id: '5a0f9c38-2e4b-4d7a-a6c1-3b8e5d9f0c04',
            cwd: blog,
            ago: 2 * DAY,
            title: 'RSS feed',
            branch: 'feat/rss',
            question: 'Add an RSS feed for the posts',
            command: 'npm run build',
            answer: 'The feed is at `/rss.xml`, with the 20 newest posts.',
          }),
          conversation({
            id: 'e86b1d49-7f2c-4a9e-8d30-5c4a1b6e2f05',
            cwd: blog,
            ago: 6 * DAY,
            branch: 'main',
            question: 'Make the code blocks wrap on phones',
            command: 'npx playwright test mobile',
            answer: 'Code blocks scroll sideways on narrow screens now, instead of pushing the page wider.',
          }),
          conversation({
            id: '9d2a7e50-4c1f-4b8d-9e62-7a0c3f5b1d06',
            cwd: path.join(root, 'old-prototype'),
            ago: 12 * DAY,
            question: 'Sketch a landing page for the beta',
            command: 'npx serve .',
            answer: 'A one-page sketch is in `index.html`: a headline, three features and a sign-up form.',
          }),
        ];
  const summary = ({ entries: _entries, ...listed }) => listed;
  let copies = 0;
  return {
    name,
    list: async (cwd) => held.filter((c) => c.cwd === cwd).map(summary),
    listAll: async () => [...held].sort((a, b) => b.endedAt - a.endedAt).map(summary),
    read: async (cwd, id) => {
      const found = held.find((c) => c.id === id && c.cwd === cwd);
      return found ? { id, cwd: found.cwd, entries: found.entries } : null;
    },
    // The scripted contact has no session to resume: the copy is a name for one.
    fork: async (cwd, id) => {
      if (!held.some((c) => c.id === id && c.cwd === cwd)) throw new Error(`${name} no longer has that conversation.`);
      copies += 1;
      return `${id}-copy-${copies}`;
    },
  };
}
