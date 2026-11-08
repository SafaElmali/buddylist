// Choosing a display picture: the contact's built-in ones and the pictures
// in the user's pack, as a grid of thumbnails.
import { fileTitle, PACK_AVATAR } from '../../shared/pack.js';
import { api } from './api.js';
import { el } from './dom.js';
import { closeMenu, openGrid } from './menu.js';
import { pack } from './pack.js';
import { pictureHtml } from './pictures.js';

/** @typedef {{ avatar: string, label: string }} PictureChoice */

/** @returns {PictureChoice[]} */
const packPictures = () => pack().pictures.map((file) => ({ avatar: `${PACK_AVATAR}${file}`, label: fileTitle(file) }));

/**
 * The pictures a contact can have.
 * @param {import('../../providers/contract.js').ProviderDescriptor} provider
 * @returns {PictureChoice[]}
 */
export const avatarChoices = (provider) => [
  ...provider.avatars.map(({ id, label }) => ({ avatar: id, label })),
  ...packPictures(),
];

/**
 * @param {Element} anchor
 * @param {object} opts
 * @param {PictureChoice[]} opts.choices
 * @param {string} [opts.current]  the avatar in use
 * @param {(avatar: string) => void} opts.pick
 * @param {() => void} [opts.browse]  adds a Browse button
 */
export function openPicturePicker(anchor, { choices, current, pick, browse }) {
  let footer;
  if (browse) {
    footer = el('<div class="popup-foot"><button class="btn" type="button">Browse...</button></div>');
    footer.querySelector('button').addEventListener('click', () => {
      closeMenu();
      browse();
    });
  }
  openGrid(
    anchor,
    choices.map(({ avatar, label }) => ({
      markup: pictureHtml({ avatar, size: 'small' }),
      caption: label,
      current: avatar === current,
      pick: () => pick(avatar),
    })),
    { className: 'picture-grid', footer }
  );
}

/** Change your own picture: one from the pack, or any file. */
export function changeMyPicture(anchor) {
  const choices = packPictures();
  if (!choices.length) return api.profile.choosePicture();
  return openPicturePicker(anchor, {
    choices,
    pick: (avatar) => api.profile.usePackPicture(avatar.slice(PACK_AVATAR.length)),
    browse: () => api.profile.choosePicture(),
  });
}
