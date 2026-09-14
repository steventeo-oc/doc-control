import { FormEvent, useCallback, useEffect, useState } from 'react';
import { lookupApi, userApi } from '../api/resources';
import type { Department, MembershipLevel, RoleRow, UserRow } from '../api/types';
import { useAuth } from '../auth/AuthContext';

/**
 * Department memberships carry explicit levels (plan-back F1): checking a
 * department arms a level picker and the update fires only once a level is
 * chosen — the UI never sends an omitted level, mirroring the API's
 * reject-don't-assume rule.
 */
export default function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingLevels, setPendingLevels] = useState<Record<string, MembershipLevel | undefined>>({});

  const load = useCallback(() => {
    userApi
      .list()
      .then(setUsers)
      .catch((err: Error) => setError(err.message));
    userApi.roles().then(setRoles).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    lookupApi.departments(true).then(setDepartments).catch(() => undefined);
  }, [load]);

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

  /** The memberships the user would hold with the given department's state applied. */
  function membershipsAfter(user: UserRow, department: Department, level: MembershipLevel | undefined) {
    const without = user.departments.filter((ud) => ud.id !== department.id);
    return level === undefined
      ? without.map((ud) => ({ departmentId: ud.id, level: ud.level }))
      : [...without.map((ud) => ({ departmentId: ud.id, level: ud.level })), { departmentId: department.id, level }];
  }

  function applyDepartments(user: UserRow, department: Department, level: MembershipLevel | undefined, key: string) {
    run(
      () => userApi.update(user.id, { departments: membershipsAfter(user, department, level) }),
      `Departments updated for ${user.email}.`,
    );
    setPendingLevels((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function toggleDepartment(user: UserRow, department: Department) {
    const key = `${user.id}:${department.id}`;
    const isMember = user.departments.some((ud) => ud.id === department.id);
    if (isMember) {
      // removal needs no level
      applyDepartments(user, department, undefined, key);
      return;
    }
    const chosen = pendingLevels[key];
    if (chosen) {
      applyDepartments(user, department, chosen, key);
    }
    // else: the level picker just armed — the update fires when a level is chosen
  }

  function changeLevel(user: UserRow, department: Department, level: MembershipLevel) {
    const key = `${user.id}:${department.id}`;
    const isMember = user.departments.some((ud) => ud.id === department.id);
    if (isMember) {
      applyDepartments(user, department, level, key);
    } else {
      // arming a new membership: store the choice, fire it
      setPendingLevels((prev) => ({ ...prev, [key]: level }));
      applyDepartments(user, department, level, key);
    }
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const selectedRoles = roles
      .filter((role) => data.get(`role-${role.name}`) === 'on')
      .map((role) => role.name);
    const selected = departments
      .filter((d) => data.get(`dept-${d.id}`) === 'on')
      .map((d) => ({ department: d, level: data.get(`level-${d.id}`) as MembershipLevel | null }));
    const missing = selected.find((s) => !s.level);
    if (selected.length === 0) {
      setError('Select at least one department.');
      return;
    }
    if (missing) {
      setError(`Choose a level for department ${missing.department.code}.`);
      return;
    }
    run(
      () =>
        userApi.create({
          name: String(data.get('name') ?? '').trim(),
          email: String(data.get('email') ?? '').trim(),
          departments: selected.map((s) => ({ departmentId: s.department.id, level: s.level as MembershipLevel })),
          password: String(data.get('password') ?? ''),
          roles: selectedRoles,
        }),
      'User created.',
    );
    event.currentTarget.reset();
  }

  function handleResetPassword(user: UserRow) {
    const newPassword = window.prompt(`New password for ${user.email} (min 8 chars):`);
    if (!newPassword) return;
    run(() => userApi.changePassword(user.id, { newPassword }), 'Password reset.');
  }

  function toggleRole(user: UserRow, roleName: string) {
    const has = user.roles.includes(roleName);
    const next = has ? user.roles.filter((r) => r !== roleName) : [...user.roles, roleName];
    run(() => userApi.update(user.id, { roles: next }), `Roles updated for ${user.email}.`);
  }

  return (
    <>
      <h1>Users</h1>
      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="success-banner">{notice}</div>}

      <table className="data">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Department</th>
            <th>Roles</th>
            <th>Active</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.name}</td>
              <td>{user.email}</td>
              <td>
                {departments.map((d) => {
                  const membership = user.departments.find((ud) => ud.id === d.id);
                  const key = `${user.id}:${d.id}`;
                  const level = membership?.level ?? pendingLevels[key];
                  return (
                    <span key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 8, display: 'inline-flex' }}>
                      <input
                        type="checkbox"
                        checked={!!membership}
                        onChange={() => toggleDepartment(user, d)}
                      />
                      {d.code}
                      {!d.active && ' (inactive)'}
                      {membership !== undefined && (
                        <select
                          aria-label={`Level in ${d.code} for ${user.email}`}
                          value={level ?? ''}
                          onChange={(e) => changeLevel(user, d, e.target.value as MembershipLevel)}
                        >
                          <option value="">level…</option>
                          {(['MANAGER', 'COLLABORATOR', 'CONTRIBUTOR', 'CONSUMER'] as MembershipLevel[]).map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </select>
                      )}
                    </span>
                  );
                })}
              </td>
              <td>
                {roles.map((role) => (
                  <label key={role.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 8 }}>
                    <input
                      type="checkbox"
                      checked={user.roles.includes(role.name)}
                      disabled={user.id === me?.id}
                      onChange={() => toggleRole(user, role.name)}
                    />
                    {role.name}
                  </label>
                ))}
              </td>
              <td>{user.active ? 'yes' : 'no'}</td>
              <td>
                <button type="button" onClick={() => handleResetPassword(user)}>
                  Reset password
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        Role checkboxes are disabled for your own account — an admin cannot change their own roles.
        Checking a department arms a level picker; the membership is saved once a level is chosen.
      </p>

      <div className="card">
        <h2>Create user</h2>
        <form className="inline" onSubmit={handleCreate}>
          <label>
            Name
            <input name="name" required maxLength={255} />
          </label>
          <label>
            Email
            <input name="email" type="email" required maxLength={255} />
          </label>
          <label>
            Departments
            <span style={{ flexDirection: 'row', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {departments.map((d) => (
                <span key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, display: 'inline-flex' }}>
                  <input type="checkbox" name={`dept-${d.id}`} />
                  {d.code}
                  {!d.active && ' (inactive)'}
                  <select name={`level-${d.id}`} defaultValue="" disabled={!departments.some((x) => x.id === d.id)}>
                    <option value="">level…</option>
                    {(['MANAGER', 'COLLABORATOR', 'CONTRIBUTOR', 'CONSUMER'] as MembershipLevel[]).map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </span>
              ))}
            </span>
          </label>
          <label>
            Initial password
            <input name="password" type="password" required minLength={8} maxLength={100} />
          </label>
          <label>
            Roles
            <span style={{ flexDirection: 'row', display: 'flex', gap: 8 }}>
              {roles.map((role) => (
                <label key={role.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" name={`role-${role.name}`} />
                  {role.name}
                </label>
              ))}
            </span>
          </label>
          <button className="primary" type="submit">
            Create user
          </button>
        </form>
      </div>
    </>
  );
}
