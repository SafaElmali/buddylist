// Harness mount only. Production registration is owned by the shared panel worker.
/* global document, window */
import { PrStack } from '../../src/renderer/chat/pr-stack.js';
import { SidePane } from '../../src/renderer/chat/side-pane.js';

const pane = new SidePane(document.querySelector('#side-pane'), {
  beside: document.querySelector('#beside'),
  room: async () => {},
});
const ctx = { contactId: 'stack' };
const view = new PrStack(pane, ctx, {
  list: (id) => window.messenger.contacts.prStack(id),
  open: (url) => window.messenger.app.openExternal(url),
});
pane.settle();
view.show();
window.stackHarness = {
  pane,
  view,
  ctx,
  async show(id) {
    ctx.contactId = id;
    await view.refresh();
  },
};
