// The changelog reads without this. With it, a link to a version (/changelog#v0.2.9, the app's
// What's new, the list of versions) opens that version's card, and Expand all and Collapse all show.

/** Opens the card the address points to, and marks its link in the list of versions. */
const openLinked = () => {
  const fold = document.getElementById(decodeURIComponent(location.hash.slice(1)))?.querySelector('.release-fold');
  if (fold) fold.open = true;
  for (const link of document.querySelectorAll('.changelog-versions a')) {
    if (fold && link.hash === location.hash) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
};

addEventListener('hashchange', openLinked);
// A link to the version already in the address changes nothing, so it opens its card itself.
document.addEventListener('click', ({ target }) => {
  const link = target.closest?.('a[href^="#"]');
  if (link && link.hash === location.hash) openLinked();
});
openLinked();

const tools = document.querySelector('.changelog-tools');
if (tools) {
  tools.addEventListener('click', ({ target }) => {
    const button = target.closest('[data-fold]');
    if (!button) return;
    for (const fold of document.querySelectorAll('.changelog-list details')) fold.open = button.dataset.fold === 'open';
  });
  tools.hidden = false;
}
