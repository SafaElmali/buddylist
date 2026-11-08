// What goes into a message as a picture, rather than as an @mention of its file: the kinds of
// picture every agent takes, up to the size it takes.

export const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const MAX_PICTURE_BYTES = 5 * 1024 * 1024;

/** A supported picture handed over whole, and an original kept beside the conversation history. */
export const PICTURE_DATA = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+=*)$/;
export const PICTURE_REFERENCE = /^picture:([a-f0-9]{64}\.(png|jpg|gif|webp))$/;

/** Keep preview/original pairs aligned, including a supported file whose thumbnail could not be made. */
export function sentPictures(images) {
  const shown = images
    .map(({ preview, mediaType, data, original: full }) => {
      const source = `data:${mediaType};base64,${data}`;
      const original = PICTURE_DATA.test(full) ? full : PICTURE_DATA.test(source) ? source : null;
      return { preview: PICTURE_DATA.test(preview) ? preview : original, original };
    })
    .filter(({ preview }) => preview);
  return { pictures: shown.map(({ preview }) => preview), originals: shown.map(({ original }) => original) };
}
