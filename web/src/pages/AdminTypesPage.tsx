import { FormEvent, useCallback, useEffect, useState } from 'react';
import { lookupApi } from '../api/resources';
import type { DocumentTier, DocumentType } from '../api/types';

/**
 * Admin > Document Types (nav restructure plan-back F3): the types card
 * extracted from the former LookupsPage — create, deactivate/activate,
 * delete (blocked server-side while documents reference the type).
 */
export default function AdminTypesPage() {
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [tiers, setTiers] = useState<DocumentTier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    lookupApi.types(true).then(setTypes).catch((err: Error) => setError(err.message));
    lookupApi.tiers(true).then(setTiers).catch(() => undefined);
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

  return (
    <>
      <h1>Document types</h1>
      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="success-banner">{notice}</div>}

      <div className="card">
        <table className="data">
          <thead>
            <tr>
              <th>Code</th>
              <th>Label</th>
              <th>Tier</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {types.map((type) => (
              <tr key={type.id}>
                <td>{type.code}</td>
                <td>{type.label}</td>
                <td>{tiers.find((t) => t.id === type.tierId)?.tierNumber ?? type.tierId}</td>
                <td>{type.active ? 'yes' : 'no'}</td>
                <td>
                  <button type="button" onClick={() => toggleType(type)}>
                    {type.active ? 'Deactivate' : 'Activate'}
                  </button>{' '}
                  <button type="button" onClick={() => run(() => lookupApi.deleteType(type.id), 'Type deleted.')}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
      </div>
    </>
  );
}
