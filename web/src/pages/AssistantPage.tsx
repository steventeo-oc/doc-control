import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import {
  ExternalLink,
  Info,
  LoaderCircle,
  RotateCcw,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { assistantApi } from '../api/assistant';
import type { AssistantAnswer, AssistantConfig, AssistantSource } from '../api/assistant';
import { parseAnswer } from '../lib/answerText';
import type { Block, Inline } from '../lib/answerText';
import { cn } from '../lib/utils';
import { PageHeader } from '../components/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';

/**
 * "Ask": questions about the current controlled documents, answered from those documents with citations
 * (AI_Assistant_Design_PlanBack.md, section 2.9). The service behind it is separate (Python, mounted under
 * /api/assistant); this page only shows what it returns.
 *
 * Three answer states are shown and never hidden: answered (cited), not covered (the text still says what the
 * documents do say) and unavailable (the closest documents are still listed). The answer is plain text: it is model
 * output built from document text, so it is parsed into paragraphs, lists, bold and citation chips and rendered
 * with React elements only (lib/answerText.ts), never as HTML. The only links on the page come from the sources'
 * metadata.
 */

const DEFAULT_LIMIT = 600;
const DISCLAIMER =
  'AI-generated from controlled documents. The document is the controlled record: check it before acting. Lists may be incomplete.';

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
        return { tone: 'warning', title: 'The assistant is switched off at the moment.' };
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
      // bg-transparent/border-0 first: a raw <button> otherwise takes the legacy base rule (white, bordered).
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

function SourceRow({
  source,
  highlighted,
  domId,
  showLabel = true,
}: {
  source: AssistantSource;
  highlighted: boolean;
  domId: string;
  /** the S1/S2 mark ties a row to the chips in the answer; with nothing cited it would mean nothing */
  showLabel?: boolean;
}) {
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
          {showLabel && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">{source.label}</span>
          )}
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
  answerId,
  answer,
  highlighted,
}: {
  answerId: number;
  answer: AssistantAnswer;
  highlighted: string | null;
}) {
  const cited = answer.sources.filter((source) => source.cited);
  const others = answer.sources.filter((source) => !source.cited);
  const answered = answer.state === 'answered' && cited.length > 0;
  const closest = useMemo(() => {
    const seen = new Set<string>();
    return answer.sources.filter((source) => (seen.has(source.documentNumber) ? false : !!seen.add(source.documentNumber))).slice(0, 5);
  }, [answer.sources]);
  const [showOthers, setShowOthers] = useState(false);
  const domId = (label: string) => `source-${answerId}-${label}`;

  if (answer.sources.length === 0) return null;
  return (
    <Card className="gap-2 py-4">
      <h2 className="px-5 text-sm font-semibold text-foreground">{answered ? 'Sources' : 'Closest documents'}</h2>
      <ul className="flex flex-col px-2">
        {(answered ? cited : closest).map((source) => (
          <SourceRow
            key={source.label}
            source={source}
            highlighted={highlighted === source.label}
            domId={domId(source.label)}
            showLabel={answered}
          />
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

function Feedback({ answerId }: { answerId: number }) {
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState('');
  const [commentSent, setCommentSent] = useState(false);

  async function rate(next: 'up' | 'down') {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await assistantApi.feedback(answerId, next);
      setRating(next);
      if (next === 'down') setCommenting(true);
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
      await assistantApi.feedback(answerId, rating, comment);
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
          <label htmlFor={`feedback-${answerId}`} className="sr-only">
            What was wrong or missing?
          </label>
          <textarea
            id={`feedback-${answerId}`}
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

function AnswerCard({ question, answer, isAdmin }: { question: string; answer: AssistantAnswer; isAdmin: boolean }) {
  const known = useMemo(() => new Set(answer.sources.map((source) => source.label)), [answer.sources]);
  const blocks = useMemo(() => parseAnswer(answer.answer, known), [answer.answer, known]);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  function showSource(label: string) {
    const target = document.getElementById(`source-${answer.id}-${label}`);
    // the source may sit in the collapsed "other passages" list; then there is nothing to scroll to
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setHighlighted(label);
    window.setTimeout(() => setHighlighted((current) => (current === label ? null : current)), 2200);
  }

  return (
    <>
      <Card className="gap-4 py-5">
        <div className="flex flex-col gap-3 px-5">
          <p className="text-xs text-muted-foreground">
            You asked: <span className="text-foreground">{question}</span>
          </p>
          {answer.state === 'not_found' && (
            <Notice tone="warning" icon={Info} title="Not covered by the current documents">
              The assistant could not find a direct answer. What the documents do say:
            </Notice>
          )}
          {answer.state === 'unavailable' && (
            // busy or a model down: nothing is broken for the reader, there is just no answer yet
            <Notice tone="warning" icon={TriangleAlert} title="The assistant can't answer right now" />
          )}
          <AnswerText blocks={blocks} onCite={showSource} />
          {answer.truncated && (
            <p className="text-xs text-muted-foreground">
              The answer was cut short because it was long. Ask a narrower question, or open the sources below.
            </p>
          )}
          {answer.state !== 'unavailable' && <Feedback key={answer.id} answerId={answer.id} />}
        </div>
      </Card>
      <SourcesCard answerId={answer.id} answer={answer} highlighted={highlighted} />
      <div className="flex flex-col gap-1 px-1 text-xs text-muted-foreground">
        <p>{DISCLAIMER}</p>
        <p>
          Index updated {timeAgo(answer.index.syncedAt)} · {plural(answer.index.documents, 'document')}
          {isAdmin && ` · ${answer.model} · prompt ${answer.promptVersion} · ${(answer.ms / 1000).toFixed(1)} s`}
        </p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The page

type Status =
  | { kind: 'idle' }
  | { kind: 'asking'; question: string }
  | { kind: 'answered'; question: string; answer: AssistantAnswer }
  | { kind: 'failed'; question: string; problem: Problem };

export default function AssistantPage() {
  const { logout, isAdmin } = useAuth();
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [configProblem, setConfigProblem] = useState<Problem | null>(null);
  const [question, setQuestion] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const asking = useRef(false);
  const latest = useRef(0);          // a slow answer must not replace a newer one

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

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const ready = !!config && config.enabled && config.allowed;
  const searchable = !!config && config.documents > 0;

  useEffect(() => {
    // Put the cursor in the box on a desktop; on a phone that would only pop the keyboard up.
    if (ready && window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
  }, [ready]);

  useEffect(() => {
    if (status.kind === 'answered' || status.kind === 'failed') {
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [status]);

  async function submit(text: string) {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean || asking.current) return;
    asking.current = true;
    const mine = ++latest.current;
    setStatus({ kind: 'asking', question: clean });
    try {
      const answer = await assistantApi.ask(clean);
      if (mine === latest.current) setStatus({ kind: 'answered', question: clean, answer });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        void logout();
      } else if (mine === latest.current) {
        setStatus({ kind: 'failed', question: clean, problem: describeProblem(error) });
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
    // Enter asks, Shift+Enter starts a new line; never while an input method is composing text.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit(question);
    }
  }

  const limit = config?.maxQuestionChars || DEFAULT_LIMIT;
  const busy = status.kind === 'asking';
  const statusLink = isAdmin && (
    <Button variant="ghost" size="sm" asChild>
      <a href="/api/assistant/admin/status.html" target="_blank" rel="noreferrer">
        Index status
        <ExternalLink aria-hidden="true" />
      </a>
    </Button>
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
              placeholder="Ask about the current controlled documents…"
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

        {searchable && status.kind === 'idle' && (
          <div className="flex flex-col gap-3 text-sm">
            {config.examples.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">Try:</span>
                {config.examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => {
                      setQuestion(example);
                      void submit(example);
                    }}
                    className="rounded-full border border-border bg-background px-3 py-1 text-left text-xs text-foreground transition-colors hover:bg-accent"
                  >
                    {example}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">
                Ask about a procedure, a work instruction or a document number, for example “Which SOP covers …?”.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Answers come only from released documents you can already open. Index updated {timeAgo(config.syncedAt)} ·{' '}
              {plural(config.documents, 'document')}
            </p>
          </div>
        )}

        <div ref={resultRef} aria-live="polite" aria-busy={busy} className="flex flex-col gap-4">
          {status.kind === 'asking' && (
            <Card className="py-5">
              <div className="flex items-center gap-3 px-5 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden="true" />
                Searching the documents…
              </div>
            </Card>
          )}
          {status.kind === 'failed' && (
            <Notice tone={status.problem.tone} icon={TriangleAlert} title={status.problem.title}>
              {status.problem.detail}
            </Notice>
          )}
          {status.kind === 'answered' && <AnswerCard question={status.question} answer={status.answer} isAdmin={isAdmin} />}
        </div>
      </>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <PageHeader
        title="Ask"
        actions={
          <>
            {statusLink}
            <Badge variant="secondary">
              <Sparkles aria-hidden="true" />
              Beta
            </Badge>
          </>
        }
      />
      {body}
    </div>
  );
}
