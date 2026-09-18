import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Ban,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  FileX,
  Layers,
  Lock,
  Maximize2,
  MessageSquare,
  Plus,
  RotateCcw,
  Star,
  Trash2,
  User,
  UserCheck,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react';
import { downloadFile } from '../api/client';
import DocumentPreviewModal, { DocumentPreviewViewer } from '../components/DocumentPreviewModal';
import { cn } from '../lib/utils';
import {
  documentApi,
  lookupApi,
  workflowApi,
  type AssigneeInput,
  type DocumentActivity,
  type WorkflowFeedback,
} from '../api/resources';
import type {
  DepartmentMember,
  DocumentDetail,
  DocumentVersion,
  ReviewerCandidate,
  StartedInstance,
  WorkflowTask,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import AcknowledgmentPanel from '../components/AcknowledgmentPanel';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge, type StatusBadgeKind } from '../components/StatusBadge';
import { Badge } from '../components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../components/ui/alert-dialog';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
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

interface ReviewerSlot {
  id: string;
  mode: 'user' | 'role';
  userId: string;
  roleName: string;
}

export default function DocumentDetailPage() {
  const { id, deptId: routeDeptId } = useParams();
  const documentId = Number(id);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();

  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);

  const state = location.state as {
    fromView?: string;
    fromDepartmentId?: number;
    fromDepartmentCode?: string;
  } | undefined;

  const deptId = routeDeptId || (state?.fromDepartmentId ? String(state.fromDepartmentId) : undefined);

  const fromView = state?.fromView;
  const backView = fromView === 'mine' || fromView === 'trash' || fromView === 'favorites' || fromView === 'archived' ? fromView : 'all';
  const backLink = deptId ? `/departments/${deptId}` : `/documents?view=${backView}`;
  const backLabel = deptId
    ? (doc ? `Back to ${doc.departmentCode}` : (state?.fromDepartmentCode ? `Back to ${state.fromDepartmentCode}` : 'Back to department'))
    : 'Back to documents';
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [uploadNotes, setUploadNotes] = useState('');

  const [candidates, setCandidates] = useState<ReviewerCandidate[] | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [activeWorkflow, setActiveWorkflow] = useState<StartedInstance | null>(null);
  const [feedback, setFeedback] = useState<WorkflowFeedback | null>(null);
  const [myDocumentTask, setMyDocumentTask] = useState<WorkflowTask | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewEffectiveDate, setReviewEffectiveDate] = useState('');
  const [completingReview, setCompletingReview] = useState(false);
  const [cancellingWorkflow, setCancellingWorkflow] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [discardVersion, setDiscardVersion] = useState<DocumentVersion | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [restoreVersion, setRestoreVersion] = useState<DocumentVersion | null>(null);
  const [restoreReason, setRestoreReason] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [retireReason, setRetireReason] = useState('');
  const [retiring, setRetiring] = useState(false);
  const [showRetireDialog, setShowRetireDialog] = useState(false);
  const [discardingDoc, setDiscardingDoc] = useState(false);
  const [showDiscardDocDialog, setShowDiscardDocDialog] = useState(false);
  const [reactivateReason, setReactivateReason] = useState('');
  const [reactivating, setReactivating] = useState(false);
  const [showReactivateDialog, setShowReactivateDialog] = useState(false);

  const [reviewers, setReviewers] = useState<ReviewerSlot[]>([
    { id: '1', mode: 'user', userId: '', roleName: '' },
  ]);
  const [deptMembers, setDeptMembers] = useState<DepartmentMember[]>([]);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>('');
  const [activities, setActivities] = useState<DocumentActivity[]>([]);
  const [previewTarget, setPreviewTarget] = useState<{
    documentId: number;
    versionId?: number;
    documentNumber: string;
    versionNumber?: number;
    title?: string;
  } | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const currentTab = rawTab || (myDocumentTask ? 'approval' : 'overview');

  const setTab = (tab: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', tab);
        return next;
      },
      { replace: true }
    );
  };

  const load = useCallback(() => {
    documentApi
      .get(documentId)
      .then((loaded) => {
        setDoc(loaded);
        setNewName(loaded.name);
        setSelectedOwnerId(String(loaded.ownerUserId));
        workflowApi
          .activeWorkflow(documentId)
          .then((wf) => {
            const current = wf ?? null;
            setActiveWorkflow(current);
            if (!current) {
              workflowApi
                .latestFeedback(documentId)
                .then(setFeedback)
                .catch(() => setFeedback(null));
            } else {
              setFeedback(null);
            }
          })
          .catch(() => {
            setActiveWorkflow(null);
            workflowApi
              .latestFeedback(documentId)
              .then(setFeedback)
              .catch(() => setFeedback(null));
          });
      })
      .catch((err: Error) => setError(err.message));

    workflowApi
      .myTasks()
      .then((tasks) => {
        const task = tasks.find((t) => t.documentId === documentId) ?? null;
        setMyDocumentTask(task);
      })
      .catch(() => setMyDocumentTask(null));

    documentApi
      .versions(documentId)
      .then(setVersions)
      .catch(() => undefined);

    documentApi
      .activity(documentId)
      .then(setActivities)
      .catch(() => setActivities([]));
  }, [documentId]);

  useEffect(load, [load]);

  const canModify =
    !!doc &&
    (isAdmin || !!user?.departments.some((department) => department.id === doc.departmentId && department.level !== 'CONSUMER'));

  const isManagerOfDept =
    !!doc &&
    !!user?.departments.some((department) => department.id === doc.departmentId && department.level === 'MANAGER');

  const canManage =
    !!doc &&
    (isAdmin || isManagerOfDept || (doc.status === 'draft' && doc.ownerUserId === user?.id));

  const canTransferOwner =
    !!doc &&
    (isAdmin || isManagerOfDept);

  useEffect(() => {
    if (canModify) {
      if (candidates === null) {
        workflowApi
          .reviewerCandidates(documentId)
          .then(setCandidates)
          .catch(() => setCandidates([]));
      }
      workflowApi
        .reviewerRoles(documentId)
        .then(setRoles)
        .catch(() => setRoles([]));
    }
  }, [canModify, candidates, documentId]);

  useEffect(() => {
    if (canTransferOwner && doc?.departmentId) {
      lookupApi
        .departmentMembers(doc.departmentId)
        .then((members) => {
          setDeptMembers(members.filter((m) => m.userActive && m.level !== 'CONSUMER'));
        })
        .catch(() => setDeptMembers([]));
    }
  }, [canTransferOwner, doc?.departmentId]);

  function run(action: () => Promise<unknown>, message: string) {
    setError(null);
    setNotice(null);
    action()
      .then(() => {
        setNotice(message);
        load();
      })
      .catch((err: Error) => setError(err.message));
  }

  function handleRename(event: FormEvent) {
    event.preventDefault();
    run(() => documentApi.update(documentId, { name: newName }), 'Name updated.');
  }

  function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get('file');
    if (!(file instanceof File) || file.size === 0) {
      setError('Choose a file to upload.');
      return;
    }
    run(
      () =>
        documentApi.uploadVersion(
          documentId,
          file,
          (data.get('changeNotes') as string) || null,
          (data.get('changeReference') as string) || null,
        ),
      'New version uploaded.',
    );
    setUploadNotes('');
  }

  function handleRestore() {
    run(() => documentApi.restore(documentId), 'Restored document.');
  }

  async function handleRetireDocument() {
    if (!doc) return;
    setRetiring(true);
    setError(null);
    try {
      await documentApi.markObsolete(documentId, retireReason.trim() || undefined);
      setNotice(`Document ${doc.documentNumber} retired and marked as obsolete.`);
      setShowRetireDialog(false);
      setRetireReason('');
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRetiring(false);
    }
  }

  async function handleReactivateDocument() {
    if (!doc) return;
    setReactivating(true);
    setError(null);
    try {
      await documentApi.reactivate(documentId, reactivateReason.trim() || undefined);
      setNotice(`Document ${doc.documentNumber} reactivated.`);
      setShowReactivateDialog(false);
      setReactivateReason('');
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReactivating(false);
    }
  }

  async function handleDiscardDraftDocument() {
    if (!doc) return;
    setDiscardingDoc(true);
    setError(null);
    try {
      await documentApi.discardDraftDocument(documentId);
      navigate(backLink);
    } catch (err) {
      setError((err as Error).message);
      setDiscardingDoc(false);
    }
  }

  async function handleToggleFavorite() {
    if (!doc) return;
    const nextVal = !doc.isFavorite;
    setDoc({ ...doc, isFavorite: nextVal });
    try {
      if (nextVal) {
        await documentApi.favorite(doc.id);
      } else {
        await documentApi.unfavorite(doc.id);
      }
    } catch {
      setDoc((prev) => (prev ? { ...prev, isFavorite: !nextVal } : prev));
    }
  }

  async function handleDiscardDraft() {
    if (!discardVersion) return;
    setDiscarding(true);
    setError(null);
    try {
      await documentApi.discardDraftVersion(documentId, discardVersion.id);
      setNotice(`Draft version ${discardVersion.versionNumber} discarded.`);
      setDiscardVersion(null);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDiscarding(false);
    }
  }

  async function handleRestoreVersion() {
    if (!restoreVersion) return;
    setRestoring(true);
    setError(null);
    try {
      await documentApi.restoreVersion(documentId, restoreVersion.id, restoreReason.trim() || undefined);
      setNotice(`Restored version ${restoreVersion.versionNumber} as new draft.`);
      setRestoreVersion(null);
      setRestoreReason('');
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRestoring(false);
    }
  }

  function addReviewerSlot() {
    setReviewers((prev) => [
      ...prev,
      { id: String(Date.now()), mode: 'user', userId: '', roleName: '' },
    ]);
  }

  function removeReviewerSlot(id: string) {
    if (reviewers.length > 1) {
      setReviewers((prev) => prev.filter((r) => r.id !== id));
    }
  }

  function updateReviewerSlot(id: string, patch: Partial<ReviewerSlot>) {
    setReviewers((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }

  function buildAssignees(): AssigneeInput[] {
    const list: AssigneeInput[] = [];
    for (const r of reviewers) {
      if (r.mode === 'user' && r.userId) {
        list.push({ type: 'USER', userId: Number(r.userId) });
      } else if (r.mode === 'role' && r.roleName.trim()) {
        list.push({ type: 'ROLE', roleName: r.roleName.trim() });
      }
    }
    return list;
  }

  const isAssigneesValid =
    reviewers.length > 0 &&
    reviewers.every((r) =>
      r.mode === 'user' ? Boolean(r.userId) : Boolean(r.roleName.trim()),
    );

  function handleStartApproval(event: FormEvent) {
    event.preventDefault();
    const draft = latestDraftVersion();
    if (!draft) {
      setError('No draft version to send for approval.');
      return;
    }
    if (!isAssigneesValid) {
      setError('Please select a valid reviewer or role for each assignee slot.');
      return;
    }
    run(
      () => workflowApi.startApproval(documentId, draft.id, buildAssignees()),
      `Approval started for v${draft.versionNumber} — reviewers will see it under My tasks.`,
    );
  }

  function handleStartReviewApproval() {
    if (!isAssigneesValid) {
      setError('Please select a valid reviewer or role for each assignee slot.');
      return;
    }
    run(
      () => workflowApi.startReviewApproval(documentId, buildAssignees()),
      'Periodic review re-approval started — reviewers will see it flagged under My tasks.',
    );
  }

  function handleCancelWorkflow() {
    setCancellingWorkflow(true);
    workflowApi
      .cancelWorkflow(documentId)
      .then(() => {
        setNotice('Approval workflow cancelled.');
        setShowCancelDialog(false);
        load();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setCancellingWorkflow(false));
  }

  function handleCompleteReview(approved: boolean) {
    if (!myDocumentTask) return;
    setCompletingReview(true);
    workflowApi
      .complete(
        myDocumentTask.id,
        approved,
        reviewComment.trim() || null,
        approved && reviewEffectiveDate ? reviewEffectiveDate : null,
      )
      .then(() => {
        setNotice(approved ? 'Document review approved.' : 'Document review rejected.');
        setReviewComment('');
        setReviewEffectiveDate('');
        load();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setCompletingReview(false));
  }

  function latestDraftVersion(): DocumentVersion | undefined {
    return versions
      .filter((version) => version.status === 'draft')
      .sort((a, b) => b.versionNumber - a.versionNumber)[0];
  }

  function formatActionName(action: string, entityType: string): string {
    if (entityType === 'document') {
      if (action === 'created') return 'Document Created';
      if (action === 'updated') return 'Document Updated';
      if (action === 'deleted') return 'Moved to Trash';
      if (action === 'restored') return 'Restored from Trash';
      if (action === 'status_changed') return 'Status Changed';
      if (action === 'review_clock_reset') return 'Periodic Review Completed';
    }
    if (entityType === 'document_version') {
      if (action === 'created') return 'New Version Uploaded';
      if (action === 'original_downloaded') return 'Original File Downloaded';
    }
    if (entityType === 'workflow_instance') {
      if (action === 'created') return 'Approval Workflow Started';
      if (action === 'cancelled') return 'Approval Cancelled';
      if (action === 'task_approved') return 'Review Approved';
      if (action === 'task_delegated') return 'Review Task Delegated';
      if (action === 'task_delegation_recalled') return 'Task Delegation Recalled';
      if (action === 'rejected') return 'Review Rejected';
      if (action === 'completed') return 'Workflow Completed';
    }
    return action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function renderActivityDetails(act: DocumentActivity) {
    if (!act.details || Object.keys(act.details).length === 0) return null;
    const d = act.details as Record<string, any>;
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {d.version_number && (
          <span className="rounded bg-muted px-2 py-0.5 font-medium text-foreground">
            v{d.version_number}
          </span>
        )}
        {d.from_name && d.to_name && (
          <span className="text-blue-700 dark:text-blue-300">
            Delegated from <strong className="text-foreground">{d.from_name}</strong> to <strong className="text-foreground">{d.to_name}</strong>
            {d.message && <span className="italic block mt-0.5">&ldquo;{d.message}&rdquo;</span>}
          </span>
        )}
        {d.recalled_by_name && (
          <span className="text-amber-700 dark:text-amber-400">
            Recalled by <strong className="text-foreground">{d.recalled_by_name}</strong>
            {d.recalled_from_name && <span> from {d.recalled_from_name}</span>}
          </span>
        )}
        {d.file_name && (
          <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">
            {d.file_name}
          </span>
        )}
        {d.comment && (
          <span className="italic text-foreground">
            &ldquo;{d.comment}&rdquo;
          </span>
        )}
        {d.reason && (
          <span className="italic text-foreground">
            Reason: {d.reason}
          </span>
        )}
        {d.after?.name && d.before?.name && (
          <span>
            Renamed from &ldquo;{d.before.name}&rdquo; to &ldquo;{d.after.name}&rdquo;
          </span>
        )}
        {d.after?.status && (
          <span>
            Status &rarr; <strong className="text-foreground">{d.after.status}</strong>
          </span>
        )}
        {d.next_review_due && (
          <span>
            Next review due: {d.next_review_due}
          </span>
        )}
      </div>
    );
  }

  if (error && !doc) {
    return (
      <>
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        <Link
          to={backLink}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {backLabel}
        </Link>
      </>
    );
  }
  if (!doc) {
    return <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  const draft = latestDraftVersion();

  return (
    <>
      <div>
        <Link
          to={backLink}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {backLabel}
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{doc.documentNumber}</h1>
          <StatusBadge status={doc.status as StatusBadgeKind}>{doc.status}</StatusBadge>
          {doc.tierNumber && (
            <Badge variant="outline" className="font-semibold text-xs" title={doc.tierLabel ?? undefined}>
              Tier {doc.tierNumber}{doc.tierLabel ? `: ${doc.tierLabel}` : ''}
            </Badge>
          )}
          {activeWorkflow ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300 border border-amber-500/30">
              <Lock className="size-3" />
              Locked (Approval in progress)
            </span>
          ) : draft ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-500/15 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:text-slate-300 border border-slate-500/30">
              <Lock className="size-3" />
              Locked (Draft v{draft.versionNumber} in progress)
            </span>
          ) : null}
          {doc.deletedAt && <StatusBadge status="superseded">trashed</StatusBadge>}
          {!doc.deletedAt && (
            <button
              type="button"
              onClick={handleToggleFavorite}
              className="p-1 rounded hover:bg-muted transition-colors"
              title={doc.isFavorite ? 'Remove from favorites' : 'Mark as favorite'}
            >
              <Star
                className={cn(
                  'size-5 transition-colors',
                  doc.isFavorite
                    ? 'fill-amber-400 text-amber-400'
                    : 'text-muted-foreground/40 hover:text-amber-400'
                )}
              />
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}
      {notice && (
        <div className="mt-4 rounded-md bg-success/10 px-3 py-2 text-sm text-success">{notice}</div>
      )}
      {/* Navigation Tabs */}
      <div className="mt-4 border-b border-border">
        <div className="flex gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setTab('overview')}
            className={cn(
              'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap',
              currentTab === 'overview'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            )}
          >
            <FileText className="size-4" />
            Overview
          </button>
          <button
            type="button"
            onClick={() => setTab('versions')}
            className={cn(
              'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap',
              currentTab === 'versions'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            )}
          >
            <Layers className="size-4" />
            Versions ({versions.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('approval')}
            className={cn(
              'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap',
              currentTab === 'approval'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            )}
          >
            <CheckCircle2 className="size-4" />
            Approval
            {myDocumentTask && (
              <span className="ml-1 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">
                Action
              </span>
            )}
            {activeWorkflow && !myDocumentTask && (
              <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setTab('acknowledgments')}
            className={cn(
              'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap',
              currentTab === 'acknowledgments'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            )}
          >
            <UserCheck className="size-4" />
            Acknowledgments
          </button>
          <button
            type="button"
            onClick={() => setTab('activity')}
            className={cn(
              'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap',
              currentTab === 'activity'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            )}
          >
            <Activity className="size-4" />
            Activity ({activities.length})
          </button>
        </div>
      </div>

      {/* Tab 1: Overview */}
      {currentTab === 'overview' && (
        <div className="flex flex-col gap-4">
          {doc.deletedAt && (
            <div className="mt-4 rounded-md bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 flex flex-wrap items-center justify-between gap-2">
              <span>This document is currently in the trash. Restore it to upload new versions or start approvals.</span>
              {canManage && (
                <Button type="button" variant="outline" size="sm" onClick={handleRestore}>
                  Restore from trash
                </Button>
              )}
            </div>
          )}

          {doc.status === 'obsolete' && !doc.deletedAt && (
            <div className="mt-4 rounded-md bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0" />
                <span>This document has been retired and marked as obsolete. It is preserved for audit and historical reference only.</span>
              </div>
              {canManage && (
                <Button type="button" variant="outline" size="sm" onClick={() => setShowReactivateDialog(true)}>
                  Reactivate document
                </Button>
              )}
            </div>
          )}

          <Card className="mt-4">
            <CardContent className="py-4">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
                <div className="py-1">
                  <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Name</dt>
                  <dd className="mt-0.5 text-sm font-medium">{doc.name}</dd>
                </div>
                <div className="py-1">
                  <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Tier</dt>
                  <dd className="mt-0.5 text-sm flex items-center gap-2">
                    {doc.tierNumber ? (
                      <>
                        <Badge variant="outline" className="font-semibold text-xs">
                          Tier {doc.tierNumber}
                        </Badge>
                        <span className="text-muted-foreground">{doc.tierLabel}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
                <div className="py-1">
                  <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Type</dt>
                  <dd className="mt-0.5 text-sm">{doc.documentTypeCode}</dd>
                </div>
                <div className="py-1">
                  <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Department</dt>
                  <dd className="mt-0.5 text-sm">{doc.departmentCode}</dd>
                </div>
                <div className="py-1">
                  <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Owner</dt>
                  <dd className="mt-0.5 text-sm">{doc.ownerName}</dd>
                </div>
                <div className="py-1">
                  <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Current version</dt>
                  <dd className="mt-0.5 text-sm">
                    {doc.currentVersionId
                      ? versions.find((v) => v.id === doc.currentVersionId)?.versionNumber ?? doc.currentVersionId
                      : '—'}
                  </dd>
                </div>
                {doc.status === 'approved' && doc.pendingEffectiveDate && (
                  <div className="py-1">
                    <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Pending effective</dt>
                    <dd className="mt-0.5 flex items-center gap-2 text-sm">
                      <StatusBadge status="approved">approved</StatusBadge> takes effect {doc.pendingEffectiveDate}
                    </dd>
                  </div>
                )}
                {doc.lastReviewedAt && (
                  <div className="py-1">
                    <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Last reviewed</dt>
                    <dd className="mt-0.5 text-sm">{doc.lastReviewedAt}</dd>
                  </div>
                )}
                {doc.nextReviewDue && (
                  <div className="py-1">
                    <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Next review due</dt>
                    <dd className="mt-0.5 flex items-center gap-2 text-sm">
                      {doc.nextReviewDue}{' '}
                      {doc.reviewOverdue && <StatusBadge status="overdue">review overdue</StatusBadge>}
                    </dd>
                  </div>
                )}
                <div className="py-1">
                  <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Created</dt>
                  <dd className="mt-0.5 text-sm">{new Date(doc.createdAt).toLocaleString()}</dd>
                </div>
                <div className="py-1">
                  <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Updated</dt>
                  <dd className="mt-0.5 text-sm">{new Date(doc.updatedAt).toLocaleString()}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Quick Interactive Document Preview */}
          {doc.currentVersionId ? (
            <div className="mt-2">
              <DocumentPreviewViewer
                documentId={doc.id}
                versionId={doc.currentVersionId}
                documentNumber={doc.documentNumber}
                versionNumber={versions.find((v) => v.id === doc.currentVersionId)?.versionNumber}
                title={doc.name}
                height="560px"
              />
            </div>
          ) : draft ? (
            <div className="mt-2">
              <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
                  <FileText className="size-3.5" />
                  Showing unreleased draft v{draft.versionNumber}
                </span>
              </div>
              <DocumentPreviewViewer
                documentId={doc.id}
                versionId={draft.id}
                documentNumber={doc.documentNumber}
                versionNumber={draft.versionNumber}
                title={`${doc.name} (Draft)`}
                height="560px"
              />
            </div>
          ) : (
            <Card className="p-6 text-center text-sm text-muted-foreground border-dashed">
              No versions uploaded yet to preview.
            </Card>
          )}

          {/* Mutation controls only rendered for editors */}
          {canModify && !doc.deletedAt && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">Metadata & Actions</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {Boolean(activeWorkflow) && (
                  <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                    <Lock className="size-4 shrink-0" />
                    <span>Metadata and ownership changes are locked while an approval workflow is in progress.</span>
                  </div>
                )}

                <form className="flex flex-wrap items-end gap-3" onSubmit={handleRename}>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="rename-name">Name</Label>
                    <Input
                      id="rename-name"
                      value={newName}
                      maxLength={255}
                      onChange={(e) => setNewName(e.target.value)}
                      disabled={Boolean(activeWorkflow)}
                      className="w-72"
                    />
                  </div>
                  <Button type="submit" disabled={Boolean(activeWorkflow)}>Save name</Button>
                  {canManage && doc.status === 'released' && (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => setShowRetireDialog(true)}
                    >
                      Retire document
                    </Button>
                  )}
                  {canManage && doc.status === 'draft' && !versions.some((v) => v.status === 'current' || v.status === 'superseded') && (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => setShowDiscardDocDialog(true)}
                    >
                      Discard draft document
                    </Button>
                  )}
                  {canManage && doc.status === 'obsolete' && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowReactivateDialog(true)}
                    >
                      Reactivate document
                    </Button>
                  )}
                </form>

                {canTransferOwner && deptMembers.length > 0 && (
                  <div className="flex flex-wrap items-end gap-3 pt-3 border-t">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="transfer-owner">Transfer ownership</Label>
                      <Select
                        value={selectedOwnerId}
                        onValueChange={(val) => setSelectedOwnerId(val)}
                        disabled={Boolean(activeWorkflow)}
                      >
                        <SelectTrigger id="transfer-owner" className="w-64">
                          <SelectValue placeholder="Select new owner…" />
                        </SelectTrigger>
                        <SelectContent>
                          {deptMembers.map((m) => (
                            <SelectItem key={m.userId} value={String(m.userId)}>
                              {m.name} ({m.level})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={Boolean(activeWorkflow) || !selectedOwnerId || Number(selectedOwnerId) === doc.ownerUserId}
                      onClick={() =>
                        run(
                          () => documentApi.update(documentId, { ownerUserId: Number(selectedOwnerId) }),
                          'Document owner updated.',
                        )
                      }
                    >
                      Transfer owner
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Tab 2: Versions */}
      {currentTab === 'versions' && (
        <div className="mt-4 flex flex-col gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Version History</CardTitle>
            </CardHeader>
            <CardContent>
              {versions.length === 0 ? (
                <EmptyState icon={FileX} message="No versions uploaded yet." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>File</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Effective</TableHead>
                      <TableHead>Change notes</TableHead>
                      <TableHead>Change reference</TableHead>
                      <TableHead>Uploaded by</TableHead>
                      <TableHead>At</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {versions.map((version) => (
                      <TableRow key={version.id}>
                        <TableCell>{version.versionNumber}</TableCell>
                        <TableCell>{version.fileName}</TableCell>
                        <TableCell>
                          <StatusBadge status={version.status as StatusBadgeKind}>{version.status}</StatusBadge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{version.effectiveAt ?? '—'}</TableCell>
                        <TableCell>{version.changeNotes ?? '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{version.changeReference ?? '—'}</TableCell>
                        <TableCell>{version.uploadedByName}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {new Date(version.uploadedAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="gap-1 text-xs"
                              onClick={() =>
                                setPreviewTarget({
                                  documentId: doc.id,
                                  versionId: version.id,
                                  documentNumber: doc.documentNumber,
                                  versionNumber: version.versionNumber,
                                  title: doc.name,
                                })
                              }
                            >
                              <Eye className="size-3.5" />
                              Preview
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                downloadFile(`/documents/${doc.id}/versions/${version.id}/download`)
                              }
                            >
                              Download
                            </Button>
                            {canModify && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                title="Download original untouched file (audited)"
                                onClick={() =>
                                  downloadFile(`/documents/${doc.id}/versions/${version.id}/download?original=true`)
                                }
                              >
                                Original
                              </Button>
                            )}
                            {canModify && !doc.deletedAt && version.status === 'draft' && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:bg-destructive/10"
                                title="Discard this unapproved draft version"
                                onClick={() => setDiscardVersion(version)}
                              >
                                Discard
                              </Button>
                            )}
                            {canModify && !doc.deletedAt && version.status !== 'draft' && version.id !== doc.currentVersionId && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={Boolean(draft) || Boolean(activeWorkflow)}
                                className="gap-1 text-muted-foreground hover:text-foreground"
                                title={
                                  draft
                                    ? 'Cannot restore while another draft is in progress. Discard or release current draft first.'
                                    : activeWorkflow
                                    ? 'Cannot restore while an approval workflow is active.'
                                    : `Restore version ${version.versionNumber} as a new draft`
                                }
                                onClick={() => {
                                  setRestoreVersion(version);
                                  setRestoreReason(`Reverting to version ${version.versionNumber}`);
                                }}
                              >
                                <RotateCcw className="size-3.5" />
                                Restore
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {canModify && !doc.deletedAt && doc.status !== 'obsolete' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">Upload new version</CardTitle>
              </CardHeader>
              <CardContent>
                {draft ? (
                  <div className="flex items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                    <Lock className="size-5 shrink-0" />
                    <span>
                      Document is locked: Draft v{draft.versionNumber} is already in progress (uploaded by {draft.uploadedByName}). Complete approval or discard the existing draft before uploading another revision.
                    </span>
                  </div>
                ) : Boolean(activeWorkflow) ? (
                  <div className="flex items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                    <AlertCircle className="size-5 shrink-0" />
                    <span>
                      Uploads are paused while an approval is in progress. Complete or cancel the active review before uploading a new version.
                    </span>
                  </div>
                ) : (
                  <form className="flex flex-wrap items-end gap-3" onSubmit={handleUpload}>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="upload-file" className="cursor-pointer">File</Label>
                      <Input
                        id="upload-file"
                        name="file"
                        type="file"
                        required
                        className="cursor-pointer file:cursor-pointer"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="upload-notes">Change notes</Label>
                      <Input
                        id="upload-notes"
                        name="changeNotes"
                        value={uploadNotes}
                        placeholder="What changed?"
                        onChange={(e) => setUploadNotes(e.target.value)}
                        className="w-64"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="upload-reference">Change reference</Label>
                      <Input
                        id="upload-reference"
                        name="changeReference"
                        placeholder="Change request / CAPA reference (optional)"
                        className="w-64"
                      />
                    </div>
                    <Button type="submit">Upload</Button>
                  </form>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Tab 3: Approval */}
      {currentTab === 'approval' && (
        <div className="mt-4 flex flex-col gap-4">
          {feedback && !activeWorkflow && !doc.deletedAt && (
            <div
              className={`rounded-md border p-4 text-sm flex items-start gap-3 ${
                feedback.action === 'rejected'
                  ? 'border-destructive/30 bg-destructive/5 text-destructive'
                  : 'border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-300'
              }`}
            >
              {feedback.action === 'rejected' ? (
                <XCircle className="size-5 shrink-0 mt-0.5" />
              ) : (
                <Ban className="size-5 shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <div className="font-semibold">
                  Previous approval was {feedback.action}
                  {feedback.actorName && ` by ${feedback.actorName}`}
                  {feedback.timestamp && ` on ${new Date(feedback.timestamp).toLocaleString()}`}
                </div>
                {feedback.comment ? (
                  <div className="mt-1 text-sm opacity-90">
                    <span className="font-medium">Feedback / Reason:</span> {feedback.comment}
                  </div>
                ) : (
                  <div className="mt-1 text-xs opacity-75">
                    No feedback comment was provided.
                  </div>
                )}
              </div>
            </div>
          )}

          {myDocumentTask && !doc.deletedAt && (
            <Card className="border-primary/40 bg-primary/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center justify-between">
                  <span className="flex items-center gap-2 text-foreground">
                    <CheckCircle2 className="size-5 text-primary" />
                    Review Requested: You are assigned to review this document
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">
                    Task ID: {myDocumentTask.id}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  As an assigned reviewer, you can review the document preview below, then submit your approval or rejection with audit feedback.
                </p>

                {(() => {
                  const targetV = versions.find(
                    (v) => (myDocumentTask.versionId ? v.id === myDocumentTask.versionId : false) ||
                           (activeWorkflow ? v.versionNumber === activeWorkflow.versionNumber : false) ||
                           (draft ? v.id === draft.id : false)
                  ) ?? versions.find((v) => v.id === doc.currentVersionId);
                  if (!targetV) return null;
                  return (
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <Eye className="size-3.5 text-primary" />
                          Document Preview (v{targetV.versionNumber})
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() =>
                            setPreviewTarget({
                              documentId: doc.id,
                              versionId: targetV.id,
                              documentNumber: doc.documentNumber,
                              versionNumber: targetV.versionNumber,
                              title: doc.name,
                            })
                          }
                        >
                          <Maximize2 className="size-3" />
                          Fullscreen
                        </Button>
                      </div>
                      <DocumentPreviewViewer
                        documentId={doc.id}
                        versionId={targetV.id}
                        documentNumber={doc.documentNumber}
                        versionNumber={targetV.versionNumber}
                        title={doc.name}
                        height="450px"
                      />
                    </div>
                  );
                })()}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="inline-review-comment">Review comment / feedback</Label>
                    <Input
                      id="inline-review-comment"
                      placeholder="Feedback, conditions, or reason for rejection (optional for approval)..."
                      value={reviewComment}
                      onChange={(e) => setReviewComment(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="inline-effective-date">Effective date (optional)</Label>
                    <Input
                      id="inline-effective-date"
                      type="date"
                      value={reviewEffectiveDate}
                      onChange={(e) => setReviewEffectiveDate(e.target.value)}
                    />
                    <span className="text-xs text-muted-foreground">
                      Leave blank for immediate release upon approval.
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <Button
                    type="button"
                    disabled={completingReview}
                    onClick={() => handleCompleteReview(true)}
                    className="gap-1.5"
                  >
                    <CheckCircle2 className="size-4" />
                    Approve
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={completingReview}
                    onClick={() => handleCompleteReview(false)}
                    className="gap-1.5"
                  >
                    <XCircle className="size-4" />
                    Reject
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Approval in progress card */}
          {(doc.status === 'in_review' || Boolean(activeWorkflow)) && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
                    <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
                    Approval in Progress
                    {activeWorkflow && (
                      <span className="text-xs font-normal text-muted-foreground ml-1">
                        for {activeWorkflow.reapproval ? 'periodic review re-approval' : `v${activeWorkflow.versionNumber}`}
                      </span>
                    )}
                  </CardTitle>
                  {activeWorkflow?.startedAt && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Started on {new Date(activeWorkflow.startedAt).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {activeWorkflow && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={() => {
                        const v = versions.find((ver) => ver.versionNumber === activeWorkflow.versionNumber) ??
                                  versions.find((ver) => ver.id === doc.currentVersionId) ??
                                  draft;
                        if (v) {
                          setPreviewTarget({
                            documentId: doc.id,
                            versionId: v.id,
                            documentNumber: doc.documentNumber,
                            versionNumber: v.versionNumber,
                            title: doc.name,
                          });
                        }
                      }}
                    >
                      <Eye className="size-3.5" />
                      Preview {activeWorkflow.reapproval ? 'Document' : `Draft v${activeWorkflow.versionNumber}`}
                    </Button>
                  )}
                  {canModify && activeWorkflow && (
                    <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10"
                        >
                          <Ban className="size-3.5 mr-1" />
                          Cancel approval
                        </Button>
                      </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Cancel approval workflow?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will abort the active review process and notify any assigned reviewers.
                          The document draft will remain intact so you can make modifications and resubmit when ready.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep in review</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          disabled={cancellingWorkflow}
                          onClick={handleCancelWorkflow}
                        >
                          {cancellingWorkflow ? 'Cancelling…' : 'Cancel approval'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {activeWorkflow && activeWorkflow.reviewers.length > 0 ? (
                  <>
                    {/* Progress Summary Bar */}
                    <div className="flex items-center justify-between text-xs border-b border-border/60 pb-2">
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        <span>Reviewers Progress:</span>
                        <span className="text-muted-foreground">
                          {activeWorkflow.reviewers.filter((r) => r.state === 'approved').length} of{' '}
                          {activeWorkflow.reviewers.length} approved
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {activeWorkflow.reviewers.map((rev, idx) => (
                          <div
                            key={idx}
                            className={cn(
                              'size-2.5 rounded-full',
                              rev.state === 'approved'
                                ? 'bg-emerald-500'
                                : rev.delegated
                                  ? 'bg-blue-500'
                                  : 'bg-amber-400'
                            )}
                            title={`${rev.name || rev.role}: ${rev.state}${rev.delegated ? ' (delegated)' : ''}`}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Detailed Reviewers List */}
                    <div className="flex flex-col gap-3">
                      {activeWorkflow.reviewers.map((rev, idx) => {
                        const isApproved = rev.state === 'approved';
                        const isDelegated = Boolean(rev.delegated);

                        return (
                          <div
                            key={idx}
                            className={cn(
                              'rounded-lg border bg-card p-3.5 shadow-sm transition-colors flex flex-col gap-2.5',
                              isApproved
                                ? 'border-emerald-500/30 bg-emerald-500/[0.03]'
                                : isDelegated
                                  ? 'border-blue-500/30 bg-blue-500/[0.03]'
                                  : 'border-border'
                            )}
                          >
                            {/* Reviewer Header Row */}
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2.5">
                                <div
                                  className={cn(
                                    'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                                    isApproved
                                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                      : isDelegated
                                        ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                                        : 'bg-muted text-foreground'
                                  )}
                                >
                                  {isApproved ? (
                                    <CheckCircle2 className="size-4" />
                                  ) : isDelegated ? (
                                    <UserPlus className="size-4" />
                                  ) : rev.role ? (
                                    <Users className="size-4" />
                                  ) : (
                                    <User className="size-4" />
                                  )}
                                </div>
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-sm text-foreground">
                                      {rev.name ?? (rev.role ? `Pooled Role: ${rev.role}` : 'Reviewer')}
                                    </span>
                                    {rev.role && rev.name && (
                                      <span className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                                        {rev.role}
                                      </span>
                                    )}
                                  </div>
                                  {rev.email && (
                                    <span className="text-xs text-muted-foreground">
                                      {rev.email}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                {isApproved ? (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 px-2 py-0.5 text-xs font-semibold">
                                    <CheckCircle2 className="size-3.5" /> Approved
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 px-2 py-0.5 text-xs font-semibold">
                                    <Clock className="size-3.5" /> Pending Review
                                  </span>
                                )}
                                {isDelegated && (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30 px-2 py-0.5 text-xs font-semibold">
                                    <UserPlus className="size-3.5" /> Delegated
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Timing and Dates Row */}
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1 border-t border-border/40">
                              {isApproved && rev.actionAt && (
                                <div className="flex items-center gap-1">
                                  <Calendar className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                                  <span>
                                    Approved on <strong className="text-foreground">{new Date(rev.actionAt).toLocaleString()}</strong>
                                  </span>
                                </div>
                              )}
                              {!isApproved && rev.actionAt && (
                                <div className="flex items-center gap-1">
                                  <Calendar className="size-3.5 text-muted-foreground" />
                                  <span>
                                    Assigned on <strong className="text-foreground">{new Date(rev.actionAt).toLocaleString()}</strong>
                                  </span>
                                </div>
                              )}
                              {rev.dueDate && (
                                <div className="flex items-center gap-1">
                                  <Clock className="size-3.5 text-muted-foreground" />
                                  <span>
                                    Due by: <strong className="text-foreground">{new Date(rev.dueDate).toLocaleDateString()}</strong>
                                  </span>
                                </div>
                              )}
                              {rev.effectiveDate && (
                                <div className="flex items-center gap-1 text-purple-700 dark:text-purple-300">
                                  <span>
                                    Scheduled effective: <strong className="text-foreground">{rev.effectiveDate}</strong>
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Approval Comment Box */}
                            {rev.comment && (
                              <div className="rounded-md bg-muted/60 p-2.5 text-xs border border-border/60">
                                <div className="flex items-center gap-1 font-semibold text-foreground mb-1">
                                  <MessageSquare className="size-3 text-muted-foreground" />
                                  <span>Reviewer Comment:</span>
                                </div>
                                <p className="italic text-foreground/90 pl-4 border-l-2 border-primary/50">
                                  &ldquo;{rev.comment}&rdquo;
                                </p>
                              </div>
                            )}

                            {/* Delegation Callout Container */}
                            {isDelegated && (
                              <div className="rounded-md bg-blue-500/10 border border-blue-500/25 p-2.5 text-xs flex flex-col gap-1.5">
                                <div className="flex items-center gap-1.5 font-semibold text-blue-700 dark:text-blue-300">
                                  <UserPlus className="size-3.5 shrink-0" />
                                  <span>
                                    Delegated by {rev.delegatedByName || 'Original Reviewer'}
                                    {rev.delegatedByEmail && ` (${rev.delegatedByEmail})`}
                                    {rev.delegatedAt && ` on ${new Date(rev.delegatedAt).toLocaleString()}`}
                                  </span>
                                </div>
                                {rev.delegationMessage && (
                                  <div className="text-foreground/85 pl-4 border-l-2 border-blue-400 dark:border-blue-500">
                                    <span className="font-medium text-foreground block text-[11px]">Instructions to Colleague:</span>
                                    <p className="italic">&ldquo;{rev.delegationMessage}&rdquo;</p>
                                  </div>
                                )}
                                <p className="text-[11px] text-muted-foreground">
                                  Task is currently assigned to{' '}
                                  <strong className="text-foreground">{rev.delegatedToName || rev.name}</strong>
                                  {rev.delegatedToEmail && ` (${rev.delegatedToEmail})`} for action.
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Workflow Audit Trail for This Run */}
                    {activities.filter((a) => a.entityType === 'workflow_instance' && a.entityId === activeWorkflow.id).length > 0 && (
                      <div className="mt-4 pt-3 border-t border-border/60">
                        <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium block mb-2">
                          Approval Workflow Timeline
                        </span>
                        <div className="relative pl-5 before:absolute before:left-2 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-border/60 space-y-2.5 text-xs">
                          {activities
                            .filter((a) => a.entityType === 'workflow_instance' && a.entityId === activeWorkflow.id)
                            .map((act) => (
                              <div key={act.id} className="relative">
                                <div className="absolute -left-5 top-1 size-2 rounded-full bg-primary" />
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <strong className="text-foreground">{formatActionName(act.action, act.entityType)}</strong>
                                  <span className="text-muted-foreground">by {act.actorName}</span>
                                  <span className="text-muted-foreground text-[11px]">• {new Date(act.performedAt).toLocaleString()}</span>
                                </div>
                                {renderActivityDetails(act)}
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    This document is currently pending approval review. Reviewers will find it in their tasks list.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Approval Configuration Section */}
          {canModify && !doc.deletedAt && !activeWorkflow && (draft || doc.status === 'draft' || doc.status === 'released') && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base font-semibold">
                  {draft
                    ? `Approval for v${draft.versionNumber}`
                    : doc.status === 'released'
                    ? 'Periodic Review Re-approval'
                    : 'Approval'}
                </CardTitle>
                {draft && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs font-normal gap-1.5"
                    onClick={() =>
                      setPreviewTarget({
                        documentId: doc.id,
                        versionId: draft.id,
                        documentNumber: doc.documentNumber,
                        versionNumber: draft.versionNumber,
                        title: doc.name,
                      })
                    }
                  >
                    <Eye className="size-3.5" />
                    Preview Draft v{draft.versionNumber}
                  </Button>
                )}
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {!draft && doc.status === 'draft' ? (
                  <p className="text-sm text-muted-foreground">
                    Upload an initial file version in the Versions tab before starting an approval workflow.
                  </p>
                ) : (
                  <form
                    className="flex flex-col gap-4"
                    onSubmit={draft ? handleStartApproval : (e) => { e.preventDefault(); handleStartReviewApproval(); }}
                  >
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium">Reviewers & Approval Chain</span>
                      <span className="text-xs text-muted-foreground">
                        Assign one or more individuals or roles. All assigned reviewers must approve before the version is released.
                      </span>
                    </div>

                    <div className="flex flex-col gap-3">
                      {reviewers.map((slot, index) => (
                        <div
                          key={slot.id}
                          className="flex flex-wrap items-end gap-3 p-3.5 rounded-lg border border-border/40 bg-slate-50/50 dark:bg-muted/10 shadow-sm"
                        >
                          <div className="flex flex-col gap-1.5">
                            <Label className="text-xs text-muted-foreground">Slot {index + 1} Type</Label>
                            <Select
                              value={slot.mode}
                              onValueChange={(val) =>
                                updateReviewerSlot(slot.id, {
                                  mode: val as 'user' | 'role',
                                  userId: '',
                                  roleName: '',
                                })
                              }
                            >
                              <SelectTrigger className="w-36">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="user">By user</SelectItem>
                                <SelectItem value="role">By role</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {slot.mode === 'user' ? (
                            <div className="flex flex-col gap-1.5">
                              <Label className="text-xs text-muted-foreground">Reviewer User</Label>
                              <Select
                                value={slot.userId}
                                onValueChange={(val) => updateReviewerSlot(slot.id, { userId: val })}
                              >
                                <SelectTrigger className="w-64">
                                  <SelectValue placeholder="Select user…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {candidates && candidates.length > 0 ? (
                                    candidates.map((c) => (
                                      <SelectItem key={c.id} value={String(c.id)}>
                                        {c.name} ({c.email})
                                      </SelectItem>
                                    ))
                                  ) : (
                                    <SelectItem value="__none__" disabled>
                                      No eligible candidates
                                    </SelectItem>
                                  )}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1.5">
                              <Label className="text-xs text-muted-foreground">Reviewer Role</Label>
                              {roles.length > 0 ? (
                                <Select
                                  value={slot.roleName}
                                  onValueChange={(val) => updateReviewerSlot(slot.id, { roleName: val })}
                                >
                                  <SelectTrigger className="w-64">
                                    <SelectValue placeholder="Select role…" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {roles.map((r) => (
                                      <SelectItem key={r} value={r}>
                                        {r}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Input
                                  value={slot.roleName}
                                  placeholder="e.g. QA_LEAD, REVIEWER"
                                  onChange={(e) => updateReviewerSlot(slot.id, { roleName: e.target.value })}
                                  className="w-64"
                                />
                              )}
                            </div>
                          )}

                          {reviewers.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeReviewerSlot(slot.id)}
                              className="text-destructive hover:bg-destructive/10"
                              title="Remove reviewer slot"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addReviewerSlot}
                        className="gap-1.5"
                      >
                        <Plus className="size-4" />
                        Add another reviewer
                      </Button>

                      <div>
                        {draft ? (
                          <Button type="submit" disabled={!isAssigneesValid}>
                            Send v{draft.versionNumber} for approval
                          </Button>
                        ) : (
                          <div className="flex items-center gap-3">
                            <Button type="submit" disabled={!isAssigneesValid}>
                              Start periodic review re-approval
                            </Button>
                            <span className="text-xs text-muted-foreground">
                              Re-approves released version; review clock resets.
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>
          )}

          {!draft && doc.status === 'released' && !activeWorkflow && !myDocumentTask && (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                This document is currently released and in effect. Review due on {doc.nextReviewDue ?? 'schedule'}.
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Tab 4: Acknowledgments */}
      {currentTab === 'acknowledgments' && (
        <div className="mt-4">
          {doc && !doc.deletedAt && (
            <AcknowledgmentPanel
              documentId={doc.id}
              documentStatus={doc.status}
              canManage={isAdmin || doc.ownerUserId === user?.id}
            />
          )}
        </div>
      )}

      {/* Tab 5: Activity */}
      {currentTab === 'activity' && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="size-4 text-primary" />
              Document Activity & Audit Trail
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activities.length > 0 ? (
              <div className="relative pl-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-border space-y-6">
                {activities.map((act) => (
                  <div key={act.id} className="relative group">
                    <div className="absolute -left-6 top-1 flex size-5 items-center justify-center rounded-full bg-background border-2 border-primary">
                      <span className="size-1.5 rounded-full bg-primary" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {formatActionName(act.action, act.entityType)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          by <strong className="text-foreground">{act.actorName}</strong>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          • {new Date(act.performedAt).toLocaleString()}
                        </span>
                      </div>
                      {renderActivityDetails(act)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No activity records found for this document yet.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Discard Draft Dialog */}
      <AlertDialog
        open={Boolean(discardVersion)}
        onOpenChange={(open) => {
          if (!open) setDiscardVersion(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard Draft Version {discardVersion?.versionNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to discard draft version {discardVersion?.versionNumber} ({discardVersion?.fileName})?
              This action cannot be undone and will permanently remove this unapproved version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={discarding}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={discarding}
              onClick={handleDiscardDraft}
            >
              {discarding ? 'Discarding…' : 'Discard draft'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restore Version Dialog */}
      <AlertDialog
        open={Boolean(restoreVersion)}
        onOpenChange={(open) => {
          if (!open) {
            setRestoreVersion(null);
            setRestoreReason('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore Version {restoreVersion?.versionNumber} as Draft</AlertDialogTitle>
            <AlertDialogDescription>
              This will copy the file from version {restoreVersion?.versionNumber} ({restoreVersion?.fileName}) into a new draft version.
              You can then make further changes or submit it for review.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Label htmlFor="restore-reason">Reason for reversion (optional)</Label>
            <Input
              id="restore-reason"
              placeholder="e.g. Rollback due to vendor change"
              value={restoreReason}
              onChange={(e) => setRestoreReason(e.target.value)}
              disabled={restoring}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoring}
              onClick={handleRestoreVersion}
            >
              {restoring ? 'Restoring…' : 'Restore as draft'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Retire / Obsolete Document Dialog */}
      <AlertDialog
        open={showRetireDialog}
        onOpenChange={(open) => {
          setShowRetireDialog(open);
          if (!open) setRetireReason('');
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retire Document (Mark Obsolete)</AlertDialogTitle>
            <AlertDialogDescription>
              Retiring this document will mark it as obsolete. It will be moved to the Archived repository and removed from active listings. Existing versions, acknowledgment records, and audit history will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Label htmlFor="retire-reason">Reason for retirement / obsolescence *</Label>
            <Input
              id="retire-reason"
              placeholder="e.g. Superseded by new global SOP-ENG-0002"
              value={retireReason}
              onChange={(e) => setRetireReason(e.target.value)}
              disabled={retiring}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={retiring}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={retiring || !retireReason.trim()}
              onClick={handleRetireDocument}
            >
              {retiring ? 'Retiring…' : 'Retire Document'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Discard Unreleased Draft Document Dialog */}
      <AlertDialog
        open={showDiscardDocDialog}
        onOpenChange={setShowDiscardDocDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard Draft Document?</AlertDialogTitle>
            <AlertDialogDescription>
              This unreleased document has never been approved or published. Discarding it will remove it from the document registry. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={discardingDoc}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={discardingDoc}
              onClick={handleDiscardDraftDocument}
            >
              {discardingDoc ? 'Discarding…' : 'Discard Draft Document'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reactivate Obsolete Document Dialog */}
      <AlertDialog
        open={showReactivateDialog}
        onOpenChange={(open) => {
          setShowReactivateDialog(open);
          if (!open) setReactivateReason('');
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reactivate Document</AlertDialogTitle>
            <AlertDialogDescription>
              Reactivating this document will restore it from obsolete status back to active status (released).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Label htmlFor="reactivate-reason">Reason for reactivation (optional)</Label>
            <Input
              id="reactivate-reason"
              placeholder="e.g. Reinstated pending regulatory review"
              value={reactivateReason}
              onChange={(e) => setReactivateReason(e.target.value)}
              disabled={reactivating}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reactivating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={reactivating}
              onClick={handleReactivateDocument}
            >
              {reactivating ? 'Reactivating…' : 'Reactivate Document'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {previewTarget && (
        <DocumentPreviewModal
          open={Boolean(previewTarget)}
          onOpenChange={(open) => {
            if (!open) setPreviewTarget(null);
          }}
          documentId={previewTarget.documentId}
          versionId={previewTarget.versionId}
          documentNumber={previewTarget.documentNumber}
          versionNumber={previewTarget.versionNumber}
          title={previewTarget.title}
        />
      )}
    </>
  );
}
