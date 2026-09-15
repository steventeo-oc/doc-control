import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { acknowledgmentApi, workflowApi } from '../api/resources';
import type { PendingAcknowledgment, StartedInstance, WorkflowTask } from '../api/types';

/**
 * The Tasks section (nav restructure plan-back section 1): panes via the
 * ?view= parameter. My Approvals is the existing reviewer queue
 * (GET /my/tasks); Pending My Acknowledgment is the reverse query
 * (GET /my/acknowledgments) — record-only, acknowledging happens on the
 * document page; Started by Me lists approvals the caller started
 * (GET /my/started-instances, plan-back approved 2026-09-14) with
 * per-reviewer state for in-progress ones.
 */
export default function TasksPage() {
  const [searchParams] = useSearchParams();
  const viewParam = searchParams.get('view');
  const view: 'approvals' | 'acknowledgments' | 'started' =
    viewParam === 'acknowledgments' || viewParam === 'started' ? viewParam : 'approvals';

  return (
    <>
      <h1>Tasks</h1>
      {view === 'approvals' ? (
        <MyApprovals />
      ) : view === 'started' ? (
        <StartedByMe />
      ) : (
        <PendingMyAcknowledgment />
      )}
    </>
  );
}

function MyApprovals() {
  const [tasks, setTasks] = useState<WorkflowTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [approving, setApproving] = useState<WorkflowTask | null>(null);
  const [effectiveDate, setEffectiveDate] = useState('');
  const [comment, setComment] = useState('');

  const load = useCallback(() => {
    workflowApi
      .myTasks()
      .then(setTasks)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  function openApprovalForm(task: WorkflowTask) {
    setApproving(task);
    setEffectiveDate('');
    setComment('');
    setError(null);
    setNotice(null);
  }

  async function submitCompletion(task: WorkflowTask, approved: boolean) {
    setError(null);
    try {
      await workflowApi.complete(
        task.id,
        approved,
        comment.trim() || null,
        approving && approved && effectiveDate ? effectiveDate : null,
      );
      setApproving(null);
      setComment('');
      setNotice(
        approved
          ? `Approved ${task.documentNumber} v${task.versionNumber}.`
          : `Rejected ${task.documentNumber} v${task.versionNumber} — the whole approval is rejected.`,
      );
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function handleApprovalSubmit(event: FormEvent) {
    event.preventDefault();
    if (approving) {
      void submitCompletion(approving, true);
    }
  }

  if (error && !tasks) {
    return <div className="error-banner">{error}</div>;
  }
  if (!tasks) {
    return <div className="page-loading">Loading…</div>;
  }

  return (
    <>
      <h2>My Approvals</h2>
      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="success-banner">{notice}</div>}

      <table className="data">
        <thead>
          <tr>
            <th>Task</th>
            <th>Document</th>
            <th>Version</th>
            <th>Assignment</th>
            <th>Due</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id}>
              <td>
                {task.name}{' '}
                {task.reapproval && <span className="badge reapproval">re-approval</span>}
              </td>
              <td>
                <Link to={`/documents/${task.documentId}`}>{task.documentNumber}</Link>
              </td>
              <td>v{task.versionNumber}</td>
              <td>
                {task.assigneeName ?? task.candidateGroups.map((g) => `role: ${g}`).join(', ')}
                {task.claimedByMe && <span className="muted"> (you)</span>}
              </td>
              <td className="muted">
                {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '—'}
              </td>
              <td>
                <button type="button" className="primary" onClick={() => openApprovalForm(task)}>
                  Approve / Reject
                </button>
              </td>
            </tr>
          ))}
          {tasks.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No pending tasks assigned to you or your roles.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <p className="muted">
        <Link to="/activity?scope=mine&category=workflow">
          View your approval history →
        </Link>
      </p>

      {approving && (
        <div className="card">
          <h2>
            Complete review — {approving.documentNumber} v{approving.versionNumber}
            {approving.reapproval && <span className="badge reapproval"> re-approval</span>}
          </h2>
          <form className="inline" onSubmit={handleApprovalSubmit}>
            <label>
              Effective date (optional)
              <input
                type="date"
                value={effectiveDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
            </label>
            <label>
              Comment
              <input
                value={comment}
                placeholder="Optional review comment"
                onChange={(e) => setComment(e.target.value)}
              />
            </label>
            <button type="submit" className="primary">
              Approve
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => void submitCompletion(approving, false)}
            >
              Reject
            </button>
            <button type="button" onClick={() => setApproving(null)}>
              Cancel
            </button>
          </form>
          <p className="muted">
            Leave the effective date empty to release immediately. A future date approves the
            version now; it takes effect (and becomes the public version) on that date.
            {approving.reapproval &&
              ' This is a periodic-review re-approval: the released version stays in place and only the review clock resets.'}
          </p>
        </div>
      )}
    </>
  );
}

function PendingMyAcknowledgment() {
  const [pending, setPending] = useState<PendingAcknowledgment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    acknowledgmentApi
      .pending()
      .then(setPending)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  if (error && !pending) {
    return <div className="error-banner">{error}</div>;
  }
  if (!pending) {
    return <div className="page-loading">Loading…</div>;
  }

  return (
    <>
      <h2>Pending My Acknowledgment</h2>
      {error && <div className="error-banner">{error}</div>}
      <table className="data">
        <thead>
          <tr>
            <th>Document</th>
            <th>Name</th>
            <th>Department</th>
            <th>Version</th>
            <th>Effective</th>
            <th>Window closes</th>
          </tr>
        </thead>
        <tbody>
          {pending.map((entry) => (
            <tr key={entry.documentId}>
              <td>
                <Link to={`/documents/${entry.documentId}`}>{entry.documentNumber}</Link>
                {entry.overdue && <span className="badge reapproval"> overdue</span>}
              </td>
              <td>{entry.name}</td>
              <td>{entry.departmentCode}</td>
              <td>v{entry.versionNumber}</td>
              <td className="muted">
                {entry.effectiveAt ? new Date(entry.effectiveAt).toLocaleDateString() : '—'}
              </td>
              <td className="muted">
                {entry.windowClosesAt ? new Date(entry.windowClosesAt).toLocaleDateString() : '—'}
              </td>
            </tr>
          ))}
          {pending.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                Nothing to acknowledge — you are all caught up.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="muted">
        Acknowledgment is record-only: open a document to read it and acknowledge there.
      </p>
    </>
  );
}

/**
 * The "Started by Me" pane (plan-back approved 2026-09-14): approvals the
 * caller started, newest first, with the per-reviewer approved/pending
 * breakdown for in-progress ones (approved names from the engine's
 * finished-task history; pooled tasks show the role — nobody has
 * committed until someone claims). Read-only: actions stay on the
 * document page.
 */
function StartedByMe() {
  const [rows, setRows] = useState<StartedInstance[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    workflowApi
      .startedByMe()
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  if (error && !rows) {
    return <div className="error-banner">{error}</div>;
  }
  if (!rows) {
    return <div className="page-loading">Loading…</div>;
  }

  return (
    <>
      <h2>Started by Me</h2>
      {error && <div className="error-banner">{error}</div>}
      <table className="data">
        <thead>
          <tr>
            <th>Document</th>
            <th>Version</th>
            <th>Status</th>
            <th>Started</th>
            <th>Reviewers</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <Link to={`/documents/${row.documentId}`}>{row.documentNumber}</Link>
                {row.reapproval && <span className="badge reapproval"> re-approval</span>}
              </td>
              <td>v{row.versionNumber}</td>
              <td>
                <span className={startedStatusBadge(row.status)}>{startedStatusLabel(row.status)}</span>
              </td>
              <td className="muted">{new Date(row.startedAt).toLocaleString()}</td>
              <td className="muted">
                {row.reviewers.length === 0 ? '—' : reviewerLine(row.reviewers)}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                You have not started any approvals.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

function startedStatusBadge(status: string | null): string {
  switch (status) {
    case 'in_progress':
      return 'badge in_review';
    case 'completed':
      return 'badge released';
    case 'rejected':
      return 'badge superseded';
    default:
      return 'badge';
  }
}

function startedStatusLabel(status: string | null): string {
  switch (status) {
    case 'in_progress':
      return 'in review';
    case 'completed':
      return 'approved';
    case 'rejected':
      return 'rejected';
    default:
      return status ?? '—';
  }
}

function reviewerLine(reviewers: StartedInstance['reviewers']) {
  return reviewers.map((r, index) => (
    <span key={index}>
      {index > 0 && ', '}
      {r.state === 'approved'
        ? `✓ ${r.name ?? '?'}`
        : r.role
          ? `${r.role} (pending)`
          : `${r.name ?? '?'} (pending)`}
    </span>
  ));
}
