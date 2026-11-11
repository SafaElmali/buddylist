// The variables part of an Environment page: the ones typed in, and the files
// more of them are read from. The same for the ones every project shares and
// for one project's own.
import { api } from '../lib/api.js';
import { html } from '../lib/dom.js';
import { group, listEditor } from './controls.js';

/**
 * @param {object} opts
 * @param {import('../../shared/project-settings.js').Variable[]} opts.env
 * @param {string[]} opts.envFiles
 * @param {string} [opts.folder]  where the file picker starts
 * @param {(patch: { env?: object[], envFiles?: string[] }) => void} opts.save
 * @returns {HTMLElement[]}
 */
export function environmentGroups({ env, envFiles, folder, save }) {
  return [
    group(
      'Variables',
      'A value is kept out of sight until you ask to see it. It is kept in the app’s own data, as plain text, like a .env file.',
      listEditor({
        items: env,
        fields: [
          { key: 'name', placeholder: 'NAME', mono: true, label: 'Name' },
          { key: 'value', placeholder: 'value', kind: 'secret', label: 'Value' },
        ],
        add: 'Add variable',
        empty: 'No variables yet.',
        onChange: (items) => save({ env: items }),
      })
    ),
    group(
      'Env files',
      html`More variables, read from files written like a <code>.env</code> file each time something is started. A
        variable typed in above wins over one from a file. A file that is not named in full is looked for in the
        contact’s own folder. The ones that say which programs start and what they load first, such as
        <code>PATH</code>, <code>NODE_OPTIONS</code>, <code>BASH_ENV</code> or <code>DYLD_</code> and
        <code>LD_</code> ones, are not taken from a file: type one in above to use it.`,
      listEditor({
        items: envFiles.map((path) => ({ path })),
        fields: [{ key: 'path', placeholder: '.env.local', mono: true, label: 'File' }],
        add: 'Add env file...',
        empty: 'No files yet.',
        make: async () => {
          const path = await api.app.pickFile('env', folder);
          return path ? { path } : null;
        },
        onChange: (items) => save({ envFiles: items.map((item) => item.path) }),
      })
    ),
  ];
}
