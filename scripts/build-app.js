// Builds the app's code for packaging: bundled and minified to keep installers small.
//
//   npm run build:app   ->  dist/app/ (electron-builder packs it in place of src/)
//
// The build keeps the layout of src/, so the paths in src/main/paths.js still
// hold: one script for the main process, one for the preload and one per window,
// next to the pages, styles, pictures and sounds they load, and the build of
// Mermaid that draws diagrams. The phone app is a bundle of its own (buildPhone).
// `npm start` runs src/ as it is and needs none of this.
import { sentryEsbuildPlugin } from '@sentry/esbuild-plugin';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MESSENGER_SCRIPT,
  messengerScript,
  NETWORK_IPC,
  PALETTES,
  PHONE_BUILD,
  PHONE_BUNDLE,
  PHONE_PAGE,
} from '../src/main/remote/web.js';
import { releaseName } from '../src/shared/error-reports.js';
import { NOTICES, notices } from './notices.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const RENDERER = path.join(SRC, 'renderer');
/** Where `npm run build:app` builds. The "files" in package.json pack this folder. */
export const APP_BUILD_DIR = path.join(ROOT, 'dist', 'app');

const MAIN = path.join('main', 'index.js');
const PRELOAD = path.join('preload', 'index.cjs');
// What a phone is given, while Settings > Remote access is on, besides the phone app (buildPhone): the sign-in page.
const REMOTE_SCRIPTS = ['renderer/remote/login.js'];
// The phone app's service worker, which the host serves at /sw.js: no page loads it, and a browser runs it as a
// classic script, where an `export` is an error.
const SERVICE_WORKER = 'renderer/phone/sw.js';
// Loaded by AudioWorklet.addModule(), outside the window's import graph.
const WORKLET_SCRIPTS = ['renderer/chat/voice-worklet.js'];
const CODE = /\.(js|cjs|css)$/;
// What the main process and the preload leave in node_modules. Electron is the app itself, the
// Agent SDK comes with its own binary and describes its tools with zod, and a terminal's
// pseudo-terminal is built for the computer. Anything else they import is put inside their
// script, with only the parts they use: as a package, the SDK that reports errors is over 100 MB.
const OUTSIDE = ['electron', '@anthropic-ai/claude-agent-sdk', 'zod', 'node-pty'];
// The main script is an ES module, which has no require(). A package written for require() that
// is put inside it, as electron-updater is, still asks it for Electron and for Node's own modules,
// so the script gets one of its own, as esbuild suggests.
const REQUIRE = "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);";

/**
 * What draws the diagrams in replies (src/renderer/lib/diagrams.js): Mermaid's own build, a small
 * script and the pieces it loads for each kind of diagram. It is more than all the rest of a
 * window, so it is no part of a window's script: it is copied as it is, and loaded from there
 * the first time a reply has a diagram. Only these files are packed, not the package.
 */
export const MERMAID = {
  dir: path.join(ROOT, 'node_modules', 'mermaid', 'dist'),
  script: 'mermaid.esm.min.mjs',
  pieces: path.join('chunks', 'mermaid.esm.min'),
};
/** Where a build of the app has Mermaid, as a path from it: beside the windows' folders. */
export const MERMAID_BUILD_DIR = path.join('renderer', 'mermaid');

/**
 * Has a build leave the import of Mermaid's script as an import, of `to`, where it was copied.
 * @param {string} to  as the window's script imports it
 * @returns {import('esbuild').Plugin}
 */
export const mermaidApart = (to) => ({
  name: 'mermaid-apart',
  setup(b) {
    b.onResolve({ filter: /\/mermaid\/dist\/mermaid\.esm\.min\.mjs$/ }, () => ({ path: to, external: true }));
  },
});

/** Copies Mermaid's script and its pieces into `dir`, without their source maps. @param {string} dir */
export function copyMermaid(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(MERMAID.dir, MERMAID.script), path.join(dir, MERMAID.script));
  fs.cpSync(path.join(MERMAID.dir, MERMAID.pieces), path.join(dir, MERMAID.pieces), {
    recursive: true,
    filter: (file) => !file.endsWith('.map'),
  });
}

/**
 * What Mermaid's build holds, for the notices (scripts/notices.js): it is copied as it was built,
 * with the packages it draws with inside it, so its unbundled build is bundled here to see which.
 * @returns {Promise<import('esbuild').Metafile>}
 */
export async function mermaidMetafile() {
  const { metafile } = await build({
    entryPoints: [path.join(MERMAID.dir, 'mermaid.core.mjs')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  return metafile;
}

/** Every file in a folder and the folders inside it, as paths from it. */
export const filesIn = (dir) =>
  fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== '.DS_Store')
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();

/** The script each page in src/renderer loads, as paths from src/. */
const windowScripts = () =>
  fs
    .readdirSync(RENDERER)
    .filter((file) => file.endsWith('.html'))
    .flatMap((page) => [
      ...fs.readFileSync(path.join(RENDERER, page), 'utf8').matchAll(/<script type="module" src="([^"]+)"/g),
    ])
    .map(([, src]) => path.join('renderer', src));

/**
 * The scripts a build holds, as paths from it, but for the phone app's bundle (buildPhone). Each has the code it
 * imports inside it.
 */
export const builtScripts = () =>
  [MAIN, PRELOAD, ...windowScripts(), ...REMOTE_SCRIPTS, SERVICE_WORKER, ...WORKLET_SCRIPTS].sort();

/**
 * What sends a script's source map to Sentry, where it turns the stack of a reported error back
 * into the names and lines of src/ (docs/error-reports.md). A build does that when it is given
 * the key to (SENTRY_AUTH_TOKEN, with SENTRY_ORG and SENTRY_PROJECT): the build of a release.
 * Every other build has no source maps at all, and no script of it is changed.
 *
 * Each script it is given is made from a module of Sentry's, which marks it and exports what the
 * script did: an ES module's build ends with an `export`, and a CommonJS one's sets module.exports.
 * Without SENTRY_ORG and SENTRY_PROJECT nothing is sent, so the tests build a release's scripts too.
 * @param {NodeJS.ProcessEnv} env
 * @returns {import('esbuild').BuildOptions}
 */
export function sourceMaps(env = process.env) {
  if (!env.SENTRY_AUTH_TOKEN) return {};
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const plugin = sentryEsbuildPlugin({
    authToken: env.SENTRY_AUTH_TOKEN,
    org: env.SENTRY_ORG,
    project: env.SENTRY_PROJECT,
    // The app says which version it is by itself (src/main/error-reports.js).
    release: { name: releaseName(version), inject: false, setCommits: false },
    telemetry: false,
    // A release is not held up by Sentry: its errors are then read without the names of src/.
    errorHandler: (error) => console.warn(`The source maps did not get to Sentry: ${error.message}`),
  });
  // Written next to the scripts, which don't mention them.
  return { sourcemap: 'external', plugins: [plugin] };
}

/**
 * Where an installed app reports its errors and counts what it is used for: the app's project at
 * Sentry (SENTRY_DSN) and at PostHog (POSTHOG_KEY). Only the build of a release is given them, as
 * repository variables of GitHub Actions, and they are written into the main script. Any other
 * build, a contributor's or a fork's, reports and counts nothing.
 * @param {NodeJS.ProcessEnv} env
 * @returns {Record<string, string>}  for esbuild's define
 */
export const services = (env = process.env) => ({
  'process.env.SENTRY_DSN': JSON.stringify(env.SENTRY_DSN ?? ''),
  'process.env.POSTHOG_KEY': JSON.stringify(env.POSTHOG_KEY ?? ''),
});

/** The phone app's sources that are no file: its messenger (see messengerScript), and its stylesheets in one. */
const PHONE_SOURCE = /^buddylist-phone:(messenger|styles)$/;

/**
 * The phone app, as one bundle, from the scripts and stylesheets its page names (see PHONE_BUILD in
 * src/main/remote/web.js). The scripts are its messenger, which runs the preload on the network before anything asks
 * for window.messenger, and Home; the conversation, with Markdown and highlighting, is a piece apart, loaded once one
 * opens, and what they share is in pieces of their own, so that the messenger and the screens have one copy of a
 * module (such as host.js). The stylesheets are one but for the palettes: a page has its own inline. Each file is
 * named by what is in it, and the build says which file of the page each stands for, and which modules they import,
 * for the page to name up front (PHONE_BUNDLE).
 * @param {string} out  the folder of the build: the app's src/
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<import('esbuild').BuildResult[]>}
 */
export async function buildPhone(out, env = process.env) {
  const page = fs.readFileSync(path.join(ROOT, PHONE_PAGE), 'utf8');
  const named = (tags) => [...page.matchAll(tags)].map(([, address]) => address);
  const scripts = named(/<script type="module" src="([^"]+)"/g);
  const sheets = named(/<link rel="stylesheet" href="([^"]+)"/g).filter((address) => address !== PALETTES);
  const dir = path.join(out, path.relative('src', PHONE_BUILD));
  const sources = {
    messenger: () => ({
      contents: messengerScript(fs.readFileSync(path.join(SRC, PRELOAD), 'utf8'), `.${NETWORK_IPC}`),
      loader: 'js',
    }),
    styles: () => ({ contents: sheets.map((address) => `@import ".${address}";`).join('\n'), loader: 'css' }),
  };
  /** @type {import('esbuild').Plugin} */
  const phoneSources = {
    name: 'phone-sources',
    setup(b) {
      b.onResolve({ filter: PHONE_SOURCE }, ({ path: name }) => ({ path: name, namespace: 'buddylist-phone' }));
      b.onLoad({ filter: PHONE_SOURCE, namespace: 'buddylist-phone' }, ({ path: name }) => ({
        ...sources[PHONE_SOURCE.exec(name)[1]](),
        resolveDir: ROOT,
      }));
    },
  };
  const options = {
    bundle: true,
    minify: true,
    logLevel: 'warning',
    metafile: true,
    outdir: dir,
    entryNames: '[name]-[hash]',
    chunkNames: '[name]-[hash]',
  };
  // Sentry's plugin first, where a release has it: it wraps each script, the messenger too, before it is looked up.
  const maps = sourceMaps(env);
  const mermaid = path
    .relative(dir, path.join(out, MERMAID_BUILD_DIR, MERMAID.script))
    .split(path.sep)
    .join('/');
  const entries = scripts.map((address) =>
    address === MESSENGER_SCRIPT
      ? { in: 'buddylist-phone:messenger', out: 'messenger' }
      : { in: path.join(ROOT, address), out: path.basename(address, '.js') }
  );
  const [code, styles] = await Promise.all([
    build({
      ...options,
      ...maps,
      platform: 'browser',
      format: 'esm',
      splitting: true,
      plugins: [...(maps.plugins ?? []), mermaidApart(mermaid), phoneSources],
      entryPoints: entries,
    }),
    build({ ...options, plugins: [phoneSources], entryPoints: [{ in: 'buddylist-phone:styles', out: 'phone' }] }),
  ]);
  /** A file of the build, by the address a phone asks for it at. */
  const addressOf = (file) => `/src/${path.relative(out, path.resolve(file)).split(path.sep).join('/')}`;
  /** The file a build made for an entry, by its name. */
  const madeFor = ({ metafile }, name) =>
    Object.keys(metafile.outputs).find(
      (file) =>
        metafile.outputs[file].entryPoint && new RegExp(`^${name}-[A-Z0-9]+\\.(?:js|css)$`).test(path.basename(file))
    );
  const files = Object.fromEntries([
    ...scripts.map((address, i) => [address, addressOf(madeFor(code, entries[i].out))]),
    ...sheets.map((address) => [address, addressOf(madeFor(styles, 'phone'))]),
  ]);
  // What the scripts import before they run, all of it: never what they import later, with import().
  const modules = new Set();
  const visit = (file) =>
    code.metafile.outputs[file].imports
      .filter(({ kind, external }) => kind === 'import-statement' && !external)
      .forEach(({ path: imported }) => {
        if (modules.has(imported)) return;
        modules.add(imported);
        visit(imported);
      });
  for (const entry of entries) visit(madeFor(code, entry.out));
  for (const entry of entries) modules.delete(madeFor(code, entry.out));
  fs.writeFileSync(
    path.join(out, path.relative('src', PHONE_BUNDLE)),
    `${JSON.stringify({ files, modules: [...modules].map(addressOf) }, null, 2)}\n`
  );
  return [code, styles];
}

/**
 * @param {string} out  the folder to build into; emptied first
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<Record<string, number>>}  how many bytes of source each script and stylesheet
 *   was made from, by its path in the build
 */
export async function buildApp(out, env = process.env) {
  const files = filesIn(SRC);
  const from = (file) => path.join(SRC, file);
  fs.rmSync(out, { recursive: true, force: true });
  // Pages, pictures and sounds go in as they are, and so does Mermaid's build.
  for (const file of files.filter((file) => !CODE.test(file))) {
    fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
    fs.copyFileSync(from(file), path.join(out, file));
  }
  copyMermaid(path.join(out, MERMAID_BUILD_DIR));
  const options = { minify: true, outdir: out, outbase: SRC, logLevel: 'warning', metafile: true };
  const node = { ...options, bundle: true, platform: 'node', external: OUTSIDE };
  // Each build sends its own source maps, so each has a plugin of its own. A window's script is
  // in a folder of renderer/, beside Mermaid's.
  const windows = { ...options, bundle: true, platform: 'browser', format: 'esm' };
  const windowMaps = sourceMaps(env);
  const mermaid = mermaidApart(`../${path.basename(MERMAID_BUILD_DIR)}/${MERMAID.script}`);
  const builds = await Promise.all([
    build({
      ...node,
      ...sourceMaps(env),
      define: services(env),
      format: 'esm',
      banner: { js: REQUIRE },
      entryPoints: [from(MAIN)],
    }),
    build({
      ...node,
      ...sourceMaps(env),
      format: 'cjs',
      entryPoints: [from(PRELOAD)],
      outExtension: { '.js': '.cjs' },
    }),
    build({
      ...windows,
      ...windowMaps,
      plugins: [mermaid, ...(windowMaps.plugins ?? [])],
      entryPoints: [...windowScripts(), ...REMOTE_SCRIPTS].map(from),
    }),
    build({ ...options, entryPoints: files.filter((file) => file.endsWith('.css')).map(from) }),
    build({ ...windows, entryPoints: WORKLET_SCRIPTS.map(from) }),
    build({ ...windows, format: 'iife', entryPoints: [from(SERVICE_WORKER)] }),
    buildPhone(out, env),
  ]);
  // Source maps have been uploaded to Sentry; omit them to keep installers small.
  for (const map of filesIn(out).filter((file) => file.endsWith('.map'))) fs.rmSync(path.join(out, map));
  // The licenses of what the scripts hold, of Mermaid's build, and of the packages packed beside them.
  fs.writeFileSync(
    path.join(out, NOTICES),
    notices({
      metafiles: [...builds.flat().map(({ metafile }) => metafile), await mermaidMetafile()],
      packed: OUTSIDE.filter((name) => name !== 'electron'),
      about:
        'Electron, which the app runs on, and the Chromium in it come under licenses of their own, which Electron publishes with each release.',
    })
  );
  return Object.fromEntries(
    builds
      .flat()
      .flatMap(({ metafile }) =>
        Object.entries(metafile.outputs).map(([file, { inputs }]) => [
          path.relative(out, path.resolve(file)),
          Object.keys(inputs).reduce((bytes, input) => bytes + metafile.inputs[input].bytes, 0),
        ])
      )
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildApp(APP_BUILD_DIR);
  const phone = path.relative('src', PHONE_BUILD);
  for (const script of [
    ...builtScripts(),
    ...filesIn(path.join(APP_BUILD_DIR, phone)).map((f) => path.join(phone, f)),
  ]) {
    const size = Math.round(fs.statSync(path.join(APP_BUILD_DIR, script)).size / 1024);
    console.log(`${path.join(path.relative(ROOT, APP_BUILD_DIR), script)} (${size} KB)`);
  }
}
