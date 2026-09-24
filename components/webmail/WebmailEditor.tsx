'use client';

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
  Underline as UnderlineIcon,
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
  Smile,
} from 'lucide-react';
import { ACCEPTED_IMAGE_TYPES, imageFileToDataUrl, isAcceptedImage } from '@/lib/webmail/images';
import EmojiPicker from './EmojiPicker';

/**
 * The compose editor (PRD C1), on TipTap.
 *
 * Links use a small inline prompt rather than window.prompt(). Pictures go
 * INTO the document as data: URIs -- inserted from the toolbar, pasted, or
 * dropped -- and the mail server turns them into Content-ID parts on send.
 *
 * The toolbar can sit above the text or below it: the redesign puts the
 * formatting row at the foot of the compose window, beside Send, while the
 * signature editor in Settings keeps it on top.
 */

type WebmailEditorProps = {
  /** Initial HTML. Read once on mount. */
  initialHtml: string;
  placeholder?: string;
  onChange: (html: string) => void;
  /** Rendered at the right-hand end of the toolbar (the AI Write button). */
  toolbarExtra?: React.ReactNode;
  toolbarPosition?: 'top' | 'bottom';
  /** A shorter toolbar and a lower minimum height, for the inline reply. */
  compact?: boolean;
  /** Focus at the start when mounted. Off for the signature editor. */
  autoFocus?: boolean;
  minHeightClass?: string;
};

export default function WebmailEditor({
  initialHtml,
  placeholder = 'Write your message…',
  onChange,
  toolbarExtra,
  toolbarPosition = 'top',
  compact = false,
  autoFocus = true,
  minHeightClass,
}: WebmailEditorProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  /**
   * Insert image files at the selection (or at `pos`, for a drop). Written
   * against the ProseMirror view so the toolbar button, paste and drop share
   * one path.
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
        // StarterKit v3 bundles Link; the explicit one below carries the
        // outgoing-mail scheme allowlist, so the bundled copy is turned off.
        link: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        // A pasted javascript: URL must never travel in an outgoing message.
        protocols: ['http', 'https', 'mailto', 'tel'],
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Image.configure({
        inline: true,
        // data: is the whole mechanism; a stored signature comes back as data: too.
        allowBase64: true,
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: initialHtml,
    editorProps: {
      attributes: {
        class: `prose prose-sm dark:prose-invert max-w-none focus:outline-none px-4 py-3 text-[13.5px] leading-[1.75] text-foreground ${
          minHeightClass ?? (compact ? 'min-h-[7rem]' : 'min-h-[12rem]')
        }`,
        'aria-label': 'Message body',
      },
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter(isAcceptedImage);
        if (files.length === 0) return false;
        event.preventDefault();
        void insertFiles(view, files);
        return true;
      },
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

  // Focus at the start, above any quoted text. NOT `editor.commands.focus`:
  // TipTap's focus command has a mobile branch that re-enters ProseMirror
  // mid-command and threw "Applying a mismatched transaction" on Android.
  // Dispatching a fresh selection and focusing the view afterwards leaves no
  // pending transaction for the focus to invalidate.
  useEffect(() => {
    if (!editor || !autoFocus) return;
    try {
      const { state, view } = editor;
      view.dispatch(state.tr.setSelection(Selection.atStart(state.doc)));
      view.focus();
    } catch (error) {
      console.warn('Could not focus the editor', error);
    }
  }, [editor, autoFocus]);

  if (!editor) {
    return <div className="flex-1 px-4 py-3 text-sm text-muted-foreground">Loading editor…</div>;
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

  const toolbar = (
    <div
      className={`flex shrink-0 flex-wrap items-center gap-0.5 px-2 py-1 ${
        toolbarPosition === 'top' ? 'border-b border-border bg-muted/60' : 'border-t border-border bg-pane'
      }`}
    >
      <ToolButton editor={editor} label="Bold" mark="bold" onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold size={14} />
      </ToolButton>
      <ToolButton editor={editor} label="Italic" mark="italic" onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic size={14} />
      </ToolButton>
      <ToolButton
        editor={editor}
        label="Underline"
        mark="underline"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon size={14} />
      </ToolButton>
      {!compact && (
        <ToolButton editor={editor} label="Strikethrough" mark="strike" onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough size={14} />
        </ToolButton>
      )}

      <Divider />

      {!compact && (
        <ToolButton
          editor={editor}
          label="Heading"
          mark="heading"
          markAttrs={{ level: 2 }}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 size={14} />
        </ToolButton>
      )}
      <ToolButton editor={editor} label="Bullet list" mark="bulletList" onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List size={14} />
      </ToolButton>
      <ToolButton editor={editor} label="Numbered list" mark="orderedList" onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered size={14} />
      </ToolButton>
      {!compact && (
        <>
          <ToolButton editor={editor} label="Quote" mark="blockquote" onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            <Quote size={14} />
          </ToolButton>
          <ToolButton editor={editor} label="Code block" mark="codeBlock" onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
            <Code size={14} />
          </ToolButton>
        </>
      )}

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
        <LinkIcon size={14} />
      </ToolButton>
      {editor.isActive('link') && (
        <ToolButton editor={editor} label="Remove link" onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}>
          <Unlink size={14} />
        </ToolButton>
      )}
      <ToolButton editor={editor} label="Insert picture" onClick={() => imageInputRef.current?.click()}>
        <ImagePlus size={14} />
      </ToolButton>
      <input
        ref={imageInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void insertFiles(editor.view, files);
        }}
      />
      <span className="relative inline-flex">
        <ToolButton editor={editor} label="Emoji" onClick={() => setEmojiOpen((v) => !v)}>
          <Smile size={14} />
        </ToolButton>
        {emojiOpen && (
          <EmojiPicker
            direction={toolbarPosition === 'bottom' ? 'up' : 'down'}
            onClose={() => setEmojiOpen(false)}
            onPick={(emoji) => {
              editor.chain().focus().insertContent(emoji).run();
              setEmojiOpen(false);
            }}
          />
        )}
      </span>

      {!compact && (
        <>
          <Divider />
          <ToolButton editor={editor} label="Undo" onClick={() => editor.chain().focus().undo().run()}>
            <Undo2 size={14} />
          </ToolButton>
          <ToolButton editor={editor} label="Redo" onClick={() => editor.chain().focus().redo().run()}>
            <Redo2 size={14} />
          </ToolButton>
        </>
      )}

      {toolbarExtra && <div className="ml-auto">{toolbarExtra}</div>}
    </div>
  );

  const linkRow = linkOpen && (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-2 py-1.5">
      <input
        autoFocus
        value={linkValue}
        onChange={(e) => setLinkValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            applyLink();
          }
          if (e.key === 'Escape') {
            // Handled: the inline reply this editor may sit in stays open.
            e.preventDefault();
            setLinkOpen(false);
          }
        }}
        placeholder="https://example.com  (empty removes the link)"
        className="flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[12.5px] focus:border-primary focus:outline-none"
      />
      <button type="button" onClick={applyLink} className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
        Apply
      </button>
      <button type="button" onClick={() => setLinkOpen(false)} className="px-1.5 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
        Cancel
      </button>
    </div>
  );

  const errorRow = imageError && (
    <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-border bg-destructive/10 px-3 py-1.5 text-[12.5px] text-destructive">
      <span className="flex-1">{imageError}</span>
      <button type="button" onClick={() => setImageError(null)} className="rounded px-2 py-0.5 text-xs font-semibold hover:bg-destructive/10">
        Dismiss
      </button>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {toolbarPosition === 'top' && (
        <>
          {toolbar}
          {linkRow}
          {errorRow}
        </>
      )}
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
      {toolbarPosition === 'bottom' && (
        <>
          {errorRow}
          {linkRow}
          {toolbar}
        </>
      )}
    </div>
  );
}

function Divider() {
  return <span className="mx-1 h-4 w-px bg-border" />;
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
      // Keep focus in the editor when a toolbar button is pressed, so the
      // selection the formatting applies to survives the click.
      onMouseDown={(e) => e.preventDefault()}
      title={label}
      aria-label={label}
      aria-pressed={mark ? active : undefined}
      className={`inline-flex h-[26px] w-[26px] items-center justify-center rounded-md transition-colors ${
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}
