// The conversations Claude Code keeps itself, under ~/.claude/projects: the ones held in a
// terminal, in the Claude desktop app or in an editor. They are read where they are, each
// time, and copied only to be continued in the app. Claude Code is the one that deletes them,
// a month on.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { forkSession, getSessionInfo, getSessionMessages, listSessions } from './sdk.js';
import { toEntries } from './transcript.js';

/** How many of a folder's conversations are listed: its newest. */
const LIMIT = 100;
/** How many are listed of every folder's at once: the newest. Claude Code keeps a month of them. */
const LIMIT_ALL = 500;
const SESSION_ID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

const oneLine = (text) =>
  String(text || '')
    .replace(/\s+/g, ' ')
    .trim();

/** Where Claude Code keeps them: a folder for each folder they were held in. */
const projects = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');

/**
 * Rejects, saying why, when they are there but can't be read, as when the folder they are kept in belongs to
 * another user: the SDK would list none, and the windows would say there are none. With no such folder,
 * Claude Code has kept none.
 */
async function readable() {
  try {
    await fs.promises.access(projects(), fs.constants.R_OK | fs.constants.X_OK);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * The same, for one of them the SDK says it has none of: rejects when its file is there but can't be read.
 * @param {string} id  a session id, nothing else
 */
async function readableFile(id) {
  await readable();
  const folders = await fs.promises.readdir(projects()).catch(() => []);
  for (const folder of folders) {
    try {
      await fs.promises.access(path.join(projects(), folder, `${id}.jsonl`), fs.constants.R_OK);
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
    }
  }
}

/**
 * One of them as the app lists it. Its title is the one it was given with `/rename`, or the summary
 * Claude Code wrote of it, when that says more than its first message. Its branch is the one it
 * ended on: none for a detached HEAD, or a folder with no repository.
 * @param {import('@anthropic-ai/claude-agent-sdk').SDKSessionInfo} session
 * @param {string} [cwd]  the folder it was listed for
 * @returns {import('../contract.js').HeldElsewhere}
 */
function held(session, cwd = '') {
  const preview = oneLine(session.firstPrompt || session.summary);
  const title = oneLine(session.customTitle || session.summary);
  const branch = session.gitBranch && session.gitBranch !== 'HEAD' ? session.gitBranch : '';
  return {
    id: session.sessionId,
    cwd: session.cwd || cwd,
    startedAt: session.createdAt ?? session.lastModified,
    endedAt: session.lastModified,
    preview,
    ...(title && title !== preview && { title }),
    ...(branch && { branch }),
  };
}

/** @type {import('../contract.js').Elsewhere} */
export const elsewhere = {
  name: 'Claude Code',

  /**
   * The ones held in `cwd`, or in another worktree of its repository: what `/resume` offers
   * there. The app's own are not among them: those are the SDK's ("programmatic"), and the
   * app keeps what was said in them itself. The copies `fork` made are, as Claude Code can't
   * tell them from the ones copied: the app knows them, and leaves them out.
   */
  async list(cwd) {
    await readable();
    const sessions = await listSessions({ dir: cwd, limit: LIMIT, includeProgrammatic: false });
    return sessions.map((session) => held(session, cwd));
  },

  /** The ones held in every folder, newest first: also those of folders no contact works in. */
  async listAll() {
    await readable();
    const sessions = await listSessions({ limit: LIMIT_ALL, includeProgrammatic: false });
    return sessions.filter((session) => session.cwd).map((session) => held(session));
  },

  async read(cwd, id) {
    // Asked for within the folder, so an id can never name a conversation held somewhere else.
    if (!SESSION_ID.test(id)) return null;
    const session = await getSessionInfo(id, { dir: cwd });
    if (!session) {
      await readableFile(id);
      return null;
    }
    const messages = await getSessionMessages(id, { dir: session.cwd || cwd });
    return { id, cwd: session.cwd || cwd, entries: toEntries(messages) };
  },

  /** Copies one with new ids throughout, the way `/branch` does: the one copied stays as it was. */
  async fork(cwd, id) {
    const session = SESSION_ID.test(id) ? await getSessionInfo(id, { dir: cwd }) : null;
    if (!session) throw new Error('Claude Code no longer has that conversation.');
    return (await forkSession(id, { dir: session.cwd || cwd })).sessionId;
  },
};
