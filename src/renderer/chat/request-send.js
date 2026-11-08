import { openMenu } from '../lib/menu.js';

/** Only an authoritative rejection may be retried, and only after the user chooses what to do. */
export async function dispatchRequest(message, { send, choose, resume }) {
  for (;;) {
    const result = await send(message);
    if (!result?.blocked) return result;
    const who = await choose(result);
    if (!who) return null;
    if (who.paused) await resume(who.id);
    message = { ...message, recipient: { id: who.id } };
  }
}

export function chooseRequestRecipient(anchor, participants) {
  return new Promise((resolve) => {
    openMenu(
      anchor,
      participants.map((who) => ({
        label: `${who.paused ? 'Resume' : 'Send to'} ${who.name}${who.paused ? ' and send' : ''}`,
        action: () => resolve(who),
      })),
      // Menus close just before invoking their action. Let that choice resolve first.
      { above: true, onClose: () => queueMicrotask(() => resolve(null)) }
    );
  });
}
