// The list on the left of Settings: the app's pages under their headings, then each project, with the pages
// of the one whose page is on show under it. One project is open at a time, and it can be folded away.
import { APP_SETTINGS, PROJECT_SETTINGS, projectPages } from '../../shared/settings-pages.js';

/**
 * A line of the list.
 * @typedef {{ kind: 'heading', label: string }
 *   | { kind: 'empty' }
 *   | { kind: 'page', section: string, label: string, selected: boolean,
 *       pages: { section: string, label: string, selected: boolean }[] }
 *   | { kind: 'project', project: string, label: string, open: boolean, expanded: boolean, selected: boolean,
 *       pages: { section: string, label: string, selected: boolean }[] }} NavRow
 *   A project is `open` while a page of it is on show, and `expanded` while its `pages` are listed under it. Folded
 *   away, it is the one `selected` in their place.
 */

const isProjectPage = (section) => PROJECT_SETTINGS.some((page) => page.id === section);

/**
 * The lines of the list, in order.
 * @param {object} opts
 * @param {{ key: string, name: string }[]} opts.projects
 * @param {{ section: string, project: string }} opts.page  what is on show: a page, and for a project's, the project by its key
 * @param {boolean} [opts.folded]  the open project's pages are folded away
 * @returns {NavRow[]}
 */
export function navRows({ projects, page: { section, project: key }, folded = false }) {
  const rows = [];
  let heading = '';
  for (const page of APP_SETTINGS) {
    if (page.parent) continue;
    if (page.heading !== heading) {
      heading = page.heading;
      rows.push({ kind: 'heading', label: heading });
    }
    const children = APP_SETTINGS.filter((child) => child.parent === page.id);
    const open = section === page.id || children.some((child) => child.id === section);
    rows.push({
      kind: 'page',
      section: page.id,
      label: page.label,
      selected: section === page.id,
      pages: open ? children.map(({ id, label }) => ({ section: id, label, selected: section === id })) : [],
    });
  }
  rows.push({ kind: 'heading', label: 'Projects' });
  if (!projects.length) rows.push({ kind: 'empty' });
  for (const project of projects) {
    const open = isProjectPage(section) && project.key === key;
    const expanded = open && !folded;
    rows.push({
      kind: 'project',
      project: project.key,
      label: project.name,
      open,
      expanded,
      selected: open && folded,
      pages: expanded
        ? projectPages(project.key).map(({ id, label }) => ({ section: id, label, selected: section === id }))
        : [],
    });
  }
  return rows;
}
