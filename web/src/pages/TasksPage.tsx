import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { acknowledgmentApi, workflowApi } from '../api/resources';
import type { PendingAcknowledgment, WorkflowTask } from '../api/types';

/**
 * The Tasks section (nav restructure plan-back section 1): two panes via
 * the ?view= parameter. My Approvals is the existing reviewer queue
 * (GET /my/tasks); Pending My Acknowledgment is the new reverse query
 * (GET /my/acknowledgments) — record-only, acknowledging happens on the
 * document page.
 */
export default function TasksPage() {
  const [searchParams] = useSearchParams();
  const view = searchParams.get('view') === 'acknowledgments' ? 'acknowledgments' : 'approvals';

  return (
    <>
      <h1>Tasks</h1>
      {view === 'approvals' ? <MyApprovals /> : <PendingMyAcknowledgment />}
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
