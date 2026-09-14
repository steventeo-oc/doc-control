import { useCallback, useEffect, useState } from 'react';
import { lookupApi } from '../api/resources';
import type { DepartmentMember } from '../api/types';

/**
 * The department members panel with level controls (department levels
 * plan-back F5), extracted from the former LookupsPage for the
 * Departments section. Rendered for Managers of the department and
 * admins; adding/removing members stays on the Admin > Users page.
 */
export default function DepartmentMembersPanel({ departmentId }: { departmentId: number }) {
  const [members, setMembers] = useState<DepartmentMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    lookupApi.departmentMembers(departmentId).then(setMembers).catch((err: Error) => setError(err.message));
  }, [departmentId]);

  useEffect(load, [load]);

  function changeLevel(userId: number, level: DepartmentMember['level']) {
    setError(null);
    lookupApi
      .updateDepartmentMember(departmentId, userId, level)
      .then((updated) => {
        setMembers((prev) => (prev ?? []).map((m) => (m.userId === userId ? updated : m)));
      })
      .catch((err: Error) => setError(err.message));
  }

  return (
    <div className="card">
      <h2>Members</h2>
      {error && <div className="error-banner">{error}</div>}
      {members ? (
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Active</th>
              <th>Level</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.userId}>
                <td>{member.name}</td>
                <td>{member.email}</td>
                <td>{member.userActive ? 'yes' : 'no'}</td>
                <td>
                  <select
                    aria-label={`Level for ${member.email}`}
                    value={member.level}
                    onChange={(e) => changeLevel(member.userId, e.target.value as DepartmentMember['level'])}
                  >
                    {(['MANAGER', 'COLLABORATOR', 'CONTRIBUTOR', 'CONSUMER'] as const).map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="page-loading">Loading members…</div>
      )}
      <p className="muted">Adding or removing members is done on the Admin &gt; Users page.</p>
    </div>
  );
}
