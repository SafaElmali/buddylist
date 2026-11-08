// The shell of a terminal in the browser preview. A browser has none, so this
// one plays along: it keeps the line you type and has a made-up answer for a
// handful of commands, about the same made-up folder the contact card and the
// Changes tab show. Nothing in here touches the page: host.js hands it what
// was typed and prints what comes back.

/**
 * What a pretend shell knows about the folder it was opened in.
 * @typedef {Object} ShellFolder
 * @property {string} cwd
 * @property {string} [name]    the project's name, for npm. The folder's own name when left out
 * @property {string} [branch]
 * @property {() => import('../src/main/changes.js').ChangedFile[]} [files]  the files that changed there,
 *   as the Changes tab lists them. Asked each time: an agent may have edited one since
 * @property {string} [title]   what the newest commit of a branch says: its pull request's title
 * @property {number} [port]    where `npm run dev` says it listens
 */

const EOL = '\r\n';
// Clears the screen and what was scrolled away, and puts the cursor back at the top.
const CLEAR = '\x1b[2J\x1b[3J\x1b[H';
const paint = (code) => (text) => `\x1b[${code}m${text}\x1b[0m`;
const green = paint(32);
const red = paint(31);
const yellow = paint(33);
const cyan = paint('1;36');
const dim = paint(2);

// Arrow keys and the like arrive as an escape sequence. There is no history to walk through.
// eslint-disable-next-line no-control-regex
const ESCAPES = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|O.|.)?/g;

const HELP = [
  'This pretend shell answers:',
  '  help   ls   pwd   whoami   echo   clear   exit',
  '  git status   git branch   git log   git diff',
  '  npm test   npm run dev',
  'In the app, a terminal is your own shell in this folder, and runs anything.',
];

// What every example folder has, whatever changed in it.
const ALWAYS_THERE = ['README.md', 'node_modules/', 'package.json', 'src/index.js'];

/** The commits every example folder has had since it was started, newest first. */
const OLD_COMMITS = [
  ['c41d9e2', 'Update the dependencies'],
  ['7a0b3f5', 'Add a README'],
  ['e12f6d8', 'First commit'],
];

// How `git status` names what happened to a file. Anything else was modified.
const STATUS_LABEL = {
  new: 'new file:   ',
  renamed: 'renamed:    ',
  deleted: 'deleted:    ',
  conflicted: 'both modified:   ',
};

const lastPart = (path) => path.split('/').filter(Boolean).pop() || path;

/** The pluses and minuses after a file's count in `git diff --stat`: ten of them at most. */
function bars(added, removed) {
  const total = added + removed;
  const shown = Math.min(total, 10);
  const plus = total ? Math.round((added / total) * shown) : 0;
  return `${green('+'.repeat(plus))}${red('-'.repeat(shown - plus))}`;
}

/**
 * What is in `dir`, as `ls` prints it: files by name, folders with a slash, each once.
 * @param {string[]} paths  every file there is, from the top of the folder. A folder of its own ends in a slash
 * @param {string} dir      '' for the top, or a folder ending in a slash
 * @returns {string[] | null}  null when there is no such folder
 */
export function entriesIn(paths, dir) {
  if (dir && !paths.some((path) => path.startsWith(dir))) return null;
  const inside = paths.filter((path) => path.startsWith(dir) && path !== dir);
  const names = inside.map((path) => {
    const rest = path.slice(dir.length);
    const slash = rest.indexOf('/');
    return slash === -1 ? rest : rest.slice(0, slash + 1);
  });
  return [...new Set(names)].sort();
}

export class DemoShell {
  /** What stands on the line so far. */
  #line = '';
  /** A command that keeps the terminal until Ctrl+C, while there is one. */
  #running = false;
  #exited = false;

  /** @param {ShellFolder} folder */
  constructor(folder) {
    this.folder = folder;
    this.name = folder.name || lastPart(folder.cwd);
    this.branch = folder.branch || 'main';
  }

  get prompt() {
    return `${cyan(lastPart(this.folder.cwd))} ${yellow(`(${this.branch})`)} $ `;
  }

  /** What a new terminal prints first. It says what it is before anything else. */
  get greeting() {
    return [
      `This is a pretend shell: a browser has none. In the app it is your own, in ${this.folder.cwd}.`,
      dim('Type help to see what it answers.'),
      '',
      this.prompt,
    ].join(EOL);
  }

  /** The files that changed in the folder, as they stand now. */
  get #files() {
    return this.folder.files?.() ?? [];
  }

  /**
   * Takes what was typed, a key or a pasted text, and answers with what the terminal prints.
   * @param {string} data
   * @returns {{ output: string, exited: boolean }}  `exited`: the shell is over, as after `exit`
   */
  type(data) {
    let output = '';
    const keys = String(data).replace(/\r\n/g, '\r').replace(ESCAPES, '');
    for (const key of keys) {
      if (this.#exited) break;
      output += this.#key(key);
    }
    return { output, exited: this.#exited };
  }

  #key(key) {
    // Ctrl+C: the line is dropped, and so is whatever kept the terminal.
    if (key === '\x03') {
      this.#line = '';
      this.#running = false;
      return `^C${EOL}${this.prompt}`;
    }
    // A dev server has the terminal to itself until it is stopped.
    if (this.#running) return '';
    if (key === '\r' || key === '\n') return this.#enter();
    // Ctrl+L: a clean screen, with the line as far as it was typed.
    if (key === '\x0c') return `${CLEAR}${this.prompt}${this.#line}`;
    if (key === '\x7f' || key === '\b') {
      if (!this.#line) return '';
      this.#line = [...this.#line].slice(0, -1).join('');
      return '\b \b';
    }
    if (key < ' ') return '';
    this.#line += key;
    return key;
  }

  #enter() {
    const line = this.#line.trim();
    this.#line = '';
    if (!line) return `${EOL}${this.prompt}`;
    const [command, ...args] = line.split(/\s+/);
    if (command === 'clear') return `${CLEAR}${this.prompt}`;
    if (command === 'exit') {
      this.#exited = true;
      return EOL;
    }
    const lines = this.#run(command, args);
    const printed = lines.map((text) => `${text}${EOL}`).join('');
    return `${EOL}${printed}${this.#running ? '' : this.prompt}`;
  }

  /** @returns {string[]} the lines a command prints */
  #run(command, args) {
    switch (command) {
      case 'help':
        return HELP;
      case 'pwd':
        return [this.folder.cwd];
      case 'whoami':
        return ['you'];
      case 'echo':
        return [args.join(' ').replace(/^(['"])(.*)\1$/, '$2')];
      case 'ls':
        return this.#ls(args.filter((arg) => !arg.startsWith('-')));
      case 'git':
        return this.#git(args);
      case 'npm':
        return this.#npm(args);
      default:
        return [`${command}: command not found. This is the browser preview: type help for what it answers.`];
    }
  }

  #ls([where = '.']) {
    const gone = this.#files.filter((file) => file.status === 'deleted').map((file) => file.path);
    const changed = this.#files.map((file) => file.path).filter((path) => !gone.includes(path));
    const paths = [...ALWAYS_THERE, ...changed];
    const path = where.replace(/^\.\/?/, '').replace(/\/+$/, '');
    if (paths.includes(path)) return [path];
    const names = entriesIn(paths, path ? `${path}/` : '');
    if (!names) return [`ls: ${where}: No such file or directory`];
    return names.length ? [names.join('  ')] : [];
  }

  #git([what, ...rest]) {
    switch (what) {
      case 'status':
        return this.#status();
      case 'branch':
        return [`* ${green(this.branch)}`, ...(this.branch === 'main' ? [] : ['  main'])];
      case 'log':
        return this.#log();
      case 'diff':
        return this.#diffStat();
      default: {
        const asked = ['git', what, ...rest].filter(Boolean).join(' ');
        return [`${asked}: the browser preview has no git. It answers git status, branch, log and diff.`];
      }
    }
  }

  /** What `git status` says of the files the Changes tab lists. */
  #status() {
    const files = this.#files;
    const lines = [`On branch ${this.branch}`];
    if (!files.length) return [...lines, 'nothing to commit, working tree clean'];
    const untracked = files.filter((file) => file.untracked);
    // git only knows of a new file or a new name once it was staged.
    const staged = files.filter((file) => !file.untracked && ['new', 'renamed'].includes(file.status));
    const unstaged = files.filter((file) => !untracked.includes(file) && !staged.includes(file));
    const row = (file) =>
      `\t${STATUS_LABEL[file.status] || 'modified:   '}${file.from ? `${file.from} -> ` : ''}${file.path}`;
    if (staged.length) lines.push('Changes to be committed:', ...staged.map((file) => green(row(file))), '');
    if (unstaged.length) {
      lines.push('Changes not staged for commit:', ...unstaged.map((file) => red(row(file))), '');
    }
    if (untracked.length) lines.push('Untracked files:', ...untracked.map((file) => red(`\t${file.path}`)), '');
    return lines.slice(0, -1);
  }

  /** The folder's commits, one to a line: the branch's own first, then the ones `main` has. */
  #log() {
    const onMain = this.branch === 'main';
    const [[id, text], ...older] = OLD_COMMITS;
    const own = `${yellow('3f9c2ab')} (HEAD -> ${this.branch}) ${this.folder.title || 'Work in progress'}`;
    const where = onMain ? '(HEAD -> main, origin/main)' : '(origin/main, main)';
    return [
      ...(onMain ? [] : [own]),
      `${yellow(id)} ${where} ${text}`,
      ...older.map(([hash, subject]) => `${yellow(hash)} ${subject}`),
    ];
  }

  /** `git diff --stat`, and where the lines themselves are to be read. */
  #diffStat() {
    const files = this.#files;
    if (!files.length) return [];
    const width = Math.max(...files.map((file) => file.path.length));
    const sum = (key) => files.reduce((total, file) => total + (file[key] || 0), 0);
    const rows = files.map(({ path, binary, added, removed }) => {
      const counted = `${(added || 0) + (removed || 0)} ${bars(added || 0, removed || 0)}`;
      return ` ${path.padEnd(width)} | ${binary ? 'Bin' : counted}`;
    });
    return [
      ...rows,
      ` ${files.length} ${files.length === 1 ? 'file' : 'files'} changed, ${sum('added')} insertions(+), ${sum('removed')} deletions(-)`,
      dim('The Changes tab shows the lines: click the + after this tab.'),
    ];
  }

  #npm(args) {
    const script = args[0] === 'run' ? args[1] : args[0];
    if (script === 'test') {
      return [
        '',
        `> ${this.name}@1.0.0 test`,
        '> node --test',
        '',
        `${green('✔')} it does what the README says ${dim('(1.8ms)')}`,
        `${green('✔')} it copes with an empty list ${dim('(0.6ms)')}`,
        `${green('✔')} it says so when something is wrong ${dim('(0.4ms)')}`,
        'ℹ tests 3',
        'ℹ pass 3',
        'ℹ fail 0',
      ];
    }
    if (script === 'dev') {
      this.#running = true;
      return [
        '',
        `> ${this.name}@1.0.0 dev`,
        '> vite',
        '',
        `  Local:   http://localhost:${this.folder.port || 3000}/`,
        '  ready in 412 ms',
        '',
        dim('Nothing is listening: this is the browser preview. Ctrl+C stops it.'),
      ];
    }
    const asked = ['npm', ...args].join(' ');
    return [`${asked}: the browser preview has no npm. It answers npm test and npm run dev.`];
  }
}
