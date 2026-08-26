import { useEffect, useState } from 'react';

/**
 * The classic mail-client keyboard set (PRD S4): c compose, r reply,
 * j/k navigate, e archive, / search, ? help.
 *
 * Zero shortcuts existed before this. The rules that make them safe rather
 * than surprising:
 *
 *  - Never fire while the user is typing. A shortcut that archives the
 *    message because someone typed "e" into the subject line is worse than
 *    no shortcut, so anything originating in an input, textarea, select or
 *    contentEditable (which is what the compose editor is) is ignored.
 *  - Never fire with a modifier held. Cmd-R is reload, not reply.
 *  - Only bind what the caller actually handles. A handler that isn't
 *    passed has no key, which keeps this honest in the same way the
 *    toolbar's optional handlers do.
 */

export interface ShortcutHandlers {
  compose?: () => void;
  reply?: () => void;
  replyAll?: () => void;
  forward?: () => void;
  archive?: () => void;
  trash?: () => void;
  next?: () => void;
  previous?: () => void;
  open?: () => void;
  close?: () => void;
  search?: () => void;
  refresh?: () => void;
  toggleStar?: () => void;
  markUnread?: () => void;
}

/** Rendered by the `?` overlay, and the single source of truth for both. */
export const SHORTCUT_HELP: Array<{ keys: string; description: string }> = [
  { keys: 'c', description: 'Compose' },
  { keys: 'r', description: 'Reply' },
  { keys: 'a', description: 'Reply all' },
  { keys: 'f', description: 'Forward' },
  { keys: 'j', description: 'Next message' },
  { keys: 'k', description: 'Previous message' },
  { keys: 'Enter', description: 'Open the selected message' },
  { keys: 'e', description: 'Archive' },
  { keys: '#', description: 'Move to Trash' },
  { keys: 's', description: 'Star / unstar' },
  { keys: 'u', description: 'Mark unread' },
  { keys: '/', description: 'Search' },
  { keys: 'g', description: 'Refresh' },
  { keys: 'Esc', description: 'Back to the list' },
  { keys: '?', description: 'This help' },
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();

  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable ||
    // The compose editor and any modal that traps typing.
    target.closest('[data-shortcuts="off"]') !== null
  );
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers, enabled = true) {
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      // Escape is the one key that must work everywhere, including out of
      // the help overlay itself.
      if (event.key === 'Escape') {
        if (helpOpen) {
          setHelpOpen(false);
          event.preventDefault();
          return;
        }
        handlers.close?.();
        return;
      }

      if (helpOpen) return;

      const run = (handler?: () => void) => {
        if (!handler) return;
        event.preventDefault();
        handler();
      };

      switch (event.key) {
        case '?':
          event.preventDefault();
          setHelpOpen(true);
          break;
        case 'c':
          run(handlers.compose);
          break;
        case 'r':
          run(handlers.reply);
          break;
        case 'a':
          run(handlers.replyAll);
          break;
        case 'f':
          run(handlers.forward);
          break;
        case 'j':
          run(handlers.next);
          break;
        case 'k':
          run(handlers.previous);
          break;
        case 'Enter':
          run(handlers.open);
          break;
        case 'e':
          run(handlers.archive);
          break;
        case '#':
          run(handlers.trash);
          break;
        case 's':
          run(handlers.toggleStar);
          break;
        case 'u':
          run(handlers.markUnread);
          break;
        case 'g':
          run(handlers.refresh);
          break;
        case '/':
          run(handlers.search);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers, enabled, helpOpen]);

  return { helpOpen, setHelpOpen };
}

/**
 * Unread count in the document title (PRD S6).
 *
 * Restores the original title on unmount and when the count reaches zero,
 * so a tab that has been read does not keep advertising a stale number.
 */
export function useUnreadTitle(unread: number, baseTitle = 'Webmail · Mailyte') {
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) ${baseTitle}` : baseTitle;

    return () => {
      document.title = baseTitle;
    };
  }, [unread, baseTitle]);
}
