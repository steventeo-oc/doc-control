import { FormEvent, useCallback, useEffect, useState } from 'react';
import { lookupApi } from '../api/resources';
import type { Department, DocumentTier, DocumentType } from '../api/types';
import { useAuth } from '../auth/AuthContext';

/**
 * The admin view loads every lookup with includeInactive so deactivated
 * rows stay visible and reactivatable (the pre-plan-back page could never
 * show them again). Deactivating confirms against the server's usage
 * counts first; deleting is blocked server-side with a sentence this page
 * renders in the error banner (lookup admin plan-back F1–F5).
 */
export default function LookupsPage() {
  const { isAdmin } = useAuth();
  const [tiers, setTiers] = useState<DocumentTier[]>([]);
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    lookupApi.tiers(true).then(setTiers).catch((err: Error) => setError(err.message));
    lookupApi.types(true).then(setTypes).catch((err: Error) => setError(err.message));
    lookupApi.departments(true).then(setDepartments).catch((err: Error) => setError(err.message));
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

  function toggleType(type: DocumentType) {
    if (!type.active) {
      run(() => lookupApi.updateType(type.id, { active: true }), `Type ${type.code} activated.`);
      return;
    }
    lookupApi.usageType(type.id).then(({ documents }) => {
      const suffix = documents > 0
        ? `${documents} existing document(s) keep using it and stay searchable.`
        : 'No documents reference it.';
      if (window.confirm(`Deactivate document type '${type.code}'? ${suffix}`)) {
        run(() => lookupApi.updateType(type.id, { active: false }), `Type ${type.code} deactivated.`);
      }
    }).catch((err: Error) => setError(err.message));
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

  function toggleTier(tier: DocumentTier) {
    if (!tier.active) {
      run(() => lookupApi.updateTier(tier.id, { active: true }), `Tier ${tier.tierNumber} activated.`);
      return;
    }
    lookupApi.usageTier(tier.id).then(({ documentTypes }) => {
      const suffix = documentTypes > 0
        ? `${documentTypes} document type(s) reference it — they keep working.`
        : 'No document types reference it.';
      if (window.confirm(`Deactivate tier ${tier.tierNumber} (${tier.label})? ${suffix}`)) {
        run(() => lookupApi.updateTier(tier.id, { active: false }), `Tier ${tier.tierNumber} deactivated.`);
      }
    }).catch((err: Error) => setError(err.message));
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

  function handleCreateTier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    run(
      () =>
        lookupApi.createTier(
          Number(data.get('tierNumber')),
          String(data.get('label') ?? '').trim(),
        ),
      'Document tier created.',
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
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier) => (
              <tr key={tier.id}>
                <td>{tier.tierNumber}</td>
                <td>{tier.label}</td>
                <td>{tier.active ? 'yes' : 'no'}</td>
                {isAdmin && (
                  <td>
                    <button type="button" onClick={() => toggleTier(tier)}>
                      {tier.active ? 'Deactivate' : 'Activate'}
                    </button>{' '}
                    <button type="button" onClick={() => run(() => lookupApi.deleteTier(tier.id), 'Tier deleted.')}>
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {isAdmin && (
          <form className="inline" onSubmit={handleCreateTier}>
            <label>
              Tier number
              <input name="tierNumber" type="number" required min={1} />
            </label>
            <label>
              Label
              <input name="label" required maxLength={255} placeholder="e.g. Level 1 — Strategic" />
            </label>
            <button className="primary" type="submit">
              Add tier
            </button>
          </form>
        )}
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
                    <button type="button" onClick={() => toggleType(type)}>
                      {type.active ? 'Deactivate' : 'Activate'}
                    </button>{' '}
                    <button type="button" onClick={() => run(() => lookupApi.deleteType(type.id), 'Type deleted.')}>
                      Delete
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
                {tiers.filter((t) => t.active).map((t) => (
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
                    <button type="button" onClick={() => toggleDepartment(department)}>
                      {department.active ? 'Deactivate' : 'Activate'}
                    </button>{' '}
                    <button
                      type="button"
                      onClick={() => run(() => lookupApi.deleteDepartment(department.id), 'Department deleted.')}
                    >
                      Delete
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
