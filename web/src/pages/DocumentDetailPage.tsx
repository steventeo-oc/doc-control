import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { downloadFile } from '../api/client';
import { documentApi } from '../api/resources';
import type { DocumentDetail, DocumentVersion } from '../api/types';
import { DOCUMENT_STATUSES } from '../api/types';
import { useAuth } from '../auth/AuthContext';

export default function DocumentDetailPage() {
  const { id } = useParams();
  const documentId = Number(id);
  const { isAdmin } = useAuth();

  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [uploadNotes, setUploadNotes] = useState('');

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

  function handleStatus(status: string) {
    run(() => documentApi.update(documentId, { status }), `Status changed to ${status}.`);
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
      () => documentApi.uploadVersion(documentId, file, (data.get('changeNotes') as string) || null),
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
          {isAdmin && (
            <label>
              Status override (admin)
              <select value={doc.status} onChange={(e) => handleStatus(e.target.value)}>
                {DOCUMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}
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

      <h2>Versions</h2>
      <table className="data">
        <thead>
          <tr>
            <th>#</th>
            <th>File</th>
            <th>Status</th>
            <th>Change notes</th>
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
              <td>{version.changeNotes ?? '—'}</td>
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
              <td colSpan={7} className="muted">
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
          <button className="primary" type="submit">
            Upload
          </button>
        </form>
      </div>
    </>
  );
}
