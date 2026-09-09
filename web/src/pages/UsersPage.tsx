import { FormEvent, useCallback, useEffect, useState } from 'react';
import { lookupApi, userApi } from '../api/resources';
import type { Department, RoleRow, UserRow } from '../api/types';
import { useAuth } from '../auth/AuthContext';

export default function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    userApi
      .list()
      .then(setUsers)
      .catch((err: Error) => setError(err.message));
    userApi.roles().then(setRoles).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    lookupApi.departments().then(setDepartments).catch(() => undefined);
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

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const selectedRoles = roles
      .filter((role) => data.get(`role-${role.name}`) === 'on')
      .map((role) => role.name);
    run(
      () =>
        userApi.create({
          name: String(data.get('name') ?? '').trim(),
          email: String(data.get('email') ?? '').trim(),
          departmentId: Number(data.get('departmentId')),
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
                <select
                  value={user.department.id}
                  onChange={(e) =>
                    run(
                      () => userApi.update(user.id, { departmentId: Number(e.target.value) }),
                      'Department updated.',
                    )
                  }
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.code}
                    </option>
                  ))}
                </select>
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
            Department
            <select name="departmentId" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code}
                </option>
              ))}
            </select>
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
