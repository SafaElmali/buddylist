// The top of the contact list: your picture, name, status and personal message,
// and the line that counts the pull requests waiting for your review.
import { api } from '../lib/api.js';
import { $, el, html } from '../lib/dom.js';
import { emoticonize } from '../lib/emoticons.js';
import { plural } from '../lib/format.js';
import { buddy, listIcon } from '../lib/icons.js';
import { openMenu } from '../lib/menu.js';
import { changeMyPicture } from '../lib/picture-picker.js';
import { pictureHtml } from '../lib/pictures.js';
import { CONNECT_TEXT, connectTitle } from '../../shared/github-connect.js';
import { STATUSES } from '../../shared/presence.js';
import { githubDialog } from './github-dialog.js';

// The buddy each status wears in the menu. What a status does is in shared/presence.js.
const ICONS = {
  online: 'online',
  busy: 'busy',
  brb: 'away',
  away: 'away',
  phone: 'busy',
  lunch: 'away',
  offline: 'offline',
};

export const MY_STATUSES = STATUSES.map(({ id, label }) => ({ id, label, icon: ICONS[id] }));

export class ProfileHeader {
  constructor({ settings, platform }) {
    this.settings = settings;
    this.platform = platform;
    this.song = null;
    this.profile = null;
    /** @type {import('../../main/review-requests.js').ReviewSummary | null} */
    this.reviews = null;
    $('#reviews-icon').innerHTML = listIcon.envelope();
    $('#reviews').addEventListener('click', () => this.openReviews());
    $('#my-picture').addEventListener('click', () => this.changePicture());
    $('#status-button').addEventListener('click', () => this.openStatusMenu());
    // The personal message shows emoticons, and turns into a text box when clicked.
    const view = $('#my-pm-view');
    const pm = /** @type {HTMLInputElement} */ ($('#my-pm'));
    const edit = () => {
      view.hidden = true;
      pm.hidden = false;
      pm.value = this.profile.personalMessage || '';
      pm.focus();
      pm.select();
    };
    view.addEventListener('click', edit);
    view.addEventListener('keydown', (e) => e.key === 'Enter' && edit());
    pm.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        if (e.key === 'Escape') pm.value = this.profile.personalMessage || '';
        pm.blur();
      }
    });
    pm.addEventListener('blur', () => {
      pm.hidden = true;
      view.hidden = false;
      if (pm.value !== (this.profile.personalMessage || '')) api.profile.update({ personalMessage: pm.value });
      else this.#renderMessage();
    });
  }

  #renderMessage() {
    const view = $('#my-pm-view');
    const song = this.settings().showListening === true ? this.song : null;
    const text = song ? `♫ ${song.title}${song.artist ? ` — ${song.artist}` : ''}` : this.profile.personalMessage || '';
    view.classList.toggle('empty', !text);
    view.textContent = text || '<Type a personal message>';
    view.title = song
      ? `${song.player === 'Music' ? 'Apple Music' : song.player}: ${text.slice(2)}\nChange your personal message`
      : 'Change your personal message';
    if (text && !song) emoticonize(view);
  }

  /** The song is temporary; editing the personal message still edits the saved text. */
  renderListening(song = this.song) {
    this.song = song;
    if (this.profile && document.activeElement !== $('#my-pm')) this.#renderMessage();
  }

  render(profile) {
    this.profile = profile;
    const status = MY_STATUSES.find((s) => s.id === profile.status) || MY_STATUSES[0];
    $('#my-picture').innerHTML = pictureHtml({
      src: profile.picture,
      size: 'medium',
      title: 'Change your display picture',
    });
    $('#my-name').textContent = profile.name;
    $('#my-status').textContent = `(${status.label})`;
    if (document.activeElement !== $('#my-pm')) this.#renderMessage();
  }

  /**
   * "You have (3) pull requests to review", as MSN counted your new e-mail. Without a way to
   * GitHub there is nothing to count, and the line is how to connect.
   * @param {import('../../main/review-requests.js').ReviewSummary | null} summary  null hides the line
   */
  renderReviews(summary) {
    this.reviews = summary;
    const line = $('#reviews');
    line.hidden = !summary;
    if (!summary) return;
    const { count, connect } = summary;
    // Nothing to review still gets its "(0)", only quieter.
    line.classList.toggle('none', count === 0);
    line.title = connect ? connectTitle(connect) : 'See them on GitHub';
    $('#reviews-text').replaceChildren(
      connect
        ? el(html`<span>${CONNECT_TEXT}</span>`)
        : el(html`<span>You have <b>(${count})</b> ${plural(count, 'pull request')} to review</span>`)
    );
  }

  /** A click on that line: the pull requests on GitHub, or the way there. */
  openReviews() {
    if (!this.reviews) return;
    // Connected, the count takes the line over: the app asks GitHub again by itself.
    if (this.reviews.connect) githubDialog();
    else api.app.openExternal(this.reviews.url);
  }

  openStatusMenu() {
    const button = $('#status-button');
    button.classList.add('open');
    openMenu(
      button,
      [
        ...MY_STATUSES.map((s) => ({
          label: s.label,
          icon: buddy(s.icon),
          bold: s.id === this.profile.status,
          action: () => api.profile.update({ status: s.id }),
        })),
        ...(this.platform() === 'darwin'
          ? [
              { separator: true },
              {
                label: "Show what I'm listening to",
                checked: this.settings().showListening === true,
                action: () => api.app.updateSettings({ showListening: this.settings().showListening !== true }),
              },
            ]
          : []),
        { separator: true },
        { label: 'Change display name...', action: () => this.editName() },
        { label: 'Change display picture...', action: () => this.changePicture() },
      ],
      { onClose: () => button.classList.remove('open') }
    );
  }

  changePicture() {
    changeMyPicture($('#my-picture'));
  }

  editName() {
    const name = $('#my-name');
    const input = document.createElement('input');
    input.className = 'input';
    input.value = this.profile.name;
    input.maxLength = 40;
    input.style.width = '150px';
    name.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      input.replaceWith(name);
      if (save && input.value.trim() && input.value.trim() !== this.profile.name) {
        api.profile.update({ name: input.value.trim() });
      }
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('blur', () => finish(true));
  }
}
