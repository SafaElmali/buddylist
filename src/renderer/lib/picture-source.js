import { PICTURE_REFERENCE } from '../../shared/pictures.js';

/** Resolve a saved attachment only when it is opened, copied, downloaded or sent again. */
export const pictureSource = (source) =>
  PICTURE_REFERENCE.test(source) ? window.messenger.app.readPicture(source) : Promise.resolve(source);

/**
 * A picture to look at: its address, or its original with a preview to fall back on. `img`: the picture of the page
 * it is of, which the viewer offers to reply with where the page does (see offerReplies in picture-viewer.js).
 * @typedef {string | { src?: string, preview?: string, img?: HTMLImageElement }} PictureSource
 */

/** A preview is an explicit fallback, never described as a recovered original. */
export async function loadPicture(source) {
  const { src, preview } = typeof source === 'string' ? { src: source } : source;
  try {
    if (!src) throw new Error('Only the preview was saved.');
    return { src: await pictureSource(src), previewOnly: false };
  } catch (error) {
    if (!preview) throw error;
    return { src: preview, previewOnly: true };
  }
}
