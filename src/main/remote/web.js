// The page a phone or another computer is given (see host.js): the phone app, from src/renderer/phone, with the
// preload's `window.messenger` speaking over a WebSocket instead of Electron's IPC (src/renderer/remote/network-ipc.js).
// The app's own windows are not given out: they are made for this Mac.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { paletteNamed } from '../../shared/theme.js';

/**
 * The only files a browser can have, by where they are in the app's folder: the phone app and what it loads.
 * Nothing of the main process, the providers or the windows, and of the packages only what the phone app loads.
 */
export const SERVED = Object.freeze([
  'src/renderer/phone/',
  'src/renderer/lib/',
  // The sign-in page, and what the messenger runs on.
  'src/renderer/remote/',
  'src/renderer/chat/stop-key.js',
  'src/renderer/styles/theme.css',
  'src/renderer/styles/pro-theme.css',
  'src/renderer/styles/palettes.css',
  // A build of the app has Mermaid's own build here, beside the pages' folders (see scripts/build-app.js).
  'src/renderer/mermaid/',
  'src/shared/',
  'node_modules/marked/lib/',
  'node_modules/dompurify/dist/',
  'node_modules/@highlightjs/cdn-assets/es/',
  'node_modules/mermaid/dist/',
]);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
};

/** @param {string} file */
export const contentType = (file) => TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';

/**
 * The file an address is for, or null for one a browser can't have: outside SERVED, or out of the
 * app's folder by way of "..", an encoded one, or a link.
 * @param {string} root  the app's folder
 * @param {string} pathname  the address's path, as it came
 * @returns {string | null}
 */
export function servedFile(root, pathname) {
  let relative;
  try {
    relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return null;
  }
  if (!relative || relative.includes('\0') || relative.includes('\\')) return null;
  if (relative.split('/').some((part) => part === '..' || part === '.')) return null;
  const allowed = SERVED.find((prefix) => relative.startsWith(prefix));
  if (!allowed) return null;
  const file = path.join(root, relative);
  try {
    // Packages may be links into a store beside them (pnpm), and are still the app's.
    const real = fs.realpathSync(file);
    const inside = path.relative(fs.realpathSync(root), real);
    if (inside.startsWith('..') || path.isAbsolute(inside)) return null;
    const inAllowed = path.relative(fs.realpathSync(path.join(root, allowed)), real);
    if (inAllowed.startsWith('..') || path.isAbsolute(inAllowed)) return null;
    return fs.statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

/**
 * What a page may load and talk to: the app's own files, and its WebSocket. It sits in no other
 * site's frame. As the windows' own (see src/renderer/chat.html), with the WebSocket added, and what the
 * phone app is besides a page: its manifest, and its service worker.
 * @param {string} host  the request's Host, which the page's WebSocket goes to
 */
export const contentSecurityPolicy = (host) =>
  [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://avatars.githubusercontent.com",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    // The phone app's manifest, which a home screen adds it with, and its service worker, which shows notifications.
    "manifest-src 'self'",
    "worker-src 'self'",
    `connect-src 'self' ws://${host} wss://${host}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');

/** Where a page gets `window.messenger` from. */
export const MESSENGER_SCRIPT = '/remote/messenger.js';

/** The phone app's page, which is what a browser opens at "/". */
export const PHONE_PAGE = 'src/renderer/phone/index.html';

/** The phone app's service worker, which shows its notifications: served at "/sw.js", for the whole app. */
export const SERVICE_WORKER = 'src/renderer/phone/sw.js';

/** What the messenger runs the preload on: the network's stand-ins for Electron (see messengerScript). */
export const NETWORK_IPC = '/src/renderer/remote/network-ipc.js';

/** Where the phone app's modules start: its own, and the messenger's (see messengerScript). */
export const PHONE_ENTRIES = Object.freeze(['/src/renderer/phone/main.js', NETWORK_IPC]);

/**
 * Where a build of the app has the phone app as one bundle (see buildPhone in scripts/build-app.js): the messenger and
 * Home, the conversation apart, what they share, and the stylesheets in one, each named by what is in it. A phone
 * keeps these for good: a file that changes is one of another name.
 */
export const PHONE_BUILD = 'src/renderer/phone/build/';

/** What a build says of its bundle: the file of it each file the page names is in, and the modules they import. */
export const PHONE_BUNDLE = 'src/renderer/phone/bundle.json';

/**
 * The phone app's bundle, where the app is a build, or null where it runs from its source.
 * @param {string} root  the app's folder
 * @returns {{ files: Record<string, string>, modules: string[] } | null}  `files`: by the address the page names, the
 *   address of the bundle's file that has it; `modules`: what those import, all of it, by address
 */
export function phoneBundle(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, PHONE_BUNDLE), 'utf8'));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * What the phone app's page is made with (see phonePage), as this app has it: the bundle of a build, else the modules
 * as they are; and the palettes, for the user's own.
 * @param {string} root  the app's folder
 */
export const phoneFiles = (root) => ({
  ...(phoneBundle(root) ?? { modules: moduleGraph(root, PHONE_ENTRIES) }),
  palettes: fs.readFileSync(path.join(root, PALETTES), 'utf8'),
});

/** Whether an address is a file of the bundle, which a phone keeps for good (see PHONE_BUILD). */
export const inPhoneBuild = (pathname) => pathname.startsWith(`/${PHONE_BUILD}`);

/** What a module imports by name, before it runs: `import … from '…'`, `export … from '…'`, `import '…'`. */
const IMPORTS = /^\s*(?:import|export)\s+(?:[\w$*{}\s,]+?\s+from\s+)?['"]([^'"\n]+)['"]/gm;

/**
 * The modules a page has to have before it runs, by address: those it starts from and every one they import by
 * name, not those it imports later with import(). Told of them all at once, a browser fetches them together, not
 * one import after another.
 * @param {string} root  the app's folder
 * @param {readonly string[]} entries  addresses, as "/src/renderer/phone/main.js"
 */
export function moduleGraph(root, entries) {
  const found = new Set();
  const visit = (address) => {
    const file = servedFile(root, address);
    if (!file || found.has(address)) return;
    found.add(address);
    for (const [, spec] of fs.readFileSync(file, 'utf8').matchAll(IMPORTS))
      if (/^\.{1,2}\/|^\//.test(spec)) visit(new URL(spec, `http://buddylist${address}`).pathname);
  };
  for (const entry of entries) visit(entry);
  return [...found];
}

/** What an address may be, to go into the page as one. */
const ADDRESS = /^\/[\w./@-]+$/;

/** A stylesheet or a script the page names: with the line it is on, so a tag left out leaves no line behind. */
const NAMED = /(\n[ \t]*)(?:<link rel="stylesheet" href="([^"]+)" \/>|<script type="module" src="([^"]+)"><\/script>)/g;

/**
 * The phone app's page, in the palette of the user's theme from its first paint, and with the modules it needs named
 * up front (see moduleGraph). A build's page names its bundle instead of the files it is made of (see phoneBundle):
 * a file once, where the first of those it has was. The palettes' file is not asked for: the user's palette is in the
 * page, by day and at night (none for Luna's blue). Light or dark is the phone's own.
 * @param {string} html
 * @param {string} palette
 * @param {{ modules?: string[], files?: Record<string, string>, palettes?: string }} [made]  `modules` and `files` as
 *   phoneBundle has them; `palettes`: palettes.css
 */
export function phonePage(html, palette, { modules = [], files = {}, palettes = '' } = {}) {
  const name = paletteNamed(palette);
  const preloads = modules
    .filter((address) => ADDRESS.test(address))
    .map((address) => `<link rel="modulepreload" href="${address}" />`)
    .join('\n    ');
  const named = new Set();
  const page = html
    .replace(/data-palette="[a-z]*"/, `data-palette="${name}"`)
    .replace(NAMED, (tag, line, sheet, script) => {
      const address = sheet ?? script;
      if (address === PALETTES) {
        const css = phonePalettes(palettes, name);
        return css && `${line}<style>${css.replaceAll('</', '<\\/')}</style>`;
      }
      const to = ADDRESS.test(files[address] ?? '') ? files[address] : address;
      if (named.has(to)) return '';
      named.add(to);
      return tag.replace(`"${address}"`, `"${to}"`);
    });
  return preloads ? page.replace(/(\s*)<script type="module"/, `$1${preloads}$1<script type="module"`) : page;
}

/** What a computer is called, as the phone and its sign-in page say it (see hostNoun): nothing else gets in. */
const NOUNS = new Set(['Mac', 'PC', 'computer']);

/**
 * The sign-in page, told what the computer it signs in to is called, as data-noun on its <html>: it is shown before
 * signing in, with no app:init to ask, and says "your Mac", "your PC" or "your computer" from it (see login.js).
 * @param {string} html
 * @param {string | undefined} noun
 */
export function signInPage(html, noun) {
  return html.replace('<html lang="en">', `<html lang="en" data-noun="${NOUNS.has(noun ?? '') ? noun : 'computer'}">`);
}

/** The palettes' file, which the phone app is given its look's part of. */
export const PALETTES = '/src/renderer/styles/palettes.css';

/** A palette's rule in the professional look, as written (`[data-look='professional']`) or as a build minifies it. */
const PROFESSIONAL = /^:root\[data-look=(['"]?)professional\1\]\[data-palette=(['"]?)([\w-]+)\2\]$/;

/**
 * The rules of a stylesheet, or of the inside of one, each as what comes before its `{` and what is inside it.
 * @param {string} css
 */
function rules(css) {
  const found = [];
  let depth = 0;
  let start = 0;
  let prelude = '';
  for (let at = 0; at < css.length; at += 1) {
    const char = css[at];
    if (char === '/' && css[at + 1] === '*') {
      at = css.indexOf('*/', at + 2);
      if (at < 0) break;
      at += 1;
      if (depth === 0) start = at + 1;
    } else if (char === '"' || char === "'") {
      for (at += 1; at < css.length && css[at] !== char; at += 1) if (css[at] === '\\') at += 1;
    } else if (char === '{') {
      if (depth++ === 0) [prelude, start] = [css.slice(start, at).trim(), at + 1];
    } else if (char === '}') {
      if (--depth === 0) {
        found.push({ prelude, body: css.slice(start, at) });
        start = at + 1;
      }
    } else if (char === ';' && depth === 0) start = at + 1;
  }
  return found;
}

/**
 * The palettes the phone app draws with: the professional look's, by day and at night, or `palette`'s alone (none
 * for Luna's blue, which theme.css and pro-theme.css have). The messenger look's, two thirds of the file, are left
 * out: the phone is always professional. Read rule by rule, so that a build's file, minified, is read as the source.
 * @param {string} css  palettes.css
 * @param {string} [palette]
 * @returns {string}
 */
export function phonePalettes(css, palette) {
  const kept = (/** @type {string} */ sheet) =>
    rules(sheet).flatMap(({ prelude, body }) => {
      if (prelude.startsWith('@media')) {
        const inside = kept(body);
        return inside.length ? [`${prelude} {\n${inside.join('\n')}\n}`] : [];
      }
      const [, , , name] = PROFESSIONAL.exec(prelude) ?? [];
      return name && (!palette || name === palette) ? [`${prelude} {${body}}`] : [];
    });
  return kept(css).join('\n\n');
}

/** What is sent compressed: text, which shrinks by three quarters. Pictures and sounds are compressed already. */
const COMPRESSIBLE = /^(?:text\/|application\/(?:json|manifest\+json)|image\/svg)/;
/** How a file of the bundle goes out: kept for good, as a file that changes is one of another name (PHONE_BUILD). */
const FOR_GOOD = 'public, max-age=31536000, immutable';
/** The most kept compressed, in all: the phone app is about a megabyte, Mermaid's build a few more. */
const MAX_KEPT_BYTES = 32 * 1024 * 1024;

/** The encoding a browser takes, of the ones made here: brotli, else gzip, else none. */
export function encodingFor(acceptEncoding) {
  const taken = String(acceptEncoding || '')
    .toLowerCase()
    .split(',')
    .map((part) => part.trim().split(';'))
    .filter(([, q = 'q=1']) => q.trim() !== 'q=0')
    .map(([name]) => name.trim());
  return taken.includes('br') ? 'br' : taken.includes('gzip') ? 'gzip' : '';
}

/** Compresses, off the main thread's back: Mermaid's build is megabytes. */
const compress = (body, encoding) =>
  new Promise((resolve, reject) => {
    const done = (error, result) => (error ? reject(error) : resolve(result));
    if (encoding === 'br')
      zlib.brotliCompress(
        body,
        { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length } },
        done
      );
    else zlib.gzip(body, { level: 9 }, done);
  });

/** Whether a browser has this version already: If-None-Match names its validator, or any. */
const has = (ifNoneMatch, etag) =>
  String(ifNoneMatch || '')
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .some((tag) => tag === '*' || tag === etag.replace(/^W\//, ''));

/**
 * How the phone app's files go out: with a validator, so one a phone has is answered 304 with nothing after it, and
 * compressed as the browser takes it, each version of a file compressed once and kept.
 */
export class Delivery {
  /** @type {Map<string, Promise<Buffer>>} oldest first */
  #kept = new Map();
  #keptBytes = 0;

  /**
   * A file from the app's folder, or what was made of it (a body).
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   * @param {Record<string, string>} headers
   * @param {string} file
   * @param {{ body?: string | Buffer, forGood?: boolean }} [made]  `body`: sent in place of the file, what the host
   *   made of it; `forGood`: a file of the bundle, named by what is in it
   */
  async file(request, response, headers, file, { body, forGood = false } = {}) {
    const stat = fs.statSync(file);
    const version = `${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}`;
    return this.#send(request, response, headers, {
      type: contentType(file),
      forGood,
      etag: `W/"${body === undefined ? version : hashOf(body)}"`,
      key: `${file}\n${version}`,
      read: async () => (body === undefined ? fs.promises.readFile(file) : Buffer.from(body)),
      size: body === undefined ? stat.size : Buffer.byteLength(body),
    });
  }

  /**
   * Text made as it is asked for: with a validator where it is the same each time (`cache`), never kept otherwise.
   * @param {{ type: string, text: string, cache: boolean }} made
   */
  async text(request, response, headers, { type, text, cache }) {
    const body = Buffer.from(text);
    const etag = `W/"${hashOf(body)}"`;
    return this.#send(request, response, headers, {
      type,
      etag: cache ? etag : '',
      key: cache ? etag : '',
      read: async () => body,
      size: body.length,
    });
  }

  async #send(request, response, headers, { type, etag, key, read, size, forGood = false }) {
    const sent = {
      ...headers,
      'content-type': type,
      ...(etag && { etag, 'cache-control': forGood ? FOR_GOOD : 'no-cache' }),
      vary: 'Accept-Encoding',
    };
    if (etag && has(request.headers['if-none-match'], etag)) {
      response.writeHead(304, sent);
      return response.end();
    }
    const encoding = COMPRESSIBLE.test(type) ? encodingFor(request.headers['accept-encoding']) : '';
    const body = encoding ? await this.#compressed(key, encoding, read) : await read();
    response.writeHead(200, {
      ...sent,
      ...(encoding && { 'content-encoding': encoding }),
      'content-length': String(encoding ? body.length : size),
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  }

  /** A body compressed, once for each version and encoding where it can be kept. */
  #compressed(key, encoding, read) {
    if (!key) return read().then((body) => compress(body, encoding));
    const name = `${key}\n${encoding}`;
    const kept = this.#kept.get(name);
    if (kept) return kept;
    const made = read().then((body) => compress(body, encoding));
    this.#kept.set(name, made);
    made.then(
      (body) => {
        this.#keptBytes += body.length;
        for (const [old, oldMade] of this.#kept) {
          if (this.#keptBytes <= MAX_KEPT_BYTES || old === name) break;
          this.#kept.delete(old);
          oldMade.then((gone) => (this.#keptBytes -= gone.length));
        }
      },
      () => this.#kept.delete(name)
    );
    return made;
  }
}

const hashOf = (body) => crypto.createHash('sha256').update(body).digest('base64url').slice(0, 22);

/**
 * The preload itself, as Electron runs it, with the network's stand-ins for what it requires of
 * Electron: the same window.messenger, name for name, and nothing kept in step by hand. It is run as the
 * CommonJS module it is, with a `module` and `exports` too: a release's build of it sets module.exports
 * (see sourceMaps() in scripts/build-app.js). A build bundles it as the messenger's script (see buildPhone there).
 * @param {string} preload  src/preload/index.cjs, or its build
 * @param {string} [from]  where network-ipc.js is, as the script imports it
 */
export const messengerScript = (preload, from = NETWORK_IPC) => `import { networkElectron } from '${from}';

// The user's own emoticons, winks and pictures come from the app, as signed in (see host.js).
globalThis.__BUDDYLIST_PACK_BASE__ = '/pack/';
const electron = networkElectron(window);
const preloadModule = { exports: {} };
((require, module, exports) => {
${preload}
})(
  (id) => {
    if (id === 'electron') return electron;
    throw new Error(\`\${id} is not there in a browser\`);
  },
  preloadModule,
  preloadModule.exports
);
`;
