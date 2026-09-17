import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Inbox } from 'lucide-react';
import { acknowledgmentApi, workflowApi } from '../api/resources';
import type { PendingAcknowledgment, StartedInstance, WorkflowTask } from '../api/types';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

/**
 * The Tasks section (nav restructure plan-back section 1): panes via the
 * ?view= parameter. My Approvals is the existing reviewer queue
 * (GET /my/tasks); Pending My Acknowledgment is the reverse query
 * (GET /my/acknowledgments) — record-only, acknowledging happens on the
 * document page; Started by Me lists approvals the caller started
 * (GET /my/started-instances, plan-back approved 2026-09-14) with
 * per-reviewer state for in-progress ones.
 *
 * Design-redesign Phase 2c (Design_System_Redesign_PlanBack.md): reskinned
 * onto PageHeader/Table/Button/Input/Label/Card/StatusBadge/EmptyState.
 * Deliberate bug fix (§11): PendingMyAcknowledgment overdue badge mapped
 * to 'overdue' (destructive red) rather than 'reapproval' (violet).
 * Behavior freeze — routes, ?view= params, API contracts, rejection logic,
 * and deep links are bit-for-bit unchanged.
 */
export default function TasksPage() {
  const [searchParams] = useSearchParams();
  const viewParam = searchParams.get('view');
  const view: 'approvals' | 'acknowledgments' | 'started' =
    viewParam === 'acknowledgments' || viewParam === 'started' ? viewParam : 'approvals';

  return (
    <>
      <PageHeader
        title={
          view === 'started'
            ? 'Started by Me'
            : view === 'acknowledgments'
              ? 'Pending My Acknowledgment'
              : 'My Approvals'
        }
      />
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
    return (
      <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (!tasks) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <>
      {error && (
        <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          {notice}
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={Inbox}
            message="No pending tasks assigned to you or your roles."
          />
        </div>
      ) : (
        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Document</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Assignment</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="w-36" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell className="font-medium">
                  {task.name}
                  {task.reapproval && (
                    <StatusBadge status="reapproval" className="ml-1.5">
                      re-approval
                    </StatusBadge>
                  )}
                </TableCell>
                <TableCell>
                  <Link
                    to={`/documents/${task.documentId}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {task.documentNumber}
                  </Link>
                </TableCell>
                <TableCell>v{task.versionNumber}</TableCell>
                <TableCell className="text-muted-foreground">
                  {task.assigneeName ?? task.candidateGroups.map((g) => `role: ${g}`).join(', ')}
                  {task.claimedByMe && <span className="text-muted-foreground"> (you)</span>}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '—'}
                </TableCell>
                <TableCell>
                  <Button type="button" size="sm" onClick={() => openApprovalForm(task)}>
                    Approve / Reject
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <p className="mt-4 text-sm text-muted-foreground">
        <Link
          to="/activity?scope=mine&category=workflow"
          className="text-primary hover:underline"
        >
          View your approval history →
        </Link>
      </p>

      {approving && (
        <Card className="mt-6 max-w-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              Complete review — {approving.documentNumber} v{approving.versionNumber}
              {approving.reapproval && (
                <StatusBadge status="reapproval">re-approval</StatusBadge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={handleApprovalSubmit}>
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="approval-effective-date">Effective date (optional)</Label>
                  <Input
                    id="approval-effective-date"
                    type="date"
                    value={effectiveDate}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setEffectiveDate(e.target.value)}
                    className="w-48"
                  />
                </div>
                <div className="flex flex-1 flex-col gap-1.5 min-w-[220px]">
                  <Label htmlFor="approval-comment">Comment</Label>
                  <Input
                    id="approval-comment"
                    value={comment}
                    placeholder="Optional review comment"
                    onChange={(e) => setComment(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button type="submit">Approve</Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void submitCompletion(approving, false)}
                >
                  Reject
                </Button>
                <Button type="button" variant="outline" onClick={() => setApproving(null)}>
                  Cancel
                </Button>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Leave the effective date empty to release immediately. A future date approves the
                version now; it takes effect (and becomes the public version) on that date.
                {approving.reapproval &&
                  ' This is a periodic-review re-approval: the released version stays in place and only the review clock resets.'}
              </p>
            </form>
          </CardContent>
        </Card>
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
    return (
      <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (!pending) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <>
      {error && (
        <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {pending.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={CheckCircle2}
            message="Nothing to acknowledge — you are all caught up."
          />
        </div>
      ) : (
        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>Document</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Effective</TableHead>
              <TableHead>Window closes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pending.map((entry) => (
              <TableRow key={entry.documentId}>
                <TableCell className="font-medium">
                  <Link
                    to={`/documents/${entry.documentId}`}
                    className="text-primary hover:underline"
                  >
                    {entry.documentNumber}
                  </Link>
                  {/* Plan-Back §11 bug fix: mapped to 'overdue' (destructive), not 'reapproval' (violet) */}
                  {entry.overdue && (
                    <StatusBadge status="overdue" className="ml-1.5">
                      overdue
                    </StatusBadge>
                  )}
                </TableCell>
                <TableCell>{entry.name}</TableCell>
                <TableCell>
                  <StatusBadge status="dept">{entry.departmentCode}</StatusBadge>
                </TableCell>
                <TableCell>v{entry.versionNumber}</TableCell>
                <TableCell className="text-muted-foreground">
                  {entry.effectiveAt ? new Date(entry.effectiveAt).toLocaleDateString() : '—'}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {entry.windowClosesAt
                    ? new Date(entry.windowClosesAt).toLocaleDateString()
                    : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <p className="mt-4 text-sm text-muted-foreground">
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
    return (
      <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (!rows) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <>
      {error && (
        <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={Inbox}
            message="You have not started any approvals."
          />
        </div>
      ) : (
        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>Document</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Reviewers</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">
                  <Link
                    to={`/documents/${row.documentId}`}
                    className="text-primary hover:underline"
                  >
                    {row.documentNumber}
                  </Link>
                  {row.reapproval && (
                    <StatusBadge status="reapproval" className="ml-1.5">
                      re-approval
                    </StatusBadge>
                  )}
                </TableCell>
                <TableCell>v{row.versionNumber}</TableCell>
                <TableCell>
                  <StartedStatusBadge status={row.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(row.startedAt).toLocaleString()}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {row.reviewers.length === 0 ? '—' : reviewerLine(row.reviewers)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

function StartedStatusBadge({ status }: { status: string | null }) {
  switch (status) {
    case 'in_progress':
      return <StatusBadge status="in_review">in review</StatusBadge>;
    case 'completed':
      return <StatusBadge status="released">approved</StatusBadge>;
    case 'rejected':
      return <StatusBadge status="superseded">rejected</StatusBadge>;
    default:
      return status ? <StatusBadge status="dept">{status}</StatusBadge> : <span>—</span>;
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
