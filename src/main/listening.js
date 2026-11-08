// "What I'm listening to", as MSN Messenger had it: the song Spotify or Apple Music is
// playing, shown in place of your personal message. Only on a Mac, and only while it is on
// (the menu under your name).
//
// One osascript runs for as long as it is on. Both players tell any app that listens about
// every new song, pause and stop, so a change is heard the moment it happens and nothing is
// polled. Only the song that is already playing when it starts has to be asked for. That is
// an Apple event, which macOS lets the user allow or not, once for each player. Turned down,
// the song shows from the next one on.
import { spawn as spawnProcess } from 'node:child_process';

/**
 * @typedef {Object} Song
 * @property {string} title
 * @property {string} artist  '' where the player doesn't say, as for some radio
 * @property {string} player  which app is playing it: Spotify or Music
 */

/** The players, by their app's bundle id, with what each announces a change as. */
const PLAYERS = [
  { id: 'com.spotify.client', name: 'Spotify', announces: 'com.spotify.client.PlaybackStateChanged' },
  { id: 'com.apple.Music', name: 'Music', announces: 'com.apple.Music.playerInfo' },
];

// JavaScript for Automation. It prints a line of JSON for each player that starts or stops
// playing: { player, playing, title, artist }. It ends itself once the app's end of its stdin
// closes, so it doesn't outlive an app that died without stopping it.
const SCRIPT = String.raw`
ObjC.import('AppKit');
ObjC.import('stdlib');
const players = ${JSON.stringify(PLAYERS)};
const out = $.NSFileHandle.fileHandleWithStandardOutput;
const input = $.NSFileHandle.fileHandleWithStandardInput;
const say = (heard) => out.writeData($(JSON.stringify(heard) + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
const playing = (player, title, artist) => say({ player: player.name, playing: true, title: title || '', artist: artist || '' });
const stopped = (player) => say({ player: player.name, playing: false });

ObjC.registerSubclass({
  name: 'BuddylistListening',
  methods: {
    'announced:': {
      types: ['void', ['id']],
      implementation: (note) => {
        const player = players.find((one) => one.announces === ObjC.unwrap(note.name));
        const info = ObjC.deepUnwrap(note.userInfo) || {};
        if (info['Player State'] === 'Playing') playing(player, info.Name, info.Artist);
        else stopped(player);
      },
    },
    'quit:': {
      types: ['void', ['id']],
      implementation: (note) => {
        const app = note.userInfo.objectForKey($.NSWorkspaceApplicationKey);
        const player = players.find((one) => one.id === ObjC.unwrap(app.bundleIdentifier));
        if (player) stopped(player);
      },
    },
    'input:': {
      types: ['void', ['id']],
      implementation: (note) => {
        if (note.userInfo.objectForKey($.NSFileHandleNotificationDataItem).length === 0) $.exit(0);
        input.readInBackgroundAndNotify;
      },
    },
  },
});

const listener = $.BuddylistListening.alloc.init;
for (const player of players) {
  $.NSDistributedNotificationCenter.defaultCenter.addObserverSelectorNameObject(listener, 'announced:', player.announces, $());
}
$.NSWorkspace.sharedWorkspace.notificationCenter.addObserverSelectorNameObject(listener, 'quit:', $.NSWorkspaceDidTerminateApplicationNotification, $());
$.NSNotificationCenter.defaultCenter.addObserverSelectorNameObject(listener, 'input:', $.NSFileHandleReadCompletionNotification, input);
input.readInBackgroundAndNotify;

// The song already playing. running() asks nothing of the player, and doesn't open it.
for (const player of players) {
  try {
    const app = Application(player.id);
    if (app.running() && app.playerState() === 'playing') playing(player, app.currentTrack.name(), app.currentTrack.artist());
  } catch (e) {}
}

$.NSRunLoop.currentRunLoop.run;
`;

/**
 * One line the script printed.
 * @param {string} line
 * @returns {{ player: string, song: Song | null } | null}  `song` null for a player that stopped; null for
 *   a line that is not one of the script's
 */
export function parseHeard(line) {
  let heard;
  try {
    heard = JSON.parse(line);
  } catch {
    return null;
  }
  const player = PLAYERS.find((one) => one.name === heard?.player)?.name;
  if (!player) return null;
  // A player can say it is playing before it says what: there is nothing to show yet.
  const title = heard.playing === true && typeof heard.title === 'string' ? heard.title.trim() : '';
  const artist = typeof heard.artist === 'string' ? heard.artist.trim() : '';
  return { player, song: title ? { title, artist, player } : null };
}

const same = (a, b) => a?.title === b?.title && a?.artist === b?.artist && a?.player === b?.player;

export class Listening {
  /** The song each player is playing, in the order they started: the last is the one shown. */
  #playing = new Map();
  /** @type {import('node:child_process').ChildProcess | null} */
  #child = null;
  /** @type {Song | null} */
  #shown = null;

  /**
   * @param {object} opts
   * @param {(song: Song | null) => void} opts.onChange  called when the song to show changes
   * @param {typeof spawnProcess} [opts.spawn]
   * @param {NodeJS.Platform} [opts.platform]
   */
  constructor({ onChange, spawn = spawnProcess, platform = process.platform }) {
    this.onChange = onChange;
    this.spawn = spawn;
    this.platform = platform;
  }

  /** @returns {Song | null}  what to show in place of the personal message; null for the message */
  get song() {
    return this.#shown;
  }

  /** Starts or stops listening, as the setting says. Only a Mac can. */
  setEnabled(on) {
    if (on && this.platform === 'darwin') this.#start();
    else this.#stop();
  }

  #start() {
    if (this.#child) return;
    const child = this.spawn('osascript', ['-l', 'JavaScript', '-e', SCRIPT], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.#child = child;
    let rest = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (this.#child !== child) return;
      const lines = (rest + chunk).split('\n');
      rest = lines.pop();
      for (const line of lines) this.#heard(parseHeard(line));
    });
    // Ended by stop, or by something that went wrong: either way there is no song to know of.
    const ended = () => {
      if (this.#child !== child) return;
      this.#child = null;
      this.#clear();
    };
    child.on('exit', ended);
    child.on('error', ended);
  }

  #stop() {
    const child = this.#child;
    this.#child = null;
    child?.stdin.end();
    child?.kill();
    this.#clear();
  }

  #heard(heard) {
    if (!heard) return;
    // Taken out and put back, so a player that starts goes to the end.
    this.#playing.delete(heard.player);
    if (heard.song) this.#playing.set(heard.player, heard.song);
    this.#show();
  }

  #clear() {
    this.#playing.clear();
    this.#show();
  }

  #show() {
    const song = [...this.#playing.values()].at(-1) ?? null;
    if (same(song, this.#shown)) return;
    this.#shown = song;
    this.onChange(song);
  }
}
