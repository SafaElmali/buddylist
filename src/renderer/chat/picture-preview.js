// A compact preview kept with the message. The original is stored separately for viewing and
// sent to the agent; this deliberately smaller copy must never replace it.
import { MAX_PICTURE_BYTES } from '../../shared/pictures.js';
import { bytesOf, written } from './screenshot-notes.js';

/** A preview fits in this many pixels each way: twice what a line shows of it, for sharp screens. */
export const PREVIEW_PX = 640;
/** A picture that fits already is kept as it is, animation and all, unless it is bigger than this. */
const KEEP_BYTES = 256 * 1024;

/**
 * How big a picture's preview is: as big as it is, or made smaller to fit.
 * @param {number} width
 * @param {number} height
 */
export function previewSize(width, height) {
  const scale = Math.min(1, PREVIEW_PX / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * The preview of a picture, as a data: URL. Null when it can't be read as one.
 * @param {Blob} file  a File, or a picture picked with Send Files
 * @param {string} url  the file itself, as a data: URL
 */
export async function previewOf(file, url) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const { width, height } = previewSize(bitmap.width, bitmap.height);
    if (width === bitmap.width && height === bitmap.height && file.size <= KEEP_BYTES) return url;
    const canvas = Object.assign(document.createElement('canvas'), { width, height });
    const pen = canvas.getContext('2d');
    pen.imageSmoothingQuality = 'high';
    pen.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL('image/webp', 0.9);
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

/** Resending a saved screenshot keeps its full source while applying the same provider size limit. */
export async function pictureToSend(url) {
  if (bytesOf(url) <= MAX_PICTURE_BYTES) {
    return { mediaType: url.slice(5, url.indexOf(';')), data: url.split(',')[1] };
  }
  const image = Object.assign(new Image(), { src: url });
  await image.decode();
  const sent = written(({ type, quality, scale }) => {
    const canvas = Object.assign(document.createElement('canvas'), {
      width: Math.max(1, Math.round(image.naturalWidth * scale)),
      height: Math.max(1, Math.round(image.naturalHeight * scale)),
    });
    const pen = canvas.getContext('2d');
    pen.imageSmoothingQuality = 'high';
    pen.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(type, quality);
  });
  return { ...sent, original: url };
}
