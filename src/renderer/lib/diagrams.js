// Diagrams in replies: a code block in Mermaid, the language agents write diagrams in, is drawn as
// the diagram it describes once its fence is closed. Until then, and if it can't be drawn, it is
// the code block it always was. Mermaid is bigger than all the rest of the window, so it is loaded
// the first time a reply has a diagram.
//
// A drawn diagram is a picture: an SVG in an <img>, which runs nothing, loads nothing, and can't
// reach the window nor be reached by its styles. It is drawn in the colours of the window's look
// and theme, and again when they change. A click shows it over the whole window, as a picture.
import { el, escapeHtml, html, raw } from './dom.js';
import { smallIcon } from './icons.js';
import { viewPictures } from './picture-viewer.js';

/** The language a code block names to be drawn as a diagram. */
const LANGUAGE = 'mermaid';

/** The class of a code block to be drawn: the one class a reply's code keeps besides its colours (see markdown.js). */
export const DIAGRAM_CLASS = `language-${LANGUAGE}`;

/** How big a diagram's words are, in pixels: a little bigger than a reply's own. */
export const FONT_SIZE = 14;

/** How long Copy source says that it copied. */
const COPIED_MS = 1500;

/**
 * The colours and type a diagram is drawn in, as chat.css gives them to one (`.diagram`).
 * @typedef {{ dark: boolean, font: string, paper: string, box: string, boxEdge: string, panel: string,
 *   panelEdge: string, ink: string, line: string }} DiagramTheme
 */

/**
 * A diagram drawn, as a picture to show in its code block's place; or why it could not be.
 * @typedef {{ src: string, width: number, height: number } | { error: string }} Drawing
 */

/**
 * Whether a code block is a diagram, by the language it says it is written in.
 * @param {string} language  the first word after its fence, in any case
 */
export const isDiagram = (language) => language.toLowerCase() === LANGUAGE;

/**
 * Whether a fenced code block is closed. A reply still being written can have one that isn't
 * yet, which Markdown reads to its end all the same.
 * @param {string} written  the block as it was written: its opening fence, its code, and its closing fence if it has one
 */
export function fenceClosed(written) {
  const lines = written.replace(/\n+$/, '').split('\n');
  const fence = lines[0].match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
  if (!fence || lines.length < 2) return false;
  // Closed by a fence of the same character, at least as long, with nothing after it.
  return new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`).test(lines.at(-1));
}

/**
 * A diagram's code block, as a reply's HTML has it. Only a closed one is marked to be drawn: one
 * still being written says only part of what it will.
 * @param {string} text  its code
 * @param {string} written  the whole block as it was written (see `fenceClosed`)
 */
export function diagramCode(text, written) {
  const code = escapeHtml(text.replace(/\n$/, ''));
  const drawn = text.trim() !== '' && fenceClosed(written);
  return `<pre><code${drawn ? ` class="${DIAGRAM_CLASS}"` : ''}>${code}\n</code></pre>\n`;
}

/**
 * What Mermaid is set up with. Strict: what a diagram says is only ever words, never markup, a
 * script or a link. And in the window's colours, which Mermaid turns into the rest it needs,
 * such as a chart's.
 * @param {DiagramTheme} theme
 */
export const mermaidConfig = (theme) => ({
  startOnLoad: false,
  securityLevel: 'strict',
  // A diagram it can't read is said to be one, and its code block stays: no picture of an error.
  suppressErrorRendering: true,
  theme: 'base',
  fontFamily: theme.font,
  fontSize: FONT_SIZE,
  themeVariables: {
    darkMode: theme.dark,
    background: theme.paper,
    fontFamily: theme.font,
    fontSize: `${FONT_SIZE}px`,
    primaryColor: theme.box,
    primaryBorderColor: theme.boxEdge,
    // A box's edge is the one colour all round, not shading into a colour of Mermaid's own.
    useGradient: false,
    primaryTextColor: theme.ink,
    textColor: theme.ink,
    lineColor: theme.line,
    clusterBkg: theme.panel,
    clusterBorder: theme.panelEdge,
    edgeLabelBackground: theme.panel,
  },
});

/**
 * How big a diagram was drawn, by its SVG's view box.
 * @param {string | null} viewBox  such as `0 0 523.5 400`
 * @returns {{ width: number, height: number } | null}  in whole pixels; null for none that says
 */
export function drawnSize(viewBox) {
  const [, , width, height] = String(viewBox ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return width > 0 && height > 0 ? { width: Math.ceil(width), height: Math.ceil(height) } : null;
}

/**
 * Why a diagram could not be drawn, in a line. Mermaid says where a diagram stopped making sense,
 * then shows the place on the lines after.
 * @param {unknown} error
 */
export const failure = (error) =>
  String(/** @type {any} */ (error)?.message ?? error ?? '')
    .split('\n')[0]
    .replace(/[\s:.]+$/, '')
    .slice(0, 160);

/** @type {Promise<any> | null} Mermaid, from the first time a reply has a diagram */
let loading = null;
/** The colours Mermaid was last set up with, as `themeKey` writes them. */
let setUpIn = '';
/** How many diagrams were drawn: each is drawn with a name of its own. */
let drawnCount = 0;
/** The colours the drawings below are in, as `themeKey` writes them. */
let drawingsIn = '';
/**
 * The diagrams drawn in the window's colours, by their code, or still being drawn. A reply that is
 * drawn again, as one is when it is done, has its diagrams at once.
 * @type {Map<string, Drawing | Promise<Drawing>>}
 */
const drawings = new Map();
/** @type {WeakMap<Element, string>} the code each diagram in the window was drawn from */
const SOURCES = new WeakMap();

/** The colours and type of a diagram in the window's look and theme, as they are now. @returns {DiagramTheme} */
function currentTheme() {
  // Read from one that is never seen: chat.css gives every diagram the same.
  const probe = document.body.appendChild(el('<figure class="diagram" hidden></figure>'));
  const style = getComputedStyle(probe);
  const colour = (name) => style.getPropertyValue(`--diagram-${name}`).trim();
  const theme = {
    dark: style.colorScheme.includes('dark'),
    font: style.fontFamily,
    paper: colour('paper'),
    box: colour('box'),
    boxEdge: colour('box-edge'),
    panel: colour('panel'),
    panelEdge: colour('panel-edge'),
    ink: colour('ink'),
    line: colour('line'),
  };
  probe.remove();
  return theme;
}

/** @param {DiagramTheme} theme */
const themeKey = (theme) => JSON.stringify(theme);

/**
 * `source`, drawn in `theme` as a picture of its own.
 * @param {string} source
 * @param {DiagramTheme} theme
 * @returns {Promise<Drawing>}
 */
async function draw(source, theme) {
  try {
    loading ??= import('../../../node_modules/mermaid/dist/mermaid.esm.min.mjs').then((module) => module.default);
    const mermaid = await loading;
    watchTheme();
    if (setUpIn !== themeKey(theme)) {
      mermaid.initialize(mermaidConfig(theme));
      setUpIn = themeKey(theme);
    }
    const { svg } = await mermaid.render(`diagram-${++drawnCount}`, source);
    return pictureOf(svg, theme.paper);
  } catch (error) {
    return { error: failure(error) };
  }
}

/**
 * A drawn diagram as a picture of its own: as big as it was drawn, on its paper. Written out as XML,
 * as a picture must be: Mermaid writes the words in its boxes as HTML, where a <br> has no end.
 * @param {string} markup  the SVG Mermaid drew
 * @param {string} paper
 * @returns {Drawing}
 */
function pictureOf(markup, paper) {
  const svg = new DOMParser().parseFromString(markup, 'text/html').querySelector('svg');
  const size = svg && drawnSize(svg.getAttribute('viewBox'));
  if (!size) return { error: '' };
  svg.setAttribute('width', String(size.width));
  svg.setAttribute('height', String(size.height));
  svg.style.maxWidth = '';
  svg.style.backgroundColor = paper;
  const xml = new XMLSerializer().serializeToString(svg);
  return { src: `data:image/svg+xml,${encodeURIComponent(xml)}`, ...size };
}

/**
 * `source` drawn in the window's colours: at once if it was drawn in them before, else once it is.
 * @param {string} source
 * @returns {Drawing | Promise<Drawing>}
 */
function drawing(source) {
  const theme = currentTheme();
  // Drawings in other colours are of no more use.
  if (drawingsIn !== themeKey(theme)) {
    drawings.clear();
    drawingsIn = themeKey(theme);
  }
  const known = drawings.get(source);
  if (known) return known;
  const drawn = draw(source, theme).then((result) => {
    if (drawings.get(source) === drawn) drawings.set(source, result);
    return result;
  });
  drawings.set(source, drawn);
  return drawn;
}

/** Copies a diagram's source, as a message's Copy copies its words, and counts it with them. @param {string} source */
async function copySource(source) {
  // Asked for here: the bridge it counts copies through is there only in a window, and tests read this file too.
  const { copyText } = await import('./copy-folder.js');
  await copyText(source, 'diagram');
}

/**
 * A diagram where its code block was. Click it to see it over the whole window; Copy source is in
 * its corner while the pointer is on it.
 * @param {string} source
 * @param {{ src: string, width: number, height: number }} picture
 */
function figureOf(source, { src, width, height }) {
  const figure = el(
    html`<figure class="diagram">
      <img src="${src}" width="${width}" height="${height}" alt="Diagram" title="View diagram" />
      <button class="diagram-copy" type="button" title="Copy source" aria-label="Copy source">
        ${raw(smallIcon.copy())}
      </button>
    </figure>`
  );
  SOURCES.set(figure, source);
  const img = /** @type {HTMLImageElement} */ (figure.querySelector('img'));
  const copy = /** @type {HTMLButtonElement} */ (figure.querySelector('.diagram-copy'));
  // A press leaves the focus where it was, the message box say, to be there again once the diagram is closed.
  for (const pressed of [img, copy]) pressed.addEventListener('mousedown', (e) => e.preventDefault());
  img.addEventListener('click', () =>
    viewPictures([{ src: img.src, img }], 0, {
      kind: 'Diagram',
      copy: { label: 'Copy source', run: () => copySource(source) },
    })
  );
  let copied;
  copy.addEventListener('click', async () => {
    await copySource(source);
    copy.replaceChildren(el(smallIcon.check()));
    copy.title = 'Copied';
    clearTimeout(copied);
    copied = setTimeout(() => {
      copy.replaceChildren(el(smallIcon.copy()));
      copy.title = 'Copy source';
    }, COPIED_MS);
  });
  return figure;
}

/**
 * Shows a diagram as it was drawn, in its code block's place: or, if it could not be, says so under the block.
 * @param {HTMLElement} pre  its code block
 * @param {string} source
 * @param {Drawing} drawn
 */
function show(pre, source, drawn) {
  if (!pre.parentNode) return;
  if (!('error' in drawn)) return void pre.replaceWith(figureOf(source, drawn));
  const why = drawn.error ? `: ${drawn.error}` : '';
  pre.after(el(html`<div class="diagram-note">This diagram could not be drawn${why}.</div>`));
}

/**
 * Draws the diagrams in a reply that was just rendered, each over its code block. One drawn
 * before in these colours is there at once; another once it is drawn, with `around`.
 * @param {HTMLElement} root
 * @param {(paint: () => void) => void} [around]  wraps a diagram put in later, e.g. to keep the
 *   conversation scrolled to the bottom
 */
export function drawDiagrams(root, around = (paint) => paint()) {
  for (const code of root.querySelectorAll(`pre > code.${DIAGRAM_CLASS}`)) {
    const pre = /** @type {HTMLElement} */ (code.parentElement);
    const source = code.textContent.replace(/\n$/, '');
    const drawn = drawing(source);
    if (drawn instanceof Promise) drawn.then((result) => around(() => show(pre, source, result)));
    else show(pre, source, drawn);
  }
}

let watching = false;

/** Every diagram in the window is drawn again in the colours of another look, palette or colour scheme. */
function watchTheme() {
  if (watching) return;
  watching = true;
  const redraw = () => {
    for (const figure of document.querySelectorAll('figure.diagram')) {
      const source = SOURCES.get(figure);
      if (source === undefined) continue;
      // In its picture's place: a change of the palette and one of the colour scheme can come one
      // after the other, and the picture drawn last is the one in the colours of both.
      Promise.resolve(drawing(source)).then((drawn) => {
        if ('error' in drawn) return;
        const img = /** @type {HTMLImageElement} */ (figure.querySelector('img'));
        Object.assign(img, { src: drawn.src, width: drawn.width, height: drawn.height });
      });
    }
  };
  // The look and the palette are marked on the page (see look.js); light or dark is the colour scheme.
  new MutationObserver(redraw).observe(document.documentElement, { attributeFilter: ['data-look', 'data-palette'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
}
