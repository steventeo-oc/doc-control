import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { acknowledgmentApi, documentApi, workflowApi } from '../api/resources';
import type {
  DocumentSummary,
  DocumentsPage as PageResult,
  PendingAcknowledgment,
  WorkflowTask,
} from '../api/types';

/**
 * The Dashboard landing page (Dashboard_Design_PlanBack.md, approved
 * 2026-09-14; round-two structure per owner review): TWO dashlets — a
 * merged Tasks card (approvals + acknowledgments, mirroring the Tasks nav
 * section) and My Documents — over endpoints that already exist. Rows are
 * compact (code + title on one line, small inline badges) and link to the
 * document page; full detail and actions stay in their section pages.
 * Lists scroll internally under a max height, so an empty card stays
 * short and a long queue cannot grow the page. The activities feed is
 * deliberately excluded — it needs the Sprint 4 audit-log read API.
 */

export default function DashboardPage() {
  return (
    <>
      <h1>Dashboard</h1>
      <div className="dash-grid">
        <TasksDashlet />
        <DocumentsDashlet />
      </div>
    </>
  );
}

function Dashlet(props: {
  title: string;
  count: number | null;
  moreTo: string;
  moreLabel: string;
  empty: React.ReactNode;
  cta?: React.ReactNode;
  error: string | null;
  loaded: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="dashlet">
      <h2>
        {props.title} {props.count !== null && <span className="muted">({props.count})</span>}
      </h2>
      {props.error && <div className="error-banner">{props.error}</div>}
      {!props.error && !props.loaded && <div className="page-loading">Loading…</div>}
      {props.loaded && props.count === 0 && (
        <div className="dash-empty">
          {props.empty}
          {props.cta}
        </div>
      )}
      {props.loaded && props.count !== null && props.count > 0 && props.children}
      <p className="dash-more">
        <Link to={props.moreTo}>
          {props.moreLabel}
          {props.count !== null && ` (${props.count})`} →
        </Link>
      </p>
    </section>
  );
}

/* Small inline SVGs for the empty states — calm, muted, no icon library. */

function InboxIcon() {
  return (
    <svg
      className="dash-empty-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      className="dash-empty-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </svg>
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
      empty={
        <>
          <InboxIcon />
          <span>Nothing waiting for you — no approvals, no acknowledgments.</span>
        </>
      }
    >
      <ul className="dash-list">
        {rows.map((row) =>
          row.kind === 'approval' ? (
            <li key={row.key}>
              <span className="badge kind-approval">Approval</span>{' '}
              <Link to={`/documents/${row.task.documentId}`}>
                {row.task.documentNumber} — {row.task.name}
              </Link>
              <div className="muted">
                <span className="badge">v{row.task.versionNumber}</span>
                {row.task.reapproval && <span className="badge reapproval"> re-approval</span>}
                {row.task.dueDate && new Date(row.task.dueDate) < startOfToday && (
                  <span className="badge overdue"> overdue</span>
                )}
                <span>
                  {' '}
                  due {row.task.dueDate ? new Date(row.task.dueDate).toLocaleDateString() : '—'}
                </span>
              </div>
            </li>
          ) : (
            <li key={row.key}>
              <span className="badge kind-acknowledgment">Acknowledgment</span>{' '}
              <Link to={`/documents/${row.entry.documentId}`}>
                {row.entry.documentNumber} — {row.entry.name}
              </Link>
              <div className="muted">
                <span className="badge dept">{row.entry.departmentCode}</span>
                <span className="badge"> v{row.entry.versionNumber}</span>
                {row.entry.overdue && <span className="badge overdue"> overdue</span>}
                <span>
                  {' '}
                  window closes{' '}
                  {row.entry.windowClosesAt
                    ? new Date(row.entry.windowClosesAt).toLocaleDateString()
                    : '—'}
                </span>
              </div>
            </li>
          ),
        )}
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
      empty={
        <>
          <FolderIcon />
          <span>You own no documents yet.</span>
        </>
      }
      cta={
        // creation itself stays on the Documents page (?create=1 opens the
        // form there — the dashboard stays read-only)
        <Link className="dash-cta" to="/documents?create=1">
          + New document
        </Link>
      }
    >
      <ul className="dash-list">
        {(page?.content ?? []).map((doc: DocumentSummary) => (
          <li key={doc.id}>
            <Link to={`/documents/${doc.id}`}>
              {doc.documentNumber} — {doc.name}
            </Link>
            <div className="muted">
              <span className={`badge ${doc.status}`}>{doc.status}</span>
            </div>
          </li>
        ))}
      </ul>
    </Dashlet>
  );
}
