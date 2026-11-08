// THIRD_PARTY_NOTICES.txt: the code and media of others that a build ships, each with the license
// it comes under. The app (scripts/build-app.js) and the browser demo (scripts/build-web-preview.js)
// carry one, made from the files their bundles read (esbuild's metafiles), so it names what is
// shipped and nothing else. A minified script keeps no comment, so the notices of a package or of a
// file copied into src/ go here instead.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The file's name, beside the app's resources and the demo's pages. */
export const NOTICES = 'THIRD_PARTY_NOTICES.txt';

/** Code copied into src/ with its license at the top, and the line its notice starts at. */
export const VENDORED = Object.freeze([
  {
    name: 'QR Code generator library, by Project Nayuki',
    file: 'src/shared/vendor/qrcodegen.js',
    from: /QR Code generator/,
  },
  { name: 'Material Icon Theme 5.39.0', file: 'src/renderer/lib/file-icons.js', from: /Material Icon Theme/ },
]);

/** What the license of buddylist does not cover, in both builds. README.md's License and credits says the same. */
const MEDIA = `The notification sounds (type.wav, nudge.wav and online.wav) and the classic Winks with their
soundtracks are Microsoft's original MSN Messenger media; src/pack/README.md says where the Winks
come from. The Claude spark and the Claude Code mascot are Anthropic's marks, drawn with the SVG
paths Simple Icons publishes. They belong to Microsoft and Anthropic, and buddylist's license does
not cover them.`;

/** A license file, as packages name theirs: LICENSE, LICENCE.md, COPYING, NOTICE and the like. */
const LICENSE_FILE = /^(licen[cs]e|copying|notice)/i;
const RULE = '='.repeat(100);

/**
 * The folder of the package a bundle read a file from, from the file's path as esbuild gives it:
 * what follows the last node_modules. None for a file of the app's own.
 * @param {string} input
 * @returns {string | null}
 */
export function packageDir(input) {
  const at = input.lastIndexOf('node_modules/');
  if (at === -1) return null;
  const [scope, name] = input.slice(at + 'node_modules/'.length).split('/');
  return path.resolve(input.slice(0, at), 'node_modules', scope.startsWith('@') ? `${scope}/${name}` : scope);
}

/**
 * What a package says of itself, and the license files it ships.
 * @param {string} dir
 * @returns {{ title: string, license: string, text: string }}
 */
export function packageNotice(dir) {
  const { name, version, license } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && LICENSE_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  return {
    title: `${name} ${version}`,
    license: typeof license === 'string' ? license : (license?.type ?? ''),
    text: files.map((file) => fs.readFileSync(path.join(dir, file), 'utf8').trim()).join('\n\n'),
  };
}

/**
 * The notice at the top of a file copied into src/: its first comment, from the line that names
 * what it is.
 * @param {string} source
 * @param {RegExp} from
 */
export function vendoredNotice(source, from) {
  const lines = source.startsWith('/*')
    ? source
        .slice(2, source.indexOf('*/'))
        .split('\n')
        .map((line) => line.replace(/^\s*\* ?/, ''))
    : source
        .split('\n')
        .slice(
          0,
          source.split('\n').findIndex((line) => !line.startsWith('//'))
        )
        .map((line) => line.replace(/^\/\/ ?/, ''));
  const start = lines.findIndex((line) => from.test(line));
  return lines.slice(start).join('\n').trim();
}

/**
 * The notices of a build.
 * @param {object} shipped
 * @param {import('esbuild').Metafile[]} shipped.metafiles  of every bundle the build made, and of what it copies as built
 * @param {string[]} [shipped.packed]  packages packed beside the scripts as they are
 * @param {string} [shipped.about]  what else ships with their own notices
 * @returns {string}
 */
export function notices({ metafiles, packed = [], about = '' }) {
  const inputs = metafiles.flatMap((metafile) => Object.keys(metafile.inputs));
  const dirs = new Set([
    ...inputs.map(packageDir).filter(Boolean),
    ...packed.map((name) => path.join(ROOT, 'node_modules', name)),
  ]);
  const packages = [...dirs].map(packageNotice).sort((a, b) => a.title.localeCompare(b.title));
  const read = new Set(inputs.map((input) => path.relative(ROOT, path.resolve(input)).split(path.sep).join('/')));
  const vendored = VENDORED.filter(({ file }) => read.has(file)).map(({ name, file, from }) => ({
    title: name,
    license: 'MIT',
    text: vendoredNotice(fs.readFileSync(path.join(ROOT, file), 'utf8'), from),
  }));
  const section = ({ title, license, text }) =>
    [
      RULE,
      license ? `${title} (${license})` : title,
      RULE,
      '',
      text || `The package ships no license file: its package.json gives the license above.`,
      '',
    ].join('\n');
  return [
    'Third-party notices',
    '',
    `buddylist's own code is under the MIT License. It ships the code and media of others below, each under its own terms.${about ? `\n${about}` : ''}`,
    '',
    MEDIA,
    '',
    ...[...vendored, ...packages].map(section),
  ].join('\n');
}
