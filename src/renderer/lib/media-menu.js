// What a right-click on a picture, a video or a sound offers: Copy image for a picture, and Download for any of
// them, to a file as it was sent or written (see main/media.js). On a picture in a conversation or over the whole
// window, on a row of the Shared tab, and on a file, in All files, the Changes tab or a link to it. On a picture of
// the conversation, Reply with this picture comes first (see chat/picture-reply.js). The buttons that download what
// an agent shares, where it is seen, download the same way (see chat/media-downloads.js and picture-viewer.js).
import { mediaKind } from '../../shared/media.js';
import { infoDialog, messageBody } from './dialog.js';
import { errorText } from './dom.js';
import { smallIcon } from './icons.js';
import { pictureSource } from './picture-source.js';

/** What the menu, the button on a picture and the picture viewer call replying with it. */
export const REPLY_WITH_PICTURE = 'Reply with this picture';

/** A picture drawn from SVG, as a diagram is: it has no pixels of its own, so it is copied as sharp as the screen shows it. */
export const SVG = /^data:image\/svg\+xml[;,]|\.svg$/i;

/**
 * A picture drawn on a canvas as big as it is: one drawn from SVG as sharp as the screen shows it. An animated one is
 * drawn as it first shows. It fails for one that can't be loaded, and its canvas can't be read for one from the web.
 * @param {string} src  a data: or file: address
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function pictureCanvas(src) {
  const img = Object.assign(new Image(), { src });
  await img.decode();
  const scale = SVG.test(src) ? devicePixelRatio : 1;
  const canvas = Object.assign(document.createElement('canvas'), {
    width: Math.round(img.naturalWidth * scale),
    height: Math.round(img.naturalHeight * scale),
  });
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Puts a picture on the clipboard as a PNG, as big as it is: what every app takes a pasted picture as.
 * An animated one is copied as it first shows.
 * @param {string} src  a data: or file: address
 */
export async function copyImage(src) {
  const canvas = await pictureCanvas(await pictureSource(src));
  const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('This picture could not be copied.');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  window.messenger.app.used('image copied').catch(() => {});
}

/** Says why it could not be copied or downloaded, as a file that could not be opened does. */
const failed = (err) => infoDialog('buddylist', messageBody(errorText(err)));

/**
 * Downloads a picture, a video or a sound as it was sent or written, to a file the save dialog names. One that can't
 * be says why.
 * @param {string} address  a data: or file: address, or a reference to an original kept with the history
 * @param {string} [name]  what its file is called to start with, where its address doesn't say (see pictureName)
 */
export const download = (address, name) =>
  pictureSource(address)
    .then((source) => window.messenger.app.download(source, name))
    .catch(failed);

/**
 * Downloads pictures all at once, each as it was handed back, to a folder asked for once (see main/media.js).
 * @param {{ address: string, name?: string }[]} pictures
 * @returns {Promise<{ saved: number, failed: number, folder: string } | null | undefined>}  how it went; null when
 *   the folder dialog was called off, undefined when it could not be done, which is said
 */
export const downloadAll = (pictures) =>
  Promise.all(pictures.map(async ({ address, name }) => ({ address: await pictureSource(address), name })))
    .then((items) => window.messenger.app.downloadAll(items))
    .catch(failed);

/**
 * What a picture of the conversation is called once downloaded, where its address doesn't say: the name its row gave
 * a call's picture (see thumbnails in activity.js), or a diagram as one. Undefined for the rest, which are called for
 * their file or their kind (see main/media.js).
 * @param {HTMLImageElement | null | undefined} img
 * @returns {string | undefined}
 */
export const pictureName = (img) => img?.dataset?.name || (img?.closest?.('figure.diagram') ? 'diagram' : undefined);

/**
 * What a right-click on a picture, a video or a sound offers. Nothing for anything else, as a text file.
 * @param {string} address  where it is: a data: or a file: address
 * @param {{ disabled?: boolean, reply?: (() => void) | null, name?: string }} [opts]  `disabled`: it is not there to
 *   copy, as a file deleted in the Changes tab. `reply`: what Reply with this picture does, for a picture of the
 *   conversation. `name`: what Download calls it to start with (see pictureName)
 * @returns {import('./menu.js').MenuItem[]}
 */
export function mediaItems(address, { disabled = false, reply = null, name } = {}) {
  const kind = mediaKind(address);
  if (!kind) return [];
  return [
    ...(kind === 'image' && reply ? [{ label: REPLY_WITH_PICTURE, icon: smallIcon.comment(), action: reply }] : []),
    ...(kind === 'image' ? [{ label: 'Copy image', disabled, action: () => copyImage(address).catch(failed) }] : []),
    { label: `Download ${kind}...`, disabled, action: () => download(address, name) },
  ];
}
