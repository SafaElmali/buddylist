// Who quitting, or restarting to update, would interrupt. The quit guard asks first while anyone
// is (src/main/quit-guard.js), Restart when idle waits for them (src/main/idle-restart.js), and the
// update card offers When idle only while there are some (src/renderer/contacts/update.js).

/**
 * What is read from a contact's view (see Conversations.view).
 * @typedef {{ name: string, status: string, project?: string }} ContactView
 */

/**
 * The contacts quitting would interrupt: at work ("busy"), or waiting for you ("away"), for an
 * answer to a question or to an invitation.
 * @param {ContactView[]} views
 */
export const busyContacts = (views) => views.filter((view) => view.status === 'busy' || view.status === 'away');
