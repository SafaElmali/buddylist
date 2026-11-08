// A picture in the message box, over the whole window to draw notes on before it is sent: a line
// drawn freehand, a box, an arrow and a few words, as on a screenshot of a page (see screenshot.js).
// Done puts the notes on the picture itself, at as many pixels as it has, to go in its place in the
// box. Cancel, or Esc, leaves it as it was. Drawn on again later, the notes from before are part of it.
import { el, html } from '../lib/dom.js';
import { Screenshot } from './screenshot.js';
import { writingsFor } from './screenshot-notes.js';

/** Room left around the picture, in its sheet. */
const INSET = 16;

/** @typedef {{ mediaType: string, data: string, original?: string }} DrawnPicture  as it goes into the box */

/**
 * Opens a picture to draw on: as big as it is, or smaller to fit the window, in a sheet with the
 * tools over it.
 * @param {string} src  the picture, as a data: URL
 * @returns {Promise<DrawnPicture | null>}  the picture with the notes on it, or null when called off
 */
export async function drawOnPicture(src) {
  const picture = Object.assign(new Image(), { src });
  await picture.decode();
  const type = src.slice(5, src.indexOf(';'));
  return new Promise((resolve) => {
    const node = el(
      html`<div class="modal picture-drawing">
        <div class="dialog" role="dialog" aria-modal="true" aria-label="Draw on the picture">
          <div class="dialog-title titlebar-like">Draw on the picture</div>
        </div>
      </div>`
    );
    /** @param {DrawnPicture | null} drawn */
    const finish = (drawn) => {
      sheet.close();
      node.remove();
      resolve(drawn);
    };
    const sheet = new Screenshot(
      picture,
      {
        size: { width: picture.naturalWidth, height: picture.naturalHeight },
        inset: INSET,
        name: 'Picture',
        done: 'Done',
        writings: writingsFor(type),
      },
      // Done with nothing drawn changes nothing: the picture stays as it was, not written again.
      { add: (drawn) => finish(sheet.empty ? null : drawn), cancel: () => finish(null) }
    );
    node.querySelector('.dialog').append(sheet.node);
    document.body.append(node);
    sheet.focus();
  });
}
