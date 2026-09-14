import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { lookupApi } from '../api/resources';
import type { Department } from '../api/types';
import { useAuth } from '../auth/AuthContext';

/**
 * The Departments section (nav restructure plan-back section 1): the
 * sidebar carries the user's own departments; the content lists them with
 * links to the detail page. Admins see every department, inactive marked.
 */
export default function DepartmentsPage() {
  const { user, isAdmin } = useAuth();
  const [all, setAll] = useState<Department[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAdmin) {
      lookupApi.departments(true).then(setAll).catch((err: Error) => setError(err.message));
    }
  }, [isAdmin]);

  const departments: Department[] = isAdmin
    ? all ?? []
    : user?.departments.slice().sort((a, b) => a.code.localeCompare(b.code)) ?? [];

  return (
    <>
      <h1>Departments</h1>
      {error && <div className="error-banner">{error}</div>}
      {departments.length === 0 && !isAdmin && (
        <p className="muted">You are not a member of any department.</p>
      )}
      <div className="card">
        <table className="data">
          <thead>
            <tr>
              <th>Code</th>
              <th>Label</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {departments.map((d) => (
              <tr key={d.id}>
                <td>
                  <Link to={`/departments/${d.id}`}>{d.code}</Link>
                  {!d.active && ' (inactive)'}
                </td>
                <td>{d.label}</td>
                <td>{d.active ? 'yes' : 'no'}</td>
              </tr>
            ))}
            {departments.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  No departments.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
