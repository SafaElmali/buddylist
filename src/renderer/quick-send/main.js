import '../lib/error-reports.js';
import '../lib/look.js';
import { api } from '../lib/api.js';
import { $, errorText } from '../lib/dom.js';
import { mountFrame } from '../lib/frame.js';

mountFrame({ title: 'Quick send', maximizable: false });
const input = $('#message');
const send = $('#send');
const open = $('#open-chat');
let contactId = null;
let available = false;
let sending = false;

const draftKey = () => `quick-send:${contactId}`;
function keepDraft() {
  if (!contactId) return;
  try {
    if (input.value) localStorage.setItem(draftKey(), input.value);
    else localStorage.removeItem(draftKey());
  } catch {
    // The open window still keeps it when storage is unavailable.
  }
}
function error(message) {
  $('#error').textContent = message;
  $('#error').hidden = !message;
}
function refresh() {
  input.disabled = !contactId;
  input.readOnly = sending;
  send.disabled = sending || !available || !input.value.trim();
  open.disabled = sending || !available;
  send.textContent = sending ? 'Sending…' : 'Send';
}
function showContact(contact, names = [contact?.name, ...(contact?.guests || []).map((g) => g.name)]) {
  available = Boolean(contact && !contact.archived && contact.status !== 'offline');
  if (contact) {
    $('#recipient').textContent = `To: ${names.join(', ')}`;
    $('#recipient').title = names.join(', ');
    $('#project').textContent = contact.cwd;
    $('#project').title = contact.cwd;
  }
  if (!available) error('This contact is unavailable. Choose another from the contact list.');
  else if ($('#error').textContent.startsWith('This contact is unavailable.')) error('');
  refresh();
}
async function submit() {
  if (sending || !available || !input.value.trim()) return;
  keepDraft();
  sending = true;
  error('');
  refresh();
  try {
    const sent = await api.quickSend.send(input.value);
    if (!sent) throw new Error('Your message was not sent. Try again.');
    input.value = '';
    keepDraft();
    await api.window.close();
  } catch (err) {
    error(errorText(err) || 'Your message was not sent. Try again.');
  } finally {
    sending = false;
    refresh();
    input.focus();
  }
}
input.addEventListener('input', () => {
  keepDraft();
  refresh();
});
send.addEventListener('click', submit);
open.addEventListener('click', async () => {
  keepDraft();
  await api.window.close();
  await api.chat.open(contactId);
});
document.addEventListener('keydown', (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    keepDraft();
    api.window.close();
  } else if (event.key === 'Enter' && event.target === input && !event.shiftKey && !event.repeat) {
    event.preventDefault();
    submit();
  }
});
api.on.windowState(({ focused }) => {
  if (focused) input.focus();
});
// Names and availability may change while this window is hidden or a message is being written.
api.on.contacts((contacts) => {
  if (!contactId) return;
  const contact = contacts.find((c) => c.id === contactId);
  showContact(contact);
});
try {
  const data = await api.quickSend.init();
  if (!data?.contact) throw new Error('No contact selected. Open a conversation first, then try Quick send again.');
  contactId = data.contact.id;
  showContact(data.contact, data.names);
  try {
    input.value = localStorage.getItem(draftKey()) || '';
  } catch {
    /* Storage may be disabled. */
  }
  refresh();
  input.focus();
} catch (err) {
  error(errorText(err));
}
