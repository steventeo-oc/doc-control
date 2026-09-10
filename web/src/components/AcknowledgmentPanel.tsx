import { FormEvent, useCallback, useEffect, useState } from 'react';
import { acknowledgmentApi, userApi } from '../api/resources';
import type { AcknowledgmentStatus, UserRow } from '../api/types';
import { ApiError } from '../api/client';

/**
 * Read & understood acknowledgment (Phase 2d) — record-only. Department
 * members acknowledge the current effective version; status is visible to
 * the owner, admins, and users granted access (per-document, per-user
 * grants). The whole panel stays hidden for viewers without status access
 * (the API decides — a 403 here simply means "not for you").
 */
export default function AcknowledgmentPanel(props: {
  documentId: number;
  documentStatus: string;
  canManage: boolean;
}) {
  const [status, setStatus] = useState<AcknowledgmentStatus | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [grantUserId, setGrantUserId] = useState<number | ''>('');
  const [accessRefresh, setAccessRefresh] = useState(0);

  const load = useCallback(() => {
    acknowledgmentApi
      .status(props.documentId)
      .then(setStatus)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 403) {
          setHidden(true);
        } else {
          setError((err as Error).message);
        }
      });
  }, [props.documentId]);

  useEffect(load, [load]);

  useEffect(() => {
    // admin-only endpoint — grant management falls back to a user id for
    // non-admin owners who cannot enumerate users
    if (props.canManage && users === null) {
      userApi
        .list()
        .then(setUsers)
        .catch(() => setUsers([]));
    }
  }, [props.canManage, users]);

  async function handleAcknowledge() {
    setError(null);
    setNotice(null);
    try {
      await acknowledgmentApi.acknowledge(props.documentId);
      setNotice('Acknowledgment recorded — thank you.');
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function handleGrant(event: FormEvent) {
    event.preventDefault();
    if (grantUserId === '') {
      return;
    }
    setError(null);
    acknowledgmentApi
      .grant(props.documentId, grantUserId)
      .then(() => {
        setNotice('Status access granted.');
        setGrantUserId('');
        setAccessRefresh((n) => n + 1);
      })
      .catch((err: Error) => setError(err.message));
  }

  if (hidden) {
    return null;
  }

  return (
    <div className="card">
      <h2>Acknowledgment</h2>
      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="success-banner">{notice}</div>}
      {status && (
        <>
          <p className="muted">
            {status.versionNumber !== null ? (
              <>
                Version {status.versionNumber}
                {status.opensAt && <> — window {status.opensAt} to {status.closesAt}</>}
                {status.overdue && <span className="badge overdue"> overdue</span>}
                {' '}· record-only: nothing is blocked by a missing acknowledgment.
              </>
            ) : (
              'Nothing in effect to acknowledge yet.'
            )}
          </p>
          {props.documentStatus === 'released' && (
            <p>
              <button type="button" className="primary" onClick={() => void handleAcknowledge()}>
                I have read and understood this document
              </button>
            </p>
          )}
          <div className="ack-columns">
            <div>
              <h3>Acknowledged ({status.acknowledged.length})</h3>
              <ul>
                {status.acknowledged.map((record) => (
                  <li key={record.id}>
                    {record.userName}{' '}
                    <span className="muted">
                      {new Date(record.acknowledgedAt).toLocaleString()}
                    </span>
                  </li>
                ))}
                {status.acknowledged.length === 0 && <li className="muted">Nobody yet.</li>}
              </ul>
            </div>
            <div>
              <h3>Outstanding ({status.outstanding.length})</h3>
              <ul>
                {status.outstanding.map((member) => (
                  <li key={member.userId}>{member.userName}</li>
                ))}
                {status.outstanding.length === 0 && <li className="muted">Everybody is caught up.</li>}
              </ul>
            </div>
          </div>
          {props.canManage && (
            <div>
              <h3>Status access</h3>
              <ul>
                <AccessList documentId={props.documentId} refreshKey={accessRefresh} />
              </ul>
              <form className="inline" onSubmit={handleGrant}>
                {users && users.length > 0 ? (
                  <label>
                    User
                    <select
                      value={grantUserId}
                      onChange={(e) => setGrantUserId(Number(e.target.value))}
                      required
                    >
                      <option value="" disabled>
                        Choose a user…
                      </option>
                      {users.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name} ({candidate.email})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label>
                    User id
                    <input
                      type="number"
                      value={grantUserId}
                      onChange={(e) => setGrantUserId(Number(e.target.value))}
                      required
                    />
                  </label>
                )}
                <button type="submit">Grant status access</button>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AccessList(props: { documentId: number; refreshKey: number }) {
  const [access, setAccess] = useState<{ userId: number; userName: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    acknowledgmentApi
      .listAccess(props.documentId)
      .then(setAccess)
      .catch(() => setAccess([]));
  }, [props.documentId]);

  // reloads on mount, after a revoke (internal), and after a grant (the
  // refreshKey bumps)
  useEffect(load, [load, props.refreshKey]);

  function revoke(userId: number) {
    setError(null);
    acknowledgmentApi
      .revoke(props.documentId, userId)
      .then(() => load())
      .catch((err: Error) => setError(err.message));
  }

  if (error) {
    return <li className="error-banner">{error}</li>;
  }
  if (!access) {
    return <li className="muted">Loading…</li>;
  }
  if (access.length === 0) {
    return <li className="muted">Only the owner and admins (default).</li>;
  }
  return (
    <>
      {access.map((grant) => (
        <li key={grant.userId}>
          {grant.userName}{' '}
          <button type="button" onClick={() => void revoke(grant.userId)}>
            Revoke
          </button>
        </li>
      ))}
    </>
  );
}
