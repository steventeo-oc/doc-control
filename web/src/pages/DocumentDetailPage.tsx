import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { downloadFile } from '../api/client';
import { documentApi, workflowApi, type AssigneeInput } from '../api/resources';
import type { DocumentDetail, DocumentVersion, ReviewerCandidate } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import AcknowledgmentPanel from '../components/AcknowledgmentPanel';

/**
 * Phase 2b retired the admin status override — releases happen only through
 * the approval engine, so this page has no release shortcut. What it offers
 * instead: sending a draft version for approval, starting a periodic-review
 * re-approval of a released document, and (Phase 2d) the acknowledgment
 * panel.
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
  const [reviewerUserId, setReviewerUserId] = useState<number | ''>('');
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
      ? [{ type: 'USER', userId: reviewerUserId }]
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
        <div className="error-banner">{error}</div>
        <Link to="/">← Back to documents</Link>
      </>
    );
  }
  if (!doc) {
    return <div className="page-loading">Loading…</div>;
  }

  return (
    <>
      <Link to="/">← Back to documents</Link>
      <h1>
        {doc.documentNumber}{' '}
        <span className={`badge ${doc.status}`}>{doc.status}</span>
        {doc.deletedAt && <span className="badge superseded"> trashed</span>}
      </h1>
      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="success-banner">{notice}</div>}

      <div className="card">
        <dl className="meta-grid">
          <div>
            <dt>Name</dt>
            <dd>{doc.name}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{doc.documentTypeCode}</dd>
          </div>
          <div>
            <dt>Department</dt>
            <dd>{doc.departmentCode}</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{doc.ownerName}</dd>
          </div>
          <div>
            <dt>Current version</dt>
            <dd>{doc.currentVersionId ? versions.find((v) => v.id === doc.currentVersionId)?.versionNumber ?? doc.currentVersionId : '—'}</dd>
          </div>
          {doc.status === 'approved' && doc.pendingEffectiveDate && (
            <div>
              <dt>Pending effective</dt>
              <dd>
                <span className="badge approved">approved</span> takes effect {doc.pendingEffectiveDate}
              </dd>
            </div>
          )}
          {doc.lastReviewedAt && (
            <div>
              <dt>Last reviewed</dt>
              <dd>{doc.lastReviewedAt}</dd>
            </div>
          )}
          {doc.nextReviewDue && (
            <div>
              <dt>Next review due</dt>
              <dd>
                {doc.nextReviewDue}{' '}
                {doc.reviewOverdue && <span className="badge overdue">review overdue</span>}
              </dd>
            </div>
          )}
          <div>
            <dt>Created</dt>
            <dd>{new Date(doc.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{new Date(doc.updatedAt).toLocaleString()}</dd>
          </div>
        </dl>
      </div>

      <div className="card">
        <h2>Metadata</h2>
        <form className="inline" onSubmit={handleRename}>
          <label>
            Name
            <input value={newName} maxLength={255} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <button type="submit">Save name</button>
          {doc.deletedAt ? (
            <button type="button" onClick={handleRestore}>
              Restore from trash
            </button>
          ) : (
            <button type="button" className="danger" onClick={handleDelete}>
              Move to trash
            </button>
          )}
        </form>
      </div>

      {canModify && !doc.deletedAt && (doc.status === 'draft' || doc.status === 'released') && (
        <div className="card">
          <h2>Approval</h2>
          <form className="inline" onSubmit={handleStartApproval}>
            <label>
              Assignee
              <select
                value={assigneeMode}
                onChange={(e) => setAssigneeMode(e.target.value as 'user' | 'role')}
              >
                <option value="user">By user</option>
                <option value="role">By role</option>
              </select>
            </label>
            {assigneeMode === 'user' ? (
              <label>
                Reviewer
                <select
                  value={reviewerUserId}
                  onChange={(e) => setReviewerUserId(Number(e.target.value))}
                  required
                >
                  <option value="" disabled>
                    Choose a reviewer…
                  </option>
                  {(candidates ?? []).map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name} ({candidate.email})
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Role (candidate group)
                <input
                  value={roleName}
                  placeholder="e.g. ENG Manager"
                  onChange={(e) => setRoleName(e.target.value)}
                  required
                />
              </label>
            )}
            {doc.status === 'draft' && latestDraftVersion() && (
              <button className="primary" type="submit">
                Send v{latestDraftVersion()!.versionNumber} for approval
              </button>
            )}
          </form>
          {doc.status === 'released' && (
            <form
              className="inline"
              onSubmit={(event) => {
                event.preventDefault();
                handleStartReviewApproval();
              }}
            >
              <button className="primary" type="submit">
                Start periodic review re-approval
              </button>
              <span className="muted">
                Re-approves the current released version — no new content, the review clock resets.
              </span>
            </form>
          )}
        </div>
      )}

      <h2>Versions</h2>
      <table className="data">
        <thead>
          <tr>
            <th>#</th>
            <th>File</th>
            <th>Status</th>
            <th>Effective</th>
            <th>Change notes</th>
            <th>Change reference</th>
            <th>Uploaded by</th>
            <th>At</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {versions.map((version) => (
            <tr key={version.id}>
              <td>{version.versionNumber}</td>
              <td>{version.fileName}</td>
              <td>
                <span className={`badge ${version.status}`}>{version.status}</span>
              </td>
              <td className="muted">{version.effectiveAt ?? '—'}</td>
              <td>{version.changeNotes ?? '—'}</td>
              <td className="muted">{version.changeReference ?? '—'}</td>
              <td>{version.uploadedByName}</td>
              <td className="muted">{new Date(version.uploadedAt).toLocaleString()}</td>
              <td>
                <button
                  type="button"
                  onClick={() =>
                    downloadFile(`/documents/${doc.id}/versions/${version.id}/download`)
                  }
                >
                  Download
                </button>
              </td>
            </tr>
          ))}
          {versions.length === 0 && (
            <tr>
              <td colSpan={9} className="muted">
                No versions uploaded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="card">
        <h2>Upload new version</h2>
        <form className="inline" onSubmit={handleUpload}>
          <label>
            File
            <input name="file" type="file" required />
          </label>
          <label>
            Change notes
            <input
              name="changeNotes"
              value={uploadNotes}
              placeholder="What changed?"
              onChange={(e) => setUploadNotes(e.target.value)}
            />
          </label>
          <label>
            Change reference
            <input
              name="changeReference"
              placeholder="Change request / CAPA reference (optional)"
            />
          </label>
          <button className="primary" type="submit">
            Upload
          </button>
        </form>
      </div>

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
