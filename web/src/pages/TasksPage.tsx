import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  Check,
  CheckCircle2,
  ExternalLink,
  Eye,
  FileText,
  Inbox,
  RotateCcw,
  Search,
  UserCheck,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import { acknowledgmentApi, workflowApi } from '../api/resources';
import DocumentPreviewModal, { DocumentPreviewViewer } from '../components/DocumentPreviewModal';
import type {
  DelegatedTask,
  PendingAcknowledgment,
  ReviewerCandidate,
  StartedInstance,
  WorkflowTask,
} from '../api/types';
import { cn } from '../lib/utils';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

export default function TasksPage() {
  const [searchParams] = useSearchParams();
  const viewParam = searchParams.get('view');
  const view: 'approvals' | 'acknowledgments' | 'started' | 'delegated' =
    viewParam === 'acknowledgments' || viewParam === 'started' || viewParam === 'delegated'
      ? viewParam
      : 'approvals';

  const notifyUpdated = useCallback(() => {
    window.dispatchEvent(new CustomEvent('task-counts-updated'));
  }, []);

  return (
    <>
      <div className="mb-6">
        <PageHeader
          title={
            view === 'delegated'
              ? 'Delegated by Me'
              : view === 'started'
                ? 'Started by Me'
                : view === 'acknowledgments'
                  ? 'Pending My Acknowledgment'
                  : 'My Approvals'
          }
        />
      </div>

      {view === 'approvals' ? (
        <MyApprovals onUpdated={notifyUpdated} />
      ) : view === 'started' ? (
        <StartedByMe onUpdated={notifyUpdated} />
      ) : view === 'delegated' ? (
        <DelegatedByMe onUpdated={notifyUpdated} />
      ) : (
        <PendingMyAcknowledgment onUpdated={notifyUpdated} />
      )}
    </>
  );
}

function DueDateBadge({ dueDate }: { dueDate: string | null }) {
  if (!dueDate) return <span className="text-muted-foreground/50 text-xs">—</span>;
  const due = new Date(dueDate);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diffDays = Math.ceil((dueDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return (
      <div className="flex flex-col items-start gap-0.5">
        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold bg-destructive/15 text-destructive border border-destructive/30">
          Overdue ({Math.abs(diffDays)}d)
        </span>
        <span className="text-xs text-muted-foreground">{due.toLocaleDateString()}</span>
      </div>
    );
  }
  if (diffDays <= 2) {
    return (
      <div className="flex flex-col items-start gap-0.5">
        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
          {diffDays === 0 ? 'Due today' : diffDays === 1 ? 'Due tomorrow' : 'Due in 2 days'}
        </span>
        <span className="text-xs text-muted-foreground">{due.toLocaleDateString()}</span>
      </div>
    );
  }
  return <span className="text-xs text-muted-foreground">{due.toLocaleDateString()}</span>;
}

function MyApprovals({ onUpdated }: { onUpdated: () => void }) {
  const [tasks, setTasks] = useState<WorkflowTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Search and Urgency Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState<'all' | 'overdue' | 'due_soon' | 'delegated'>('all');

  // Preview state
  const [previewTask, setPreviewTask] = useState<WorkflowTask | null>(null);
  const [showReviewEmbeddedPreview, setShowReviewEmbeddedPreview] = useState(true);

  // Modals state
  const [reviewTask, setReviewTask] = useState<WorkflowTask | null>(null);
  const [effectiveDate, setEffectiveDate] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Rejection confirmation safeguard state
  const [rejectTask, setRejectTask] = useState<WorkflowTask | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Delegation modal state
  const [delegateTask, setDelegateTask] = useState<WorkflowTask | null>(null);
  const [candidates, setCandidates] = useState<ReviewerCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>('');
  const [delegateMessage, setDelegateMessage] = useState('');
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [delegating, setDelegating] = useState(false);

  const load = useCallback(() => {
    workflowApi
      .myTasks()
      .then(setTasks)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  function getTaskUrgency(task: WorkflowTask): 'overdue' | 'due_soon' | 'normal' {
    if (!task.dueDate) return 'normal';
    const due = new Date(task.dueDate);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const diffDays = Math.ceil((dueDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return 'overdue';
    if (diffDays <= 2) return 'due_soon';
    return 'normal';
  }

  const counts = {
    all: tasks?.length ?? 0,
    overdue: tasks?.filter((t) => getTaskUrgency(t) === 'overdue').length ?? 0,
    dueSoon: tasks?.filter((t) => getTaskUrgency(t) === 'due_soon').length ?? 0,
    delegated: tasks?.filter((t) => Boolean(t.delegatedBy)).length ?? 0,
  };

  const filteredTasks = (tasks ?? []).filter((task) => {
    if (urgencyFilter === 'overdue' && getTaskUrgency(task) !== 'overdue') return false;
    if (urgencyFilter === 'due_soon' && getTaskUrgency(task) !== 'due_soon') return false;
    if (urgencyFilter === 'delegated' && !task.delegatedBy) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchDocNumber = task.documentNumber?.toLowerCase().includes(q);
      const matchDocName = task.documentName?.toLowerCase().includes(q);
      const matchNotes = task.changeNotes?.toLowerCase().includes(q);
      const matchDelegatedBy = task.delegatedBy?.toLowerCase().includes(q);
      const matchAssignee = task.assigneeName?.toLowerCase().includes(q);
      const matchTaskName = task.name?.toLowerCase().includes(q);
      if (!matchDocNumber && !matchDocName && !matchNotes && !matchDelegatedBy && !matchAssignee && !matchTaskName) {
        return false;
      }
    }
    return true;
  });

  function openReviewModal(task: WorkflowTask) {
    setReviewTask(task);
    setEffectiveDate('');
    setComment('');
    setShowReviewEmbeddedPreview(true);
    setError(null);
    setNotice(null);
  }

  function openRejectConfirm(task: WorkflowTask) {
    setRejectTask(task);
    setRejectReason('');
  }

  function openDelegateModal(task: WorkflowTask) {
    setDelegateTask(task);
    setSelectedCandidateId('');
    setDelegateMessage('');
    setLoadingCandidates(true);
    workflowApi
      .reviewerCandidates(task.documentId)
      .then((res) => {
        // filter out current assignee
        setCandidates(res.filter((c) => String(c.id) !== task.assigneeUserId));
      })
      .catch(() => setCandidates([]))
      .finally(() => setLoadingCandidates(false));
  }

  async function handleApprove(event: FormEvent) {
    event.preventDefault();
    if (!reviewTask) return;
    setSubmitting(true);
    setError(null);
    try {
      await workflowApi.complete(
        reviewTask.id,
        true,
        comment.trim() || null,
        effectiveDate ? effectiveDate : null
      );
      setNotice(`Approved ${reviewTask.documentNumber} Rev ${reviewTask.versionNumber}.`);
      setReviewTask(null);
      load();
      onUpdated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmReject() {
    if (!rejectTask) return;
    setSubmitting(true);
    setError(null);
    try {
      await workflowApi.complete(rejectTask.id, false, rejectReason.trim() || null, null);
      setNotice(
        `Rejected ${rejectTask.documentNumber} Rev ${rejectTask.versionNumber} — the approval process has been ended.`
      );
      setRejectTask(null);
      setReviewTask(null);
      load();
      onUpdated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmDelegate(event: FormEvent) {
    event.preventDefault();
    if (!delegateTask || !selectedCandidateId) return;
    setDelegating(true);
    setError(null);
    try {
      await workflowApi.delegate(
        delegateTask.id,
        Number(selectedCandidateId),
        delegateMessage.trim() || null
      );
      const cand = candidates.find((c) => String(c.id) === selectedCandidateId);
      setNotice(
        `Task for ${delegateTask.documentNumber} delegated to ${cand ? cand.name : 'new reviewer'}.`
      );
      setDelegateTask(null);
      load();
      onUpdated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDelegating(false);
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
        <div className="mb-4 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setUrgencyFilter('all')}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
              urgencyFilter === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            )}
          >
            All ({counts.all})
          </button>
          <button
            type="button"
            onClick={() => setUrgencyFilter('overdue')}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1',
              urgencyFilter === 'overdue'
                ? 'bg-destructive text-destructive-foreground'
                : 'bg-muted text-muted-foreground hover:text-destructive'
            )}
          >
            <span>Overdue</span>
            {counts.overdue > 0 && (
              <span className="rounded-full bg-destructive/20 px-1.5 py-0.2 text-[10px] font-bold">
                {counts.overdue}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setUrgencyFilter('due_soon')}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1',
              urgencyFilter === 'due_soon'
                ? 'bg-amber-600 text-white'
                : 'bg-muted text-muted-foreground hover:text-amber-600'
            )}
          >
            <span>Due Soon</span>
            {counts.dueSoon > 0 && (
              <span className="rounded-full bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-bold">
                {counts.dueSoon}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setUrgencyFilter('delegated')}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1',
              urgencyFilter === 'delegated'
                ? 'bg-blue-600 text-white'
                : 'bg-muted text-muted-foreground hover:text-blue-600'
            )}
          >
            <span>Delegated to Me</span>
            {counts.delegated > 0 && (
              <span className="rounded-full bg-blue-500/20 px-1.5 py-0.2 text-[10px] font-bold">
                {counts.delegated}
              </span>
            )}
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search document, name, notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs w-full"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {filteredTasks.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={Inbox}
            message={
              tasks.length === 0
                ? 'No pending tasks assigned to you or your roles.'
                : 'No tasks match your current search and filter criteria.'
            }
          />
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-border/40 bg-card p-0 shadow-xs overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border/40 hover:bg-transparent">
                <TableHead>Task</TableHead>
                <TableHead className="min-w-[200px]">Document</TableHead>
                <TableHead>Revision</TableHead>
                <TableHead>Assignment</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTasks.map((task) => (
                <TableRow key={task.id} className="border-border/30 hover:bg-muted/40 transition-colors">
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span>{task.name}</span>
                      {task.reapproval && (
                        <StatusBadge status="reapproval">re-approval</StatusBadge>
                      )}
                    </div>
                    {task.delegatedBy && (
                      <div className="mt-1.5 rounded bg-blue-500/10 border border-blue-500/20 px-2 py-1 text-[11px] text-blue-700 dark:text-blue-300">
                        <span className="font-semibold">Delegated by {task.delegatedBy}</span>
                        {task.delegationMessage && (
                          <p className="mt-0.5 italic text-muted-foreground break-words font-normal">
                            "{task.delegationMessage}"
                          </p>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <Link
                        to={`/documents/${task.documentId}`}
                        className="font-medium text-primary hover:underline flex items-center gap-1"
                      >
                        {task.documentNumber}
                        <ArrowUpRight className="size-3 text-muted-foreground/60" />
                      </Link>
                      {task.documentName && (
                        <span className="text-xs text-muted-foreground line-clamp-1 max-w-xs">
                          {task.documentName}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-semibold text-xs">Rev {task.versionNumber}</span>
                      {task.changeNotes && (
                        <span
                          className="text-[11px] text-muted-foreground italic line-clamp-1 max-w-[140px]"
                          title={task.changeNotes}
                        >
                          {task.changeNotes}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {task.assigneeName ?? task.candidateGroups.map((g) => `role: ${g}`).join(', ')}
                    {task.claimedByMe && <span className="font-medium text-foreground"> (you)</span>}
                  </TableCell>
                  <TableCell>
                    <DueDateBadge dueDate={task.dueDate} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1.5 justify-end">
                      {task.versionId && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                          onClick={() => setPreviewTask(task)}
                          title="Quick preview document draft"
                        >
                          <Eye className="size-3.5" />
                          <span className="hidden sm:inline">Preview</span>
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => openDelegateModal(task)}
                        title="Delegate task to colleague"
                        className="h-8 text-xs"
                      >
                        <UserPlus className="size-3.5 mr-1" />
                        Delegate
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => openReviewModal(task)}
                        className="h-8 text-xs font-medium"
                      >
                        Review
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="mt-4 text-sm text-muted-foreground">
        <Link to="/activity?scope=mine&category=workflow" className="text-primary hover:underline">
          View your approval history →
        </Link>
      </p>

      {/* Document Quick Preview Modal */}
      <DocumentPreviewModal
        open={Boolean(previewTask)}
        onOpenChange={(open) => !open && setPreviewTask(null)}
        documentId={previewTask?.documentId ?? 0}
        versionId={previewTask?.versionId}
        documentNumber={previewTask?.documentNumber ?? ''}
        versionNumber={previewTask?.versionNumber}
        title={previewTask?.documentName}
      />

      {/* Complete Review Modal Dialog */}
      <Dialog open={Boolean(reviewTask)} onOpenChange={(open) => !open && setReviewTask(null)}>
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-3xl max-h-[92vh] flex flex-col overflow-hidden p-0 rounded-2xl border border-border/40 shadow-2xl shadow-black/10 dark:shadow-black/40 ring-1 ring-black/[0.03] dark:ring-white/[0.04]"
        >
          <DialogHeader className="px-5 py-3 border-b border-border/30 bg-muted/20 flex flex-row items-center justify-between space-y-0">
            <div className="flex flex-col gap-0.5 min-w-0 pr-4">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-sm font-semibold truncate">
                  Complete Review — {reviewTask?.documentNumber} Rev {reviewTask?.versionNumber}
                </DialogTitle>
                {reviewTask?.reapproval && (
                  <StatusBadge status="reapproval">re-approval</StatusBadge>
                )}
              </div>
              <DialogDescription className="text-xs text-muted-foreground truncate">
                {reviewTask?.documentName}
              </DialogDescription>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {reviewTask?.versionId && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2.5 text-xs gap-1 border-border/40 hover:bg-muted/40"
                  onClick={() =>
                    window.open(
                      `/api/documents/${reviewTask.documentId}/versions/${reviewTask.versionId}/download?inline=true`,
                      '_blank'
                    )
                  }
                  title="Open document in a new browser tab"
                >
                  <ExternalLink className="size-3.5" />
                  <span>Open in tab</span>
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground rounded-lg"
                onClick={() => setReviewTask(null)}
                title="Close"
              >
                <X className="size-4" />
              </Button>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Embedded Interactive Preview */}
            {reviewTask?.versionId && (
              <div className="border border-border/40 rounded-xl overflow-hidden bg-card shadow-xs">
                <div className="flex items-center justify-between px-3.5 py-2 bg-muted/25 border-b border-border/30 text-xs">
                  <span className="font-semibold text-foreground flex items-center gap-1.5">
                    <FileText className="size-3.5 text-primary" />
                    Interactive Document Preview (Rev {reviewTask.versionNumber})
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowReviewEmbeddedPreview(!showReviewEmbeddedPreview)}
                    className="text-[11px] text-primary hover:underline font-medium"
                  >
                    {showReviewEmbeddedPreview ? 'Collapse preview' : 'Expand preview'}
                  </button>
                </div>
                {showReviewEmbeddedPreview && (
                  <DocumentPreviewViewer
                    documentId={reviewTask.documentId}
                    versionId={reviewTask.versionId}
                    documentNumber={reviewTask.documentNumber}
                    versionNumber={reviewTask.versionNumber}
                    title={reviewTask.documentName}
                    height="360px"
                    showToolbar={false}
                  />
                )}
              </div>
            )}

            {reviewTask?.changeNotes && (
              <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground border border-border/30">
                <span className="font-semibold text-foreground block mb-1">Revision Change Notes:</span>
                {reviewTask.changeNotes}
              </div>
            )}

            <form id="review-approval-form" onSubmit={handleApprove} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="approval-effective-date" className="text-xs font-semibold">Effective date (optional)</Label>
                  <Input
                    id="approval-effective-date"
                    type="date"
                    value={effectiveDate}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setEffectiveDate(e.target.value)}
                    className="h-8 text-xs border-border/40"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Leave blank to release immediately upon completion.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="approval-comment" className="text-xs font-semibold">Approval Comment (optional)</Label>
                  <Input
                    id="approval-comment"
                    value={comment}
                    placeholder="Notes or observations for the audit trail..."
                    onChange={(e) => setComment(e.target.value)}
                    className="h-8 text-xs border-border/40"
                  />
                </div>
              </div>
            </form>
          </div>

          <div className="px-5 py-3 border-t border-border/30 bg-muted/20 flex items-center justify-between">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => reviewTask && openRejectConfirm(reviewTask)}
              disabled={submitting}
              className="text-xs"
            >
              <XCircle className="size-3.5 mr-1" />
              Reject
            </Button>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setReviewTask(null)}
                disabled={submitting}
                className="text-xs border-border/40"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                form="review-approval-form"
                size="sm"
                disabled={submitting}
                className="text-xs font-semibold"
              >
                <Check className="size-3.5 mr-1" />
                {submitting ? 'Approving…' : 'Approve'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rejection Safeguard Modal Dialog */}
      <AlertDialog open={Boolean(rejectTask)} onOpenChange={(open) => !open && setRejectTask(null)}>
        <AlertDialogContent className="sm:max-w-lg rounded-2xl border border-border/40 shadow-2xl shadow-black/10 dark:shadow-black/40 ring-1 ring-black/[0.03] dark:ring-white/[0.04] p-6">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5 text-destructive shrink-0" />
              <span>Confirm Rejection of {rejectTask?.documentNumber} Rev {rejectTask?.versionNumber}</span>
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left text-xs space-y-2 text-muted-foreground">
              <p>
                <strong className="text-foreground">Warning:</strong> Rejecting will immediately cancel the entire approval workflow for all reviewers. The author will be notified to revise the draft.
              </p>
              <p>
                To maintain ISO 9001 auditability, a clear rejection reason is required.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-2 my-2 text-left">
            <Label htmlFor="rejection-reason" className="text-xs font-semibold text-foreground">
              Rejection Reason <span className="text-destructive">*</span>
            </Label>
            <textarea
              id="rejection-reason"
              required
              rows={3}
              className="w-full rounded-xl border border-border/40 bg-background px-3 py-2 text-xs shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive/30"
              placeholder="Detail the technical or editorial deficiencies requiring revision..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            {rejectReason.trim().length > 0 && rejectReason.trim().length < 5 && (
              <span className="text-[11px] text-destructive">Reason must be at least 5 characters.</span>
            )}
          </div>

          <AlertDialogFooter className="pt-3 border-t border-border/30">
            <AlertDialogCancel disabled={submitting} className="text-xs border-border/40">Back to Review</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="text-xs"
              disabled={submitting || rejectReason.trim().length < 5}
              onClick={handleConfirmReject}
            >
              {submitting ? 'Rejecting…' : 'Confirm Rejection'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delegation Modal Dialog */}
      <Dialog open={Boolean(delegateTask)} onOpenChange={(open) => !open && setDelegateTask(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl border border-border/40 shadow-2xl shadow-black/10 dark:shadow-black/40 ring-1 ring-black/[0.03] dark:ring-white/[0.04] p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="size-5 text-primary" />
              <span>Delegate Review Task</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Reassign {delegateTask?.documentNumber} Rev {delegateTask?.versionNumber} to another eligible reviewer.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleConfirmDelegate} className="flex flex-col gap-4 mt-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="delegate-candidate" className="text-xs font-semibold">Select New Reviewer</Label>
              {loadingCandidates ? (
                <div className="py-2 text-xs text-muted-foreground">Loading candidates…</div>
              ) : candidates.length === 0 ? (
                <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground border border-border/30">
                  No other eligible reviewers found for this document's department.
                </div>
              ) : (
                <Select
                  value={selectedCandidateId}
                  onValueChange={setSelectedCandidateId}
                  required
                >
                  <SelectTrigger id="delegate-candidate" className="w-full border-border/40 text-xs">
                    <SelectValue placeholder="Choose a colleague…" />
                  </SelectTrigger>
                  <SelectContent className="border-border/40 shadow-xl rounded-xl">
                    {candidates.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)} className="text-xs">
                        {c.name} ({c.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="delegate-message" className="text-xs font-semibold">Instructions / Message to Colleague (optional)</Label>
              <textarea
                id="delegate-message"
                rows={3}
                className="w-full rounded-xl border border-border/40 bg-background px-3 py-2 text-xs shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
                placeholder="e.g., Please review Section 4 and verify calibration tolerances..."
                value={delegateMessage}
                onChange={(e) => setDelegateMessage(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                This context will be shown to your colleague and recorded in the audit log.
              </p>
            </div>

            <DialogFooter className="mt-4 pt-3 border-t border-border/30 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs border-border/40"
                onClick={() => setDelegateTask(null)}
                disabled={delegating}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="text-xs"
                disabled={delegating || !selectedCandidateId}
              >
                {delegating ? 'Delegating…' : 'Delegate Task'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PendingMyAcknowledgment({ onUpdated }: { onUpdated: () => void }) {
  const [pending, setPending] = useState<PendingAcknowledgment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Search and Urgency Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState<'all' | 'overdue' | 'due_soon'>('all');

  // Preview state
  const [previewAckDoc, setPreviewAckDoc] = useState<PendingAcknowledgment | null>(null);

  // Quick Acknowledge modal state
  const [ackModalDoc, setAckModalDoc] = useState<PendingAcknowledgment | null>(null);
  const [confirmedRead, setConfirmedRead] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    acknowledgmentApi
      .pending()
      .then(setPending)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  function isDueSoon(windowClosesAt: string | null): boolean {
    if (!windowClosesAt) return false;
    const due = new Date(windowClosesAt);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const diffDays = Math.ceil((dueDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 2;
  }

  const counts = {
    all: pending?.length ?? 0,
    overdue: pending?.filter((p) => p.overdue).length ?? 0,
    dueSoon: pending?.filter((p) => !p.overdue && isDueSoon(p.windowClosesAt)).length ?? 0,
  };

  const filteredPending = (pending ?? []).filter((item) => {
    if (urgencyFilter === 'overdue' && !item.overdue) return false;
    if (urgencyFilter === 'due_soon' && (item.overdue || !isDueSoon(item.windowClosesAt))) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchNumber = item.documentNumber?.toLowerCase().includes(q);
      const matchName = item.name?.toLowerCase().includes(q);
      const matchDept = item.departmentCode?.toLowerCase().includes(q);
      if (!matchNumber && !matchName && !matchDept) return false;
    }
    return true;
  });

  async function handleConfirmAcknowledge() {
    if (!ackModalDoc) return;
    setSubmitting(true);
    setError(null);
    try {
      await acknowledgmentApi.acknowledge(ackModalDoc.documentId);
      setNotice(`Recorded your acknowledgment for ${ackModalDoc.documentNumber} Rev ${ackModalDoc.versionNumber}.`);
      setAckModalDoc(null);
      load();
      onUpdated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

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
      {notice && (
        <div className="mb-4 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </div>
      )}

      {/* Filter and Search Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setUrgencyFilter('all')}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
              urgencyFilter === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            )}
          >
            All ({counts.all})
          </button>
          <button
            type="button"
            onClick={() => setUrgencyFilter('overdue')}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1',
              urgencyFilter === 'overdue'
                ? 'bg-destructive text-destructive-foreground'
                : 'bg-muted text-muted-foreground hover:text-destructive'
            )}
          >
            <span>Overdue</span>
            {counts.overdue > 0 && (
              <span className="rounded-full bg-destructive/20 px-1.5 py-0.2 text-[10px] font-bold">
                {counts.overdue}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setUrgencyFilter('due_soon')}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1',
              urgencyFilter === 'due_soon'
                ? 'bg-amber-600 text-white'
                : 'bg-muted text-muted-foreground hover:text-amber-600'
            )}
          >
            <span>Due Soon</span>
            {counts.dueSoon > 0 && (
              <span className="rounded-full bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-bold">
                {counts.dueSoon}
              </span>
            )}
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search document, department..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs w-full"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {filteredPending.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={CheckCircle2}
            message={
              pending.length === 0
                ? 'Nothing to acknowledge — you are all caught up.'
                : 'No pending acknowledgments match your search and filter criteria.'
            }
          />
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-border/40 bg-card p-0 shadow-xs overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border/40 hover:bg-transparent">
                <TableHead className="min-w-[200px]">Document</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Revision</TableHead>
                <TableHead>Effective Date</TableHead>
                <TableHead>Window Closes</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPending.map((entry) => (
                <TableRow key={entry.documentId} className="border-border/30 hover:bg-muted/40 transition-colors">
                  <TableCell className="font-medium">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5">
                        <Link
                          to={`/documents/${entry.documentId}`}
                          className="text-primary hover:underline font-semibold flex items-center gap-1"
                        >
                          {entry.documentNumber}
                          <ArrowUpRight className="size-3 text-muted-foreground/60" />
                        </Link>
                        {entry.overdue && (
                          <StatusBadge status="overdue">
                            overdue
                          </StatusBadge>
                        )}
                      </div>
                      {entry.name && (
                        <span className="text-xs text-muted-foreground line-clamp-1 max-w-xs">
                          {entry.name}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status="dept">{entry.departmentCode}</StatusBadge>
                  </TableCell>
                  <TableCell className="font-semibold text-xs">Rev {entry.versionNumber}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {entry.effectiveAt ? new Date(entry.effectiveAt).toLocaleDateString() : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    <DueDateBadge dueDate={entry.windowClosesAt} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1.5 justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                        onClick={() => setPreviewAckDoc(entry)}
                        title="Quick preview document before acknowledging"
                      >
                        <Eye className="size-3.5" />
                        <span className="hidden sm:inline">Preview</span>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          setAckModalDoc(entry);
                          setConfirmedRead(false);
                        }}
                        className="h-8 text-xs font-medium"
                      >
                        <CheckCircle2 className="size-3.5 mr-1" />
                        Acknowledge
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Document Quick Preview Modal for Acknowledgment */}
      <DocumentPreviewModal
        open={Boolean(previewAckDoc)}
        onOpenChange={(open) => !open && setPreviewAckDoc(null)}
        documentId={previewAckDoc?.documentId ?? 0}
        versionId={previewAckDoc?.versionId}
        documentNumber={previewAckDoc?.documentNumber ?? ''}
        versionNumber={previewAckDoc?.versionNumber}
        title={previewAckDoc?.name ?? ''}
      />

      {/* Quick Acknowledge Dialog */}
      <Dialog open={Boolean(ackModalDoc)} onOpenChange={(open) => !open && setAckModalDoc(null)}>
        <DialogContent className="sm:max-w-lg rounded-2xl border border-border/40 shadow-2xl shadow-black/10 dark:shadow-black/40 ring-1 ring-black/[0.03] dark:ring-white/[0.04] p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-primary" />
              <span>Acknowledge Controlled Document</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {ackModalDoc?.documentNumber} Rev {ackModalDoc?.versionNumber} — {ackModalDoc?.name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 my-2">
            <div className="rounded-xl bg-muted/40 p-3.5 text-xs text-muted-foreground border border-border/30 space-y-2">
              <p className="font-medium text-foreground">
                In compliance with ISO 9001 Document Control standards, all personnel must review and acknowledge updated operating procedures individually.
              </p>
              <div className="pt-1 flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1 border-border/40 hover:bg-muted/40"
                  onClick={() => {
                    setPreviewAckDoc(ackModalDoc);
                  }}
                >
                  <Eye className="size-3" />
                  Quick preview
                </Button>
                <Link
                  to={`/documents/${ackModalDoc?.documentId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary font-semibold hover:underline text-xs"
                >
                  Open in new tab
                  <ExternalLink className="size-3" />
                </Link>
              </div>
            </div>

            <label className="flex items-start gap-3 p-3 rounded-xl border border-border/30 hover:bg-muted/20 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={confirmedRead}
                onChange={(e) => setConfirmedRead(e.target.checked)}
                className="mt-0.5 size-4 rounded border-border/40 text-primary focus:ring-primary"
              />
              <span className="text-xs text-foreground select-none leading-relaxed">
                I hereby certify that I have thoroughly read, understood, and agree to adhere to the policies and operational instructions outlined in <strong>{ackModalDoc?.documentNumber}</strong>.
              </span>
            </label>
          </div>

          <DialogFooter className="mt-2 pt-3 border-t border-border/30 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs border-border/40"
              onClick={() => setAckModalDoc(null)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="text-xs"
              disabled={submitting || !confirmedRead}
              onClick={handleConfirmAcknowledge}
            >
              <UserCheck className="size-4 mr-1.5" />
              {submitting ? 'Confirming…' : 'Submit Acknowledgment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The "Started by Me" pane: approvals the caller started, newest first.
 * Supports status filtering, displays rejection feedback, and permits in-flight cancellation.
 */
function StartedByMe({ onUpdated }: { onUpdated: () => void }) {
  const [rows, setRows] = useState<StartedInstance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'in_progress' | 'completed' | 'rejected'>('all');

  const [searchQuery, setSearchQuery] = useState('');

  // Cancel workflow state
  const [cancelRow, setCancelRow] = useState<StartedInstance | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(() => {
    workflowApi
      .startedByMe()
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  async function handleConfirmCancel() {
    if (!cancelRow) return;
    setCancelling(true);
    setError(null);
    try {
      await workflowApi.cancelWorkflow(cancelRow.documentId);
      setNotice(`Cancelled workflow for ${cancelRow.documentNumber} Rev ${cancelRow.versionNumber}. Document returned to draft.`);
      setCancelRow(null);
      load();
      onUpdated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCancelling(false);
    }
  }

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

  const inProgressCount = rows.filter((r) => r.status === 'in_progress').length;
  const completedCount = rows.filter((r) => r.status === 'completed').length;
  const rejectedCount = rows.filter((r) => r.status === 'rejected').length;

  const filteredRows = rows.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchDocNumber = r.documentNumber?.toLowerCase().includes(q);
      const matchDocName = r.documentName?.toLowerCase().includes(q);
      const matchReviewer = r.reviewers?.some(
        (rev) => rev.name?.toLowerCase().includes(q) || rev.role?.toLowerCase().includes(q)
      );
      if (!matchDocNumber && !matchDocName && !matchReviewer) return false;
    }
    return true;
  });

  return (
    <>
      {error && (
        <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
              statusFilter === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            )}
          >
            All ({rows.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('in_progress')}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1',
              statusFilter === 'in_progress'
                ? 'bg-blue-600 text-white'
                : 'bg-muted text-muted-foreground hover:text-blue-600'
            )}
          >
            <span>In Progress</span>
            {inProgressCount > 0 && (
              <span className="rounded-full bg-blue-500/20 px-1.5 py-0.2 text-[10px] font-bold">
                {inProgressCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('completed')}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1',
              statusFilter === 'completed'
                ? 'bg-emerald-600 text-white'
                : 'bg-muted text-muted-foreground hover:text-emerald-600'
            )}
          >
            <span>Approved</span>
            {completedCount > 0 && (
              <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.2 text-[10px] font-bold">
                {completedCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('rejected')}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1',
              statusFilter === 'rejected'
                ? 'bg-destructive text-destructive-foreground'
                : 'bg-muted text-muted-foreground hover:text-destructive'
            )}
          >
            <span>Rejected</span>
            {rejectedCount > 0 && (
              <span className="rounded-full bg-destructive/20 px-1.5 py-0.2 text-[10px] font-bold">
                {rejectedCount}
              </span>
            )}
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search document, reviewer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs w-full"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={Inbox}
            message={
              statusFilter === 'all'
                ? 'You have not started any approval workflows.'
                : `No approval workflows found with status "${statusFilter}".`
            }
          />
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-border/40 bg-card p-0 shadow-xs overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border/40 hover:bg-transparent">
                <TableHead className="min-w-[200px]">Document</TableHead>
                <TableHead>Revision</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Reviewers & Feedback</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((row) => (
                <TableRow key={row.id} className="border-border/30 hover:bg-muted/40 transition-colors">
                  <TableCell className="font-medium">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5">
                        <Link
                          to={`/documents/${row.documentId}`}
                          className="text-primary hover:underline font-semibold flex items-center gap-1"
                        >
                          {row.documentNumber}
                          <ArrowUpRight className="size-3 text-muted-foreground/60" />
                        </Link>
                        {row.reapproval && (
                          <StatusBadge status="reapproval">re-approval</StatusBadge>
                        )}
                      </div>
                      {row.documentName && (
                        <span className="text-xs text-muted-foreground line-clamp-1 max-w-xs">
                          {row.documentName}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-semibold text-xs">Rev {row.versionNumber}</TableCell>
                  <TableCell>
                    <StartedStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                    {new Date(row.startedAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.status === 'rejected' ? (
                      <div className="rounded bg-destructive/10 border border-destructive/20 p-2 text-destructive max-w-sm space-y-1">
                        <div className="font-semibold flex items-center gap-1">
                          <XCircle className="size-3.5 shrink-0" />
                          <span>Rejected by {row.feedbackActor || 'Reviewer'}</span>
                        </div>
                        {row.feedbackComment ? (
                          <p className="italic text-[11px] text-destructive/90 break-words">
                            "{row.feedbackComment}"
                          </p>
                        ) : (
                          <p className="text-[11px] opacity-70">No specific comment provided.</p>
                        )}
                      </div>
                    ) : (
                      <div className="text-muted-foreground">
                        {row.reviewers.length === 0 ? '—' : reviewerLine(row.reviewers)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-2 justify-end">
                      {row.status === 'in_progress' && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                          onClick={() => setCancelRow(row)}
                          title="Cancel this in-flight approval"
                        >
                          <Ban className="size-3.5 mr-1" />
                          Cancel
                        </Button>
                      )}
                      <Link
                        to={`/documents/${row.documentId}`}
                        className="inline-flex items-center justify-center rounded-md text-xs font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 px-3"
                      >
                        View
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Cancel Workflow Safeguard Dialog */}
      <AlertDialog open={Boolean(cancelRow)} onOpenChange={(open) => !open && setCancelRow(null)}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5 text-destructive shrink-0" />
              <span>Cancel Approval Workflow?</span>
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left text-sm space-y-2">
              <p>
                Are you sure you want to cancel the approval workflow for{' '}
                <strong>{cancelRow?.documentNumber} Rev {cancelRow?.versionNumber}</strong>?
              </p>
              <p className="text-muted-foreground text-xs">
                This will immediately terminate all pending reviewer tasks. The document revision will return to draft status so revisions can be made.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Keep Workflow</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={cancelling}
              onClick={handleConfirmCancel}
            >
              {cancelling ? 'Cancelling…' : 'Confirm Cancellation'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
    case 'cancelled':
      return <StatusBadge status="superseded">cancelled</StatusBadge>;
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

function DelegatedByMe({ onUpdated }: { onUpdated: () => void }) {
  const [tasks, setTasks] = useState<DelegatedTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Search and status filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed'>('all');

  // Recall confirmation modal state
  const [recallTask, setRecallTask] = useState<DelegatedTask | null>(null);
  const [recalling, setRecalling] = useState(false);

  const load = useCallback(() => {
    workflowApi
      .delegatedByMe()
      .then(setTasks)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  async function handleConfirmRecall() {
    if (!recallTask) return;
    setRecalling(true);
    setError(null);
    try {
      await workflowApi.recall(recallTask.taskId);
      setNotice(
        `Successfully recalled task for ${recallTask.documentNumber} Rev ${recallTask.versionNumber}. It is now back in your My Approvals queue.`
      );
      setRecallTask(null);
      load();
      onUpdated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRecalling(false);
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

  const pendingCount = tasks.filter((t) => t.status === 'pending').length;
  const completedCount = tasks.filter((t) => t.status !== 'pending').length;

  const filteredTasks = tasks.filter((task) => {
    if (statusFilter === 'pending' && task.status !== 'pending') return false;
    if (statusFilter === 'completed' && task.status === 'pending') return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchDocNumber = task.documentNumber?.toLowerCase().includes(q);
      const matchDocName = task.documentName?.toLowerCase().includes(q);
      const matchTo =
        task.delegatedToName?.toLowerCase().includes(q) ||
        task.delegatedToEmail?.toLowerCase().includes(q);
      const matchMsg = task.delegationMessage?.toLowerCase().includes(q);
      if (!matchDocNumber && !matchDocName && !matchTo && !matchMsg) return false;
    }
    return true;
  });

  return (
    <>
      {error && (
        <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
              statusFilter === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            )}
          >
            All ({tasks.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('pending')}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1',
              statusFilter === 'pending'
                ? 'bg-blue-600 text-white'
                : 'bg-muted text-muted-foreground hover:text-blue-600'
            )}
          >
            <span>Pending</span>
            {pendingCount > 0 && (
              <span className="rounded-full bg-blue-500/20 px-1.5 py-0.2 text-[10px] font-bold">
                {pendingCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('completed')}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1',
              statusFilter === 'completed'
                ? 'bg-emerald-600 text-white'
                : 'bg-muted text-muted-foreground hover:text-emerald-600'
            )}
          >
            <span>Completed</span>
            {completedCount > 0 && (
              <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.2 text-[10px] font-bold">
                {completedCount}
              </span>
            )}
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search document, colleague, notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs w-full"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {filteredTasks.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={UserCheck}
            message={
              tasks.length === 0
                ? 'You have not delegated any tasks.'
                : 'No delegated tasks match your current search and filter criteria.'
            }
          />
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-border/40 bg-card p-0 shadow-xs overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border/40 hover:bg-transparent">
                <TableHead className="min-w-[200px]">Document</TableHead>
                <TableHead>Revision</TableHead>
                <TableHead>Delegated To</TableHead>
                <TableHead>Instructions / Message</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Delegated At</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTasks.map((task) => (
                <TableRow key={task.taskId} className="border-border/30 hover:bg-muted/40 transition-colors">
                  <TableCell>
                    <div className="flex flex-col">
                      {task.documentId ? (
                        <Link
                          to={`/documents/${task.documentId}`}
                          className="font-medium text-primary hover:underline flex items-center gap-1"
                        >
                          {task.documentNumber}
                          <ArrowUpRight className="size-3 text-muted-foreground/60" />
                        </Link>
                      ) : (
                        <span className="font-medium">{task.documentNumber || '—'}</span>
                      )}
                      {task.documentName && (
                        <span className="text-xs text-muted-foreground line-clamp-1 max-w-xs">
                          {task.documentName}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-semibold text-xs">
                    Rev {task.versionNumber ?? 0}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col text-xs">
                      <span className="font-medium text-foreground">{task.delegatedToName}</span>
                      {task.delegatedToEmail && (
                        <span className="text-muted-foreground">{task.delegatedToEmail}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs max-w-xs">
                    {task.delegationMessage ? (
                      <span className="italic text-muted-foreground line-clamp-2" title={task.delegationMessage}>
                        "{task.delegationMessage}"
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {task.status === 'pending' ? (
                      <StatusBadge status="in_review">in review</StatusBadge>
                    ) : (
                      <StatusBadge status="released">completed</StatusBadge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                    {task.delegatedAt ? new Date(task.delegatedAt).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>
                    <DueDateBadge dueDate={task.dueDate} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-2 justify-end">
                      {task.canRecall && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 border-amber-500/30"
                          onClick={() => setRecallTask(task)}
                          title="Recall this delegated task back to your queue"
                        >
                          <RotateCcw className="size-3.5 mr-1" />
                          Recall
                        </Button>
                      )}
                      {task.documentId && (
                        <Link
                          to={`/documents/${task.documentId}`}
                          className="inline-flex items-center justify-center rounded-md text-xs font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 px-3"
                        >
                          View
                        </Link>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Recall Safeguard Dialog */}
      <AlertDialog open={Boolean(recallTask)} onOpenChange={(open) => !open && setRecallTask(null)}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-foreground">
              <RotateCcw className="size-5 text-amber-600 shrink-0" />
              <span>Recall Delegated Task?</span>
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left text-sm space-y-2">
              <p>
                Are you sure you want to recall the review task for{' '}
                <strong>{recallTask?.documentNumber} Rev {recallTask?.versionNumber}</strong>?
              </p>
              <p className="text-muted-foreground text-xs">
                The task will be removed from <strong>{recallTask?.delegatedToName}</strong>'s queue and reassigned back to your <em>My Approvals</em> list. They will receive a notification of this recall.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={recalling}>Keep Delegated</AlertDialogCancel>
            <Button
              type="button"
              disabled={recalling}
              onClick={handleConfirmRecall}
            >
              {recalling ? 'Recalling…' : 'Confirm Recall'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

