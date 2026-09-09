import { FormEvent, useCallback, useEffect, useState } from 'react';
import { lookupApi } from '../api/resources';
import type { Department, DocumentTier, DocumentType } from '../api/types';
import { useAuth } from '../auth/AuthContext';

export default function LookupsPage() {
  const { isAdmin } = useAuth();
  const [tiers, setTiers] = useState<DocumentTier[]>([]);
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    lookupApi.tiers().then(setTiers).catch((err: Error) => setError(err.message));
    lookupApi.types().then(setTypes).catch((err: Error) => setError(err.message));
    lookupApi.departments().then(setDepartments).catch((err: Error) => setError(err.message));
  }, []);

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

  function handleCreateType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    run(
      () =>
        lookupApi.createType(
          String(data.get('code') ?? '').trim(),
          String(data.get('label') ?? '').trim(),
          Number(data.get('tierId')),
        ),
      'Document type created.',
    );
    event.currentTarget.reset();
  }

  function handleCreateDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    run(
      () =>
        lookupApi.createDepartment(
          String(data.get('code') ?? '').trim(),
          String(data.get('label') ?? '').trim(),
        ),
      'Department created.',
    );
    event.currentTarget.reset();
  }

  return (
    <>
      <h1>Lookups</h1>
      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="success-banner">{notice}</div>}

      <div className="card">
        <h2>Document tiers</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Tier</th>
              <th>Label</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier) => (
              <tr key={tier.id}>
                <td>{tier.tierNumber}</td>
                <td>{tier.label}</td>
                <td>{tier.active ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Document types</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Code</th>
              <th>Label</th>
              <th>Tier</th>
              <th>Active</th>
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {types.map((type) => (
              <tr key={type.id}>
                <td>{type.code}</td>
                <td>{type.label}</td>
                <td>{tiers.find((t) => t.id === type.tierId)?.tierNumber ?? type.tierId}</td>
                <td>{type.active ? 'yes' : 'no'}</td>
                {isAdmin && (
                  <td>
                    <button
                      type="button"
                      onClick={() =>
                        run(
                          () => lookupApi.updateType(type.id, { active: !type.active }),
                          `Type ${type.code} updated.`,
                        )
                      }
                    >
                      {type.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {isAdmin && (
          <form className="inline" onSubmit={handleCreateType}>
            <label>
              Code
              <input name="code" required maxLength={32} placeholder="e.g. DWG" />
            </label>
            <label>
              Label
              <input name="label" required maxLength={255} placeholder="e.g. Drawing" />
            </label>
            <label>
              Tier
              <select name="tierId" required defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {tiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    Tier {t.tierNumber} — {t.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" type="submit">
              Add type
            </button>
          </form>
        )}
      </div>

      <div className="card">
        <h2>Departments</h2>
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
            {departments.map((department) => (
              <tr key={department.id}>
                <td>{department.code}</td>
                <td>{department.label}</td>
                <td>{department.active ? 'yes' : 'no'}</td>
                {isAdmin && (
                  <td>
                    <button
                      type="button"
                      onClick={() =>
                        run(
                          () =>
                            lookupApi.updateDepartment(department.id, { active: !department.active }),
                          `Department ${department.code} updated.`,
                        )
                      }
                    >
                      {department.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {isAdmin && (
          <form className="inline" onSubmit={handleCreateDepartment}>
            <label>
              Code
              <input name="code" required maxLength={32} placeholder="e.g. IT" />
            </label>
            <label>
              Label
              <input name="label" required maxLength={255} placeholder="e.g. IT Services" />
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
