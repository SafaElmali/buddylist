// Your contacts beside the conversation, on its left: the contact list as its own
// window draws it, by project unless you grouped it another way. The "..." over it groups
// and sorts both lists. A click on a contact shows its conversation in this window: an
// archived one's to read, with the way to restore it over it.
// The list takes its room from the conversation and gives it back when it is hidden: the
// window stays where it is, as wide as it is. The bar between the two drags the list wider
// or narrower. Add project, under the list, is the way to a project that has no contact yet.
import { $ } from '../lib/dom.js';
import { smallIcon } from '../lib/icons.js';
import { CONTACTS_PANE_WIDTH, clampPaneWidth, paneView, widthInAddress } from '../../shared/contacts-pane.js';
import { ContactList } from '../contacts/list.js';
import { mountSplitter } from './sidebar.js';

// A window that goes on to another contact loads its page again. How far down the list was is kept
// for the window, so it is the same list after. What is folded is the contact list's own, in every
// window and after a restart (see ContactList).
const SCROLLED = 'contactsPaneScrolled';

function kept(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key));
  } catch {
    return null;
  }
}

function keep(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // It starts over after the next contact, then.
  }
}

export class ContactsPane {
  /**
   * @param {HTMLElement} root
   * @param {object} opts
   * @param {HTMLElement} opts.splitter  the bar between the list and the conversation
   * @param {HTMLElement} opts.beside  the conversation's column, which the list takes its room from
   * @param {string} opts.current  the contact whose conversation this window shows
   * @param {(change: () => void) => Promise<void>} [opts.around]  wraps the list's showing and hiding, e.g. to
   *   keep the conversation scrolled to the bottom
   * @param {(contact: any) => void} opts.open  a contact was picked
   * @param {(contact: any) => void} opts.addFrom  the + on a project: another contact on it
   * @param {(from: any) => void} opts.addOnComputer  the + on This computer: another contact there, like `from`
   * @param {(project: import('../../shared/groups.js').EmptyProject) => void} opts.addIn  the + on a project nobody
   *   works on any more: a contact on it again
   * @param {(manager: any) => void} [opts.addUnder]  the + on a project's manager's row: another contact under it
   * @param {(contact: any, managerId: string | null, how: 'drag') => void} [opts.assign]  a conversation dragged
   *   onto a manager's row, or onto its project's line: see ContactList
   * @param {(like: { from: any, groupId?: string }) => void} opts.addLike  the + on any other section: see ContactList
   * @param {(button: HTMLElement) => void} opts.addProject  Add project, under the list: the ways to a project, by `button`
   * @param {(contact: any) => void} opts.openPullRequest  the tags on a contact's row were clicked
   * @param {(contact: any, action: string) => void} opts.tagAction  one of them that acts in its conversation
   *   was: see ContactList
   * @param {(contact: any, name: string) => Promise<unknown>} opts.rename  saves the name typed over a contact's own:
   *   see ContactList
   * @param {(contact: any, at: { x: number, y: number }) => void} opts.menu  a contact was right-clicked
   * @param {(section: import('../../shared/groups.js').Section, at: { x: number, y: number }) => void} opts.projectMenu  a
   *   project was right-clicked
   * @param {(button: HTMLElement) => void} opts.viewMenu  the "..." over the list was clicked
   * @param {(width: number) => void} opts.resized  the user dragged the list to another width
   */
  constructor(
    root,
    {
      splitter,
      beside,
      current,
      around = async (change) => change(),
      open,
      addFrom,
      addOnComputer,
      addIn,
      addUnder,
      assign,
      addLike,
      addProject,
      openPullRequest,
      tagAction,
      rename,
      menu,
      projectMenu,
      viewMenu,
      resized,
    }
  ) {
    this.root = root;
    this.splitter = splitter;
    this.around = around;

    const more = $('.contacts-pane-menu', root);
    more.innerHTML = smallIcon.more();
    more.addEventListener('click', () => viewMenu(more));

    const box = $('.cl-list', root);
    this.list = new ContactList(
      box,
      {
        open: (contact) => {
          // The click was the wish. The row that says where you are is the one that stays marked.
          this.list.select(null);
          if (contact.id !== current) open(contact);
        },
        addFrom,
        addOnComputer,
        addIn,
        addUnder,
        assign,
        addLike,
        openPullRequest,
        tagAction,
        rename,
        contextMenu: menu,
        projectMenu,
      },
      // Beside a conversation a click is enough.
      { click: true }
    );
    this.list.currentId = current;
    box.addEventListener('scroll', () => keep(SCROLLED, box.scrollTop), { passive: true });
    this.box = box;
    /** Whether the list was put back where it was scrolled to, once it had its contacts. */
    this.placed = false;

    const add = $('.contacts-pane-add', root);
    $('.contacts-pane-add-icon', add).innerHTML = smallIcon.folderPlus();
    add.addEventListener('click', () => addProject(add));

    // A window whose address says how wide the list is shows it from the start.
    const width = widthInAddress(location.search);
    root.hidden = splitter.hidden = !width;
    mountSplitter(splitter, root, beside, {
      at: 'left',
      clamp: clampPaneWidth,
      width: width || CONTACTS_PANE_WIDTH,
      usual: CONTACTS_PANE_WIDTH,
      save: (to) => resized(clampPaneWidth(to)),
    });
  }

  get shown() {
    return !this.root.hidden;
  }

  /** How the list is grouped and sorted now. */
  get view() {
    return this.list.view;
  }

  /** @param {any[]} contacts  every contact, as the contact list has them */
  setContacts(contacts) {
    this.list.setContacts(contacts);
    if (this.placed) return;
    this.placed = true;
    this.box.scrollTop = Number(kept(SCROLLED)) || 0;
  }

  /** @param {import('../../shared/groups.js').Group[]} groups */
  setGroups(groups) {
    this.list.setGroups(groups);
  }

  /** @param {import('../../shared/groups.js').EmptyProject[]} projects  the projects listed with nobody on them */
  setEmptyProjects(projects) {
    this.list.setEmptyProjects(projects);
  }

  /** @param {object} settings  the app's settings: how the contact list is grouped and sorted */
  setView(settings) {
    this.list.setView(paneView(settings));
  }

  /** Takes the mark off the row a menu was opened for. */
  unselect() {
    this.list.select(null);
  }

  /** Lets the user type another name for a contact, where its name is. @param {string} id */
  rename(id) {
    this.list.rename(id);
  }

  /**
   * Shows the list, or hides it. The conversation gets narrower or wider for it, and the window
   * stays as it is.
   * @param {boolean} shown
   */
  async show(shown) {
    if (shown === this.shown) return;
    await this.around(() => {
      this.root.hidden = this.splitter.hidden = !shown;
    });
  }
}
