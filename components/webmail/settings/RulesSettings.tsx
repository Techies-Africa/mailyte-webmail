'use client';

import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDown, ArrowUp, ListFilter, Pencil, Plus, Trash2, X } from 'lucide-react';
import { updateRules, type ApiRule } from '@/lib/webmail/client';
import type { WebmailFolder } from '@/components/webmail/types';
import { useLabels } from '@/lib/webmail/query/accountQueries';
import { foldersQuery } from '@/lib/webmail/query/mailQueries';
import { settingsKeys, useRules } from '@/lib/webmail/query/settingsQueries';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import { Hint, Input, Label, Select, Switch } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import ConfirmModal from '../modals/ConfirmModal';
import { labelTitle } from '@/lib/webmail/tags';
import type { SettingsSectionProps } from './types';

/**
 * Filter rules.
 *
 * Each rule is "when a message arrives and these things are true, do this".
 * The mail server compiles the list to Sieve and runs it at delivery, so a
 * rule works with this page closed and in every mail app on the mailbox.
 * The list is written straight away on every change -- there is no Save
 * button, because the list IS the setting (the same as Blocked senders).
 *
 * Every word on screen comes from the tables below, never from the
 * server's field names: "from / contains / fileinto" is what the rule
 * compiles to, not what a person is asked to read.
 */

/** Matches MAX_RULES on the mail server. */
const MAX_RULES = 50;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Field = 'from' | 'to' | 'cc' | 'subject' | 'body';
type Operator = 'contains' | 'is' | 'matches';
type ActionType = 'move' | 'label' | 'flag' | 'mark_read' | 'forward' | 'discard';

const FIELDS: { value: Field; label: string; placeholder: string }[] = [
  { value: 'from', label: 'Sender', placeholder: 'name@example.com or example.com' },
  { value: 'to', label: 'Sent to', placeholder: 'an address in the To line' },
  { value: 'cc', label: 'Copied to (Cc)', placeholder: 'an address in the Cc line' },
  { value: 'subject', label: 'Subject', placeholder: 'words in the subject' },
  { value: 'body', label: 'Message text', placeholder: 'words in the message' },
];

const OPERATORS: { value: Operator; label: string }[] = [
  { value: 'contains', label: 'contains' },
  { value: 'is', label: 'is exactly' },
  { value: 'matches', label: 'matches the pattern' },
];

const ACTIONS: { value: ActionType; label: string; needs: 'folder' | 'label' | 'email' | null }[] = [
  { value: 'move', label: 'Move it to the folder', needs: 'folder' },
  { value: 'label', label: 'Add the label', needs: 'label' },
  { value: 'flag', label: 'Star it', needs: null },
  { value: 'mark_read', label: 'Mark it as read', needs: null },
  { value: 'forward', label: 'Send a copy to', needs: 'email' },
  { value: 'discard', label: 'Delete it', needs: null },
];

const fieldLabel = (value: string) => FIELDS.find((f) => f.value === value)?.label ?? value;
const operatorLabel = (value: string) => OPERATORS.find((o) => o.value === value)?.label ?? 'contains';
const actionMeta = (value: string) => ACTIONS.find((a) => a.value === value);

/** "INBOX" is what IMAP calls it; nobody else does. */
const folderTitle = (name: string) => (name === 'INBOX' ? 'Inbox' : name);

/** The same slug rule the server applies, so the picker shows what will be stored. */
function labelSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/_{2,}/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 40);
}

interface Condition {
  field: Field;
  operator: Operator;
  value: string;
}

interface Action {
  type: ActionType;
  value: string;
}

interface Draft {
  id?: string;
  name: string;
  match: 'all' | 'any';
  conditions: Condition[];
  actions: Action[];
  enabled: boolean;
}

function toDraft(rule: ApiRule): Draft {
  return {
    id: rule.id,
    name: rule.name ?? '',
    match: rule.match === 'any' ? 'any' : 'all',
    conditions: (rule.conditions ?? []).map((c) => ({
      field: (FIELDS.some((f) => f.value === c.field) ? c.field : 'from') as Field,
      operator: (OPERATORS.some((o) => o.value === c.operator) ? c.operator : 'contains') as Operator,
      value: c.value ?? '',
    })),
    actions: (rule.actions ?? []).map((a) => ({
      type: (ACTIONS.some((x) => x.value === a.type) ? a.type : 'move') as ActionType,
      value: a.value ?? '',
    })),
    enabled: rule.enabled !== false,
  };
}

function emptyDraft(): Draft {
  return {
    name: '',
    match: 'all',
    conditions: [{ field: 'from', operator: 'contains', value: '' }],
    actions: [{ type: 'move', value: '' }],
    enabled: true,
  };
}

function conditionText(c: { field: string; operator?: string; value?: string }): string {
  return `${fieldLabel(c.field)} ${operatorLabel(c.operator ?? 'contains')} “${c.value ?? ''}”`;
}

function actionText(a: { type: string; value?: string }): string {
  const meta = actionMeta(a.type);
  if (!meta) return a.type;
  if (meta.needs === 'folder') return `Move to ${folderTitle(a.value ?? '')}`;
  if (meta.needs === 'label') return `Label ${labelTitle(labelSlug(a.value ?? ''))}`;
  if (meta.needs === 'email') return `Send a copy to ${a.value ?? ''}`;
  return meta.label;
}

const NO_FOLDERS: WebmailFolder[] = [];

export default function RulesSettings({ onUnauthorized }: SettingsSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // The rules are cached; the folders and labels are the same cached copies
  // the mailbox uses, so none of the three loads again on a second visit.
  const rulesResult = useRules(onUnauthorized);
  const rules = rulesResult.data ? (rulesResult.data.rules ?? []) : null;
  const managed = rulesResult.data?.managed !== false;
  const loadError = !rulesResult.data && rulesResult.isError ? rulesResult.error.message : null;
  const folders: WebmailFolder[] = useQuery(foldersQuery(queryClient, onUnauthorized)).data ?? NO_FOLDERS;
  const labels = useLabels();

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ index: number | null; draft: Draft } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  /** Folders a rule may file into: yours, not a shared mailbox's. */
  const fileableFolders = useMemo(
    () =>
      folders
        .filter((f) => !f.name.startsWith('Shared/'))
        .sort((a, b) => {
          if (a.name === 'INBOX') return -1;
          if (b.name === 'INBOX') return 1;
          return folderTitle(a.name).localeCompare(folderTitle(b.name));
        }),
    [folders],
  );

  // Only the newest write's answer may land: two quick toggles send two whole
  // lists, and the first answer must not paint over the second.
  const writeTicket = useRef(0);

  /**
   * Write the whole list; the server replaces the script in one go. The list
   * on screen changes at once, and goes back, with the reason, if the server
   * refuses.
   */
  const persist = async (next: ApiRule[], done: string): Promise<boolean> => {
    const ticket = ++writeTicket.current;
    const before = queryClient.getQueryData(settingsKeys.rules);
    queryClient.setQueryData(settingsKeys.rules, (prev: { rules: ApiRule[]; active: boolean; managed: boolean } | undefined) =>
      prev ? { ...prev, rules: next } : prev,
    );
    setBusy(true);
    setError(null);
    const result = await updateRules(next, onUnauthorized);
    if (ticket !== writeTicket.current) return result.success;
    setBusy(false);
    if (!result.success) {
      queryClient.setQueryData(settingsKeys.rules, before);
      setError(result.message);
      return false;
    }
    queryClient.setQueryData(settingsKeys.rules, (prev: { rules: ApiRule[]; active: boolean; managed: boolean } | undefined) =>
      prev ? { ...prev, rules: result.data?.rules ?? next, managed: true } : prev,
    );
    toast(done);
    return true;
  };

  const toggle = (index: number, enabled: boolean) => {
    if (!rules) return;
    const next = rules.map((r, i) => (i === index ? { ...r, enabled } : r));
    void persist(next, enabled ? 'Rule turned on' : 'Rule turned off');
  };

  const move = (index: number, delta: -1 | 1) => {
    if (!rules) return;
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target], next[index]];
    void persist(next, 'Order changed');
  };

  const remove = async () => {
    if (!rules || pendingDelete === null) return;
    const name = rules[pendingDelete]?.name ?? 'Rule';
    const ok = await persist(
      rules.filter((_, i) => i !== pendingDelete),
      `Deleted “${name}”`,
    );
    if (ok) setPendingDelete(null);
  };

  const commit = async (draft: Draft): Promise<string | null> => {
    if (!rules) return 'Rules have not loaded yet.';
    const conditions = draft.conditions.filter((c) => c.value.trim() !== '');
    if (conditions.length === 0) return 'Add at least one condition, with something to look for.';
    if (draft.actions.length === 0) return 'Add at least one thing to do.';
    for (const action of draft.actions) {
      const meta = actionMeta(action.type);
      if (!meta) continue;
      const value = action.value.trim();
      if (meta.needs === 'folder' && value === '') return 'Choose a folder to move the message to.';
      if (meta.needs === 'label' && labelSlug(value) === '') return 'Type a label to add.';
      if (meta.needs === 'email' && !EMAIL_RE.test(value)) return 'Enter a full email address to send a copy to.';
    }
    const name = draft.name.trim() || conditionText(conditions[0]).slice(0, 60);
    const rule: ApiRule = {
      id: draft.id,
      name,
      match: draft.match,
      enabled: draft.enabled,
      conditions: conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value.trim() })),
      actions: draft.actions.map((a) => {
        const meta = actionMeta(a.type);
        if (!meta || meta.needs === null) return { type: a.type };
        return { type: a.type, value: meta.needs === 'label' ? labelSlug(a.value) : a.value.trim() };
      }),
    };
    const next = editing?.index === null || editing?.index === undefined
      ? [...rules, rule]
      : rules.map((r, i) => (i === editing.index ? rule : r));
    if (next.length > MAX_RULES) return `You can have at most ${MAX_RULES} rules.`;
    const ok = await persist(next, editing?.index === null ? `Added “${name}”` : `Saved “${name}”`);
    return ok ? null : 'The rule could not be saved.';
  };

  if (loadError) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {loadError}
      </p>
    );
  }

  if (!rules) {
    return <p className="text-sm text-muted-foreground">Loading rules…</p>;
  }

  return (
    <div className="space-y-6" data-shortcuts="off">
      <section>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          A rule sorts mail the moment it arrives, before you see it. Rules run on the mail server, so they work
          while this page is closed and in every mail app you use with this mailbox. They run in the order shown,
          from the top.
        </p>
        {!managed && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-warning/[0.12] px-3 py-2.5 text-sm text-warning">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>This mailbox already has filter rules that were not created here. The first change below replaces them.</span>
          </p>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-[13px] font-semibold">
            Your rules{' '}
            <span className="font-normal text-muted-foreground">
              {rules.length} of {MAX_RULES}
            </span>
          </h3>
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={13} />}
            disabled={busy || rules.length >= MAX_RULES}
            onClick={() => setEditing({ index: null, draft: emptyDraft() })}
          >
            New rule
          </Button>
        </div>

        {rules.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <ListFilter size={22} className="mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm font-semibold">No rules yet</p>
            <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
              Start with something like “move newsletters to a folder” or “label receipts as they arrive”.
            </p>
          </div>
        ) : (
          <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {rules.map((rule, index) => {
              const enabled = rule.enabled !== false;
              return (
                <li key={rule.id ?? index} className={`px-3.5 py-3 ${enabled ? '' : 'bg-muted/40'}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex shrink-0 flex-col pt-0.5">
                      <button
                        type="button"
                        onClick={() => move(index, -1)}
                        disabled={busy || index === 0}
                        aria-label={`Move “${rule.name}” up`}
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(index, 1)}
                        disabled={busy || index === rules.length - 1}
                        aria-label={`Move “${rule.name}” down`}
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowDown size={13} />
                      </button>
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-[13.5px] font-semibold ${enabled ? '' : 'text-muted-foreground'}`}>{rule.name}</p>
                      <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                        <span className="font-semibold text-foreground/70">If </span>
                        {(rule.conditions ?? []).map(conditionText).join(rule.match === 'any' ? ' or ' : ' and ')}
                      </p>
                      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                        <span className="font-semibold text-foreground/70">Then </span>
                        {(rule.actions ?? []).map(actionText).join(' · ')}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <Switch checked={enabled} onChange={(next) => toggle(index, next)} label={enabled ? 'On' : 'Off'} disabled={busy} />
                      <button
                        type="button"
                        onClick={() => setEditing({ index, draft: toDraft(rule) })}
                        disabled={busy}
                        aria-label={`Edit “${rule.name}”`}
                        title="Edit"
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(index)}
                        disabled={busy}
                        aria-label={`Delete “${rule.name}”`}
                        title="Delete"
                        className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {error && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </section>

      {editing && (
        <RuleEditor
          draft={editing.draft}
          isNew={editing.index === null}
          folders={fileableFolders}
          labels={labels}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={async (draft) => {
            const problem = await commit(draft);
            if (problem === null) setEditing(null);
            return problem;
          }}
        />
      )}

      <ConfirmModal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={remove}
        keepOpenOnConfirm
        icon={<Trash2 size={16} />}
        tone="danger"
        title="Delete this rule?"
        body={
          <>
            “{pendingDelete !== null ? rules[pendingDelete]?.name : ''}” stops running. Mail it already sorted stays
            where it is.
          </>
        }
        confirmLabel="Delete rule"
      />
    </div>
  );
}

// --- The editor ----------------------------------------------------------------

type RuleEditorProps = {
  draft: Draft;
  isNew: boolean;
  folders: WebmailFolder[];
  labels: string[];
  busy: boolean;
  onCancel: () => void;
  /** Returns a problem to show, or null when saved. */
  onSave: (draft: Draft) => Promise<string | null>;
};

function RuleEditor({ draft: initial, isNew, folders, labels, busy, onCancel, onSave }: RuleEditorProps) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [problem, setProblem] = useState<string | null>(null);

  const setCondition = (index: number, patch: Partial<Condition>) =>
    setDraft((d) => ({ ...d, conditions: d.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)) }));
  const setAction = (index: number, patch: Partial<Action>) =>
    setDraft((d) => ({ ...d, actions: d.actions.map((a, i) => (i === index ? { ...a, ...patch } : a)) }));

  const hasDiscard = draft.actions.some((a) => a.type === 'discard');
  const hasPattern = draft.conditions.some((c) => c.operator === 'matches');
  const namePlaceholder =
    draft.conditions.find((c) => c.value.trim() !== '') !== undefined
      ? conditionText(draft.conditions.find((c) => c.value.trim() !== '')!)
      : 'Newsletters, Receipts, From the bank…';

  return (
    <Dialog
      open
      onClose={onCancel}
      title={isNew ? 'New rule' : 'Edit rule'}
      icon={<ListFilter size={16} />}
      width="lg"
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            onClick={() => {
              setProblem(null);
              void onSave(draft).then((p) => setProblem(p));
            }}
          >
            {isNew ? 'Add rule' : 'Save rule'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <Label htmlFor="rule-name">Name</Label>
          <Input
            id="rule-name"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder={namePlaceholder}
            autoComplete="off"
            maxLength={80}
          />
          <Hint>Only you see this. Leave it blank and the first condition becomes the name.</Hint>
        </div>

        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[13px] font-semibold">
            <span>When a message arrives and</span>
            <Select
              value={draft.match}
              onChange={(e) => setDraft((d) => ({ ...d, match: e.target.value as 'all' | 'any' }))}
              aria-label="How many conditions must be true"
              className="w-auto py-1"
            >
              <option value="all">all</option>
              <option value="any">any</option>
            </Select>
            <span>of these are true</span>
          </div>
          <div className="space-y-2">
            {draft.conditions.map((condition, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                <Select
                  value={condition.field}
                  onChange={(e) => setCondition(index, { field: e.target.value as Field })}
                  aria-label={`Condition ${index + 1}: which part of the message`}
                  className="sm:w-40"
                >
                  {FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </Select>
                <Select
                  value={condition.operator}
                  onChange={(e) => setCondition(index, { operator: e.target.value as Operator })}
                  aria-label={`Condition ${index + 1}: how to compare`}
                  className="sm:w-44"
                >
                  {OPERATORS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                <Input
                  value={condition.value}
                  onChange={(e) => setCondition(index, { value: e.target.value })}
                  placeholder={FIELDS.find((f) => f.value === condition.field)?.placeholder}
                  aria-label={`Condition ${index + 1}: what to look for`}
                  autoComplete="off"
                  className="min-w-[10rem] flex-1"
                />
                <button
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, conditions: d.conditions.filter((_, i) => i !== index) }))}
                  disabled={draft.conditions.length === 1}
                  aria-label={`Remove condition ${index + 1}`}
                  className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <Button
              variant="dashed"
              size="sm"
              icon={<Plus size={12} />}
              onClick={() =>
                setDraft((d) => ({ ...d, conditions: [...d.conditions, { field: 'subject', operator: 'contains', value: '' }] }))
              }
            >
              Add a condition
            </Button>
          </div>
          {hasPattern && (
            <Hint>
              In a pattern, <span className="font-mono">*</span> stands for anything and{' '}
              <span className="font-mono">?</span> for one character, so <span className="font-mono">*@example.com</span>{' '}
              is everyone at example.com.
            </Hint>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-[13px] font-semibold">Do this</p>
          <div className="space-y-2">
            {draft.actions.map((action, index) => {
              const meta = actionMeta(action.type);
              return (
                <div key={index} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                  <Select
                    value={action.type}
                    onChange={(e) => setAction(index, { type: e.target.value as ActionType, value: '' })}
                    aria-label={`Action ${index + 1}`}
                    className="sm:w-52"
                  >
                    {ACTIONS.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </Select>
                  {meta?.needs === 'folder' && (
                    <Select
                      value={action.value}
                      onChange={(e) => setAction(index, { value: e.target.value })}
                      aria-label={`Action ${index + 1}: folder`}
                      className="min-w-[10rem] flex-1"
                    >
                      <option value="">Choose a folder…</option>
                      {folders.map((f) => (
                        <option key={f.id} value={f.name}>
                          {folderTitle(f.name)}
                        </option>
                      ))}
                    </Select>
                  )}
                  {meta?.needs === 'label' && (
                    <>
                      <Input
                        list="rule-known-labels"
                        value={action.value}
                        onChange={(e) => setAction(index, { value: e.target.value })}
                        placeholder="Receipt, Follow up, Q4 launch…"
                        aria-label={`Action ${index + 1}: label`}
                        autoComplete="off"
                        maxLength={40}
                        className="min-w-[10rem] flex-1"
                      />
                      <datalist id="rule-known-labels">
                        {labels.map((slug) => (
                          <option key={slug} value={labelTitle(slug)} />
                        ))}
                      </datalist>
                    </>
                  )}
                  {meta?.needs === 'email' && (
                    <Input
                      type="email"
                      value={action.value}
                      onChange={(e) => setAction(index, { value: e.target.value })}
                      placeholder="name@example.com"
                      aria-label={`Action ${index + 1}: address`}
                      autoComplete="off"
                      className="min-w-[10rem] flex-1"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, actions: d.actions.filter((_, i) => i !== index) }))}
                    disabled={draft.actions.length === 1}
                    aria-label={`Remove action ${index + 1}`}
                    className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-2">
            <Button
              variant="dashed"
              size="sm"
              icon={<Plus size={12} />}
              onClick={() => setDraft((d) => ({ ...d, actions: [...d.actions, { type: 'label', value: '' }] }))}
            >
              Do something else too
            </Button>
          </div>
          {hasDiscard && (
            <p className="mt-2 flex items-start gap-2 rounded-lg bg-warning/[0.12] px-3 py-2 text-xs text-warning">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>
                “Delete it” throws the message away before it reaches you. It never goes to Trash and cannot be got
                back. Moving it to Junk is the safer choice unless you are sure.
              </span>
            </p>
          )}
        </div>

        <Switch checked={draft.enabled} onChange={(next) => setDraft((d) => ({ ...d, enabled: next }))} label="Rule is on" />

        {problem && (
          <p className="text-sm text-destructive" role="alert">
            {problem}
          </p>
        )}
      </div>
    </Dialog>
  );
}
