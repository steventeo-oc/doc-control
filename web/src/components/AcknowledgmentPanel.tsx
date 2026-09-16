import { FormEvent, useCallback, useEffect, useState } from 'react';
import { acknowledgmentApi, userApi } from '../api/resources';
import type { AcknowledgmentStatus, UserRow } from '../api/types';
import { ApiError } from '../api/client';
import { StatusBadge } from './StatusBadge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

/**
 * Read & understood acknowledgment (Phase 2d) — record-only. Department
 * members acknowledge the current effective version; status is visible to
 * the owner, admins, and users granted access (per-document, per-user
 * grants). The whole panel stays hidden for viewers without status access
 * (the API decides — a 403 here simply means "not for you").
 *
 * Design-redesign Phase 2b (F5 — migrates with its first host page,
 * DocumentDetailPage): reskinned onto Card/StatusBadge/Button/Label/
 * Input/Select with the shared banner and list-row patterns. Behavior
 * unchanged, including the grant picker's two paths: a Select when the
 * admin-only user list loaded, a plain number Input for non-admin owners
 * who cannot enumerate users.
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
  // Radix Select works in strings — converted to a number for the request.
  const [grantUserId, setGrantUserId] = useState('');
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
      .grant(props.documentId, Number(grantUserId))
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
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base font-semibold">Acknowledgment</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}
        {notice && (
          <div className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">{notice}</div>
        )}
        {status && (
          <>
            <p className="text-sm text-muted-foreground">
              {status.versionNumber !== null ? (
                <>
                  Version {status.versionNumber}
                  {status.opensAt && <> — window {status.opensAt} to {status.closesAt}</>}
                  {status.overdue && <StatusBadge status="overdue">overdue</StatusBadge>}
                  {' '}· record-only: nothing is blocked by a missing acknowledgment.
                </>
              ) : (
                'Nothing in effect to acknowledge yet.'
              )}
            </p>
            {props.documentStatus === 'released' && (
              <div>
                <Button type="button" onClick={() => void handleAcknowledge()}>
                  I have read and understood this document
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-8">
              <div className="min-w-[240px] flex-1">
                <h3 className="text-sm font-semibold">Acknowledged ({status.acknowledged.length})</h3>
                <ul className="mt-1 flex flex-col">
                  {status.acknowledged.map((record) => (
                    <li key={record.id} className="border-b border-border py-1.5 text-sm">
                      {record.userName}{' '}
                      <span className="text-muted-foreground">
                        {new Date(record.acknowledgedAt).toLocaleString()}
                      </span>
                    </li>
                  ))}
                  {status.acknowledged.length === 0 && (
                    <li className="py-1.5 text-sm text-muted-foreground">Nobody yet.</li>
                  )}
                </ul>
              </div>
              <div className="min-w-[240px] flex-1">
                <h3 className="text-sm font-semibold">Outstanding ({status.outstanding.length})</h3>
                <ul className="mt-1 flex flex-col">
                  {status.outstanding.map((member) => (
                    <li key={member.userId} className="border-b border-border py-1.5 text-sm">
                      {member.userName}
                    </li>
                  ))}
                  {status.outstanding.length === 0 && (
                    <li className="py-1.5 text-sm text-muted-foreground">Everybody is caught up.</li>
                  )}
                </ul>
              </div>
            </div>
            {props.canManage && (
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">Status access</h3>
                <ul className="flex flex-col">
                  <AccessList documentId={props.documentId} refreshKey={accessRefresh} />
                </ul>
                <form className="flex flex-wrap items-end gap-3" onSubmit={handleGrant}>
                  {users && users.length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="ack-grant-user">User</Label>
                      <Select value={grantUserId} onValueChange={setGrantUserId} required>
                        <SelectTrigger id="ack-grant-user" className="w-64">
                          <SelectValue placeholder="Choose a user…" />
                        </SelectTrigger>
                        <SelectContent>
                          {users.map((candidate) => (
                            <SelectItem key={candidate.id} value={String(candidate.id)}>
                              {candidate.name} ({candidate.email})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="ack-grant-userid">User id</Label>
                      <Input
                        id="ack-grant-userid"
                        type="number"
                        value={grantUserId}
                        onChange={(e) => setGrantUserId(e.target.value)}
                        required
                        className="w-32"
                      />
                    </div>
                  )}
                  <Button type="submit">Grant status access</Button>
                </form>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
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
    return <li className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</li>;
  }
  if (!access) {
    return <li className="py-1.5 text-sm text-muted-foreground">Loading…</li>;
  }
  if (access.length === 0) {
    return <li className="py-1.5 text-sm text-muted-foreground">Only the owner and admins (default).</li>;
  }
  return (
    <>
      {access.map((grant) => (
        <li
          key={grant.userId}
          className="flex items-center justify-between gap-3 border-b border-border py-1.5 text-sm"
        >
          {grant.userName}{' '}
          <Button type="button" variant="outline" size="sm" onClick={() => void revoke(grant.userId)}>
            Revoke
          </Button>
        </li>
      ))}
    </>
  );
}
