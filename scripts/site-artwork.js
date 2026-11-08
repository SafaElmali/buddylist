// The app's own artwork, by the tokens a page writes for it: __TB_INVITE__, __EMO_SMILE__ and so
// on. The landing page uses them.
import fs from 'node:fs';
import { picker } from '../src/renderer/lib/emoticons.js';
import {
  appMark,
  buddy,
  listIcon,
  nextGlyph,
  smallIcon,
  tagIcon,
  toolbarIcon,
  windowGlyph,
} from '../src/renderer/lib/icons.js';

// "newChat" -> "NEW_CHAT": how an icon's name reads in a token.
const tokenName = (name) => name.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();

/** A token for every picture in a set: `prefix` and the picture's name, such as __TB_NEW_CHAT__. */
const pictures = (prefix, set) =>
  Object.fromEntries(Object.entries(set).map(([name, draw]) => [`${prefix}_${tokenName(name)}`, draw]));

const STATUSES = ['online', 'busy', 'away', 'offline'];

/** The buddy in each status as a <symbol>, for the rows that change status while the page is open. */
const buddySymbols = () =>
  STATUSES.map((status) =>
    buddy(status)
      .replace(/<svg[^>]*>/, `<symbol id="b-${status}" viewBox="0 0 16 16">`)
      .replace('</svg>', '</symbol>')
  ).join('');

/**
 * The professional look's line icons, from the app's own stylesheet, for a window drawn in it
 * (`.look-pro`), and for the page's own icons beside it (`.pro-icons`): each icon of the messenger is
 * masked with the line drawing that stands in for it.
 */
function proIcons() {
  const css = fs.readFileSync(new URL('../src/renderer/styles/pro.css', import.meta.url), 'utf8');
  const drawings = css.match(/--draw-[\w-]+:\s*url\("[^"]*"\);/g);
  const icons = [...css.matchAll(/\[data-icon='([\w-]+)'\]\s*\{\s*--icon:\s*(var\(--draw-[\w-]+\));\s*\}/g)].map(
    ([, name, drawing]) => `:is(.look-pro, .pro-icons) [data-icon='${name}'] { --icon: ${drawing}; }`
  );
  return [`:is(.look-pro, .pro-icons) { ${drawings.join(' ')} }`, ...icons].join('\n');
}

// Each token is drawn anew wherever it stands, because every drawing has gradients with ids of its own.
export const artworkTokens = {
  ICON_MARK: () => appMark(16),
  ICON_TRAY: () => appMark(38),
  BUDDY_SYMBOLS: buddySymbols,
  PRO_ICONS: proIcons,
  ...Object.fromEntries(STATUSES.map((status) => [`BUDDY_${status.toUpperCase()}`, () => buddy(status, 38)])),
  ...pictures('WIN', windowGlyph),
  ...pictures('TB', toolbarIcon),
  ...pictures('SM', smallIcon),
  ...pictures('LI', listIcon),
  ...pictures('TAG', tagIcon),
  ...pictures('NEXT', nextGlyph),
  ...Object.fromEntries(picker().map((emoticon) => [`EMO_${tokenName(emoticon.name)}`, () => emoticon.img])),
};

/**
 * Writes each token's drawing in its place, and stops on a token it doesn't know.
 * A token is capitals with single underscores between them, so two can stand side by side.
 * @param {string} page
 * @param {Record<string, () => string>} tokens
 * @param {string} file  the page, named in the error
 */
export const fillTokens = (page, tokens, file) =>
  page.replace(/__([A-Z]+(?:_[A-Z]+)*)__/g, (_match, name) => {
    if (!(name in tokens)) throw new Error(`${file} uses an unknown token: __${name}__`);
    return tokens[name]();
  });
