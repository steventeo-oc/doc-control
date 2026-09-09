import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { documentApi, lookupApi } from '../api/resources';
import type { Department, DocumentSummary, DocumentType, DocumentsPage as PageResult } from '../api/types';
import { DOCUMENT_STATUSES } from '../api/types';
import { useAuth } from '../auth/AuthContext';

export default function DocumentsPage() {
  const { user, isAdmin } = useAuth();
  const [page, setPage] = useState<PageResult | null>(null);
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState({ type: '', department: '', status: '', q: '' });
  const [pageNumber, setPageNumber] = useState(0);

  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setError(null);
    documentApi
      .list({
        type: filters.type || undefined,
        department: filters.department || undefined,
        status: filters.status || undefined,
        q: filters.q || undefined,
        page: pageNumber,
      })
      .then(setPage)
      .catch((err: Error) => setError(err.message));
  }, [filters, pageNumber]);

  useEffect(load, [load]);
  useEffect(() => {
    lookupApi.types().then(setTypes).catch(() => undefined);
    lookupApi.departments().then(setDepartments).catch(() => undefined);
  }, []);

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setCreating(true);
    setCreateError(null);
    documentApi
      .create(
        Number(data.get('documentTypeId')),
        Number(data.get('departmentId')),
        String(data.get('name') ?? ''),
        data.get('file') instanceof File && (data.get('file') as File).size > 0
          ? (data.get('file') as File)
          : null,
      )
      .then(() => {
        form.reset();
        setShowCreate(false);
        load();
      })
      .catch((err: Error) => setCreateError(err.message))
      .finally(() => setCreating(false));
  }

  return (
    <>
      <h1>Documents</h1>

      <div className="filters">
        <label>
          Type
          <select
            value={filters.type}
            onChange={(e) => {
              setFilters({ ...filters, type: e.target.value });
              setPageNumber(0);
            }}
          >
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t.id} value={t.code}>
                {t.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          Department
          <select
            value={filters.department}
            onChange={(e) => {
              setFilters({ ...filters, department: e.target.value });
              setPageNumber(0);
            }}
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.code}>
                {d.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={filters.status}
            onChange={(e) => {
              setFilters({ ...filters, status: e.target.value });
              setPageNumber(0);
            }}
          >
            <option value="">All statuses</option>
            {DOCUMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Search
          <input
            type="search"
            value={filters.q}
            placeholder="Name contains…"
            onChange={(e) => {
              setFilters({ ...filters, q: e.target.value });
              setPageNumber(0);
            }}
          />
        </label>
        <button type="button" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'Cancel' : 'New document'}
        </button>
      </div>

      {showCreate && (
        <form className="stack card" onSubmit={handleCreate}>
          <h2>New document</h2>
          {createError && <div className="error-banner">{createError}</div>}
          <label>
            Type
            <select name="documentTypeId" required defaultValue="">
              <option value="" disabled>
                Choose type…
              </option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code} — {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Department
            <select name="departmentId" required defaultValue="">
              <option value="" disabled>
                Choose department…
              </option>
              {(isAdmin
                ? departments
                : departments.filter((d) => user?.departments.some((ud) => ud.id === d.id))
              ).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {d.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Name
            <input name="name" required maxLength={255} placeholder="e.g. Incoming Inspection Procedure" />
          </label>
          <label>
            File (optional — becomes version 1)
            <input name="file" type="file" />
          </label>
          <button className="primary" type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create document'}
          </button>
        </form>
      )}

      {error && <div className="error-banner">{error}</div>}

      <table className="data">
        <thead>
          <tr>
            <th>Number</th>
            <th>Name</th>
            <th>Status</th>
            <th>Type</th>
            <th>Dept</th>
            <th>Owner</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {(page?.content ?? []).map((doc: DocumentSummary) => (
            <tr key={doc.id}>
              <td>
                <Link to={`/documents/${doc.id}`}>{doc.documentNumber}</Link>
              </td>
              <td>{doc.name}</td>
              <td>
                <span className={`badge ${doc.status}`}>{doc.status}</span>
              </td>
              <td>{doc.documentTypeCode}</td>
              <td>{doc.departmentCode}</td>
              <td>{doc.ownerName}</td>
              <td className="muted">{new Date(doc.updatedAt).toLocaleString()}</td>
            </tr>
          ))}
          {page && page.content.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                No documents match.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {page && page.totalPages > 0 && (
        <div className="pagination">
          <button type="button" disabled={page.page === 0} onClick={() => setPageNumber(page.page - 1)}>
            ← Prev
          </button>
          <span>
            Page {page.page + 1} of {page.totalPages} ({page.totalElements} documents)
          </span>
          <button
            type="button"
            disabled={page.page + 1 >= page.totalPages}
            onClick={() => setPageNumber(page.page + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </>
  );
}
