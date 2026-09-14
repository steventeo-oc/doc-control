import { FormEvent, useCallback, useEffect, useState } from 'react';
import { lookupApi } from '../api/resources';
import type { DocumentTier } from '../api/types';

/**
 * Admin > Tiers (nav restructure plan-back F3): the tiers card extracted
 * from the former LookupsPage — create, deactivate/activate, delete
 * (blocked server-side while document types reference the tier).
 */
export default function AdminTiersPage() {
  const [tiers, setTiers] = useState<DocumentTier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    lookupApi.tiers(true).then(setTiers).catch((err: Error) => setError(err.message));
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
      <h1>Document tiers</h1>
      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="success-banner">{notice}</div>}

      <div className="card">
        <table className="data">
          <thead>
            <tr>
              <th>Tier</th>
              <th>Label</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier) => (
              <tr key={tier.id}>
                <td>{tier.tierNumber}</td>
                <td>{tier.label}</td>
                <td>{tier.active ? 'yes' : 'no'}</td>
                <td>
                  <button type="button" onClick={() => toggleTier(tier)}>
                    {tier.active ? 'Deactivate' : 'Activate'}
                  </button>{' '}
                  <button type="button" onClick={() => run(() => lookupApi.deleteTier(tier.id), 'Tier deleted.')}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
      </div>
    </>
  );
}
