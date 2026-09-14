import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { documentApi, lookupApi } from '../api/resources';
import type { Department, DocumentsPage as PageResult } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import DepartmentMembersPanel from '../components/DepartmentMembersPanel';

/**
 * The department detail page (nav restructure plan-back section 1):
 * department info plus its documents (server-side visibility applies via
 * the department filter). Level-scoped: Consumers and Contributors get the
 * read-only view; Managers and Admins additionally see the Members panel
 * with level controls (plan-back F5).
 */
export default function DepartmentDetailPage() {
  const { id } = useParams();
  const departmentId = Number(id);
  const { user, isAdmin } = useAuth();
  const [department, setDepartment] = useState<Department | null>(null);
  const [resolved, setResolved] = useState(false);
  const [docs, setDocs] = useState<PageResult | null>(null);

  const membership = user?.departments.find((d) => d.id === departmentId);
  const canManage = isAdmin || membership?.level === 'MANAGER';

  useEffect(() => {
    if (isAdmin) {
      lookupApi
        .departments(true)
        .then((all) => {
          setDepartment(all.find((d) => d.id === departmentId) ?? null);
          setResolved(true);
        })
        .catch(() => setResolved(true));
    } else {
      setDepartment(membership ?? null);
      setResolved(true);
    }
  }, [isAdmin, departmentId, membership]);

  useEffect(() => {
    if (!department) return;
    documentApi
      .list({ department: department.code, pageSize: 100 })
      .then(setDocs)
      .catch(() => setDocs(null));
  }, [department]);

  if (!resolved) {
    return <div className="page-loading">Loading…</div>;
  }
  if (!department) {
    return (
      <>
        <h1>Department</h1>
        <p className="muted">You are not a member of this department.</p>
      </>
    );
  }

  return (
    <>
      <h1>
        {department.code} — {department.label}
      </h1>
      <p className="muted">
        Active: {department.active ? 'yes' : 'no'} · {docs?.totalElements ?? 0} document(s)
      </p>

      {canManage && <DepartmentMembersPanel departmentId={departmentId} />}

      <div className="card">
        <h2>Documents</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Number</th>
              <th>Name</th>
              <th>Status</th>
              <th>Owner</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {(docs?.content ?? []).map((doc) => (
              <tr key={doc.id}>
                <td>
                  <Link to={`/documents/${doc.id}`}>{doc.documentNumber}</Link>
                </td>
                <td>{doc.name}</td>
                <td>
                  <span className={`badge ${doc.status}`}>{doc.status}</span>
                </td>
                <td>{doc.ownerName}</td>
                <td className="muted">{new Date(doc.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
            {(docs?.content.length ?? 0) === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No documents in this department.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
