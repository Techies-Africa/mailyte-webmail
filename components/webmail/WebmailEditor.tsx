import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Selection, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import {
  Bold,
  Italic,
  Strikethrough,
  List,
  ListOrdered,
  Link as LinkIcon,
  Quote,
  Code,
  Undo2,
  Redo2,
  Heading2,
  Unlink,
  ImagePlus,
} from 'lucide-react';
import { ACCEPTED_IMAGE_TYPES, imageFileToDataUrl, isAcceptedImage } from '@/lib/webmail/images';

/**
 * The compose editor (PRD C1).
 *
 * Replaces a contentEditable driven by document.execCommand, which has been
 * deprecated for years, behaves differently in every browser, and had no
 * undo history of its own. The old one also needed a mount-time hack to
 * stop React resetting the caret on every keystroke -- TipTap owns its
 * document, so that whole class of problem goes away.
 *
 * Links use a small inline prompt rather than window.prompt(): the native
 * dialog is modal to the whole browser, unstyleable, and blocked outright in
 * some embedded contexts.
 *
 * Pictures go INTO the document, as data: URIs -- inserted from the toolbar,
 * pasted, or dropped. The contentEditable this replaced did that for free
 * (a browser pastes an image into an editable region as an <img>); TipTap
 * keeps only the nodes it is told about, so without the Image node every
 * pasted picture vanished silently and the only way to get one into a
 * message was Attach, which sends it as a file rather than showing it in
 * the body. A signature banner, in particular, has to be in the body.
 */

type WebmailEditorProps = {
  /** Initial HTML. Read once on mount -- see the comment on the effect below. */
  initialHtml: string;
  placeholder?: string;
  onChange: (html: string) => void;
  /** Rendered at the right-hand end of the toolbar (the AI Write button). */
  toolbarExtra?: React.ReactNode;
};

export default function WebmailEditor({
  initialHtml,
  placeholder = 'Type your message…',
  onChange,
  toolbarExtra,
}: WebmailEditorProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [imageError, setImageError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  /**
   * Insert image files at the selection (or at `pos`, for a drop), one
   * node per file. Written against the ProseMirror view rather than the
   * TipTap command chain so the toolbar button, paste and drop share one
   * path -- the paste/drop hooks below are handed a view, not an editor.
   *
   * Each file is converted (and scaled, if large) before it is inserted, so
   * a refusal names the file and leaves the document untouched.
   */
  const insertFiles = async (view: EditorView, files: File[], pos?: number) => {
    if (files.length === 0) return;
    setImageError(null);

    if (pos !== undefined) {
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))));
    }

    for (const file of files) {
      try {
        const src = await imageFileToDataUrl(file);
        const node = view.state.schema.nodes.image.create({ src, alt: file.name });
        view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
      } catch (error) {
        setImageError(error instanceof Error ? error.message : 'Could not insert the image.');
      }
    }
    view.focus();
  };

  const editor = useEditor({
    // Next renders this on the client only; TipTap warns loudly otherwise.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        // StarterKit v3 bundles Link itself. Left on, the explicit Link
        // below registers a second copy -- TipTap warns "Duplicate extension
        // names found: ['link']" -- and every link plugin (autolink, paste,
        // click) runs twice. This one is configured with the outgoing-mail
        // scheme allowlist; the bundled default is not, so it is the one
        // that goes.
        link: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        // A link typed into a compose window is going out to someone else.
        // Restricting the schemes here means a paste cannot smuggle a
        // javascript: URL into an outgoing message.
        protocols: ['http', 'https', 'mailto', 'tel'],
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Image.configure({
        // Inline, so a logo can sit beside a name in a signature rather than
        // forcing its own block.
        inline: true,
        // data: is the whole mechanism -- see the note at the top. A stored
        // signature comes back from the server as data: too, and without this
        // the extension refuses to parse it and the picture disappears from
        // the settings editor.
        allowBase64: true,
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: initialHtml,
    editorProps: {
      attributes: {
        class:
          'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[12rem] px-3 py-2',
        'aria-label': 'Message body',
      },
      // A screenshot on the clipboard arrives as a file, not as HTML.
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter(isAcceptedImage);
        if (files.length === 0) return false;
        event.preventDefault();
        void insertFiles(view, files);
        return true;
      },
      // `moved` is a drag of content already inside the editor, which
      // ProseMirror handles itself.
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []).filter(isAcceptedImage);
        if (files.length === 0) return false;
        event.preventDefault();
        const dropped = view.posAtCoords({ left: event.clientX, top: event.clientY });
        void insertFiles(view, files, dropped?.pos);
        return true;
      },
    },
    onUpdate: ({ editor: instance }) => onChange(instance.getHTML()),
  });

  // Focus at the start, above any quoted text -- the same behaviour the old
  // editor needed explicit range juggling for. Runs once, on the editor
  // becoming available: re-running it would move the caret mid-typing.
  //
  // NOT `editor.commands.focus('start')`. TipTap's focus command has an
  // Android/iOS branch that calls view.dom.focus() synchronously INSIDE the
  // command, before the command manager dispatches the command's own
  // transaction. On Chrome for Android that focus re-enters ProseMirror
  // (focus + selectionchange -> DOMObserver flush), which can move the
  // state on underneath the still-pending transaction; ProseMirror then
  // throws "RangeError: Applying a mismatched transaction" out of this
  // effect, and React hands the whole page to the error boundary. That was
  // Reply on a phone: the quoted message made a document the flush had
  // something to say about, a blank New message did not.
  //
  // Dispatching a fresh selection first and focusing the view afterwards
  // leaves no pending transaction for the focus to invalidate. And the caret
  // position is a courtesy, so a failure here is logged, never thrown -- an
  // editor that opens with the caret in the wrong place is usable; an error
  // page is not.
  useEffect(() => {
    if (!editor) return;
    try {
      const { state, view } = editor;
      view.dispatch(state.tr.setSelection(Selection.atStart(state.doc)));
      view.focus();
    } catch (error) {
      console.warn('Could not focus the editor', error);
    }
  }, [editor]);

  if (!editor) {
    return <div className="flex-1 px-3 py-2 text-sm text-gray-400">Loading editor…</div>;
  }

  const applyLink = () => {
    const url = linkValue.trim();
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
    setLinkOpen(false);
    setLinkValue('');
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center flex-wrap gap-0.5 px-2 py-1 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <ToolButton editor={editor} label="Bold" mark="bold" onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={15} />
        </ToolButton>
        <ToolButton editor={editor} label="Italic" mark="italic" onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic size={15} />
        </ToolButton>
        <ToolButton editor={editor} label="Strikethrough" mark="strike" onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough size={15} />
        </ToolButton>

        <Divider />

        <ToolButton
          editor={editor}
          label="Heading"
          mark="heading"
          markAttrs={{ level: 2 }}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 size={15} />
        </ToolButton>
        <ToolButton editor={editor} label="Bullet list" mark="bulletList" onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List size={15} />
        </ToolButton>
        <ToolButton editor={editor} label="Numbered list" mark="orderedList" onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered size={15} />
        </ToolButton>
        <ToolButton editor={editor} label="Quote" mark="blockquote" onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote size={15} />
        </ToolButton>
        <ToolButton editor={editor} label="Code block" mark="codeBlock" onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
          <Code size={15} />
        </ToolButton>

        <Divider />

        <ToolButton
          editor={editor}
          label="Insert link"
          mark="link"
          onClick={() => {
            setLinkValue(editor.getAttributes('link').href ?? '');
            setLinkOpen((open) => !open);
          }}
        >
          <LinkIcon size={15} />
        </ToolButton>
        {editor.isActive('link') && (
          <ToolButton
            editor={editor}
            label="Remove link"
            onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
          >
            <Unlink size={15} />
          </ToolButton>
        )}
        <ToolButton editor={editor} label="Insert image" onClick={() => imageInputRef.current?.click()}>
          <ImagePlus size={15} />
        </ToolButton>
        <input
          ref={imageInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            // Reset so re-picking the same file fires change again.
            e.target.value = '';
            void insertFiles(editor.view, files);
          }}
        />

        <Divider />

        <ToolButton editor={editor} label="Undo" onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 size={15} />
        </ToolButton>
        <ToolButton editor={editor} label="Redo" onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 size={15} />
        </ToolButton>

        {toolbarExtra && <div className="ml-auto">{toolbarExtra}</div>}
      </div>

      {linkOpen && (
        <div className="flex items-center gap-2 px-2 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <input
            autoFocus
            value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLink();
              }
              if (e.key === 'Escape') setLinkOpen(false);
            }}
            placeholder="https://example.com  (empty removes the link)"
            className="flex-1 text-sm px-2 py-1 border border-gray-200 dark:border-gray-700 rounded bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <button onClick={applyLink} className="text-sm px-3 py-1 rounded bg-primary text-black">
            Apply
          </button>
          <button
            onClick={() => setLinkOpen(false)}
            className="text-sm px-2 py-1 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            Cancel
          </button>
        </div>
      )}

      {imageError && (
        <div
          role="alert"
          className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300"
        >
          <span className="flex-1">{imageError}</span>
          <button
            onClick={() => setImageError(null)}
            className="text-xs px-2 py-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/40"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function Divider() {
  return <span className="w-px h-5 mx-1 bg-gray-200 dark:bg-gray-700" />;
}

function ToolButton({
  editor,
  label,
  mark,
  markAttrs,
  onClick,
  children,
}: {
  editor: Editor;
  label: string;
  mark?: string;
  markAttrs?: Record<string, unknown>;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const active = mark ? editor.isActive(mark, markAttrs) : false;

  return (
    <button
      type="button"
      onClick={onClick}
      // Keep focus in the editor when a toolbar button is pressed. Every
      // handler here runs `chain().focus()...`, and with the editor already
      // focused TipTap's focus command returns before its Android-only
      // view.dom.focus() -- the re-entrant call behind "Applying a
      // mismatched transaction" (see the mount effect). It also keeps the
      // selection the formatting is meant to apply to, which is what every
      // editor toolbar does.
      onMouseDown={(e) => e.preventDefault()}
      title={label}
      aria-label={label}
      aria-pressed={mark ? active : undefined}
      className={`p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
        active ? 'bg-gray-200 dark:bg-gray-700 text-primary' : 'text-gray-700 dark:text-gray-300'
      }`}
    >
      {children}
    </button>
  );
}
