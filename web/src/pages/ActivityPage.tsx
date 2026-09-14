import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { auditApi } from '../api/resources';
import type { ActivityScope, AuditLogPage } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import ActivitySentence from '../components/ActivitySentence';

/**
 * The full Activity view (activity plan-back, approved 2026-09-14): one
 * permission-scoped page for Mine / My Departments / Company (admins, F4).
 * The scope wears the section sidebar like every other section; category
 * and time-range presets are in-page controls over the API's from/to
 * dates; the CSV export button (admin only) is the ISO 9001 evidence
 * surface from the go-live checklist. Read-only over the immutable trail.
 */

const RANGES = [
  { key: 'today', label: 'Today', days: 0 },
  { key: '7', label: 'Last 7 days', days: 6 },
  { key: '14', label: 'Last 14 days', days: 13 },
  { key: '28', label: 'Last 28 days', days: 27 },
];

const CATEGORIES = [
  { key: '', label: 'All categories' },
  { key: 'documents', label: 'Documents' },
  { key: 'workflow', label: 'Workflow' },
  { key: 'acknowledgment', label: 'Acknowledgment' },
  { key: 'membership', label: 'Membership' },
];

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export default function ActivityPage() {
  const { isAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  const scopeParam = searchParams.get('scope');
  const scope: ActivityScope =
    scopeParam === 'departments' || scopeParam === 'company' ? scopeParam : 'mine';

  const [category, setCategory] = useState('');
  const [rangeKey, setRangeKey] = useState('7');
  const [pageNumber, setPageNumber] = useState(0);
  const [page, setPage] = useState<AuditLogPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[1];
  const to = isoDate(new Date());
  const from = isoDate(new Date(Date.now() - range.days * 86400000));

  const load = useCallback(() => {
    setError(null);
    auditApi
      .list({ scope, category: category || undefined, from, to, page: pageNumber })
      .then(setPage)
      .catch((err: Error) => setError(err.message));
  }, [scope, category, from, to, pageNumber]);

  useEffect(load, [load]);
  useEffect(() => {
    setPageNumber(0);
  }, [scope, category, rangeKey]);

  return (
    <>
      <h1>Activity</h1>

      <div className="filters">
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Period
          <select value={rangeKey} onChange={(e) => setRangeKey(e.target.value)}>
            {RANGES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        {isAdmin && (
          <a className="dash-cta" href={auditApi.exportUrl({ scope, category: category || undefined, from, to })}>
            Export CSV
          </a>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <table className="data">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>What</th>
            <th>Department</th>
          </tr>
        </thead>
        <tbody>
          {(page?.content ?? []).map((entry) => (
            <tr key={entry.id}>
              <td className="muted">{new Date(entry.performedAt).toLocaleString()}</td>
              <td>{entry.actorName}</td>
              <td>
                <ActivitySentence entry={entry} />
              </td>
              <td>
                {entry.departmentCode ? (
                  <span className="badge dept">{entry.departmentCode}</span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))}
          {page && page.content.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No activity in this view.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {page && page.totalPages > 0 && (
        <div className="pagination">
          <button type="button" disabled={page.page === 0} onClick={() => setPageNumber(page.page - 1)}>
            ← Prev
          </button>
          <span>
            Page {page.page + 1} of {page.totalPages} ({page.totalElements} entries)
          </span>
          <button
            type="button"
            disabled={page.page + 1 >= page.totalPages}
            onClick={() => setPageNumber(page.page + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </>
  );
}
