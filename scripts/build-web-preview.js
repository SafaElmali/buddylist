// Builds browser pages and bundled media that run the app's real windows
// in a browser, in demo mode (scripted replies, no Claude login needed).
//
//   npm run preview:web   ->  dist/web-preview/ (open index.html over http)
//
// Each window (contact list, conversation, message history, toast) is bundled with
// preview/bridge.js, which stands in for the Electron preload. The page runs
// preview/host.js, which stands in for the main process and drives the app's
// own Conversations manager and DemoSession.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appMark } from '../src/renderer/lib/icons.js';
import { copyMermaid, MERMAID, mermaidApart, mermaidMetafile } from './build-app.js';
import { NOTICES, notices } from './notices.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const PREVIEW = path.join(ROOT, 'preview');
const OUT = path.join(ROOT, 'dist', 'web-preview');
/** Where the preview has Mermaid, beside its pages: loaded as in the app, the first time a reply has a diagram. */
export const MERMAID_PREVIEW_DIR = 'mermaid';

const read = (file) => fs.readFileSync(file, 'utf8');
const scriptSafe = (code) => code.replace(/<\/script/gi, '<\\/script');
const favicon = `<link rel="icon" type="image/png" href="data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'build', 'icon-128.png')).toString('base64')}">`;

// Node built-ins used by shared code resolve to tiny browser shims. So does zod, which only
// describes the app's tools to a real agent: the whole of it would be most of the page.
const nodeShims = {
  name: 'node-shims',
  setup(b) {
    b.onResolve({ filter: /^node:/ }, (args) => ({ path: path.join(PREVIEW, 'shims', `${args.path.slice(5)}.js`) }));
    b.onResolve({ filter: /^zod$/ }, () => ({ path: path.join(PREVIEW, 'shims', 'zod.js') }));
  },
};

/** What each bundle read, for the notices of what the demo ships. */
const metafiles = [];

async function bundle(options) {
  const result = await build({
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    // The licenses are in the notices beside the pages instead.
    legalComments: 'none',
    metafile: true,
    // A page's script is in the page: Mermaid is found from where the page is.
    plugins: [nodeShims, mermaidApart(`./${MERMAID_PREVIEW_DIR}/${MERMAID.script}`)],
    ...options,
  });
  metafiles.push(result.metafile);
  return scriptSafe(result.outputFiles[0].text);
}

/** The CSS, markup and bundled script of one window. */
async function windowTemplate(kind) {
  const page = read(path.join(RENDERER, `${kind}.html`));
  const css = [...page.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)]
    .map(([, href]) => read(path.join(RENDERER, href)))
    .concat(read(path.join(RENDERER, 'styles', 'browser.css')))
    .join('\n');
  const body = page.slice(page.indexOf('<body>') + 6, page.indexOf('</body>')).trim();
  const js = await bundle({
    stdin: {
      contents: `import './bridge.js';\nimport '../src/renderer/${kind}/main.js';\n`,
      resolveDir: PREVIEW,
      sourcefile: `${kind}-preview.js`,
    },
    // Windows read ?contactId=… from location.search; the preview passes it in the #hash.
    define: {
      'location.search': 'window.__previewSearch',
      'globalThis.__BUDDYLIST_PACK_BASE__': '"pack/"',
    },
  });
  return { css, body, js };
}

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'sounds'), { recursive: true });
for (const file of ['type.wav', 'nudge.wav', 'online.wav']) {
  fs.copyFileSync(path.join(RENDERER, 'sounds', file), path.join(OUT, 'sounds', file));
}
// The app icon a title bar, the toast and About show, found from each window's page as in the app.
fs.rmSync(path.join(OUT, 'pictures'), { recursive: true, force: true });
fs.cpSync(path.join(RENDERER, 'pictures'), path.join(OUT, 'pictures'), { recursive: true });
// The pack as it is now: a wink the last build copied and src/ no longer has would be deployed with the rest.
fs.rmSync(path.join(OUT, 'pack'), { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'src', 'pack', 'winks'), path.join(OUT, 'pack', 'winks'), { recursive: true });
// Mermaid as it is now, for the same reason.
fs.rmSync(path.join(OUT, MERMAID_PREVIEW_DIR), { recursive: true, force: true });
copyMermaid(path.join(OUT, MERMAID_PREVIEW_DIR));
const kb = (s) => `${Math.round(Buffer.byteLength(s) / 1024)} KB`;

// One page per window, with its CSS and script inline.
for (const kind of ['contacts', 'chat', 'history', 'toast']) {
  const { css, body, js } = await windowTemplate(kind);
  const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${favicon}<title>${kind}</title><style>${css}</style></head><body>${body}<script>${js}</script></body></html>\n`;
  fs.writeFileSync(path.join(OUT, `${kind}.html`), html);
  console.log(`dist/web-preview/${kind}.html (${kb(html)})`);
}

// The desktop page: windows, taskbar and the stand-in main process.
const host = await bundle({ entryPoints: [path.join(PREVIEW, 'host.js')] });
const page = read(path.join(PREVIEW, 'page.html')).replace('__APP_MARK__', appMark(20));
const fragment = `${page}\n<script>${host}</script>\n`;
// The artifact host adds its own <!doctype>/<head>/<body>, so publish the fragment…
fs.writeFileSync(path.join(OUT, 'buddylist.html'), fragment);
// …and wrap it for opening locally.
fs.writeFileSync(
  path.join(OUT, 'index.html'),
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">${favicon}</head><body>\n${fragment}</body></html>\n`
);
console.log(`dist/web-preview/index.html (${kb(fragment)})`);

// The licenses of what the pages hold, and of Mermaid's build beside them.
fs.writeFileSync(path.join(OUT, NOTICES), notices({ metafiles: [...metafiles, await mermaidMetafile()] }));
