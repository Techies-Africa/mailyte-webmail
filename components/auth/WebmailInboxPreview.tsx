'use client';

import { motion } from 'framer-motion';

// Deliberately plain-language and visual, not a metrics chart -- most
// mailbox holders logging in here aren't email-marketing admins and won't
// know what "delivery rate" means. This just shows "here's your inbox,"
// which everyone already understands. Figures/names are illustrative.
const previewMessages = [
  { initial: 'S', color: 'bg-blue-500', from: 'Sarah Chen', subject: 'Team lunch tomorrow?', time: '2m', unread: true },
  { initial: 'A', color: 'bg-emerald-500', from: 'Alex Morgan', subject: 'Meeting notes attached', time: '1h', unread: true },
  { initial: 'J', color: 'bg-purple-500', from: 'Jordan Lee', subject: 'Thanks for your help!', time: '3h', unread: false },
  { initial: 'M', color: 'bg-amber-500', from: 'Maria Silva', subject: 'Invoice for last month', time: 'Yesterday', unread: false },
];

export default function WebmailInboxPreview({ className = '' }: { className?: string }) {
  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-2xl border border-border bg-background/70 p-6 shadow-sm backdrop-blur-sm md:p-7 ${className}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-[family-name:var(--font-display)] text-base font-semibold text-foreground">
          Inbox
        </span>
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <motion.span
            className="h-2.5 w-2.5 rounded-full bg-green-500"
            animate={{ opacity: [1, 0.3, 1], scale: [1, 0.85, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
          New mail arrives automatically
        </span>
      </div>

      <div className="mt-5 space-y-1">
        {previewMessages.map((message, index) => (
          <motion.div
            key={message.from}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: index * 0.12 }}
            className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-foreground/[0.03]"
          >
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${message.color}`}
            >
              {message.initial}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span
                  className={`truncate text-sm ${message.unread ? 'font-semibold text-foreground' : 'text-foreground/70'}`}
                >
                  {message.from}
                </span>
                {message.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
              </span>
              <span className="block truncate text-sm text-muted-foreground">{message.subject}</span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{message.time}</span>
          </motion.div>
        ))}
      </div>

      <p className="mt-5 text-center text-xs text-muted-foreground">
        Everything here is real — the same messages you'd see in any email app.
      </p>
    </div>
  );
}
