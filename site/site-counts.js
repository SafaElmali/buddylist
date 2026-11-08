// What the pages count by a name of their own, beside the visits and clicks PostHog counts by
// itself (docs/analytics.md). Every page loads it: the landing page through site.js, the
// changelog, the docs and the sponsor page by themselves. A page built without a project to
// count in (scripts/site-analytics.js) has no `posthog`, and counts nothing.

/** Counts something that happened on the page, with what there is to say about it. */
export const count = (event, properties) => window.posthog?.capture(event, properties);

/**
 * The links counted by name when they are clicked, by the attribute each wears. Its value says
 * where on the page the link stands: data-download="hero".
 */
export const LINKS = Object.freeze({
  'data-download': 'download clicked',
  'data-github': 'github clicked',
  'data-coffee': 'coffee clicked',
  'data-sponsor': 'sponsor clicked',
  'data-x': 'x clicked',
  'data-product-hunt': 'product hunt clicked',
  'data-release-notes': 'release notes clicked',
});

document.addEventListener('click', (event) => {
  for (const [attribute, name] of Object.entries(LINKS)) {
    const link = event.target.closest(`[${attribute}]`);
    if (link) count(name, { from: link.getAttribute(attribute) });
  }
});
