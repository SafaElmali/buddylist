// What an agent is sent when its turn comes in a conversation with several
// agents: what was said and done since it last spoke and, when it needs
// telling, who is there. All of it as one text, so a provider needs to know
// nothing about any of this.
import { activityStatus } from '../shared/activity-text.js';
import { EFFORT_LEVELS } from '../shared/models.js';

/** @typedef {import('./storage/history.js').HistoryEntry} HistoryEntry */
/** @typedef {import('../shared/mentions.js').Person} Person */

/** How much a guest is told of what was said before it joined, in characters. The newest is kept. */
export const RECAP_MAX = 6000;

// What a session wrote into the history itself, rather than the user or the app.
export const FROM_A_SESSION = ['assistant', 'tool', 'permission', 'result', 'error'];

// A slash command was the host's alone, and is no part of what was said.
const fromUser = (entry) => entry.kind === 'user' && !entry.text.startsWith('/');
const isMessage = (entry) => fromUser(entry) || entry.kind === 'assistant';
// Something an agent did itself, and went through with.
const isAction = (entry) => entry.kind === 'tool' && !entry.sub && !entry.declined;
// What changes the files: a file written or edited.
const CHANGES = ['write', 'edit'];

const pictures = ({ images }) => (images ? ` (with ${images === 1 ? 'a picture' : `${images} pictures`})` : '');

/**
 * The entries as text: one block per message, and one per run of actions, a line each.
 * @param {HistoryEntry[]} entries
 * @param {(entry: HistoryEntry) => string} name  who an entry is from
 * @returns {string[]}
 */
function transcript(entries, name) {
  const blocks = [];
  let actions = null;
  for (const entry of entries) {
    if (entry.kind === 'tool') {
      if (!actions) blocks.push((actions = []));
      actions.push(`[${name(entry)}: ${activityStatus(entry.activity)}]`);
    } else {
      actions = null;
      blocks.push([`${name(entry)}: ${entry.text}${pictures(entry)}`]);
    }
  }
  return blocks.map((lines) => lines.join('\n'));
}

/** The newest messages that fit in RECAP_MAX, with a note when older ones were left out. */
function recap(blocks) {
  let first = blocks.length;
  let size = 0;
  while (first > 0 && size + blocks[first - 1].length <= RECAP_MAX) size += blocks[--first].length;
  if (first === 0) return blocks;
  // Not even the newest message fits whole: its beginning says who it is from and what it is about.
  const kept = first === blocks.length ? [`${blocks.at(-1).slice(0, RECAP_MAX)}…`] : blocks.slice(first);
  return ['(Earlier messages are left out.)', ...kept];
}

/** What an agent is sent after its effort check, when nothing was said in the meantime. */
export const GO_AHEAD = 'The effort levels are set. Go ahead and answer now.';

/**
 * What an effort check asks, after what is new: a level for everyone about to answer.
 * @param {{ name: string, levels: string[], effort: string | null }[]} agents  those in line that take
 *   effort levels: the ones each takes, lowest first, and the one it is on, when that is known
 * @param {boolean} [alone]  it is a contact on its own, picking its own level: it was never told of other agents
 */
export function effortCheck(agents, alone = false) {
  const names = agents.map(({ name }) => name);
  if (alone) {
    const [{ levels, effort }] = agents;
    return [
      '[Effort check]',
      'Do not start on this yet. First pick the effort level you will work on it at.',
      `The levels you take, from least to most effort: ${levels.join(', ')}${effort ? ` (now ${effort})` : ''}`,
      'Pick the lowest level that will do the job well. Reply with only this, a level in the brackets, and a few words on why:',
      `@${names[0]}(level)`,
    ].join('\n');
  }
  return [
    '[Effort check]',
    `Do not start on this yet. First pick an effort level for each agent about to answer (${names.join(', ')}): the level it works at when its turn comes.`,
    'The levels they take, from least to most effort:',
    ...agents.map(({ name, levels, effort }) => `- ${name}: ${levels.join(', ')}${effort ? ` (now ${effort})` : ''}`),
    'Give each the lowest level that will do its part well. Reply with only this, a level in each pair of brackets, and a few words on why:',
    names.map((name) => `@${name}(level)`).join(' '),
  ].join('\n');
}

/**
 * Who is here and how the conversation works, for an agent that hasn't been told, or not since that changed.
 * @param {{ to: Person, agents: (Person & { paused?: boolean })[], me: string, cwd: string, picking: boolean,
 *   atOnce: boolean }} about
 */
function introduction({ to, agents, me, cwd, picking, atOnce }) {
  const others = agents.filter((agent) => agent.id !== to.id).map((agent) => agent.name);
  const paused = agents.filter((agent) => agent.id !== to.id && agent.paused).map((agent) => agent.name);
  // A hand-over is shown with someone it would give a turn to, where there is one.
  const example = others.find((name) => !paused.includes(name)) ?? others[0];
  const lines = 'Each message below starts with the name of who said it.';
  if (!others.length) {
    return [
      '[Group conversation]',
      `The other agents have left: it is you, ${to.name}, and ${me} (the user) again.`,
      lines,
    ].join('\n');
  }
  return [
    '[Group conversation]',
    `You are ${to.name}. With you in this conversation: ${me}, who is the user, and ${others.join(', ')} (${others.length === 1 ? 'another AI agent' : 'other AI agents'}).`,
    `Everyone works in the same folder: ${cwd}`,
    // Work for another pull request is still done here: a checkout made elsewhere is one the Changes tab never shows.
    'Stay in it: the user sees only what changes there. Make no clone, worktree or other checkout of it, and ask nobody else to, also for work that goes in another branch or pull request: do all of it here, and split it into branches when it is committed.',
    // Answering all at once, nobody waits for the others: what they do reaches it later.
    ...(atOnce
      ? [
          'You all answer at the same time, so what the others say and do reaches you on your next turn. Keep to your own part, and leave alone the files another agent may be changing.',
        ]
      : []),
    `${lines} A line in [brackets] is something another agent did in the folder.`,
    'Answer as you normally would, without your own name in front.',
    `To hand over to another agent, mention it with @ and its name, like @${example}. It then gets a turn, so only mention it when it should act.`,
    // The user paused them: they only answer the user, so a hand-over to one goes nowhere.
    ...(paused.length
      ? [
          `${paused.join(', ')} ${paused.length === 1 ? 'is' : 'are'} paused by ${me}: mentioning ${paused.length === 1 ? 'it' : 'them'} gives no turn. Only ${me} can ask ${paused.length === 1 ? 'it' : 'them'} to answer.`,
        ]
      : []),
    // With the agents picking their effort: a hand-over can say how hard the next one should think.
    ...(picking
      ? [
          `You pick your effort levels among yourselves. A hand-over can give one, right behind the name, like @${example}(high): from least to most effort there are ${EFFORT_LEVELS.join(', ')}, and an agent that does not take a level gets the nearest one it does. Give the lowest level that will do that part well.`,
        ]
      : []),
    'Before you start, look at what the others already did, and do not do it again.',
  ].join('\n');
}

/** What each agent in one conversation has been told so far. */
export class Relay {
  /** agent id -> id of the newest history entry it has been told about */
  #told = new Map();
  /** agent id -> the entries after that one it has been told about all the same: they were moved (see `moving`) */
  #toldLater = new Map();
  /** The agents who know who else is here. */
  #introduced = new Set();

  /** Someone joined, left, changed name or was paused or resumed: everyone is told again who is here. */
  rosterChanged() {
    this.#introduced.clear();
  }

  /**
   * `id` knows everything in `entries`: what the host was sent directly, as it was
   * said, before anyone joined. But for the messages that still wait for a turn of their own:
   * it leaves off before the first of them, and knows what came after.
   * @param {string} id
   * @param {HistoryEntry[]} entries
   * @param {Set<string>} [waiting]  the ids of the messages that wait
   */
  caughtUp(id, entries, waiting = new Set()) {
    const first = entries.findIndex((entry) => waiting.has(entry.id));
    const known = first === -1 ? entries : entries.slice(0, first);
    const later = first === -1 ? [] : entries.slice(first).filter((entry) => !waiting.has(entry.id));
    if (known.length) this.#told.set(id, known.at(-1).id);
    if (later.length) this.#toldLater.set(id, new Set(later.map((entry) => entry.id)));
    else this.#toldLater.delete(id);
  }

  /** `id` left. Should it be invited again, it starts from where it joins. */
  forget(id) {
    this.#told.delete(id);
    this.#toldLater.delete(id);
    this.#introduced.delete(id);
  }

  /**
   * `ids` go to the end of the conversation, as messages that waited and are read only now (see
   * History.moveToEnd). An agent told them already is not told them again, and is still told
   * everything after where it left off.
   * @param {HistoryEntry[]} entries  the conversation as it is before they go
   * @param {string[]} ids
   */
  moving(entries, ids) {
    const moving = new Set(ids);
    for (const [id, told] of this.#told) {
      const known = entries.slice(0, entries.findIndex((entry) => entry.id === told) + 1);
      const stays = known.findLast((entry) => !moving.has(entry.id));
      // It left off at the last of what it knew that stays where it is.
      if (stays) this.#told.set(id, stays.id);
      const later = this.#toldLater.get(id) ?? new Set();
      for (const entry of known) if (moving.has(entry.id)) later.add(entry.id);
      if (later.size) this.#toldLater.set(id, later);
    }
  }

  /**
   * What `to` is sent on its turn.
   * @param {object} about
   * @param {HistoryEntry[]} about.entries  the conversation so far
   * @param {Person} about.to  whose turn it is
   * @param {(Person & { paused?: boolean })[]} about.agents  everyone answering in the conversation, the host first
   * @param {string} about.me  the user's name
   * @param {string} about.cwd  the folder they share
   * @param {boolean} [about.newcomer]  its session is new, so it is also told what was said before it joined
   * @param {boolean} [about.picking]  the agents pick their effort levels themselves, so it is told how
   * @param {boolean} [about.atOnce]  the agents answer all at once, so it is told the others are at work meanwhile
   * @param {boolean} [about.alone]  it is a contact on its own that was never told of anyone else here: it is
   *   sent what the user said since it last spoke, as they said it
   * @param {string[]} [about.waiting]  the user's messages that wait for a turn of their own, by id: not told yet
   * @returns {{ text: string, asked: string }}  `asked` is the user's newest message, on its own
   */
  compose({
    entries,
    to,
    agents,
    me,
    cwd,
    newcomer = false,
    picking = false,
    atOnce = false,
    alone = false,
    waiting = [],
  }) {
    const [host] = agents;
    const name = (entry) => (entry.kind === 'user' ? me : (entry.speakerName ?? host.name));
    const unread = new Set(waiting);
    const told = (entry) => !unread.has(entry.id);
    const { start, news: all } = this.#news(entries, to.id, host.id);
    const news = all.filter(told);
    const asked = entries.findLast((entry) => fromUser(entry) && told(entry))?.text ?? '';
    if (alone) {
      this.caughtUp(to.id, entries, unread);
      const said = news.filter(fromUser).map((entry) => entry.text);
      return { text: said.join('\n\n'), asked };
    }
    const earlier = entries.slice(0, start).filter((entry) => isMessage(entry) && told(entry));
    const before = newcomer ? recap(transcript(earlier, name)) : [];

    const parts = [];
    if (!this.#introduced.has(to.id)) parts.push(introduction({ to, agents, me, cwd, picking, atOnce }));
    if (before.length) parts.push('[Said before you joined]', ...before, '[Since then]');
    parts.push(...transcript(news, name));

    this.#introduced.add(to.id);
    this.caughtUp(to.id, entries, unread);
    return { text: parts.join('\n\n'), asked };
  }

  /**
   * Whether another agent said or did something since `id` was last told what went on, or last did something
   * itself: as an agent that took a conversation over from another one hasn't heard what that one did last.
   * @param {HistoryEntry[]} entries  the conversation so far
   * @param {string} id
   * @param {string} hostId
   */
  missedOthers(entries, id, hostId) {
    return this.#news(entries, id, hostId).news.some((entry) => entry.kind !== 'user');
  }

  /**
   * Whether another agent wrote or edited a file since `id` was last told what went on.
   * @param {HistoryEntry[]} entries  the conversation so far
   * @param {string} id
   * @param {string} hostId
   */
  changedFor(entries, id, hostId) {
    return this.#news(entries, id, hostId).news.some(
      (entry) => isAction(entry) && CHANGES.includes(entry.activity?.kind)
    );
  }

  /**
   * What `id` has not been told yet: what was said and done since, by the others. And where that starts.
   * @param {HistoryEntry[]} entries
   * @param {string} id
   * @param {string} hostId
   */
  #news(entries, id, hostId) {
    const own = (entry) => FROM_A_SESSION.includes(entry.kind) && (entry.speaker ?? hostId) === id;
    // Where it left off. Without a note of that (the app was restarted, or it has only just
    // joined), that is after the last thing it did itself, or after the line that says it was added.
    const told = entries.findIndex((entry) => entry.id === this.#told.get(id));
    const start = (told === -1 ? entries.findLastIndex((entry) => own(entry) || entry.joined === id) : told) + 1;
    const later = this.#toldLater.get(id);
    const news = entries
      .slice(start)
      .filter((entry) => !own(entry) && !later?.has(entry.id) && (isMessage(entry) || isAction(entry)));
    return { start, news };
  }
}
