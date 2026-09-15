import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { lookupApi } from '../api/resources';
import type { Department } from '../api/types';
import { useAuth } from '../auth/AuthContext';

/**
 * The Departments section (nav restructure plan-back section 1): the
 * sidebar carries the user's own departments; the content lists them with
 * links to the detail page. Admins see every department, inactive marked.
 *
 * The admin CRUD (create, deactivate/reactivate with the usage-count
 * confirmation, delete with the server's blocking sentence) was lost when
 * the old LookupsPage's departments table was deleted in the nav
 * restructure — restored here from that page's interactions, plus an
 * inline rename the old page never had. Backend endpoints were untouched
 * throughout (LookupAdminTests covers them).
 */
export default function DepartmentsPage() {
  const { user, isAdmin } = useAuth();
  const [all, setAll] = useState<Department[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Department | null>(null);

  const load = useCallback(() => {
    if (isAdmin) {
      lookupApi.departments(true).then(setAll).catch((err: Error) => setError(err.message));
    }
  }, [isAdmin]);

  useEffect(load, [load]);

  function run(action: () => Promise<unknown>, message: string) {
    setError(null);
    action()
      .then(() => {
        setNotice(message);
        setRenaming(null);
        load();
      })
      .catch((err: Error) => setError(err.message));
  }

  function toggleDepartment(department: Department) {
    if (!department.active) {
      run(
        () => lookupApi.updateDepartment(department.id, { active: true }),
        `Department ${department.code} activated.`,
      );
      return;
    }
    lookupApi.usageDepartment(department.id).then(({ documents, users }) => {
      const docPart = documents > 0
        ? `${documents} existing document(s) keep using it and stay searchable.`
        : 'No documents reference it.';
      const userPart = users > 0
        ? `${users} user(s) belong to it — they keep access to existing documents but cannot file new ones here.`
        : 'No users belong to it.';
      if (window.confirm(`Deactivate department '${department.code}'? ${docPart} ${userPart}`)) {
        run(
          () => lookupApi.updateDepartment(department.id, { active: false }),
          `Department ${department.code} deactivated.`,
        );
      }
    }).catch((err: Error) => setError(err.message));
  }

  function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renaming) return;
    const label = String(new FormData(event.currentTarget).get('label') ?? '').trim();
    if (!label) return;
    run(
      () => lookupApi.updateDepartment(renaming.id, { label }),
      `Department ${renaming.code} renamed.`,
    );
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    run(
      () =>
        lookupApi.createDepartment(
          String(data.get('code') ?? '').trim(),
          String(data.get('label') ?? '').trim(),
        ),
      'Department created.',
    );
    form.reset();
  }

  const departments: Department[] = isAdmin
    ? all ?? []
    : user?.departments.slice().sort((a, b) => a.code.localeCompare(b.code)) ?? [];

  return (
    <>
      <h1>Departments</h1>
      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="success-banner">{notice}</div>}
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
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {departments.map((d) => (
              <tr key={d.id}>
                <td>
                  <Link to={`/departments/${d.id}`}>{d.code}</Link>
                  {!d.active && ' (inactive)'}
                </td>
                <td>
                  {renaming?.id === d.id ? (
                    <form className="inline" onSubmit={handleRename}>
                      <input
                        name="label"
                        defaultValue={d.label}
                        required
                        maxLength={255}
                        aria-label={`New label for ${d.code}`}
                      />
                      <button className="primary" type="submit">
                        Save
                      </button>
                      <button type="button" onClick={() => setRenaming(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    d.label
                  )}
                </td>
                <td>{d.active ? 'yes' : 'no'}</td>
                {isAdmin && (
                  <td>
                    {renaming?.id === d.id ? null : (
                      <>
                        <button type="button" onClick={() => setRenaming(d)}>
                          Rename
                        </button>{' '}
                        <button type="button" onClick={() => toggleDepartment(d)}>
                          {d.active ? 'Deactivate' : 'Activate'}
                        </button>{' '}
                        <button
                          type="button"
                          onClick={() =>
                            run(() => lookupApi.deleteDepartment(d.id), `Department ${d.code} deleted.`)
                          }
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {departments.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 4 : 3} className="muted">
                  No departments.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {isAdmin && (
          <form className="inline" onSubmit={handleCreate}>
            <label>
              Code
              <input name="code" required maxLength={32} placeholder="e.g. ENG" />
            </label>
            <label>
              Label
              <input name="label" required maxLength={255} placeholder="e.g. Engineering" />
            </label>
            <button className="primary" type="submit">
              Add department
            </button>
          </form>
        )}
      </div>
    </>
  );
}
