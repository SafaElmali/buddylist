// Who answers, and in which order, in a conversation with several agents.
// One speaks at a time and the others wait in line, so two of them never work
// in the folder at once. Unless they answer all at once: then everyone asked
// starts together, and an agent only waits for its own turn before. Nothing here
// talks to a session: Conversations starts the turns this hands out, and reports
// back what the sessions say.
import { mentions } from '../shared/mentions.js';
import { answeringParticipants } from '../shared/send-targets.js';
import { DEFAULT_TURN_LIMIT } from '../shared/turn-limit.js';

/**
 * Someone answering in the conversation. A paused one sits out: only a mention from the user gives it a turn.
 * One that answers after changes waits for the others to finish, and answers if they changed files (see `followUp`).
 * @typedef {import('../shared/mentions.js').Person & { paused?: boolean, afterChanges?: boolean }} Agent
 */
/** @typedef {import('../providers/contract.js').SessionEvent} SessionEvent */

/**
 * One agent's go at answering.
 * @typedef {Object} Turn
 * @property {string} id  whose turn it is
 * @property {{ mediaType: string, data: string }[]} images  the pictures the user sent it
 * @property {string} [command]  a slash command: sent as it is, instead of what was said
 * @property {true} [check]  an effort check: it picks the effort levels of those in line, and answers nothing yet
 * @property {string} [selected]  the queued message isolated by Send now
 * @property {string} [note]  a manager notice isolated by Send now
 * @property {true} [notes]  it is there to read the notes that wait for the conversation (see `readNotes`)
 * @property {string} [continuation]  the app's instruction to take over after a usage limit
 * @property {string} [brief]  what a project's manager that invited it asks of it first (see `brief`)
 * @property {boolean} [fixedEffort] the user chose the effort for this explicit continuation
 */

/**
 * A turn that is going on.
 * @typedef {Object} Speaking
 * @property {Turn | null} turn  the turn it was given. None when nobody here gave it one: it was answering
 *   before the conversation had turns, or it started on its own
 * @property {boolean} failed  its session reported an error during the turn
 * @property {boolean} unasked  it started on its own
 */

/**
 * Something the user said, by its id, with the pictures it came with and who it asks to answer.
 * @typedef {{ id: string | null, images: Turn['images'], asked: string[] }} Message
 */

export class Turns {
  /** Everyone in line starts at once, each on a turn of its own, instead of one after another. */
  atOnce;
  /** @type {string[] | null} who answers first when nobody is mentioned, by id: see `inAnswerOrder` */
  order;
  /** @type {Map<string, Speaking>} who is speaking, in the order they started */
  #speaking = new Map();
  /** @type {Turn[]} */
  #queue = [];
  /** Turns started since the round going on started: the first turn on a message of the user's, or on notes, starts one. */
  #taken = 0;
  /**
   * Messages from the user that nobody has started on yet: they came while someone was speaking.
   * @type {Message[]}
   */
  #unheard = [];
  /**
   * Which of the user's messages each turn in line was given for: one of `#unheard` until a turn starts on it.
   * A turn hears that one, and none that waits for a turn of its own: each is answered on its own, in order.
   * @type {WeakMap<Turn, Message>}
   */
  #for = new WeakMap();
  /**
   * The messages a turn in line is there for, by their ids. A turn without them stays whatever the user takes
   * back: an agent handed over to it, or nobody said which message it is for.
   * @type {WeakMap<Turn, Set<string>>}
   */
  #askedBy = new WeakMap();
  /** The user wants what they said answered now: a turn they stop for it leaves the line as it is. */
  #hurried = false;
  /** An interrupt request is pending; separate from preserving the line when its result arrives late. */
  #hurryPending = false;
  /** Who is on the way out of the conversation. */
  #leaving = new Set();
  /** Who was paused in the middle of a turn, and is being stopped (see `pause`). */
  #stopping = new Set();
  /**
   * Why the round was cut short, if it was: the user stopped it, or the agents took all the turns they get
   * on it. Nobody follows up on it until the user says something again. A note still starts a round of its
   * own after the limit, but never after the user stopped one (see `readNotes`).
   * @type {'stopped' | 'limit' | null}
   */
  #cut = null;

  /** @param {{ atOnce?: boolean, order?: string[] | null }} [how] */
  constructor({ atOnce = false, order = null } = {}) {
    this.atOnce = atOnce;
    this.order = order;
  }

  /** Who is speaking: the first of them to start, when several are. Null for nobody. */
  get current() {
    return this.#speaking.keys().next().value ?? null;
  }

  /** Agents are in line for a turn. */
  get waiting() {
    return this.#queue.length > 0;
  }

  /** A round is going on: someone is speaking, or about to. */
  get active() {
    return this.#speaking.size > 0 || this.waiting;
  }

  /** An effort check is going on. It always goes on alone. */
  get checking() {
    return [...this.#speaking.values()].some((speaking) => Boolean(speaking.turn?.check));
  }

  /**
   * How many of the user's messages wait for whoever is speaking: nobody has started on them yet. Each
   * is heard by the first turn given for it.
   */
  get unheard() {
    return this.waiting ? this.#unheard.length : 0;
  }

  get queuedIds() {
    return this.unheard ? this.#unheard.map((message) => message.id) : [];
  }

  /** Who each of those messages asks to answer, by its id. @returns {Map<string | null, string[]>} */
  get queuedFor() {
    return new Map(this.unheard ? this.#unheard.map((message) => [message.id, message.asked]) : []);
  }

  /** Who is in line to answer, in that order. An effort check answers nothing. */
  get line() {
    return [...new Set(this.#queue.filter((turn) => !turn.check).map((turn) => turn.id))];
  }

  /**
   * `id` is speaking, and was given the turn it is in. One that started on its own was not, and one
   * being stopped for a pause is in it no more: what either says counts for nothing.
   */
  asked(id) {
    const speaking = this.#speaking.get(id);
    return Boolean(speaking) && !speaking.unasked && !this.#stopping.has(id);
  }

  /**
   * The turn `id` was given and is in, while it is. Null when it is not speaking, nobody here gave it its turn,
   * or it is being stopped for a pause: nothing more is sent for that turn.
   * @param {string} id
   */
  turnOf(id) {
    return this.#stopping.has(id) ? null : (this.#speaking.get(id)?.turn ?? null);
  }

  /**
   * The user said something. Whoever they @mention answers, in that order; without
   * a mention everyone who isn't paused does, in `order`, but for the ones that answer
   * after changes: they wait for the others (see `followUp`), unless there are no others. A
   * slash command is the host's alone. Each message is a round of its own, after everyone in
   * line: someone in line already keeps their place, and answers this one on a turn of its own
   * once that is over. The count of turns starts over when its round does (see `next`). With the
   * agents picking their effort, the round starts with an effort check: by the agent `effortBy`
   * names or, when that is nobody here who answers this message, by the first one asked.
   * @param {string} text
   * @param {Agent[]} agents  the host, then the guests in the order they joined
   * @param {Turn['images']} [images]
   * @param {string | null} [effortBy]  who picks the effort levels; left out when the user does
   * @param {string | null} [said]  the message, by its id, to take it back by while it waits (see `takeBack`)
   * @param {string[] | null} [recipients]  a side-pane request's recipients, validated by Conversations
   * @param {boolean} [fixedEffort] keep the user's explicit effort for this continuation
   * @returns {string[]}  who was asked to answer: nobody when everyone here is paused and nobody was mentioned
   */
  userSaid(text, agents, images = [], effortBy = null, said = null, recipients = null, fixedEffort = false) {
    this.#cut = null;
    // With nobody in line, what was said before has been heard, or was sent away: it waits no more.
    const message = { id: said, images, asked: [] };
    this.#unheard = [...(this.waiting ? this.#unheard : []), message];
    // A command can't be sent along with anything else.
    if (text.startsWith('/')) {
      message.asked = [agents[0].id];
      this.#line(message, [{ id: agents[0].id, images, command: text }]);
      return [agents[0].id];
    }
    const mentioned = mentions(text, agents);
    const asked =
      recipients ?? (mentioned.length ? mentioned : answeringParticipants(agents, this.order).map((agent) => agent.id));
    message.asked = asked;
    const turns = asked.map((id) => ({ id, images: [...images], ...(fixedEffort && { fixedEffort: true }) }));
    if (effortBy && asked.length) {
      const answers = (agent) => !agent.paused || asked.includes(agent.id);
      const by = agents.some((agent) => agent.id === effortBy && answers(agent)) ? effortBy : asked[0];
      turns.unshift({ id: by, images: [], check: true });
    }
    this.#line(message, turns);
    return asked;
  }

  /**
   * The turns given for something the user said join the line, after everyone in it.
   * @param {Message} message
   * @param {Turn[]} turns
   */
  #line(message, turns) {
    for (const turn of turns) {
      this.#queue.push(turn);
      this.#for.set(turn, message);
      if (message.id) this.#askedBy.set(turn, new Set([message.id]));
    }
  }

  /**
   * A speaker said something. Mentioning another agent hands over to it: it gets a turn too,
   * unless it is paused.
   * @param {string} id
   * @param {string} text
   * @param {Agent[]} agents
   * @param {string} me  the user's name
   */
  agentSaid(id, text, agents, me) {
    // An effort check names the others to give them a level, not a turn. And what an agent says
    // on its own answers nobody here.
    if (!this.asked(id) || this.turnOf(id)?.check || this.#leaving.has(id)) return;
    // The user can be mentioned as well, which hands over to nobody. A paused agent is still looked
    // for, so that "@Claude (api)" is never taken for a mention of "Claude".
    const mentioned = mentions(text, [...agents, { id: '', name: me }]);
    const paused = new Set(agents.filter((agent) => agent.paused).map((agent) => agent.id));
    this.#enqueue(mentioned.filter((other) => other && other !== id && !paused.has(other)));
  }

  /** A usage-limit hand-off keeps the round's turn budget and joins an existing turn in line. */
  continueWith(id, continuation, images = []) {
    if (this.#cut) return false;
    this.#enqueue([id], images);
    const turn = this.#queue.find((one) => one.id === id && !one.command && !one.check);
    turn.images = [...new Set(turn.images)];
    turn.continuation = [turn.continuation, continuation].filter(Boolean).join('\n\n');
    return true;
  }

  /**
   * An agent a project's manager invited is asked what it is to do first: a turn of its own after everyone in line,
   * with the manager's words, which counts as any other. Not when the round was cut short, nor once its round took
   * all the turns it gets: it goes by what it is told of the manager's words with the turn it gets next.
   * @param {string} id
   * @param {string} brief
   * @param {number} [limit]
   * @returns {boolean}  whether it is in line
   */
  brief(id, brief, limit = DEFAULT_TURN_LIMIT) {
    if (this.#cut || this.#taken >= limit || this.#leaving.has(id)) return false;
    this.#enqueue([id]);
    const turn = this.#queue.find((one) => one.id === id && !one.command && !one.check);
    turn.brief = [turn.brief, brief].filter(Boolean).join('\n\n');
    return true;
  }

  /**
   * The round is over, and `ids` answer after changes: the others changed files since each was last told
   * what went on. Each gets a turn of its own now, which counts as any other. Not when the round was cut
   * short, and not while it is still going on.
   * @param {string[]} ids
   * @returns {string[]}  who is in line now
   */
  followUp(ids) {
    if (this.#cut || this.active) return [];
    const due = ids.filter((id) => !this.#leaving.has(id));
    this.#enqueue(due);
    return due;
  }

  /**
   * The user wants a note read now, with Send now: a turn of its own ahead of everyone in line, which starts a
   * round as a message of the user's does, also once the round going on took all the turns it gets. Not when
   * the user stopped the round.
   * @param {string} id
   * @param {string} note  the note, by its entry in the conversation's history
   * @returns {boolean}  whether it is in line
   */
  noteNow(id, note) {
    if (this.#cut === 'stopped' || this.#leaving.has(id)) return false;
    // Retrying an unacknowledged interrupt must not add another turn for the same note.
    if (this.#queue.some((turn) => turn.note === note)) return true;
    this.#queue.unshift({ id, images: [], note });
    return true;
  }

  /**
   * Notes wait for the conversation, and `id` is to read them: a turn of its own, which starts a round as a
   * message of the user's does. What other conversations report is no hand-off between the agents here, so a
   * round cut at the limit holds no note back, and the turns taken on it are counted from the note on. Not
   * while a round goes on: its next turn reads them. Nor when the user stopped the round.
   * @param {string} id
   * @returns {boolean}  whether it is in line
   */
  readNotes(id) {
    if (this.#cut === 'stopped' || this.active || this.#leaving.has(id)) return false;
    this.#queue.push({ id, images: [], notes: true });
    return true;
  }

  cancelNote(note) {
    this.#queue = this.#queue.filter((turn) => turn.note !== note);
  }

  /**
   * `ids` were handed over to: each joins its own turn in line, or gets one after everyone in it.
   * @param {string[]} ids
   * @param {Turn['images']} [images]
   */
  #enqueue(ids, images = []) {
    for (const id of ids) {
      const inLine = this.#queue.find((turn) => turn.id === id && !turn.command && !turn.check);
      const turn = inLine ?? { id, images: [] };
      turn.images.push(...images);
      if (!inLine) this.#queue.push(turn);
      // Handed over to, it stays whatever the user takes back.
      this.#askedBy.delete(turn);
    }
  }

  /**
   * The user took back `said` before anyone started on it, as if it had never been said: whoever is in line
   * only for it leaves the line, and its pictures go with it. An effort check with nobody left in line goes too.
   * @param {string} said  the message, by its id
   * @returns {boolean}  whether it still waited: not once a turn has started, which heard it
   */
  takeBack(said) {
    const message = said && this.unheard ? this.#unheard.find((unheard) => unheard.id === said) : undefined;
    if (!message) return false;
    this.#unheard = this.#unheard.filter((unheard) => unheard !== message);
    const pictures = new Set(message.images);
    this.#queue = this.#queue.filter((turn) => {
      turn.images = turn.images.filter((image) => !pictures.has(image));
      const askedBy = this.#askedBy.get(turn);
      askedBy?.delete(said);
      return askedBy?.size !== 0;
    });
    if (this.#queue.every((turn) => turn.check)) this.#queue = [];
    return true;
  }

  /**
   * A turn to start now, if there is one: the first in line when nobody is speaking. All at once,
   * also the first turn of each agent in line that is not speaking itself, so this is asked until it
   * says null. An effort check waits for everyone to finish, and nobody starts while it goes on. At the
   * limit everyone in line for the round going on is sent away instead, and `{ paused: true }` says so:
   * a message that waits still gets its round, so this is asked again. So does a note: a turn for one
   * starts a round too. An effort check is not one of the turns that are counted.
   * @param {number} [limit]  how many turns the agents take on one message from the user, hand-overs included
   * @returns {Turn | { paused: true } | null}
   */
  next(limit = DEFAULT_TURN_LIMIT) {
    const at = this.#startable();
    if (at === -1) return null;
    const waits = (turn) => this.#unheard.includes(this.#for.get(turn));
    // The first turn on a message that waited starts its round, and so does a turn that reads notes.
    const first = this.#queue[at];
    if (waits(first) || first.note || first.notes) {
      this.#taken = 0;
      this.#cut = null;
    }
    if (this.#taken >= limit) {
      this.#queue = this.#queue.filter(waits);
      this.#cut = 'limit';
      return { paused: true };
    }
    const [turn] = this.#queue.splice(at, 1);
    this.#speaking.set(turn.id, { turn, failed: false, unasked: false });
    if (!turn.check) this.#taken += 1;
    // It hears the message it is for, and any nobody is in line for. Not one that waits for a turn of its own.
    if (!turn.note) {
      const own = this.#for.get(turn);
      this.#unheard = this.#unheard.filter(
        (message) => message !== own && this.#queue.some((later) => this.#for.get(later) === message)
      );
    }
    return turn;
  }

  /** Where in line the turn is that may start now: -1 for none. */
  #startable() {
    if (!this.waiting) return -1;
    if ([...this.#speaking.values()].some((speaker) => speaker.turn?.note)) return -1;
    // A selected message gets its own round, including when agents normally answer at once.
    const selected = [...this.#speaking.values()].find((speaker) => speaker.turn?.selected)?.turn.selected;
    if (selected && this.#queue[0]?.selected !== selected) return -1;
    if (!this.#speaking.size) return 0;
    if (this.#queue[0]?.note) return -1;
    if (!this.atOnce || this.checking) return -1;
    // Nobody passes an effort check: it picks the levels of everyone behind it.
    const until = this.#queue.findIndex((turn) => turn.check);
    const ahead = until === -1 ? this.#queue : this.#queue.slice(0, until);
    return ahead.findIndex((turn) => !this.#speaking.has(turn.id) && !this.#leaving.has(turn.id));
  }

  /** `id`'s turn is over before anything was sent: an effort check with no level to pick. */
  skip(id) {
    this.#over(id);
  }

  /** `id` is not speaking any more. With nobody speaking, nobody is left to stop for the user. */
  #over(id) {
    this.#speaking.delete(id);
    this.#stopping.delete(id);
    if (!this.#speaking.size) {
      this.#hurried = false;
      this.#hurryPending = false;
    }
  }

  /**
   * Follows what a session reports. True when that ends its turn: a result, or no
   * result because it went offline or stopped after an error, so whoever waits for it
   * is never left waiting. "Idle" alone ends nothing: a session says so as it starts,
   * and as it finishes the turn before. Unless nobody here gave it the turn it is in: it
   * was seen at work, and idle again it is done, also one that was only starting up with
   * nothing to answer. So is one being stopped for a pause. A turn the user stopped sends
   * everyone in line away: the user has taken over. Unless they stopped it for what they
   * said (see `hurry`), or only paused the one in it (see `pause`).
   * @param {string} id
   * @param {SessionEvent} event
   */
  turnEnded(id, event) {
    const speaking = this.#speaking.get(id);
    if (!speaking || this.#leaving.has(id)) return false;
    if (event.type === 'error') speaking.failed = true;
    const stopping = this.#stopping.has(id);
    const done = speaking.failed || !speaking.turn || stopping;
    const gaveUp = event.type === 'state' && (event.state === 'offline' || (event.state === 'idle' && done));
    if (event.type !== 'result' && !gaveUp) return false;
    if (event.type === 'result' && event.stopped && !this.#hurried && !stopping) {
      this.#queue = [];
      this.#cut = 'stopped';
    }
    this.#over(id);
    return true;
  }

  /**
   * The user wants what they said answered now, not once whoever is speaking is done: everyone
   * speaking is to stop, and the line stays as it is, for its turns to start as those end.
   * @param {string} [said]  select just this message from the pending turns
   * @returns {string[] | null}  who is to stop; null for a stale or already pending selection
   */
  hurry(said) {
    if (said !== undefined) {
      const message = this.#unheard.find((entry) => entry.id === said);
      if (!message || this.#hurryPending) return null;
      const selected = [];
      for (const turn of this.#queue) {
        if (turn.check || this.#for.get(turn) !== message) continue;
        selected.push({ ...turn, images: message.images, selected: said });
      }
      if (!selected.length) return null;
      // Split only this message out of turns that were handed over to as well, keeping every remaining turn in place.
      this.takeBack(said);
      this.#unheard.push(message);
      for (const turn of selected) {
        this.#askedBy.set(turn, new Set([said]));
        this.#for.set(turn, message);
      }
      this.#queue.unshift(...selected);
    }
    if (this.#speaking.size) this.#hurried = this.#hurryPending = true;
    return [...this.#speaking.keys()];
  }

  /** A failed or timed-out request may be tried again; a late stopped result still preserves the queue. */
  retryHurry() {
    this.#hurryPending = false;
  }

  /** `id` was answering before the conversation had turns: that is the turn going on. */
  alreadySpeaking(id) {
    if (this.#speaking.size) return;
    this.#speaking.set(id, { turn: null, failed: false, unasked: false });
  }

  /**
   * `id` got to work without being given a turn: it started on its own, say because a helper of it
   * reported. That is a turn going on, so nobody who waits for it is given theirs in the middle of it,
   * and its result ends no turn but this one. What it says hands over to nobody. Taking turns, it only
   * counts with nobody else speaking; all at once, with it not speaking already.
   */
  startedItself(id) {
    if (this.atOnce ? this.#speaking.has(id) : this.#speaking.size) return;
    this.#speaking.set(id, { turn: null, failed: false, unasked: true });
  }

  /** The user stopped everyone: nobody is speaking, and nobody is in line. */
  stop() {
    this.#speaking.clear();
    this.#stopping.clear();
    this.#queue = [];
    this.#hurried = false;
    this.#hurryPending = false;
    this.#cut = 'stopped';
  }

  /**
   * `id` is on the way out. What its session still reports, as it is stopped, ends no
   * turn and hands nothing over: its turn lasts until `remove`.
   */
  leaving(id) {
    this.#leaving.add(id);
  }

  /**
   * `id` was paused: it gives up its place in line, also where the user mentioned it, but for a slash
   * command waiting for it: that was sent to it alone. A turn it is in is to stop, for it alone. Until its
   * session says it has (see `turnEnded` and `stopped`), nobody who waits for it starts. What it says
   * meanwhile hands over to nobody, and its stopping sends nobody in line away.
   * @param {string} id
   * @returns {boolean}  whether it is in a turn, and so is to be stopped
   */
  pause(id) {
    this.#queue = this.#queue.filter((turn) => turn.id !== id || turn.command);
    if (!this.#speaking.has(id)) return false;
    this.#stopping.add(id);
    return true;
  }

  /**
   * `id` was paused in the middle of a turn, and its session was stopped without saying the turn is over:
   * it is over all the same.
   * @param {string} id
   * @returns {boolean}  whether that ended its turn: not one that was over already, or never being stopped
   */
  stopped(id) {
    if (!this.#stopping.has(id)) return false;
    this.#over(id);
    return true;
  }

  /** `id` has left: it gives up its place in line, and a turn it was in is over. */
  remove(id) {
    this.#leaving.delete(id);
    this.#queue = this.#queue.filter((turn) => turn.id !== id);
    this.#over(id);
  }
}
