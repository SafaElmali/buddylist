// Classic-messenger emoticons: original yellow-smiley art (or the pictures in
// the user's pack), and turning text codes like ":)" into them.
import { packUrl } from '../../shared/pack.js';
import { availableEmoticons, codePattern, SAFE_CODES } from './emoticon-codes.js';
import { pack } from './pack.js';

const FACE_DEFS = `<defs>
  <radialGradient id="ef" cx=".38" cy=".3" r=".75"><stop offset="0" stop-color="#fffbd6"/><stop offset=".45" stop-color="#ffe44d"/><stop offset="1" stop-color="#f2a900"/></radialGradient>
  <radialGradient id="ea" cx=".38" cy=".3" r=".75"><stop offset="0" stop-color="#ffd9cc"/><stop offset=".45" stop-color="#ff7a5c"/><stop offset="1" stop-color="#c8261a"/></radialGradient>
  <linearGradient id="eh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a9a"/><stop offset=".5" stop-color="#e8202a"/><stop offset="1" stop-color="#9c0a12"/></linearGradient>
  <linearGradient id="eg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3c0"/><stop offset="1" stop-color="#f0b400"/></linearGradient>
</defs>`;

const face = (features, fill = 'ef', stroke = '#b77b00') =>
  `<circle cx="10" cy="10" r="8.6" fill="url(#${fill})" stroke="${stroke}" stroke-width=".9"/>` +
  `<ellipse cx="7.6" cy="5.4" rx="3.6" ry="2" fill="#fff" opacity=".55"/>${features}`;

const EYES =
  '<ellipse cx="7" cy="8" rx="1.05" ry="1.5" fill="#3b2600"/><ellipse cx="13" cy="8" rx="1.05" ry="1.5" fill="#3b2600"/>';
const SMILE =
  '<path d="M5.6 11.6Q10 16 14.4 11.6" stroke="#3b2600" stroke-width="1.2" fill="none" stroke-linecap="round"/>';
const FROWN =
  '<path d="M6.4 14.6Q10 11.2 13.6 14.6" stroke="#3b2600" stroke-width="1.2" fill="none" stroke-linecap="round"/>';

const ART = {
  smile: face(EYES + SMILE),
  grin: face(
    EYES +
      '<path d="M5 10.6Q10 18.6 15 10.6Z" fill="#7a2a00" stroke="#3b2600" stroke-width=".8" stroke-linejoin="round"/><path d="M5.8 11.2h8.4l-.6 1.4H6.4z" fill="#fff"/>'
  ),
  wink: face(
    '<path d="M5.6 8.4q1.4-1.3 2.8 0" stroke="#3b2600" stroke-width="1.2" fill="none" stroke-linecap="round"/><ellipse cx="13" cy="8" rx="1.05" ry="1.5" fill="#3b2600"/>' +
      SMILE
  ),
  sad: face(EYES + FROWN),
  tongue: face(
    EYES +
      '<path d="M6 11.8Q10 14.6 14 11.8" stroke="#3b2600" stroke-width="1.2" fill="none" stroke-linecap="round"/><path d="M8.6 13.1h3.4v1.6a1.7 1.7 0 0 1-3.4 0z" fill="#ff6f7d" stroke="#a3202e" stroke-width=".6"/>'
  ),
  surprised: face(
    '<ellipse cx="7" cy="7.6" rx="1.4" ry="2" fill="#3b2600"/><ellipse cx="13" cy="7.6" rx="1.4" ry="2" fill="#3b2600"/><ellipse cx="10" cy="13.4" rx="2.1" ry="2.5" fill="#7a2a00" stroke="#3b2600" stroke-width=".8"/>'
  ),
  angry: face(
    '<path d="M4.8 6.2l3.6 1.8M15.2 6.2l-3.6 1.8" stroke="#3b0a00" stroke-width="1.3" stroke-linecap="round"/><ellipse cx="7.2" cy="9.2" rx="1" ry="1.2" fill="#3b0a00"/><ellipse cx="12.8" cy="9.2" rx="1" ry="1.2" fill="#3b0a00"/><path d="M6.6 14.4Q10 12 13.4 14.4" stroke="#3b0a00" stroke-width="1.3" fill="none" stroke-linecap="round"/>',
    'ea',
    '#8f1a10'
  ),
  confused: face(
    EYES +
      '<path d="M5.8 13.2q1.4-1.4 2.8 0t2.8 0 2.8 0" stroke="#3b2600" stroke-width="1.2" fill="none" stroke-linecap="round"/>'
  ),
  embarrassed: face(
    '<path d="M5.8 8.6q1.2 1 2.4 0M11.8 8.6q1.2 1 2.4 0" stroke="#3b2600" stroke-width="1.1" fill="none" stroke-linecap="round"/><ellipse cx="5.4" cy="11.4" rx="1.9" ry="1.1" fill="#ff7b7b" opacity=".75"/><ellipse cx="14.6" cy="11.4" rx="1.9" ry="1.1" fill="#ff7b7b" opacity=".75"/><path d="M8 13.4q2 1.2 4 0" stroke="#3b2600" stroke-width="1.1" fill="none" stroke-linecap="round"/>'
  ),
  cool: face(
    '<path d="M3.4 7.2h13.2" stroke="#111" stroke-width="1.1"/><path d="M4 7.2h5.2v1.6a2.4 2.4 0 0 1-4.8 0zM10.8 7.2H16v1.6a2.4 2.4 0 0 1-4.8 0z" fill="#1a1a1a"/><path d="M5 7.8h1.6" stroke="#fff" stroke-width=".7" opacity=".7"/>' +
      SMILE
  ),
  crying: face(
    '<path d="M5.6 8.4q1.4-1.1 2.8 0M11.6 8.4q1.4-1.1 2.8 0" stroke="#3b2600" stroke-width="1.1" fill="none" stroke-linecap="round"/><path d="M6.4 10q-1.2 2.3 0 3.2 1.2-.9 0-3.2zM13.6 10q-1.2 2.3 0 3.2 1.2-.9 0-3.2z" fill="#55b4ff" stroke="#1f6fc0" stroke-width=".5"/>' +
      FROWN
  ),
  sleepy: face(
    '<path d="M5.6 8.4q1.4 1.1 2.8 0M11.6 8.4q1.4 1.1 2.8 0" stroke="#3b2600" stroke-width="1.1" fill="none" stroke-linecap="round"/><ellipse cx="10" cy="13.6" rx="1.4" ry="1.1" fill="#7a2a00"/><text x="13.4" y="5.6" font-size="5" font-weight="bold" font-family="Verdana" fill="#2a5ab8">z</text>'
  ),
  thinking: face(
    '<ellipse cx="7.4" cy="7" rx="1" ry="1.4" fill="#3b2600"/><ellipse cx="13.4" cy="7" rx="1" ry="1.4" fill="#3b2600"/><path d="M7.4 13.2h4.8" stroke="#3b2600" stroke-width="1.2" stroke-linecap="round"/><path d="M5.2 5q2-1.6 4 -.4" stroke="#3b2600" stroke-width=".9" fill="none" stroke-linecap="round"/>'
  ),
  heart:
    '<path d="M10 17.4S2.2 12.4 2.2 7.2A4 4 0 0 1 10 5.4a4 4 0 0 1 7.8 1.8c0 5.2-7.8 10.2-7.8 10.2z" fill="url(#eh)" stroke="#7a0610" stroke-width=".8"/><ellipse cx="6.4" cy="6.8" rx="2" ry="1.2" fill="#fff" opacity=".6"/>',
  brokenHeart:
    '<path d="M9.4 17S2.2 12.4 2.2 7.2A4 4 0 0 1 9.4 5l-1 3 2 2.2-1.6 2.4 1.2 1.6z" fill="url(#eh)" stroke="#7a0610" stroke-width=".8" stroke-linejoin="round"/><path d="M11.2 5.2a4 4 0 0 1 6.6 2c0 5-7 9.6-7 9.6l.8-3.4-1.2-1.6 1.6-2.4-2-2.2z" fill="url(#eh)" stroke="#7a0610" stroke-width=".8" stroke-linejoin="round"/>',
  thumbsUp:
    '<path d="M3 9h3.4v8.4H3z" fill="#4a8be0" stroke="#1d4f9c" stroke-width=".8"/><path d="M6.4 9.4 9.6 3.2c1.6-.4 2.4.8 2 2.4L11 8.4h4.4c1.3 0 2 1.2 1.6 2.4l-1.6 5.2c-.3.9-1 1.4-2 1.4H6.4z" fill="url(#eg)" stroke="#a87300" stroke-width=".8" stroke-linejoin="round"/>',
  thumbsDown:
    '<g transform="rotate(180 10 10)"><path d="M3 9h3.4v8.4H3z" fill="#4a8be0" stroke="#1d4f9c" stroke-width=".8"/><path d="M6.4 9.4 9.6 3.2c1.6-.4 2.4.8 2 2.4L11 8.4h4.4c1.3 0 2 1.2 1.6 2.4l-1.6 5.2c-.3.9-1 1.4-2 1.4H6.4z" fill="url(#eg)" stroke="#a87300" stroke-width=".8" stroke-linejoin="round"/></g>',
  star: '<path d="m10 1.8 2.5 5.3 5.8.7-4.3 4 1.1 5.7L10 14.7l-5.1 2.8 1.1-5.7-4.3-4 5.8-.7z" fill="url(#eg)" stroke="#a87300" stroke-width=".9" stroke-linejoin="round"/>',
  coffee:
    '<path d="M4 8h9.6v5.4a3.4 3.4 0 0 1-3.4 3.4H7.4A3.4 3.4 0 0 1 4 13.4z" fill="#fff" stroke="#5c4033" stroke-width=".9"/><path d="M13.6 9.4h1.2a2 2 0 0 1 0 4h-1.3" fill="none" stroke="#5c4033" stroke-width=".9"/><ellipse cx="8.8" cy="8.6" rx="4.2" ry=".9" fill="#6b3d1e"/><path d="M7 6.4q-1-1.4 0-2.6t0-2.4M10.4 6.4q-1-1.4 0-2.6t0-2.4" stroke="#9ab" stroke-width=".8" fill="none"/>',
  bulb: '<path d="M10 2a5.4 5.4 0 0 0-3.2 9.8V13.6h6.4v-1.8A5.4 5.4 0 0 0 10 2z" fill="url(#eg)" stroke="#a87300" stroke-width=".9"/><rect x="6.8" y="13.6" width="6.4" height="3.6" rx="1" fill="#b8c2cc" stroke="#69737d" stroke-width=".7"/><path d="M8.4 9.6 10 11.2l1.6-1.6" stroke="#a87300" stroke-width=".7" fill="none"/>',
  gift: '<rect x="3" y="8" width="14" height="9" fill="#e8302c" stroke="#8f120e" stroke-width=".8"/><rect x="2.4" y="5.6" width="15.2" height="3" fill="#ff5b4f" stroke="#8f120e" stroke-width=".8"/><path d="M10 5.6V17" stroke="#ffd34d" stroke-width="2.4"/><path d="M10 5.6Q6 1 5.4 4.2 6 6 10 5.6q4 .4 4.6-1.4Q14 1 10 5.6z" fill="#ffd34d" stroke="#a87300" stroke-width=".6"/>',
  cake: '<rect x="3.4" y="10" width="13.2" height="7" rx="1" fill="#f9d7a7" stroke="#8a5a1a" stroke-width=".8"/><path d="M3.4 12.4q2.2 1.4 4.4 0t4.4 0 4.4 0" stroke="#ff7ba8" stroke-width="1.6" fill="none"/><rect x="9.2" y="5.4" width="1.6" height="4.6" fill="#7fb8ff" stroke="#2a68c8" stroke-width=".5"/><path d="M10 2.2q-1.4 1.8 0 3 1.4-1.2 0-3z" fill="#ffb31a"/>',
};

const uris = new Map();
function dataUri(name) {
  if (!uris.has(name)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">${FACE_DEFS}${ART[name]}</svg>`;
    uris.set(name, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  }
  return uris.get(name);
}

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * <img> markup for one emoticon.
 * @param {{ name: string, title: string, file: string | null }} emoticon
 * @param {string} code  the code as it was typed
 */
function emoticonImg({ name, title, file }, code) {
  const src = file ? packUrl('emoticons', file) : dataUri(name);
  return `<img class="emoticon" src="${src}" alt="${escapeAttr(code)}" title="${escapeAttr(`${title} ${code}`)}" draggable="false">`;
}

// Everything derived from the emoticons on offer, rebuilt if the pack changes.
let tables = null;
function current() {
  const files = pack().emoticons;
  if (tables?.files !== files) {
    const list = availableEmoticons(files, (name) => name in ART);
    const byCode = new Map(list.flatMap((e) => e.codes.map((code) => [code.toLowerCase(), e])));
    tables = {
      files,
      list,
      byCode,
      full: codePattern([...byCode.keys()]),
      safe: codePattern(SAFE_CODES.filter((code) => byCode.has(code.toLowerCase()))),
    };
  }
  return tables;
}

/** The picker: one entry per picture, with the code that inserts it. */
export const picker = () => current().list.map((e) => ({ ...e, img: emoticonImg(e, e.code) }));

/**
 * Replace emoticon codes inside text nodes (skipping code, links, pre, the names of files and the conversations
 * a message tags).
 * @param {HTMLElement} root
 * @param {{ safe?: boolean }} [opts]
 */
export function emoticonize(root, { safe = false } = {}) {
  const { byCode, full, safe: safePattern } = current();
  const re = safe ? safePattern : full;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('code, pre, a, textarea, .file-mention, .conversation-tag, .terminal-output')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    re.lastIndex = 0;
    if (!re.test(text)) continue;
    re.lastIndex = 0;
    const span = document.createElement('span');
    let last = 0;
    let markup = '';
    for (const match of text.matchAll(re)) {
      const start = match.index + match[1].length;
      const code = match[2];
      markup +=
        escapeAttr(text.slice(last, start)).replace(/>/g, '&gt;') + emoticonImg(byCode.get(code.toLowerCase()), code);
      last = start + code.length;
    }
    markup += escapeAttr(text.slice(last)).replace(/>/g, '&gt;');
    span.innerHTML = markup;
    node.replaceWith(...span.childNodes);
  }
}
