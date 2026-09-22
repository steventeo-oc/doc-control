import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import {
  ExternalLink,
  History,
  Info,
  LoaderCircle,
  MessageSquarePlus,
  Pencil,
  RotateCcw,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { assistantApi, conversationsApi } from '../api/assistant';
import type { AssistantAnswer, AssistantConfig, AssistantSource, ConversationSummary } from '../api/assistant';
import { parseAnswer } from '../lib/answerText';
import type { Block, Inline } from '../lib/answerText';
import { cn } from '../lib/utils';
import { PageHeader } from '../components/PageHeader';
import { useSectionSidebar } from '../components/SectionSidebarContext';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Sheet, SheetContent, SheetTitle } from '../components/ui/sheet';

/**
 * "Ask": questions about the current controlled documents, answered from those documents with citations
 * (AI_Assistant_Design_PlanBack.md section 2.9), as saved, resumable conversations
 * (AI_Assistant_Conversations_PlanBack.md, Phase 1). The service behind it is separate (Python, mounted under
 * /api/assistant); this page only shows what it returns.
 *
 * Every question the page sends belongs to a conversation -- the first one starts a new one
 * (conversationsApi.start), every one after continues it (conversationsApi.continue) -- so a colleague's history is
 * never silently lost the way a single-shot page would lose it. The plain, unthreaded POST /assistant/ask stays in
 * the service for scripts (the release gate, the terminal client); the page itself never calls it.
 *
 * Three answer states are shown and never hidden: answered (cited), not covered (the text still says what the
 * documents do say) and unavailable (the closest documents are still listed). An answer is plain text: it is model
 * output built from document text, so it is parsed into paragraphs, lists, bold and citation chips and rendered
 * with React elements only (lib/answerText.ts), never as HTML. The only links on the page come from the sources'
 * metadata, never from model output.
 */

const DEFAULT_LIMIT = 600;
const DISCLAIMER =
  'AI-generated from controlled documents. The document is the controlled record: check it before acting. Lists may be incomplete.';

/** One exchange as the page renders it -- shaped the same whether it just came back live (AssistantAnswer) or was
 * loaded by reopening a saved conversation (ConversationMessage), so ExchangeCard never needs to know which. Fields
 * only a live answer carries (truncated, timing, model) are simply absent on a reopened one -- Phase 1 does not
 * persist them separately, a small, deliberate gap, not an oversight. */
interface Exchange {
  id: number;
  question: string;
  answer: string;
  state: AssistantAnswer['state'];
  sources: AssistantSource[];
  rating: 'up' | 'down' | null;
  comment: string | null;
  truncated?: boolean;
  ms?: number;
  model?: string;
  promptVersion?: string;
}

function exchangeFromAnswer(question: string, answer: AssistantAnswer): Exchange {
  return { id: answer.id, question, answer: answer.answer, state: answer.state, sources: answer.sources,
          rating: null, comment: null, truncated: answer.truncated, ms: answer.ms, model: answer.model,
          promptVersion: answer.promptVersion };
}

// ---------------------------------------------------------------------------------------------------------------
// Small helpers

function formatDay(day: string | null): string | null {
  if (!day) return null;
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return day;
  return new Date(year, month - 1, date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'not yet';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

interface Problem {
  tone: 'warning' | 'error';
  title: string;
  detail?: string;
}

/** What went wrong, in words a colleague can act on. 401 is handled by the caller (back to the login page). */
function describeProblem(error: unknown): Problem {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
        return { tone: 'warning', title: error.message };
      case 403:
        return { tone: 'warning', title: 'The assistant is not open to your department yet.' };
      case 404:
        return { tone: 'warning', title: 'The assistant is switched off at the moment, or that conversation is gone.' };
      case 429:
        return {
          tone: 'warning',
          title: 'You are asking a little too fast.',
          detail: error.retryAfter
            ? `Please wait ${plural(error.retryAfter, 'second')} and ask again.`
            : 'Please wait a moment and ask again.',
        };
      case 502:
      case 504:
        return {
          tone: 'error',
          title: 'The assistant is not reachable right now.',
          detail: 'Try again in a minute. If it keeps happening, tell an administrator.',
        };
      case 503:
        return { tone: 'warning', title: error.message };
      default:
        return { tone: 'error', title: 'Something went wrong.', detail: error.message };
    }
  }
  return { tone: 'error', title: 'The assistant could not be reached.', detail: 'Check your connection and try again.' };
}

// ---------------------------------------------------------------------------------------------------------------
// Pieces

const TONES = {
  warning: { box: 'border-warning/30 bg-warning/10', icon: 'text-warning' },
  error: { box: 'border-destructive/30 bg-destructive/10', icon: 'text-destructive' },
  info: { box: 'border-info/30 bg-info/10', icon: 'text-info' },
} as const;

function Notice({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: keyof typeof TONES;
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 rounded-xl border px-4 py-3 text-sm', TONES[tone].box)}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', TONES[tone].icon)} aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-medium text-foreground">{title}</p>
        {children && <div className="text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

function Cite({ label, onOpen }: { label: string; onOpen: (label: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(label)}
      aria-label={`Show source ${label}`}
      title={`Show source ${label}`}
      className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded border-0 bg-primary/10 px-1 align-baseline text-[11px] font-semibold text-primary outline-none transition-colors hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {label}
    </button>
  );
}

function Inlines({ parts, onCite }: { parts: Inline[]; onCite: (label: string) => void }) {
  return (
    <>
      {parts.map((part, index) => {
        switch (part.kind) {
          case 'bold':
            return (
              <strong key={index} className="font-semibold">
                {part.text}
              </strong>
            );
          case 'code':
            return (
              <code key={index} className="rounded bg-muted px-1 py-0.5 text-[0.9em]">
                {part.text}
              </code>
            );
          case 'cite':
            return (
              <span key={index}>
                {part.labels.map((label) => (
                  <Cite key={label} label={label} onOpen={onCite} />
                ))}
              </span>
            );
          default:
            return <span key={index}>{part.text}</span>;
        }
      })}
    </>
  );
}

function AnswerText({ blocks, onCite }: { blocks: Block[]; onCite: (label: string) => void }) {
  return (
    <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-foreground">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading':
            return (
              <p key={index} className="font-semibold">
                <Inlines parts={block.inline} onCite={onCite} />
              </p>
            );
          case 'list': {
            const items = block.items.map((item, i) => (
              <li key={i} className="pl-1">
                <Inlines parts={item} onCite={onCite} />
              </li>
            ));
            return block.ordered ? (
              <ol key={index} start={block.start} className="ml-5 flex list-decimal flex-col gap-1.5">
                {items}
              </ol>
            ) : (
              <ul key={index} className="ml-5 flex list-disc flex-col gap-1.5">
                {items}
              </ul>
            );
          }
          case 'table':
            return (
              <pre key={index} className="overflow-x-auto rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed">
                {block.text}
              </pre>
            );
          default:
            return (
              <p key={index} className="whitespace-pre-line">
                <Inlines parts={block.inline} onCite={onCite} />
              </p>
            );
        }
      })}
    </div>
  );
}

function SourceRow({ source, highlighted, domId }: { source: AssistantSource; highlighted: boolean; domId: string }) {
  const facts = [
    source.section,
    source.version != null ? `v${source.version}` : null,
    source.effectiveAt ? `effective ${formatDay(source.effectiveAt)}` : null,
  ].filter(Boolean);
  return (
    <li
      id={domId}
      className={cn(
        'flex flex-col gap-1 rounded-lg px-3 py-2.5 text-sm transition-colors sm:flex-row sm:items-start sm:justify-between sm:gap-4',
        highlighted && 'bg-primary/10 ring-1 ring-primary/30',
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">{source.label}</span>
          <span className="font-medium text-foreground">{source.documentNumber}</span>
          <span className="text-foreground">{source.title}</span>
        </div>
        {facts.length > 0 && <p className="mt-0.5 text-xs text-muted-foreground">{facts.join(' · ')}</p>}
      </div>
      {source.documentId && (
        <a
          href={`/documents/${source.documentId}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Open document
          <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      )}
    </li>
  );
}

/** Cited passages when there are any; otherwise the closest documents, once per document. */
function SourcesCard({
  exchangeId,
  sources,
  state,
  highlighted,
}: {
  exchangeId: number;
  sources: AssistantSource[];
  state: AssistantAnswer['state'];
  highlighted: string | null;
}) {
  const cited = sources.filter((source) => source.cited);
  const others = sources.filter((source) => !source.cited);
  const answered = state === 'answered' && cited.length > 0;
  const closest = useMemo(() => {
    const seen = new Set<string>();
    return sources.filter((source) => (seen.has(source.documentNumber) ? false : !!seen.add(source.documentNumber))).slice(0, 5);
  }, [sources]);
  const [showOthers, setShowOthers] = useState(false);
  const domId = (label: string) => `source-${exchangeId}-${label}`;

  if (sources.length === 0) return null;
  return (
    <Card className="gap-2 py-4">
      <h2 className="px-5 text-sm font-semibold text-foreground">{answered ? 'Sources' : 'Closest documents'}</h2>
      <ul className="flex flex-col px-2">
        {(answered ? cited : closest).map((source) => (
          <SourceRow key={source.label} source={source} highlighted={highlighted === source.label} domId={domId(source.label)} />
        ))}
      </ul>
      {answered && others.length > 0 && (
        <div className="px-5">
          <button
            type="button"
            onClick={() => setShowOthers((open) => !open)}
            aria-expanded={showOthers}
            className="border-0 bg-transparent p-0 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
          >
            {showOthers ? 'Hide' : 'Show'} {plural(others.length, 'other passage')} that were searched
          </button>
          {showOthers && (
            <ul className="-mx-3 mt-1 flex flex-col">
              {others.map((source) => (
                <SourceRow key={source.label} source={source} highlighted={false} domId={domId(source.label)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function Feedback({
  exchangeId,
  initialRating,
  initialComment,
}: {
  exchangeId: number;
  initialRating: 'up' | 'down' | null;
  initialComment: string | null;
}) {
  const [rating, setRating] = useState(initialRating);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState('');
  const [commentSent, setCommentSent] = useState(!!initialComment);

  async function rate(next: 'up' | 'down') {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await assistantApi.feedback(exchangeId, next);
      setRating(next);
      if (next === 'down' && !commentSent) setCommenting(true);
    } catch {
      setError('Your feedback could not be sent. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function sendComment() {
    if (!rating || saving || !comment.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await assistantApi.feedback(exchangeId, rating, comment);
      setCommentSent(true);
      setCommenting(false);
    } catch {
      setError('Your comment could not be sent. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const rateButton = (value: 'up' | 'down', Icon: LucideIcon, label: string) => (
    <Button
      type="button"
      variant={rating === value ? 'secondary' : 'outline'}
      size="sm"
      onClick={() => void rate(value)}
      disabled={saving}
      aria-pressed={rating === value}
      aria-label={label}
      title={label}
    >
      <Icon aria-hidden="true" />
    </Button>
  );

  return (
    <div className="flex flex-col gap-2 border-t border-border/40 pt-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>{rating ? 'Thanks for the feedback.' : 'Was this helpful?'}</span>
        {rateButton('up', ThumbsUp, 'This answer helped')}
        {rateButton('down', ThumbsDown, 'This answer did not help')}
        {rating && !commenting && !commentSent && (
          <button
            type="button"
            onClick={() => setCommenting(true)}
            className="border-0 bg-transparent p-0 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
          >
            Add a comment
          </button>
        )}
        {commentSent && <span className="text-xs">Comment sent.</span>}
      </div>
      {commenting && (
        <div className="flex flex-col gap-2">
          <label htmlFor={`feedback-${exchangeId}`} className="sr-only">
            What was wrong or missing?
          </label>
          <textarea
            id={`feedback-${exchangeId}`}
            rows={2}
            maxLength={1000}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="What was wrong or missing? (optional)"
            className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => void sendComment()} disabled={saving || !comment.trim()}>
              Send comment
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCommenting(false)}>
              Not now
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function ExchangeCard({ exchange, isAdmin }: { exchange: Exchange; isAdmin: boolean }) {
  const known = useMemo(() => new Set(exchange.sources.map((source) => source.label)), [exchange.sources]);
  const blocks = useMemo(() => parseAnswer(exchange.answer, known), [exchange.answer, known]);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  function showSource(label: string) {
    const target = document.getElementById(`source-${exchange.id}-${label}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setHighlighted(label);
    window.setTimeout(() => setHighlighted((current) => (current === label ? null : current)), 2200);
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="gap-4 py-5">
        <div className="flex flex-col gap-3 px-5">
          <p className="text-xs text-muted-foreground">
            You asked: <span className="text-foreground">{exchange.question}</span>
          </p>
          {exchange.state === 'not_found' && (
            <Notice tone="warning" icon={Info} title="Not covered by the current documents">
              The assistant could not find a direct answer. What the documents do say:
            </Notice>
          )}
          {exchange.state === 'unavailable' && (
            <Notice tone="warning" icon={TriangleAlert} title="The assistant can't answer right now" />
          )}
          <AnswerText blocks={blocks} onCite={showSource} />
          {exchange.truncated && (
            <p className="text-xs text-muted-foreground">
              The answer was cut short because it was long. Ask a narrower question, or open the sources below.
            </p>
          )}
          {exchange.state !== 'unavailable' && (
            <Feedback exchangeId={exchange.id} initialRating={exchange.rating} initialComment={exchange.comment} />
          )}
        </div>
      </Card>
      <SourcesCard exchangeId={exchange.id} sources={exchange.sources} state={exchange.state} highlighted={highlighted} />
      {isAdmin && exchange.model && (
        <p className="px-1 text-xs text-muted-foreground">
          {exchange.model} · prompt {exchange.promptVersion} · {((exchange.ms ?? 0) / 1000).toFixed(1)} s
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The conversation sidebar

function ConversationRow({
  conversation,
  active,
  onOpen,
  onRename,
  onDelete,
}: {
  conversation: ConversationSummary;
  active: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function submitRename(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    setEditing(false);
    if (trimmed && trimmed !== conversation.title) onRename(trimmed);
    else setTitle(conversation.title);
  }

  if (editing) {
    return (
      <form onSubmit={submitRename} className="px-1 py-0.5">
        <Input
          autoFocus
          value={title}
          maxLength={80}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={submitRename}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setTitle(conversation.title);
              setEditing(false);
            }
          }}
          className="h-8 text-sm"
        />
      </form>
    );
  }

  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm',
        active ? 'bg-primary/10' : 'hover:bg-accent',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        title={conversation.title}
        className={cn(
          'min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left outline-none',
          active ? 'font-medium text-primary' : 'text-foreground',
        )}
      >
        {conversation.title}
      </button>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label="Rename conversation"
        title="Rename"
        className="hidden size-6 shrink-0 items-center justify-center rounded border-0 bg-transparent text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground group-hover:flex"
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </button>
      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          aria-label="Delete conversation"
          title="Delete"
          className="hidden size-6 shrink-0 items-center justify-center rounded border-0 bg-transparent text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:flex"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </button>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              "{conversation.title}" will no longer appear in your history. This does not remove it from the
              assistant's log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ConversationList({
  conversations,
  activeId,
  onNew,
  onOpen,
  onRename,
  onDelete,
}: {
  conversations: ConversationSummary[];
  activeId: number | null;
  onNew: () => void;
  onOpen: (id: number) => void;
  onRename: (id: number, title: string) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Button variant="outline" size="sm" onClick={onNew} className="justify-start">
        <MessageSquarePlus aria-hidden="true" />
        New chat
      </Button>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">Your saved conversations will appear here.</p>
        ) : (
          conversations.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === activeId}
              onOpen={() => onOpen(conversation.id)}
              onRename={(title) => onRename(conversation.id, title)}
              onDelete={() => onDelete(conversation.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The page

type Status = { kind: 'idle' } | { kind: 'asking' } | { kind: 'failed'; problem: Problem };

export default function AssistantPage() {
  const { logout, isAdmin } = useAuth();
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [configProblem, setConfigProblem] = useState<Problem | null>(null);
  const [question, setQuestion] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const asking = useRef(false);
  const latest = useRef(0);          // a slow reply must not land after a newer chat/conversation switch

  const loadConfig = useCallback(() => {
    setConfigProblem(null);
    assistantApi
      .config()
      .then(setConfig)
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          void logout();
          return;
        }
        setConfigProblem(describeProblem(error));
      });
  }, [logout]);

  const loadConversations = useCallback(() => {
    conversationsApi.list().then(setConversations).catch(() => undefined);
  }, []);

  useEffect(() => {
    loadConfig();
    loadConversations();
  }, [loadConfig, loadConversations]);

  const ready = !!config && config.enabled && config.allowed;
  const searchable = !!config && config.documents > 0;

  useEffect(() => {
    if (ready && window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
  }, [ready]);

  useEffect(() => {
    if (status.kind === 'asking' || exchanges.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [exchanges.length, status.kind]);

  function startNew() {
    latest.current += 1;                 // invalidates any reply still in flight for the conversation just left
    setActiveId(null);
    setExchanges([]);
    setStatus({ kind: 'idle' });
    setQuestion('');
    inputRef.current?.focus();
  }

  function openConversation(id: number) {
    if (id === activeId) return;
    const mine = ++latest.current;
    setActiveId(id);
    setExchanges([]);
    setStatus({ kind: 'asking' });        // reused as "loading", the spinner card fits either meaning
    conversationsApi
      .get(id)
      .then((detail) => {
        if (mine !== latest.current) return;
        setExchanges(
          detail.messages.map((m) => ({ id: m.id, question: m.question, answer: m.answer, state: m.state,
                                        sources: m.sources, rating: m.rating, comment: m.comment })),
        );
        setStatus({ kind: 'idle' });
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          void logout();
          return;
        }
        if (mine !== latest.current) return;
        setStatus({ kind: 'failed', problem: describeProblem(error) });
      });
  }

  function renameConversation(id: number, title: string) {
    setConversations((rows) => rows.map((row) => (row.id === id ? { ...row, title } : row)));
    conversationsApi.rename(id, title).catch(() => loadConversations());   // reconcile on failure
  }

  function deleteConversation(id: number) {
    setConversations((rows) => rows.filter((row) => row.id !== id));
    if (id === activeId) startNew();
    conversationsApi.remove(id).catch(() => loadConversations());
  }

  async function submit(text: string) {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean || asking.current) return;
    asking.current = true;
    const mine = ++latest.current;
    setStatus({ kind: 'asking' });
    setQuestion('');
    try {
      const answer = activeId == null
        ? await conversationsApi.start(clean)
        : await conversationsApi.continue(activeId, clean);
      if (mine !== latest.current) return;
      setExchanges((rows) => [...rows, exchangeFromAnswer(clean, answer)]);
      setStatus({ kind: 'idle' });
      if (answer.conversationId != null && answer.conversationId !== activeId) setActiveId(answer.conversationId);
      loadConversations();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        void logout();
      } else if (mine === latest.current) {
        setQuestion(clean);                            // give the question back so it is not lost
        setStatus({ kind: 'failed', problem: describeProblem(error) });
      }
    } finally {
      asking.current = false;
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(question);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit(question);
    }
  }

  const limit = config?.maxQuestionChars || DEFAULT_LIMIT;
  const busy = status.kind === 'asking';

  // Memoized so the sidebar only actually changes identity when the conversations it lists (or which one is
  // active) do -- not on every keystroke in the question box. useSectionSidebar's effect deps include this node,
  // so an unmemoized one would re-register (and re-render Layout's whole aside) on every render of this page.
  const sidebar = useMemo(
    () => (
      <ConversationList
        conversations={conversations}
        activeId={activeId}
        onNew={() => {
          startNew();
          setDrawerOpen(false);
        }}
        onOpen={(id) => {
          openConversation(id);
          setDrawerOpen(false);
        }}
        onRename={renameConversation}
        onDelete={deleteConversation}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startNew/openConversation/renameConversation/
    // deleteConversation close over nothing that changes without conversations/activeId also changing.
    [conversations, activeId],
  );

  // Renders `sidebar` flush against the nav rail, the same chrome-level column Documents/Tasks/Departments/
  // Activity/Admin use (Layout.tsx), instead of floating it inside the page's own content the way this page used
  // to. The mobile "History" sheet below keeps its own copy -- Layout's aside is desktop-only (`hidden md:flex`).
  useSectionSidebar(sidebar);

  const headerActions = (
    <>
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Button variant="outline" size="sm" className="md:hidden" onClick={() => setDrawerOpen(true)}>
          <History aria-hidden="true" />
          History
        </Button>
        <SheetContent side="left" className="w-80 p-4">
          <SheetTitle className="mb-2 text-sm">Your conversations</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>
      {isAdmin && (
        <Button variant="ghost" size="sm" asChild>
          <a href="/api/assistant/admin/status.html" target="_blank" rel="noreferrer">
            Index status
            <ExternalLink aria-hidden="true" />
          </a>
        </Button>
      )}
      <Badge variant="secondary">
        <Sparkles aria-hidden="true" />
        Beta
      </Badge>
    </>
  );

  let body: ReactNode;
  if (configProblem) {
    body = (
      <Notice tone={configProblem.tone} icon={TriangleAlert} title={configProblem.title}>
        {configProblem.detail}
        <div className="mt-2">
          <Button variant="outline" size="sm" onClick={loadConfig}>
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>
        </div>
      </Notice>
    );
  } else if (!config) {
    body = <p className="text-sm text-muted-foreground">Loading…</p>;
  } else if (!ready) {
    body = (
      <Notice tone="info" icon={Info} title="The assistant is not switched on for your account yet.">
        When it is, an Ask entry appears in the menu. Until then, the documents are all in the Documents section.
      </Notice>
    );
  } else {
    body = (
      <>
        {!searchable && (
          <Notice tone="info" icon={Info} title="No documents can be searched yet.">
            Released documents are added automatically, usually within a few minutes of the first sync.
            <div className="mt-2">
              <Button variant="outline" size="sm" onClick={loadConfig}>
                <RotateCcw aria-hidden="true" />
                Check again
              </Button>
            </div>
          </Notice>
        )}

        {exchanges.length === 0 && status.kind !== 'asking' && status.kind !== 'failed' && searchable && (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              {activeId == null
                ? 'Ask about a procedure, a work instruction or a document number, for example "Which SOP covers …?".'
                : 'This conversation has no messages yet.'}
            </p>
            {activeId == null && config.examples.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">Try:</span>
                {config.examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => void submit(example)}
                    className="rounded-full border border-border bg-background px-3 py-1 text-left text-xs text-foreground transition-colors hover:bg-accent"
                  >
                    {example}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div aria-live="polite" aria-busy={busy} className="flex flex-col gap-4">
          {exchanges.map((exchange) => (
            <ExchangeCard key={exchange.id} exchange={exchange} isAdmin={isAdmin} />
          ))}
          {status.kind === 'asking' && (
            <Card className="py-5">
              <div className="flex items-center gap-3 px-5 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden="true" />
                {exchanges.length === 0 && activeId != null ? 'Opening this conversation…' : 'Searching the documents…'}
              </div>
            </Card>
          )}
          {status.kind === 'failed' && (
            <Notice tone={status.problem.tone} icon={TriangleAlert} title={status.problem.title}>
              {status.problem.detail}
            </Notice>
          )}
        </div>
        <div ref={bottomRef} />
      </>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <PageHeader title="Ask" actions={headerActions} />
      {body}

      {ready && (
        <Card className="gap-0 py-4">
          <form onSubmit={onSubmit} className="flex flex-col gap-3 px-4">
            <label htmlFor="ask-question" className="sr-only">
              Your question
            </label>
            <textarea
              id="ask-question"
              ref={inputRef}
              rows={2}
              maxLength={limit}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={onKeyDown}
              disabled={!searchable}
              placeholder={activeId == null ? 'Ask about the current controlled documents…' : 'Ask a follow-up…'}
              className="min-h-[4.25rem] w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
            />
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="text-xs text-muted-foreground">Questions and answers are logged to improve the assistant.</p>
              <div className="flex items-center gap-3">
                <span className={cn('text-xs tabular-nums', question.length > limit - 50 ? 'text-warning' : 'text-muted-foreground')}>
                  {question.length}/{limit}
                </span>
                <Button type="submit" disabled={busy || !searchable || !question.trim()} title="Ask (Enter)">
                  {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
                  Ask
                </Button>
              </div>
            </div>
          </form>
        </Card>
      )}

      {ready && config && (
        <p className="px-1 text-xs text-muted-foreground">
          {DISCLAIMER} Index updated {timeAgo(config.syncedAt)} · {plural(config.documents, 'document')}
        </p>
      )}
    </div>
  );
}
