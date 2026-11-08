// One creation flow per window. A standalone manager replaces an unfinished contact; only Under explicitly
// borrows that contact's lifetime and returns to its draft. Register before looking up a repository so a late
// answer cannot reopen a contact form after the user chose to add a manager instead.
let contact = null;
let manager = null;

/** @param {(signal: AbortSignal) => Promise<any>} create */
export async function creatingContact(create) {
  if (contact || manager) return null;
  const lifetime = new AbortController();
  contact = lifetime;
  lifetime.signal.addEventListener(
    'abort',
    () => {
      if (contact === lifetime) contact = null;
    },
    { once: true }
  );
  try {
    return await create(lifetime.signal);
  } finally {
    lifetime.abort();
  }
}

/**
 * @param {(signal: AbortSignal) => Promise<any>} create
 * @param {AbortSignal} [fromContact]  only Under supplies this: keep its draft, and cancel with it
 */
export async function creatingManager(create, fromContact) {
  if (manager || fromContact?.aborted) return null;
  if (!fromContact) contact?.abort();
  const lifetime = new AbortController();
  manager = lifetime;
  lifetime.signal.addEventListener(
    'abort',
    () => {
      if (manager === lifetime) manager = null;
    },
    { once: true }
  );
  const cancel = () => lifetime.abort();
  fromContact?.addEventListener('abort', cancel, { once: true });
  try {
    return await create(lifetime.signal);
  } finally {
    fromContact?.removeEventListener('abort', cancel);
    lifetime.abort();
  }
}
