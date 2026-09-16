import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Folder, Inbox, type LucideIcon } from 'lucide-react';
import { acknowledgmentApi, auditApi, documentApi, lookupApi, workflowApi } from '../api/resources';
import type {
  AuditLogPage,
  Department,
  DocumentSummary,
  DocumentsPage as PageResult,
  PendingAcknowledgment,
  WorkflowTask,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import ActivitySentence from '../components/ActivitySentence';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge, type StatusBadgeKind } from '../components/StatusBadge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';

/** Local-date ISO string n days back (0 = today) — the activity presets. */
function isoDaysAgo(days: number): string {
  const date = new Date(Date.now() - days * 86400000);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The dashboard greeting is computed in Singapore time specifically
 * (Asia/Singapore, fixed UTC+8 — this app's users are in Singapore and
 * Malaysia, and a misconfigured device clock must not produce a wrong
 * greeting), never the browser's local timezone. hourCycle h23 (rather
 * than the equivalent hour12: false) sidesteps en-US's "24" reading of
 * midnight, which would mis-bucket 00:00 into the evening.
 */
function sgtGreeting(now: Date): string {
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Singapore',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(now),
    10,
  );
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function sgtDateString(now: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
}

/**
 * The Dashboard landing page (Dashboard_Design_PlanBack.md, approved
 * 2026-09-14; round-three structure per owner review; Activity made real
 * per the approved activity plan-back). Design-redesign Phase 1: reskinned
 * onto Card/StatusBadge/EmptyState/PageHeader — the 2×2 grid, the 384px
 * scrolling list cap, the empty-state CTA, and every data source/href are
 * unchanged from the pre-redesign version (F7 in the plan-back). The grid
 * keeps the original 860px collapse breakpoint exactly (an arbitrary-value
 * variant, not Tailwind's default 768px `md:`).
 */

export default function DashboardPage() {
  const { user } = useAuth();
  const now = new Date();
  return (
    // ≥861px (dashboard & navigation plan-back round two, superseding F7
    // for this width only): the page is exactly the shell's height and the
    // grid fills it — each card is a fixed cell and overflow scrolls
    // inside the card, never the page. Below 861px none of these apply:
    // natural content-sized cards with normal page scroll, as before.
    <div className="min-[861px]:flex min-[861px]:h-full min-[861px]:min-h-0 min-[861px]:flex-col">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {sgtGreeting(now)}
          {user?.name ? `, ${user.name}` : ''}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {sgtDateString(now)} — Here's what's happening across Document Control today.
        </p>
      </div>
      <div className="grid grid-cols-2 items-start gap-4 max-[860px]:grid-cols-1 min-[861px]:flex-1 min-[861px]:min-h-0 min-[861px]:grid-rows-2 min-[861px]:items-stretch">
        <TasksDashlet />
        <DocumentsDashlet />
        <DepartmentsDashlet />
        <ActivityDashlet />
      </div>
    </div>
  );
}

function Dashlet(props: {
  title: string;
  count: number | null;
  moreTo: string;
  moreLabel: string;
  emptyIcon: LucideIcon;
  emptyMessage: React.ReactNode;
  cta?: React.ReactNode;
  error: string | null;
  loaded: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex min-[861px]:h-full flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <props.emptyIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            {props.title}{' '}
            {props.count !== null && (
              <span className="font-normal text-muted-foreground">({props.count})</span>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-40 min-[861px]:min-h-0 flex-1 flex-col">
        {props.error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {props.error}
          </div>
        )}
        {!props.error && !props.loaded && (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
        )}
        {props.loaded && props.count === 0 && (
          <EmptyState icon={props.emptyIcon} message={props.emptyMessage} cta={props.cta} />
        )}
        {props.loaded && props.count !== null && props.count > 0 && props.children}
        <p className="mt-auto pt-3 text-sm">
          <Link className="text-primary hover:underline" to={props.moreTo}>
            {props.moreLabel}
            {props.count !== null && ` (${props.count})`} →
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

type TaskRow =
  | { kind: 'approval'; key: string; date: number; task: WorkflowTask }
  | { kind: 'acknowledgment'; key: string; date: number; entry: PendingAcknowledgment };

/**
 * The merged Tasks card: approvals and acknowledgments in one queue,
 * matching the Tasks nav section which already groups both. Sorted by the
 * row's deadline — an approval's due date or an acknowledgment's window
 * close — soonest first, undated last. The full lists arrive unbounded,
 * so the card body scrolls under its max height instead of slicing.
 */
function TasksDashlet() {
  const [tasks, setTasks] = useState<WorkflowTask[] | null>(null);
  const [pending, setPending] = useState<PendingAcknowledgment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    workflowApi.myTasks().then(setTasks).catch((err: Error) => setError(err.message));
    acknowledgmentApi.pending().then(setPending).catch((err: Error) => setError(err.message));
  }, []);

  const loaded = tasks !== null && pending !== null;
  const count = loaded ? tasks!.length + pending!.length : null;

  // Overdue mirrors the sweep's business-day rule: the highlight starts the
  // day after the due date — due today is "due today", not overdue.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const rows: TaskRow[] = [
    ...(tasks ?? []).map((task) => ({
      kind: 'approval' as const,
      key: task.id,
      date: task.dueDate ? new Date(task.dueDate).getTime() : Infinity,
      task,
    })),
    ...(pending ?? []).map((entry) => ({
      kind: 'acknowledgment' as const,
      key: `ack-${entry.documentId}`,
      date: entry.windowClosesAt ? new Date(entry.windowClosesAt).getTime() : Infinity,
      entry,
    })),
  ].sort((a, b) => a.date - b.date);

  return (
    <Dashlet
      title="Tasks"
      count={count}
      moreTo="/tasks?view=approvals"
      moreLabel="All my tasks"
      error={error}
      loaded={loaded}
      emptyIcon={Inbox}
      emptyMessage="Nothing waiting for you — no approvals, no acknowledgments."
    >
      <ul className="max-h-96 list-none overflow-y-auto p-0 min-[861px]:max-h-none min-[861px]:flex-1 min-[861px]:min-h-0">
        {rows.map((row) =>
          row.kind === 'approval' ? (
            <li key={row.key} className="border-b border-border py-1.5 leading-normal last:border-b-0">
              <StatusBadge status="kind-approval">Approval</StatusBadge>{' '}
              <Link className="hover:underline" to={`/documents/${row.task.documentId}`}>
                {row.task.documentNumber} — {row.task.name}
              </Link>
              <div className="text-xs text-muted-foreground">
                {row.task.departmentCode && (
                  <StatusBadge status="dept">{row.task.departmentCode}</StatusBadge>
                )}{' '}
                <StatusBadge status="dept">v{row.task.versionNumber}</StatusBadge>{' '}
                {row.task.reapproval && (
                  <StatusBadge status="reapproval">re-approval</StatusBadge>
                )}{' '}
                {row.task.dueDate && new Date(row.task.dueDate) < startOfToday && (
                  <StatusBadge status="overdue">overdue</StatusBadge>
                )}{' '}
                due {row.task.dueDate ? new Date(row.task.dueDate).toLocaleDateString() : '—'}
              </div>
            </li>
          ) : (
            <li key={row.key} className="border-b border-border py-1.5 leading-normal last:border-b-0">
              <StatusBadge status="kind-acknowledgment">Acknowledgment</StatusBadge>{' '}
              <Link className="hover:underline" to={`/documents/${row.entry.documentId}`}>
                {row.entry.documentNumber} — {row.entry.name}
              </Link>
              <div className="text-xs text-muted-foreground">
                <StatusBadge status="dept">{row.entry.departmentCode}</StatusBadge>{' '}
                <StatusBadge status="dept">v{row.entry.versionNumber}</StatusBadge>{' '}
                {row.entry.overdue && <StatusBadge status="overdue">overdue</StatusBadge>}{' '}
                window closes{' '}
                {row.entry.windowClosesAt
                  ? new Date(row.entry.windowClosesAt).toLocaleDateString()
                  : '—'}
              </div>
            </li>
          ),
        )}
      </ul>
    </Dashlet>
  );
}

/**
 * The Departments card: the signed-in user's own memberships, or every
 * department for admins — the same sources and inactive marking as the
 * Layout's Departments sidebar (memberships from /auth/me, the
 * includeInactive list for admins). Rows link to each department's
 * detail page.
 */
function DepartmentsDashlet() {
  const { user, isAdmin } = useAuth();
  const [adminDepartments, setAdminDepartments] = useState<Department[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAdmin) {
      lookupApi
        .departments(true)
        .then(setAdminDepartments)
        .catch((err: Error) => setError(err.message));
    }
  }, [isAdmin]);

  const departments: Department[] | null = isAdmin ? adminDepartments : (user?.departments ?? null);
  const count = departments?.length ?? null;

  return (
    <Dashlet
      title="Departments"
      count={count}
      moreTo="/departments"
      moreLabel="All departments"
      error={error}
      loaded={departments !== null}
      emptyIcon={Folder}
      emptyMessage="You belong to no departments."
    >
      <ul className="max-h-96 list-none overflow-y-auto p-0 min-[861px]:max-h-none min-[861px]:flex-1 min-[861px]:min-h-0">
        {(departments ?? [])
          .slice()
          .sort((a, b) => a.code.localeCompare(b.code))
          .map((d) => (
            <li key={d.id} className="border-b border-border py-1.5 leading-normal last:border-b-0">
              <Link className="hover:underline" to={`/departments/${d.id}`}>
                {d.code}
              </Link>{' '}
              — {d.label}
              {!d.active && <span className="text-xs text-muted-foreground"> (inactive)</span>}
            </li>
          ))}
      </ul>
    </Dashlet>
  );
}

/**
 * The real Activity card (activity plan-back, approved 2026-09-14): my
 * activity over the last 7 days, top 5, deep-linking into the full
 * /activity view. Read-only over the immutable audit trail.
 */
function ActivityDashlet() {
  const [page, setPage] = useState<AuditLogPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    auditApi
      .list({
        scope: 'mine',
        from: isoDaysAgo(6),
        to: isoDaysAgo(0),
        pageSize: 5,
      })
      .then(setPage)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <Dashlet
      title="Activity"
      count={page?.totalElements ?? null}
      moreTo="/activity?scope=mine"
      moreLabel="All my activity"
      error={error}
      loaded={page !== null}
      emptyIcon={Inbox}
      emptyMessage="No activity in the last 7 days."
    >
      <ul className="max-h-96 list-none overflow-y-auto p-0 min-[861px]:max-h-none min-[861px]:flex-1 min-[861px]:min-h-0">
        {(page?.content ?? []).map((entry) => (
          <li key={entry.id} className="border-b border-border py-1.5 leading-normal last:border-b-0">
            <ActivitySentence entry={entry} />
            <div className="text-xs text-muted-foreground">
              {new Date(entry.performedAt).toLocaleString()}
              {entry.departmentCode && (
                <>
                  {' '}
                  <StatusBadge status="dept">{entry.departmentCode}</StatusBadge>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Dashlet>
  );
}

function DocumentsDashlet() {
  const [page, setPage] = useState<PageResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // First page at dashlet size — the list endpoint's default order is
    // createdAt desc, so content arrives newest-first; the count is the
    // true total from the page payload.
    documentApi
      .list({ owner: 'me', page: 0, pageSize: 8 })
      .then(setPage)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <Dashlet
      title="My Documents"
      count={page?.totalElements ?? null}
      moreTo="/documents?view=mine"
      moreLabel="All my documents"
      error={error}
      loaded={page !== null}
      emptyIcon={Folder}
      emptyMessage="You own no documents yet."
      cta={
        // creation itself stays on the Documents page (?create=1 opens the
        // form there — the dashboard stays read-only)
        <Button asChild size="sm" className="mt-1">
          <Link to="/documents?create=1">+ New document</Link>
        </Button>
      }
    >
      <ul className="max-h-96 list-none overflow-y-auto p-0 min-[861px]:max-h-none min-[861px]:flex-1 min-[861px]:min-h-0">
        {(page?.content ?? []).map((doc: DocumentSummary) => (
          <li key={doc.id} className="border-b border-border py-1.5 leading-normal last:border-b-0">
            <Link className="hover:underline" to={`/documents/${doc.id}`}>
              {doc.documentNumber} — {doc.name}
            </Link>
            <div className="text-xs text-muted-foreground">
              <StatusBadge status={doc.status as StatusBadgeKind}>{doc.status}</StatusBadge>
            </div>
          </li>
        ))}
      </ul>
    </Dashlet>
  );
}
