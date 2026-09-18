import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Search } from 'lucide-react';
import { acknowledgmentApi, userApi } from '../api/resources';
import type { AcknowledgmentStatus, UserRow } from '../api/types';
import { ApiError } from '../api/client';
import { cn } from '../lib/utils';
import { useAuth } from '../auth/AuthContext';
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
  const { user } = useAuth();
  const [status, setStatus] = useState<AcknowledgmentStatus | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [users, setUsers] = useState<UserRow[] | null>(null);
  // Radix Select works in strings — converted to a number for the request.
  const [grantUserId, setGrantUserId] = useState('');
  const [accessRefresh, setAccessRefresh] = useState(0);
  const [ackFilter, setAckFilter] = useState<'all' | 'outstanding' | 'acknowledged'>('all');
  const [ackSearch, setAckSearch] = useState('');

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
            {(() => {
              const myAck = status.acknowledged.find((a) => a.userId === user?.id);
              const isOutstanding = status.outstanding.some((o) => o.userId === user?.id);

              if (myAck) {
                return (
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                      <span>
                        You acknowledged version {status.versionNumber} on {new Date(myAck.acknowledgedAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                );
              }

              if (props.documentStatus === 'released' && isOutstanding) {
                return (
                  <div>
                    <Button type="button" onClick={() => void handleAcknowledge()}>
                      I have read and understood this document
                    </Button>
                  </div>
                );
              }

              return null;
            })()}
            {/* Progress Gauge */}
            {(() => {
              const ackCount = status.acknowledged.length;
              const outCount = status.outstanding.length;
              const totalCount = ackCount + outCount;
              const percent = totalCount > 0 ? Math.round((ackCount / totalCount) * 100) : 0;

              const allMembers = [
                ...status.acknowledged.map((a) => ({
                  id: `ack-${a.id}`,
                  name: a.userName,
                  status: 'acknowledged' as const,
                  at: a.acknowledgedAt,
                })),
                ...status.outstanding.map((o) => ({
                  id: `out-${o.userId}`,
                  name: o.userName,
                  status: 'outstanding' as const,
                  at: null,
                })),
              ];

              const filteredMembers = allMembers.filter((m) => {
                if (ackFilter === 'acknowledged' && m.status !== 'acknowledged') return false;
                if (ackFilter === 'outstanding' && m.status !== 'outstanding') return false;
                if (ackSearch.trim() && !m.name.toLowerCase().includes(ackSearch.toLowerCase().trim())) {
                  return false;
                }
                return true;
              });

              return (
                <div className="flex flex-col gap-3">
                  {totalCount > 0 && (
                    <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/30 p-3.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-foreground">Sign-off Progress</span>
                        <span className="font-semibold text-foreground">
                          {ackCount} of {totalCount} acknowledged ({percent}%)
                        </span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            'h-full transition-all duration-300',
                            percent === 100
                              ? 'bg-emerald-500'
                              : percent >= 50
                              ? 'bg-primary'
                              : 'bg-amber-500'
                          )}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <div className="flex items-center gap-4 pt-0.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <span className="size-2 rounded-full bg-emerald-500" />
                          Acknowledged: {ackCount}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="size-2 rounded-full bg-amber-500" />
                          Outstanding: {outCount}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Filter & Search Bar */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
                      <button
                        type="button"
                        onClick={() => setAckFilter('all')}
                        className={cn(
                          'rounded-md px-2.5 py-1 font-medium transition-colors',
                          ackFilter === 'all'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        All ({totalCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setAckFilter('outstanding')}
                        className={cn(
                          'rounded-md px-2.5 py-1 font-medium transition-colors',
                          ackFilter === 'outstanding'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        Outstanding ({outCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setAckFilter('acknowledged')}
                        className={cn(
                          'rounded-md px-2.5 py-1 font-medium transition-colors',
                          ackFilter === 'acknowledged'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        Acknowledged ({ackCount})
                      </button>
                    </div>

                    <div className="relative w-full sm:w-64">
                      <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search member..."
                        value={ackSearch}
                        onChange={(e) => setAckSearch(e.target.value)}
                        className="h-8 pl-8 text-xs"
                      />
                    </div>
                  </div>

                  {/* Constrained Scrollable List */}
                  <div className="max-h-64 overflow-y-auto rounded-md border border-border divide-y divide-border bg-background">
                    {filteredMembers.length > 0 ? (
                      filteredMembers.map((m) => (
                        <div key={m.id} className="flex items-center justify-between px-3 py-2 text-sm">
                          <span className="font-medium text-foreground">{m.name}</span>
                          {m.status === 'acknowledged' ? (
                            <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="size-3.5" />
                              <span>Acknowledged</span>
                              {m.at && (
                                <span className="ml-1 text-muted-foreground">
                                  ({new Date(m.at).toLocaleDateString()})
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                              <Clock className="size-3.5" />
                              <span>Pending</span>
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="py-6 text-center text-xs text-muted-foreground">
                        {ackSearch.trim()
                          ? 'No department members match your search.'
                          : totalCount === 0
                          ? 'No members in this department yet.'
                          : ackFilter === 'outstanding'
                          ? 'Everybody is caught up!'
                          : 'Nobody has acknowledged yet.'}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
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
