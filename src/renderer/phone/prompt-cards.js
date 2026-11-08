// The cards a conversation shows while its agent waits for you: a permission to Allow or Decline, questions to
// answer or skip, a plan to approve or send back, and project instructions to save or not (see cards.js). A card
// stays until the app says it was answered, from here or anywhere else. What was chosen and written on one is kept
// as it changes, and put back when the card is drawn again (see drafts.js). A phone that may only read sees what a
// card asks with nothing to answer it with; one that may answer, every answer but Always allow (see access.js).
import { el, html } from '../lib/dom.js';
import { UNCONFIRMED } from '../remote/network-ipc.js';
import { renderMarkdown } from '../lib/markdown.js';
import { planTitle } from '../../shared/plan-title.js';
import { cardSays, instructionsCard, keepPlanning, planChoices, questionAnswer, toolCard } from './cards.js';
import { fitForPhone } from './transcript.js';

/**
 * @typedef {object} CardOptions
 * @property {string} name  who asks
 * @property {string} folder  the contact's, which a plan's pictures are named from
 * @property {{ mode: string, label: string, primary?: boolean }[]} approvals  the provider's ways to approve a plan
 * @property {(answer: import('../../providers/contract.js').PermissionResponse) => Promise<unknown>} respond
 * @property {any} [saved]  what was chosen and written on it before, as `keep` was given it
 * @property {(state: object | null) => void} [keep]  keeps what is chosen and written on it, as it changes
 * @property {{ answer: boolean, widen: boolean }} [may]  whether this phone may answer it, and widen what its agent
 *   does unasked: always allow, or approve a plan auto-accepting edits
 */

/**
 * The buttons of a card wait while its answer is on its way, and come back should it not have left. One that left with
 * no word back may still get to the Mac once it's back: it is not offered again, and the card says so. The
 * conversation is drawn again from what the Mac has once it's back (see main.js), with the card if it still waits.
 */
function answering(card, respond, answer) {
  const buttons = [...card.querySelectorAll('button, input, textarea')];
  for (const button of buttons) button.disabled = true;
  card.classList.add('ph-answering');
  return respond(answer).catch((error) => {
    if (error?.code === UNCONFIRMED) {
      card.classList.add('ph-unsure');
      if (!card.querySelector('.ph-unconfirmed')) card.append(el(html`<p class="ph-unconfirmed">${error.message}</p>`));
      return;
    }
    for (const button of buttons) button.disabled = false;
    card.classList.remove('ph-answering');
  });
}

/** The buttons of the choices `which` picks, each by its place among all of them. */
const choiceButtons = (choices, which = () => true) =>
  choices.map((choice, i) => {
    if (!which(choice)) return '';
    const look = choice.primary ? 'ph-primary' : choice.quiet ? 'ph-quiet' : '';
    return html`<button class="ph-button ${look}" type="button" data-choice="${i}">${choice.label}</button>`;
  });

/**
 * A card of choices: a permission, or instructions. Its two answers side by side, the same at every width; a quiet
 * one, such as Always allow, on a row of its own below them.
 */
function choicesCard({ title, detail, reason, choices }, kind, { respond }) {
  const quiet = choices.some((choice) => choice.quiet);
  const card = el(
    html`<section class="ph-card ph-card-${kind}" aria-label="${title}">
      <p class="ph-card-title">${title}</p>
      ${reason ? html`<p class="ph-card-reason">${reason}</p>` : ''}
      ${
        detail
          ? html`<pre class="ph-card-detail" tabindex="0" role="group" aria-label="What it would do">${detail}</pre>`
          : ''
      }
      <div class="ph-actions ph-actions-pair">${choiceButtons(choices, (choice) => !choice.quiet)}</div>
      ${
        quiet
          ? html`<div class="ph-actions ph-actions-more">${choiceButtons(choices, (choice) => choice.quiet)}</div>`
          : ''
      }
    </section>`
  );
  card.addEventListener('click', ({ target }) => {
    const index = /** @type {HTMLElement} */ (target).closest?.('[data-choice]')?.getAttribute('data-choice');
    if (index !== undefined && index !== null) answering(card, respond, choices[Number(index)].answer);
  });
  return card;
}

/**
 * Questions, each answered by its options or in words, and sent together. One takes an option, by a radio button;
 * one that takes as many as you like has a box to tick by each, as in the conversation window.
 */
function questionsCard({ requestId, questions = [] }, { name, respond, saved, keep = () => {} }) {
  const card = el(
    html`<section class="ph-card ph-card-question" aria-label="Questions from ${name}">
      <p class="ph-card-title">${cardSays({ kind: 'question', questions }, name)}</p>
      ${questions.map(
        (question, i) =>
          html`<fieldset class="ph-question">
            <legend>
              ${question.header ? html`<span class="ph-chip">${question.header}</span>` : ''}${question.question}
            </legend>
            ${(question.options || []).map(
              (option, j) =>
                html`<label class="ph-option">
                  <input
                    type="${question.multiSelect ? 'checkbox' : 'radio'}"
                    name="${requestId}:${i}"
                    data-q="${i}"
                    data-o="${j}"
                  />
                  <span class="ph-option-text">
                    <span class="ph-option-label">${option.label}</span>
                    ${option.description ? html`<span class="ph-option-description">${option.description}</span>` : ''}
                  </span>
                </label>`
            )}
            <input
              class="ph-other"
              data-q="${i}"
              type="text"
              placeholder="Or say something else"
              aria-label="Your own answer"
            />
          </fieldset>`
      )}
      <div class="ph-actions ph-card-send">
        <button class="ph-button" type="button" data-do="skip">Let it decide</button>
        <button class="ph-button ph-primary" type="button" data-do="send" disabled>
          ${questions.length === 1 ? 'Send answer' : 'Send answers'}
        </button>
      </div>
    </section>`
  );
  const send = /** @type {HTMLButtonElement} */ (card.querySelector('[data-do="send"]'));
  /** @type {(i: number) => HTMLInputElement[]} */
  const options = (i) => [...card.querySelectorAll(`input[data-o][data-q="${i}"]`)];
  /** @type {(i: number) => HTMLInputElement} */
  const other = (i) => card.querySelector(`.ph-other[data-q="${i}"]`);
  /** By place, for each question: the options ticked, and what was written instead. */
  const state = () => ({
    chosen: questions.map((_, i) => options(i).flatMap((box) => (box.checked ? [Number(box.dataset.o)] : []))),
    other: questions.map((_, i) => other(i).value),
  });
  const picks = () => {
    const { chosen, other: written } = state();
    return questions.map((question, i) => ({
      chosen: chosen[i].map((j) => question.options[j].label),
      other: written[i],
    }));
  };
  const ready = () => (send.disabled = !questionAnswer(questions, picks()));
  // As it was left: before a Back, a reload or a dropped connection.
  for (const [i, chosen] of (saved?.chosen || []).entries())
    for (const box of i < questions.length ? options(i) : []) box.checked = chosen.includes(Number(box.dataset.o));
  for (const [i, written] of (saved?.other || []).entries()) if (i < questions.length) other(i).value = written;
  ready();
  card.addEventListener('input', ({ target }) => {
    // What is sent is what shows: your own words are the answer, or the options ticked are, never both.
    const input = /** @type {HTMLInputElement} */ (target);
    const i = Number(input.dataset.q);
    if (input.matches('.ph-other') && input.value.trim()) for (const box of options(i)) box.checked = false;
    if (input.matches('input[data-o]') && input.checked) other(i).value = '';
    ready();
    const now = state();
    keep(now.chosen.some((chosen) => chosen.length) || now.other.some(Boolean) ? now : null);
  });
  card.addEventListener('click', ({ target }) => {
    const button = /** @type {HTMLElement} */ (target).closest?.('button');
    if (button?.dataset.do === 'skip') answering(card, respond, { decision: 'skip' });
    if (button?.dataset.do === 'send') answering(card, respond, questionAnswer(questions, picks()));
  });
  return card;
}

/**
 * A plan, to read and approve in one of its provider's modes, or to send back with what should change. Approvals this
 * phone may not give are said once, under the others.
 */
function planCard({ plan = '' }, { name, folder, approvals = [], respond, saved, keep = () => {}, may }) {
  const choices = planChoices(approvals, { widen: may?.widen !== false });
  const held = approvals
    .filter(({ mode }) => !choices.some(({ answer }) => answer.mode === mode))
    .map(({ label }) => label);
  const card = el(
    html`<section class="ph-card ph-card-plan" aria-label="A plan from ${name}">
      <p class="ph-card-title">${name} has a plan: ${planTitle(plan)}</p>
      <div class="ph-plan md" tabindex="0" role="group" aria-label="The plan"></div>
      <div class="ph-actions ph-actions-stacked">
        ${choiceButtons(choices)}
        <button class="ph-button" type="button" data-do="keep">No, keep planning</button>
      </div>
      ${held.length ? html`<p class="ph-card-held">${held.join(' and ')} ${held.length > 1 ? 'need' : 'needs'} full access.</p>` : ''}
      <div class="ph-feedback" hidden>
        <textarea rows="2" placeholder="What should change? (optional)" aria-label="What should change"></textarea>
        <button class="ph-button ph-primary" type="button" data-do="feedback">Send</button>
      </div>
    </section>`
  );
  renderMarkdown(/** @type {HTMLElement} */ (card.querySelector('.ph-plan')), plan, undefined, folder);
  fitForPhone(card);
  const feedback = /** @type {HTMLElement} */ (card.querySelector('.ph-feedback'));
  const said = /** @type {HTMLTextAreaElement} */ (feedback.querySelector('textarea'));
  // Feedback that was being written is open again, with its words.
  if (typeof saved?.feedback === 'string') {
    feedback.hidden = false;
    said.value = saved.feedback;
  }
  card.addEventListener('input', () => keep({ feedback: said.value }));
  card.addEventListener('click', ({ target }) => {
    const button = /** @type {HTMLElement} */ (target).closest?.('button');
    if (!button) return;
    if (button.dataset.choice !== undefined)
      return answering(card, respond, choices[Number(button.dataset.choice)].answer);
    if (button.dataset.do === 'keep') {
      feedback.hidden = false;
      keep({ feedback: said.value });
      return said.focus();
    }
    if (button.dataset.do === 'feedback') answering(card, respond, keepPlanning(said.value));
  });
  return card;
}

/**
 * The card for a request the agent waits on.
 * @param {import('../../providers/contract.js').PermissionRequest & { requestId: string }} prompt
 * @param {CardOptions} opts
 */
export function promptCard(prompt, opts) {
  const { answer = true, widen = true } = opts.may ?? {};
  const card =
    prompt.kind === 'question'
      ? questionsCard(prompt, opts)
      : prompt.kind === 'plan'
        ? planCard(prompt, opts)
        : prompt.kind === 'instructions'
          ? choicesCard(instructionsCard(prompt, opts.name), 'instructions', opts)
          : choicesCard(toolCard(prompt, opts.name, { always: widen }), 'tool', opts);
  card.dataset.request = prompt.requestId;
  if (!answer) readOnly(card);
  return card;
}

/** A card this phone may not answer: what it asks stays, what answers it goes, and what takes words takes none. */
function readOnly(card) {
  card.classList.add('ph-card-read');
  for (const part of card.querySelectorAll('.ph-actions, .ph-feedback, .ph-card-held')) part.remove();
  for (const input of card.querySelectorAll('input, textarea')) input.disabled = true;
}
