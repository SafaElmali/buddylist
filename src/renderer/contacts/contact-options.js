// What "Add a Contact" folds under "More options", said in one line beside it: a new contact
// starts out with all of it chosen for it, and the line says what, so nothing is picked out of sight.
// Plain data in and out, no DOM.

/**
 * @param {object} opts
 * @param {{ name: string, base: string } | { pull: true } | null} opts.branch  where it works in a repository: a
 *   new branch, '' for one named after the first message, started from `base`; or a pull request's own. Null outside one
 * @param {string} opts.model  the model's name, '' for the service's default: "Default model (Opus 5.5)" says the
 *   default and what it comes to
 * @param {string} [opts.effort]  the effort level's name, such as "High"; '' for the model's own, which goes unsaid
 * @param {string} [opts.mode]  how it asks before acting, in short: "Asks first"
 * @param {string} [opts.group]  the group it goes in
 * @returns {string}  "New branch from origin/main · Default model · Asks first"
 */
export function optionsSummary({ branch, model, effort, mode, group }) {
  let where = '';
  if (branch && 'pull' in branch) where = "The pull request's branch";
  else if (branch) where = `${branch.name || 'New branch'} from ${branch.base}`;
  return [where, model || 'Default model', effort && `${effort} effort`, mode, group].filter(Boolean).join(' · ');
}
