// Claude Code emits this fixed placeholder for a silent reply, and agents can repeat it.
// Recognise only the whole placeholder, never wording that happens to occur in a real answer.
export const NO_RESPONSE = 'No response requested.';

/** Whether a reply has anything to show, save or pass on. */
export const hasReply = (text = '') => Boolean(text.trim()) && text.trim() !== NO_RESPONSE;
