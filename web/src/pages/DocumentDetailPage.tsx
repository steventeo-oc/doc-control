import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, FileX } from 'lucide-react';
import { downloadFile } from '../api/client';
import { documentApi, lookupApi, workflowApi, type AssigneeInput } from '../api/resources';
import type { DepartmentMember, DocumentDetail, DocumentVersion, ReviewerCandidate, StartedInstance } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import AcknowledgmentPanel from '../components/AcknowledgmentPanel';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge, type StatusBadgeKind } from '../components/StatusBadge';
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

export default function DocumentDetailPage() {
  const { id } = useParams();
  const documentId = Number(id);
  const location = useLocation();
  const { user, isAdmin } = useAuth();

  const fromView = (location.state as { fromView?: string } | undefined)?.fromView;
  const backView = fromView === 'mine' || fromView === 'trash' ? fromView : 'all';
  const backLink = `/documents?view=${backView}`;

  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [uploadNotes, setUploadNotes] = useState('');

  const [candidates, setCandidates] = useState<ReviewerCandidate[] | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [activeWorkflow, setActiveWorkflow] = useState<StartedInstance | null>(null);
  const [deptMembers, setDeptMembers] = useState<DepartmentMember[]>([]);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>('');
  const [assigneeMode, setAssigneeMode] = useState<'user' | 'role'>('user');
  const [reviewerUserId, setReviewerUserId] = useState('');
  const [roleName, setRoleName] = useState('');

  const load = useCallback(() => {
    documentApi
      .get(documentId)
      .then((loaded) => {
        setDoc(loaded);
        setNewName(loaded.name);
        setSelectedOwnerId(String(loaded.ownerUserId));
        workflowApi
          .activeWorkflow(documentId)
          .then(setActiveWorkflow)
          .catch(() => setActiveWorkflow(null));
      })
      .catch((err: Error) => setError(err.message));
    documentApi
      .versions(documentId)
      .then(setVersions)
      .catch(() => undefined);
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

  function handleDelete() {
    run(() => documentApi.softDelete(documentId), 'Moved to trash.');
  }

  function handleRestore() {
    run(() => documentApi.restore(documentId), 'Restored from trash.');
  }

  function buildAssignees(): AssigneeInput[] {
    return assigneeMode === 'user' && reviewerUserId !== ''
      ? [{ type: 'USER', userId: Number(reviewerUserId) }]
      : [{ type: 'ROLE', roleName: roleName.trim() }];
  }

  function handleStartApproval(event: FormEvent) {
    event.preventDefault();
    const draft = latestDraftVersion();
    if (!draft) {
      setError('No draft version to send for approval.');
      return;
    }
    run(
      () => workflowApi.startApproval(documentId, draft.id, buildAssignees()),
      `Approval started for v${draft.versionNumber} — reviewers will see it under My tasks.`,
    );
  }

  function handleStartReviewApproval() {
    run(
      () => workflowApi.startReviewApproval(documentId, buildAssignees()),
      'Periodic review re-approval started — reviewers will see it flagged under My tasks.',
    );
  }

  function latestDraftVersion(): DocumentVersion | undefined {
    return versions
      .filter((version) => version.status === 'draft')
      .sort((a, b) => b.versionNumber - a.versionNumber)[0];
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
          Back to documents
        </Link>
      </>
    );
  }
  if (!doc) {
    return <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <>
      <div>
        <Link
          to={backLink}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to documents
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{doc.documentNumber}</h1>
          <StatusBadge status={doc.status as StatusBadgeKind}>{doc.status}</StatusBadge>
          {doc.deletedAt && <StatusBadge status="superseded">trashed</StatusBadge>}
        </div>
      </div>
      {error && (
        <div className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}
      {notice && (
        <div className="mt-4 rounded-md bg-success/10 px-3 py-2 text-sm text-success">{notice}</div>
      )}

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

      <Card className="mt-4">
        <CardContent className="py-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
            <div className="py-1">
              <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Name</dt>
              <dd className="mt-0.5 text-sm font-medium">{doc.name}</dd>
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

      {/* Mutation controls only rendered for editors */}
      {canModify && !doc.deletedAt && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Metadata & Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form className="flex flex-wrap items-end gap-3" onSubmit={handleRename}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rename-name">Name</Label>
                <Input
                  id="rename-name"
                  value={newName}
                  maxLength={255}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-72"
                />
              </div>
              <Button type="submit">Save name</Button>
              {canManage && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="destructive">
                      Move to trash
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Move document to trash?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to move &ldquo;{doc.name}&rdquo; ({doc.documentNumber}) to the trash?
                        It will no longer appear in active document searches, but can be restored by an administrator or manager.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={handleDelete}>
                        Move to trash
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </form>

            {canTransferOwner && deptMembers.length > 0 && (
              <div className="flex flex-wrap items-end gap-3 pt-3 border-t">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="transfer-owner">Transfer ownership</Label>
                  <Select
                    value={selectedOwnerId}
                    onValueChange={(val) => setSelectedOwnerId(val)}
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
                  disabled={!selectedOwnerId || Number(selectedOwnerId) === doc.ownerUserId}
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

      {/* Approval in progress card */}
      {(doc.status === 'in_review' || activeWorkflow !== null) && (
        <Card className="mt-4 border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
              <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
              Approval in progress
              {activeWorkflow && (
                <span className="text-xs font-normal text-muted-foreground ml-1">
                  for {activeWorkflow.reapproval ? 'periodic review re-approval' : `v${activeWorkflow.versionNumber}`}
                  {activeWorkflow.startedAt && ` (started ${new Date(activeWorkflow.startedAt).toLocaleDateString()})`}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeWorkflow && activeWorkflow.reviewers.length > 0 ? (
              <div className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Reviewers</span>
                <div className="flex flex-wrap gap-2">
                  {activeWorkflow.reviewers.map((rev, idx) => (
                    <div
                      key={idx}
                      className="inline-flex items-center gap-2 rounded-md border bg-card px-2.5 py-1 text-xs"
                    >
                      <span>{rev.name ?? rev.role ?? 'Reviewer'}</span>
                      <StatusBadge status={rev.state === 'approved' ? 'approved' : 'in_review'}>
                        {rev.state}
                      </StatusBadge>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                This document is currently pending approval review. Reviewers will find it in their tasks list.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {canModify && !doc.deletedAt && !activeWorkflow && (doc.status === 'draft' || doc.status === 'released') && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Approval</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form className="flex flex-wrap items-end gap-3" onSubmit={handleStartApproval}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="approval-assignee">Assignee</Label>
                <Select
                  value={assigneeMode}
                  onValueChange={(value) => setAssigneeMode(value as 'user' | 'role')}
                >
                  <SelectTrigger id="approval-assignee" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">By user</SelectItem>
                    <SelectItem value="role">By role</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {assigneeMode === 'user' ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="approval-reviewer">Reviewer</Label>
                  <Select value={reviewerUserId} onValueChange={setReviewerUserId} required>
                    <SelectTrigger id="approval-reviewer" className="w-64">
                      <SelectValue placeholder="Choose a reviewer…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(candidates ?? []).map((candidate) => (
                        <SelectItem key={candidate.id} value={String(candidate.id)}>
                          {candidate.name} ({candidate.email})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="approval-role">Role (candidate group)</Label>
                  {roles.length > 0 ? (
                    <Select value={roleName} onValueChange={setRoleName} required>
                      <SelectTrigger id="approval-role" className="w-64">
                        <SelectValue placeholder="Choose a role…" />
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
                      id="approval-role"
                      value={roleName}
                      placeholder="e.g. ENG Manager"
                      onChange={(e) => setRoleName(e.target.value)}
                      required
                      className="w-64"
                    />
                  )}
                </div>
              )}
              {doc.status === 'draft' && latestDraftVersion() && (
                <Button type="submit">Send v{latestDraftVersion()!.versionNumber} for approval</Button>
              )}
            </form>
            {doc.status === 'released' && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  handleStartReviewApproval();
                }}
              >
                <div className="flex items-center gap-3">
                  <Button type="submit">Start periodic review re-approval</Button>
                  <span className="text-sm text-muted-foreground">
                    Re-approves the current released version — no new content, the review clock resets.
                  </span>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      <h2 className="mt-4 text-base font-semibold">Versions</h2>
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
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {canModify && !doc.deletedAt && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Upload new version</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      )}

      {doc && !doc.deletedAt && (
        <AcknowledgmentPanel
          documentId={doc.id}
          documentStatus={doc.status}
          canManage={isAdmin || doc.ownerUserId === user?.id}
        />
      )}
    </>
  );
}
