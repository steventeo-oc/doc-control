import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FileX } from 'lucide-react';
import { downloadFile } from '../api/client';
import { documentApi, workflowApi, type AssigneeInput } from '../api/resources';
import type { DocumentDetail, DocumentVersion, ReviewerCandidate } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import AcknowledgmentPanel from '../components/AcknowledgmentPanel';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge, type StatusBadgeKind } from '../components/StatusBadge';
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

/**
 * Phase 2b retired the admin status override — releases happen only through
 * the approval engine, so this page has no release shortcut. What it offers
 * instead: sending a draft version for approval, starting a periodic-review
 * re-approval of a released document, and (Phase 2d) the acknowledgment
 * panel.
 *
 * Design-redesign Phase 2b (Design_System_Redesign_PlanBack.md): reskinned
 * onto Card/StatusBadge/Select/Table/Button/Label/Input/EmptyState.
 * Behavior freeze — the two-form approval layout (the assignee fields live
 * in the first form and feed the re-approval submit in the second, exactly
 * as before), every conditional card, and every request shape are
 * unchanged. The only structural swap is the F3 native-select → Radix
 * Select replacement.
 */
export default function DocumentDetailPage() {
  const { id } = useParams();
  const documentId = Number(id);
  const { user, isAdmin } = useAuth();

  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [uploadNotes, setUploadNotes] = useState('');

  // Approval assignment (ad-hoc, per instance): a named user or a role.
  // The candidate list is gated by the same canModify rule as starting an
  // approval, so non-admin owners assign reviewers by name too.
  const [candidates, setCandidates] = useState<ReviewerCandidate[] | null>(null);
  const [assigneeMode, setAssigneeMode] = useState<'user' | 'role'>('user');
  // Radix Select works in strings — converted to a number for the request.
  const [reviewerUserId, setReviewerUserId] = useState('');
  const [roleName, setRoleName] = useState('');

  const load = useCallback(() => {
    documentApi
      .get(documentId)
      .then((loaded) => {
        setDoc(loaded);
        setNewName(loaded.name);
      })
      .catch((err: Error) => setError(err.message));
    documentApi
      .versions(documentId)
      .then(setVersions)
      .catch(() => undefined);
  }, [documentId]);

  useEffect(load, [load]);

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

  // Mirrors the server's Phase 2a rule (admin, or member of the document's
  // department) — the server enforces it; this only shapes the UI.
  const canModify =
    !!doc &&
    (isAdmin || !!user?.departments.some((department) => department.id === doc.departmentId));

  useEffect(() => {
    // same gate as starting an approval itself — not an admin-only list
    if (canModify && candidates === null) {
      workflowApi
        .reviewerCandidates(documentId)
        .then(setCandidates)
        .catch(() => setCandidates([]));
    }
  }, [canModify, candidates, documentId]);

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
        <Link to="/" className="text-sm text-muted-foreground hover:underline">← Back to documents</Link>
      </>
    );
  }
  if (!doc) {
    return <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <>
      <div>
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
          ← Back to documents
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

      <Card className="mt-4">
        <CardContent className="py-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
            <div className="py-1">
              <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Name</dt>
              <dd className="mt-0.5 text-sm">{doc.name}</dd>
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

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Metadata</CardTitle>
        </CardHeader>
        <CardContent>
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
            {doc.deletedAt ? (
              <Button type="button" variant="outline" onClick={handleRestore}>
                Restore from trash
              </Button>
            ) : (
              <Button type="button" variant="destructive" onClick={handleDelete}>
                Move to trash
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      {canModify && !doc.deletedAt && (doc.status === 'draft' || doc.status === 'released') && (
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
                  <Input
                    id="approval-role"
                    value={roleName}
                    placeholder="e.g. ENG Manager"
                    onChange={(e) => setRoleName(e.target.value)}
                    required
                    className="w-64"
                  />
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
                <TableCell>
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Upload new version</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3" onSubmit={handleUpload}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="upload-file">File</Label>
              <Input id="upload-file" name="file" type="file" required />
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
