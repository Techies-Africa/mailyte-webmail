import { useEffect, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
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
} from 'lucide-react';

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

  const editor = useEditor({
    // Next renders this on the client only; TipTap warns loudly otherwise.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
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
      Placeholder.configure({ placeholder }),
    ],
    content: initialHtml,
    editorProps: {
      attributes: {
        class:
          'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[12rem] px-3 py-2',
        'aria-label': 'Message body',
      },
    },
    onUpdate: ({ editor: instance }) => onChange(instance.getHTML()),
  });

  // Focus at the start, above any quoted text -- the same behaviour the old
  // editor needed explicit range juggling for. Runs once, on the editor
  // becoming available: re-running it would move the caret mid-typing.
  useEffect(() => {
    if (!editor) return;
    editor.commands.focus('start');
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
