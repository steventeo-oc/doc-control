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
 * 2026-09-14): exactly three read-only dashlets over endpoints that already
 * exist — My Approvals (GET /my/tasks), My Acknowledgments
 * (GET /my/acknowledgments), My Documents (owner=me). Each is a count, the
 * top few rows and a deep link into the owning section page; approve /
 * acknowledge actions stay in their existing homes. The activities feed is
 * deliberately excluded — it needs the Sprint 4 audit-log read API.
 */

const DASHLET_ROWS = 8;

export default function DashboardPage() {
  return (
    <>
      <h1>Dashboard</h1>
      <div className="dash-grid">
        <ApprovalsDashlet />
        <AcknowledgmentsDashlet />
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
  empty: string;
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
      {props.loaded && props.count === 0 && <p className="muted">{props.empty}</p>}
      {props.loaded && props.count !== null && props.count > 0 && props.children}
      <p className="dash-more">
        <Link to={props.moreTo}>{props.moreLabel} →</Link>
      </p>
    </section>
  );
}

function ApprovalsDashlet() {
  const [tasks, setTasks] = useState<WorkflowTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    workflowApi
      .myTasks()
      .then(setTasks)
      .catch((err: Error) => setError(err.message));
  }, []);

  // Overdue mirrors the sweep's business-day rule: the highlight starts the
  // day after the due date — due today is "due today", not overdue.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const rows = (tasks ?? [])
    .slice()
    .sort((a, b) => {
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return ad - bd;
    })
    .slice(0, DASHLET_ROWS);

  return (
    <Dashlet
      title="My Approvals"
      count={tasks?.length ?? null}
      moreTo="/tasks?view=approvals"
      moreLabel="All my approvals"
      empty="Nothing waiting for your approval."
      error={error}
      loaded={tasks !== null}
    >
      <ul className="dash-list">
        {rows.map((task) => (
          <li key={task.id}>
            <Link to={`/documents/${task.documentId}`}>
              {task.documentNumber} v{task.versionNumber}
            </Link>{' '}
            — {task.name}
            {task.reapproval && <span className="badge reapproval"> re-approval</span>}
            <div className="muted">
              {task.dueDate ? `Due ${new Date(task.dueDate).toLocaleDateString()}` : 'No due date'}
              {task.dueDate && new Date(task.dueDate) < startOfToday && (
                <span className="badge overdue"> overdue</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Dashlet>
  );
}

function AcknowledgmentsDashlet() {
  const [pending, setPending] = useState<PendingAcknowledgment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    acknowledgmentApi
      .pending()
      .then(setPending)
      .catch((err: Error) => setError(err.message));
  }, []);

  const rows = (pending ?? [])
    .slice()
    .sort((a, b) => {
      const ad = a.windowClosesAt ? new Date(a.windowClosesAt).getTime() : Infinity;
      const bd = b.windowClosesAt ? new Date(b.windowClosesAt).getTime() : Infinity;
      return ad - bd;
    })
    .slice(0, DASHLET_ROWS);

  return (
    <Dashlet
      title="My Acknowledgments"
      count={pending?.length ?? null}
      moreTo="/tasks?view=acknowledgments"
      moreLabel="All pending acknowledgments"
      empty="Nothing to acknowledge — you are all caught up."
      error={error}
      loaded={pending !== null}
    >
      <ul className="dash-list">
        {rows.map((entry) => (
          <li key={entry.documentId}>
            <Link to={`/documents/${entry.documentId}`}>{entry.documentNumber}</Link> — {entry.name}
            {entry.overdue && <span className="badge overdue"> overdue</span>}
            <div className="muted">
              {entry.departmentCode} · v{entry.versionNumber} · window closes{' '}
              {entry.windowClosesAt ? new Date(entry.windowClosesAt).toLocaleDateString() : '—'}
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
    // true total from the page payload (plan-back F2).
    documentApi
      .list({ owner: 'me', page: 0, pageSize: DASHLET_ROWS })
      .then(setPage)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <Dashlet
      title="My Documents"
      count={page?.totalElements ?? null}
      moreTo="/documents?view=mine"
      moreLabel="All my documents"
      empty="You own no documents yet."
      error={error}
      loaded={page !== null}
    >
      <ul className="dash-list">
        {(page?.content ?? []).map((doc: DocumentSummary) => (
          <li key={doc.id}>
            <Link to={`/documents/${doc.id}`}>{doc.documentNumber}</Link> — {doc.name}
            <div className="muted">
              <span className={`badge ${doc.status}`}>{doc.status}</span>
            </div>
          </li>
        ))}
      </ul>
    </Dashlet>
  );
}
