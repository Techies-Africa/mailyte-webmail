/**
 * What identifies one page of the message list, and so one cache entry.
 *
 * The folder rail, the Starred and label views, the filter pills, search and
 * paging all come down to these few fields. Two views that ask the server the
 * same question -- Starred, and the inbox with the Starred pill -- share one
 * entry, because they are the same answer.
 */

/** One page. */
export const PAGE_SIZE = 50;

/** Starred is a keyword view over the inbox, not an IMAP folder. */
export const STARRED_VIEW = '__starred__';

/**
 * A label view: every message carrying one label, across all folders. Not a
 * folder either -- it is `__label__:<slug>` in the folder slot, resolved to
 * a server-side KEYWORD search.
 */
export const LABEL_VIEW_PREFIX = '__label__:';

export function labelOfView(folder: string): string | null {
  return folder.startsWith(LABEL_VIEW_PREFIX) ? folder.slice(LABEL_VIEW_PREFIX.length) : null;
}

export type ListFilter = 'all' | 'unread' | 'starred' | 'attachments';
export type SearchScope = 'folder' | 'all';

export interface ListParams {
  /** null = every folder: a label view, or a search across all mail. */
  folder: string | null;
  search: string;
  unread: boolean;
  starred: boolean;
  label: string | null;
  offset: number;
}

export interface ListView {
  /** The rail selection: a folder, STARRED_VIEW or a label view. */
  folder: string;
  search: string;
  scope: SearchScope;
  filter: ListFilter;
  offset: number;
}

/**
 * The server question a view asks. Starred is SEARCH FLAGGED on the inbox; a
 * label is a KEYWORD search everywhere. The "attachments" pill has no server
 * counterpart -- it filters the page it is given -- so it asks the same
 * question as "all" and shares its cache entry.
 */
export function listParamsFor(view: ListView): ListParams {
  const isStarredView = view.folder === STARRED_VIEW;
  const label = labelOfView(view.folder);
  const allMail = (view.search !== '' && view.scope === 'all') || label !== null;
  return {
    folder: allMail ? null : isStarredView ? 'INBOX' : view.folder,
    search: view.search,
    unread: view.filter === 'unread',
    starred: isStarredView || view.filter === 'starred',
    label,
    offset: view.offset,
  };
}

/** The same list at a different page: the old page may stand in while the new one loads. */
export function sameListOtherPage(a: ListParams, b: ListParams): boolean {
  return (
    a.folder === b.folder &&
    a.search === b.search &&
    a.unread === b.unread &&
    a.starred === b.starred &&
    a.label === b.label
  );
}
