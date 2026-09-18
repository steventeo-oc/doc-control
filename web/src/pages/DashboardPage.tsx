import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileCheck2,
  FileText,
  Folder,
  Inbox,
  Loader2,
  Plus,
  Sparkles,
} from 'lucide-react';
import { acknowledgmentApi, auditApi, documentApi, lookupApi, workflowApi } from '../api/resources';
import { activityCategory } from '../api/activitySummary';
import type {
  AuditLogEntry,
  AuditLogPage,
  Department,
  DepartmentMembership,
  DocumentsPage,
  DocumentSummary,
  PendingAcknowledgment,
  WorkflowTask,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import ActivitySentence from '../components/ActivitySentence';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge, type StatusBadgeKind } from '../components/StatusBadge';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';

/** Local-date ISO string n days back (0 = today) — the activity presets. */
function isoDaysAgo(days: number): string {
  const date = new Date(Date.now() - days * 86400000);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The dashboard greeting is computed in Singapore time specifically
 * (Asia/Singapore, fixed UTC+8 — this app's users are in Singapore and
 * Malaysia, and a misconfigured device clock must not produce a wrong
 * greeting), never the browser's local timezone. hourCycle h23 sidesteps
 * en-US's "24" reading of midnight.
 */
function sgtGreeting(now: Date): string {
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Singapore',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(now),
    10,
  );
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function sgtDateString(now: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
}

function formatActivityTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch {
    return isoString;
  }
}

type CombinedTaskRow =
  | { kind: 'approval'; key: string; deadlineMs: number; rawDueDate: string | null; task: WorkflowTask }
  | { kind: 'acknowledgment'; key: string; deadlineMs: number; rawDueDate: string | null; entry: PendingAcknowledgment };

const CATEGORY_BADGE_CLASSES: Record<string, string> = {
  blue: 'bg-info/15 text-info border-transparent',
  purple: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 border-transparent',
  emerald: 'bg-success/15 text-success border-transparent',
  amber: 'bg-warning/15 text-warning border-transparent',
  slate: 'bg-muted text-muted-foreground border-transparent',
};

export default function DashboardPage() {
  const { user, isAdmin } = useAuth();
  const now = new Date();

  const [tasks, setTasks] = useState<WorkflowTask[] | null>(null);
  const [pendingAcks, setPendingAcks] = useState<PendingAcknowledgment[] | null>(null);
  const [myDocs, setMyDocs] = useState<DocumentsPage | null>(null);
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [activityPage, setActivityPage] = useState<AuditLogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);

    const pTasks = workflowApi.myTasks().catch((err: Error) => {
      console.error('Failed to load workflow tasks', err);
      return [] as WorkflowTask[];
    });
    const pAcks = acknowledgmentApi.pending().catch((err: Error) => {
      console.error('Failed to load pending acknowledgments', err);
      return [] as PendingAcknowledgment[];
    });
    const pDocs = documentApi.list({ owner: 'me', page: 0, pageSize: 6 }).catch((err: Error) => {
      console.error('Failed to load my documents', err);
      return null;
    });
    const pDepts = isAdmin
      ? lookupApi.departments(true).catch((err: Error) => {
          console.error('Failed to load departments', err);
          return [] as Department[];
        })
      : Promise.resolve((user?.departments ?? []) as Department[]);
    const pAudit = auditApi
      .list({
        scope: 'mine',
        from: isoDaysAgo(6),
        to: isoDaysAgo(0),
        pageSize: 6,
      })
      .catch((err: Error) => {
        console.error('Failed to load recent activity', err);
        return null;
      });

    Promise.all([pTasks, pAcks, pDocs, pDepts, pAudit])
      .then(([t, a, d, depts, act]) => {
        if (!active) return;
        setTasks(t);
        setPendingAcks(a);
        setMyDocs(d);
        setDepartments(depts);
        setActivityPage(act);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message || 'Failed to load dashboard data.');
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isAdmin, user]);

  // Derived counts and urgency calculations
  const startOfToday = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const overdueApprovalsCount = useMemo(() => {
    if (!tasks) return 0;
    return tasks.filter((t) => t.dueDate && new Date(t.dueDate) < startOfToday).length;
  }, [tasks, startOfToday]);

  const overdueAcksCount = useMemo(() => {
    if (!pendingAcks) return 0;
    return pendingAcks.filter((a) => a.overdue).length;
  }, [pendingAcks]);

  const totalTasksCount = (tasks?.length ?? 0) + (pendingAcks?.length ?? 0);

  // Combined urgent tasks list sorted soonest due first
  const combinedTasks: CombinedTaskRow[] = useMemo(() => {
    const rows: CombinedTaskRow[] = [
      ...(tasks ?? []).map((t) => ({
        kind: 'approval' as const,
        key: `appr-${t.id}`,
        deadlineMs: t.dueDate ? new Date(t.dueDate).getTime() : Infinity,
        rawDueDate: t.dueDate,
        task: t,
      })),
      ...(pendingAcks ?? []).map((a) => ({
        kind: 'acknowledgment' as const,
        key: `ack-${a.documentId}`,
        deadlineMs: a.windowClosesAt ? new Date(a.windowClosesAt).getTime() : Infinity,
        rawDueDate: a.windowClosesAt,
        entry: a,
      })),
    ];
    return rows.sort((a, b) => a.deadlineMs - b.deadlineMs);
  }, [tasks, pendingAcks]);

  return (
    <div className="space-y-6 pb-12">
      {/* Dashboard Top Header & Quick Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/40 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {sgtGreeting(now)}, {user?.name || 'User'}
            </h1>
            {isAdmin && (
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs font-semibold">
                Admin
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:text-sm">
            <Clock className="size-3.5 text-muted-foreground/70" />
            <span>{sgtDateString(now)} (SGT · UTC+8)</span>
            <span className="text-border">•</span>
            <span>Document Control & Compliance Center</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Button variant="outline" size="sm" asChild className="h-9 gap-1.5 shadow-xs">
            <Link to="/tasks?view=approvals">
              <Inbox className="size-4" />
              <span>Tasks</span>
              {totalTasksCount > 0 && (
                <span className="ml-1 rounded-full bg-primary/15 px-2 py-0.2 text-xs font-semibold text-primary">
                  {totalTasksCount}
                </span>
              )}
            </Link>
          </Button>
          <Button size="sm" asChild className="h-9 gap-1.5 shadow-xs">
            <Link to="/documents?create=1">
              <Plus className="size-4" />
              <span>New Document</span>
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* KPI Metrics Executive Banner */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* KPI 1: Approvals */}
        <Card className="relative overflow-hidden rounded-2xl border border-border/40 bg-card shadow-xs transition-shadow hover:shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-sm font-medium text-muted-foreground">Pending Approvals</span>
            <span className="flex size-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Clock className="size-4.5" />
            </span>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <div className="text-3xl font-bold tracking-tight text-foreground">
                {tasks !== null ? tasks.length : <Loader2 className="size-6 animate-spin text-muted-foreground" />}
              </div>
              {overdueApprovalsCount > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-destructive/15 px-2 py-0.5 text-xs font-semibold text-destructive border border-destructive/30">
                  <AlertTriangle className="size-3" />
                  {overdueApprovalsCount} overdue
                </span>
              ) : tasks && tasks.length > 0 ? (
                <span className="inline-flex items-center rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400 border border-amber-500/30">
                  Needs review
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-3" /> Caught up
                </span>
              )}
            </div>
            <Link
              to="/tasks?view=approvals"
              className="flex items-center justify-between pt-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground border-t border-border/30"
            >
              <span>Go to approvals</span>
              <ArrowRight className="size-3.5" />
            </Link>
          </CardContent>
        </Card>

        {/* KPI 2: Acknowledgments */}
        <Card className="relative overflow-hidden rounded-2xl border border-border/40 bg-card shadow-xs transition-shadow hover:shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-sm font-medium text-muted-foreground">Pending Acknowledgments</span>
            <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <FileCheck2 className="size-4.5" />
            </span>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <div className="text-3xl font-bold tracking-tight text-foreground">
                {pendingAcks !== null ? pendingAcks.length : <Loader2 className="size-6 animate-spin text-muted-foreground" />}
              </div>
              {overdueAcksCount > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-destructive/15 px-2 py-0.5 text-xs font-semibold text-destructive border border-destructive/30">
                  <AlertTriangle className="size-3" />
                  {overdueAcksCount} overdue
                </span>
              ) : pendingAcks && pendingAcks.length > 0 ? (
                <span className="inline-flex items-center rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                  Sign required
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-3" /> All signed
                </span>
              )}
            </div>
            <Link
              to="/tasks?view=acknowledgments"
              className="flex items-center justify-between pt-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground border-t border-border/30"
            >
              <span>Review & sign</span>
              <ArrowRight className="size-3.5" />
            </Link>
          </CardContent>
        </Card>

        {/* KPI 3: My Documents */}
        <Card className="relative overflow-hidden rounded-2xl border border-border/40 bg-card shadow-xs transition-shadow hover:shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-sm font-medium text-muted-foreground">My Controlled Documents</span>
            <span className="flex size-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <FileText className="size-4.5" />
            </span>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <div className="text-3xl font-bold tracking-tight text-foreground">
                {myDocs !== null ? myDocs.totalElements : <Loader2 className="size-6 animate-spin text-muted-foreground" />}
              </div>
              <span className="text-xs font-medium text-muted-foreground">Authored by you</span>
            </div>
            <Link
              to="/documents?view=mine"
              className="flex items-center justify-between pt-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground border-t border-border/30"
            >
              <span>Browse documents</span>
              <ArrowRight className="size-3.5" />
            </Link>
          </CardContent>
        </Card>

        {/* KPI 4: My Departments */}
        <Card className="relative overflow-hidden rounded-2xl border border-border/40 bg-card shadow-xs transition-shadow hover:shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-sm font-medium text-muted-foreground">Department Scopes</span>
            <span className="flex size-9 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400">
              <Building2 className="size-4.5" />
            </span>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <div className="text-3xl font-bold tracking-tight text-foreground">
                {departments !== null ? departments.length : <Loader2 className="size-6 animate-spin text-muted-foreground" />}
              </div>
              <span className="text-xs font-medium text-muted-foreground">
                {isAdmin ? 'System-wide scope' : 'Active units'}
              </span>
            </div>
            <Link
              to="/departments"
              className="flex items-center justify-between pt-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground border-t border-border/30"
            >
              <span>View departments</span>
              <ArrowRight className="size-3.5" />
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid: 2 Columns */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        {/* Left Column: Urgent Tasks & My Documents (7 cols) */}
        <div className="space-y-6 lg:col-span-7">
          {/* Dashlet 1: Urgent Action Queue */}
          <Card className="rounded-2xl border border-border/40 bg-card shadow-xs overflow-hidden">
            <CardHeader className="border-b border-border/30 bg-muted/20 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <Inbox className="size-4.5" />
                  </span>
                  <div>
                    <CardTitle className="text-base font-semibold">Action Center</CardTitle>
                    <CardDescription className="text-xs">
                      Approvals & acknowledgments prioritized by deadline
                    </CardDescription>
                  </div>
                </div>
                {totalTasksCount > 0 && (
                  <Badge variant="secondary" className="font-semibold text-xs">
                    {totalTasksCount} pending
                  </Badge>
                )}
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {loading && !tasks && !pendingAcks ? (
                <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" /> Loading tasks…
                </div>
              ) : combinedTasks.length === 0 ? (
                <div className="py-12">
                  <EmptyState
                    icon={CheckCircle2}
                    message="You're all caught up! No pending approvals or acknowledgments on your desk."
                  />
                </div>
              ) : (
                <div className="divide-y divide-border/30">
                  {combinedTasks.slice(0, 6).map((row) => {
                    const isApproval = row.kind === 'approval';
                    const docId = isApproval ? row.task.documentId : row.entry.documentId;
                    const docNum = isApproval ? row.task.documentNumber : row.entry.documentNumber;
                    const docTitle = isApproval ? row.task.name : row.entry.name;
                    const deptCode = isApproval ? row.task.departmentCode : row.entry.departmentCode;
                    const verNum = isApproval ? row.task.versionNumber : row.entry.versionNumber;
                    const isReapproval = isApproval ? row.task.reapproval : false;

                    // Due date calculations
                    const rawDue = row.rawDueDate;
                    let dueBadge = null;
                    if (rawDue) {
                      const due = new Date(rawDue);
                      const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
                      const diffDays = Math.ceil((dueDay.getTime() - startOfToday.getTime()) / (1000 * 60 * 60 * 24));
                      if (diffDays < 0) {
                        dueBadge = (
                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold bg-destructive/15 text-destructive border border-destructive/30">
                            Overdue ({Math.abs(diffDays)}d)
                          </span>
                        );
                      } else if (diffDays <= 2) {
                        dueBadge = (
                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                            {diffDays === 0 ? 'Due today' : diffDays === 1 ? 'Due tomorrow' : 'Due in 2d'}
                          </span>
                        );
                      } else {
                        dueBadge = (
                          <span className="text-xs text-muted-foreground">
                            {due.toLocaleDateString()}
                          </span>
                        );
                      }
                    }

                    return (
                      <div
                        key={row.key}
                        className="flex flex-col gap-2 p-4 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="space-y-1.5 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {isApproval ? (
                              <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-transparent text-[11px] font-semibold">
                                Approval
                              </Badge>
                            ) : (
                              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-transparent text-[11px] font-semibold">
                                Acknowledgment
                              </Badge>
                            )}
                            <Link
                              to={`/documents/${docId}`}
                              className="font-medium text-foreground hover:text-primary hover:underline text-sm truncate"
                            >
                              {docNum} — {docTitle}
                            </Link>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {deptCode && <Badge variant="outline" className="text-[11px] py-0 px-1.5">{deptCode}</Badge>}
                            <Badge variant="outline" className="text-[11px] py-0 px-1.5">v{verNum}</Badge>
                            {isReapproval && (
                              <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border-transparent text-[11px] py-0 px-1.5">
                                re-approval
                              </Badge>
                            )}
                            {dueBadge}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                          {isApproval ? (
                            <Button size="sm" variant="outline" asChild className="h-8 gap-1 text-xs hover:border-primary/50 hover:bg-primary/5">
                              <Link to="/tasks?view=approvals">
                                <span>Review</span>
                                <ChevronRight className="size-3.5" />
                              </Link>
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" asChild className="h-8 gap-1 text-xs text-emerald-700 dark:text-emerald-400 hover:border-emerald-500/50 hover:bg-emerald-500/5">
                              <Link to="/tasks?view=acknowledgments">
                                <span>Sign</span>
                                <ChevronRight className="size-3.5" />
                              </Link>
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="border-t border-border/30 bg-muted/10 p-3 text-center">
                <Link
                  to="/tasks?view=approvals"
                  className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
                >
                  <span>Open full task inbox</span>
                  {totalTasksCount > 0 && <span>({totalTasksCount})</span>}
                  <ArrowRight className="size-3" />
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Dashlet 2: My Controlled Documents with Tiers */}
          <Card className="rounded-2xl border border-border/40 bg-card shadow-xs overflow-hidden">
            <CardHeader className="border-b border-border/30 bg-muted/20 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    <FileText className="size-4.5" />
                  </span>
                  <div>
                    <CardTitle className="text-base font-semibold">My Controlled Documents</CardTitle>
                    <CardDescription className="text-xs">
                      Recently authored or owned documents with classification tiers
                    </CardDescription>
                  </div>
                </div>
                <Button size="sm" variant="outline" asChild className="h-8 gap-1 text-xs">
                  <Link to="/documents?create=1">
                    <Plus className="size-3.5" /> New
                  </Link>
                </Button>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {loading && !myDocs ? (
                <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" /> Loading documents…
                </div>
              ) : !myDocs || myDocs.content.length === 0 ? (
                <div className="py-12">
                  <EmptyState
                    icon={Folder}
                    message="You haven't authored any documents yet."
                    cta={
                      <Button asChild size="sm" className="mt-2">
                        <Link to="/documents?create=1">+ New document</Link>
                      </Button>
                    }
                  />
                </div>
              ) : (
                <div className="divide-y divide-border/30">
                  {myDocs.content.map((doc: DocumentSummary) => (
                    <div
                      key={doc.id}
                      className="flex flex-col gap-2 p-4 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to={`/documents/${doc.id}`}
                            className="font-medium text-foreground hover:text-primary hover:underline text-sm truncate"
                          >
                            {doc.documentNumber} — {doc.name}
                          </Link>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          {/* Tier Badge */}
                          {doc.tierNumber ? (
                            <Badge
                              variant="outline"
                              className="font-semibold text-[11px] py-0 px-1.5 whitespace-nowrap bg-background"
                              title={doc.tierLabel ?? undefined}
                            >
                              Tier {doc.tierNumber}
                            </Badge>
                          ) : null}

                          {/* Document Type */}
                          {doc.documentTypeCode && (
                            <Badge variant="outline" className="text-[11px] py-0 px-1.5 font-medium bg-background">
                              {doc.documentTypeCode}
                            </Badge>
                          )}

                          {/* Department */}
                          {doc.departmentCode && (
                            <Badge variant="outline" className="text-[11px] py-0 px-1.5 bg-background">
                              {doc.departmentCode}
                            </Badge>
                          )}

                          {/* Lifecycle / Revision Status */}
                          {doc.revisionStatus === 'IN_REVIEW' ? (
                            <span className="inline-flex items-center rounded-md px-1.5 py-0 text-[11px] font-semibold bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-500/30 whitespace-nowrap">
                              v{doc.revisionVersionNumber} in review
                            </span>
                          ) : doc.revisionStatus === 'DRAFT' ? (
                            <span className="inline-flex items-center rounded-md px-1.5 py-0 text-[11px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 whitespace-nowrap">
                              v{doc.revisionVersionNumber} draft
                            </span>
                          ) : doc.revisionStatus === 'RE_APPROVAL' ? (
                            <span className="inline-flex items-center rounded-md px-1.5 py-0 text-[11px] font-semibold bg-purple-500/15 text-purple-700 dark:text-purple-400 border border-purple-500/30 whitespace-nowrap">
                              re-approval
                            </span>
                          ) : (
                            <StatusBadge status={doc.status as StatusBadgeKind} className="text-[11px] py-0 px-1.5">
                              {doc.status}
                            </StatusBadge>
                          )}

                          {/* Periodic Review Due / Overdue */}
                          {doc.reviewOverdue && (
                            <span className="inline-flex items-center rounded px-1.5 py-0 text-[11px] font-semibold bg-destructive/15 text-destructive border border-destructive/30">
                              Review Overdue
                            </span>
                          )}
                        </div>
                      </div>

                      <Button
                        size="sm"
                        variant="ghost"
                        asChild
                        className="size-8 p-0 text-muted-foreground hover:text-foreground shrink-0 self-end sm:self-center"
                      >
                        <Link to={`/documents/${doc.id}`} aria-label={`Open ${doc.documentNumber}`}>
                          <ChevronRight className="size-4" />
                        </Link>
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="border-t border-border/30 bg-muted/10 p-3 text-center">
                <Link
                  to="/documents?view=mine"
                  className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
                >
                  <span>Browse all my documents</span>
                  {myDocs && <span>({myDocs.totalElements})</span>}
                  <ArrowRight className="size-3" />
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Departments & Recent Activity (5 cols) */}
        <div className="space-y-6 lg:col-span-5">
          {/* Dashlet 3: My Departments */}
          <Card className="rounded-2xl border border-border/40 bg-card shadow-xs overflow-hidden">
            <CardHeader className="border-b border-border/30 bg-muted/20 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400">
                    <Building2 className="size-4.5" />
                  </span>
                  <div>
                    <CardTitle className="text-base font-semibold">My Departments</CardTitle>
                    <CardDescription className="text-xs">
                      Assigned departments and role authorization
                    </CardDescription>
                  </div>
                </div>
                {departments && (
                  <Badge variant="secondary" className="font-semibold text-xs">
                    {departments.length}
                  </Badge>
                )}
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {loading && !departments ? (
                <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" /> Loading departments…
                </div>
              ) : !departments || departments.length === 0 ? (
                <div className="py-12">
                  <EmptyState icon={Building2} message="You are not assigned to any departments." />
                </div>
              ) : (
                <div className="divide-y divide-border/30">
                  {departments.slice(0, 6).map((dept) => {
                    const membership = user?.departments?.find((m: DepartmentMembership) => m.id === dept.id);
                    const memberLevel = membership?.level;

                    return (
                      <div
                        key={dept.id}
                        className="flex items-center justify-between p-4 transition-colors hover:bg-muted/30"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <Link
                              to={`/departments/${dept.id}`}
                              className="font-medium text-foreground hover:text-primary hover:underline text-sm truncate"
                            >
                              {dept.code} — {dept.label}
                            </Link>
                            {!dept.active && (
                              <span className="text-xs text-muted-foreground/70">(inactive)</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {memberLevel === 'MANAGER' ? (
                              <Badge className="bg-purple-500/15 text-purple-700 dark:text-purple-400 border-transparent text-[11px] font-semibold">
                                Manager
                              </Badge>
                            ) : memberLevel === 'COLLABORATOR' ? (
                              <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-transparent text-[11px] font-semibold">
                                Collaborator
                              </Badge>
                            ) : memberLevel === 'CONTRIBUTOR' ? (
                              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-transparent text-[11px] font-semibold">
                                Contributor
                              </Badge>
                            ) : memberLevel === 'CONSUMER' ? (
                              <Badge className="bg-slate-500/15 text-slate-700 dark:text-slate-400 border-transparent text-[11px] font-semibold">
                                Consumer
                              </Badge>
                            ) : isAdmin ? (
                              <Badge variant="outline" className="bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20 text-[11px] font-semibold">
                                Admin Access
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[11px]">Member</Badge>
                            )}
                          </div>
                        </div>

                        <Button
                          size="sm"
                          variant="ghost"
                          asChild
                          className="size-8 p-0 text-muted-foreground hover:text-foreground shrink-0"
                        >
                          <Link to={`/departments/${dept.id}`} aria-label={`Open ${dept.code}`}>
                            <ChevronRight className="size-4" />
                          </Link>
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="border-t border-border/30 bg-muted/10 p-3 text-center">
                <Link
                  to="/departments"
                  className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
                >
                  <span>View all departments</span>
                  <ArrowRight className="size-3" />
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Dashlet 4: Recent Activity */}
          <Card className="rounded-2xl border border-border/40 bg-card shadow-xs overflow-hidden">
            <CardHeader className="border-b border-border/30 bg-muted/20 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400">
                    <Sparkles className="size-4.5" />
                  </span>
                  <div>
                    <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
                    <CardDescription className="text-xs">
                      Audit trail of actions taken in the last 7 days
                    </CardDescription>
                  </div>
                </div>
                {activityPage && (
                  <Badge variant="secondary" className="font-semibold text-xs">
                    {activityPage.totalElements} events
                  </Badge>
                )}
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {loading && !activityPage ? (
                <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" /> Loading activity…
                </div>
              ) : !activityPage || activityPage.content.length === 0 ? (
                <div className="py-12">
                  <EmptyState icon={Inbox} message="No recent activity logged in the past 7 days." />
                </div>
              ) : (
                <div className="divide-y divide-border/30">
                  {activityPage.content.slice(0, 6).map((entry: AuditLogEntry) => {
                    const cat = activityCategory(entry);
                    const colorClass = CATEGORY_BADGE_CLASSES[cat.color] ?? CATEGORY_BADGE_CLASSES.slate;

                    return (
                      <div key={entry.id} className="p-4 transition-colors hover:bg-muted/30 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge className={`text-[11px] font-semibold py-0 px-2 ${colorClass}`}>
                              {cat.label}
                            </Badge>
                            {entry.departmentCode && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1 text-muted-foreground">
                                {entry.departmentCode}
                              </Badge>
                            )}
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            {formatActivityTime(entry.performedAt)}
                          </span>
                        </div>
                        <div className="text-sm leading-relaxed text-foreground">
                          <ActivitySentence entry={entry} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="border-t border-border/30 bg-muted/10 p-3 text-center">
                <Link
                  to="/activity?scope=mine"
                  className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
                >
                  <span>View full activity log</span>
                  <ArrowRight className="size-3" />
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
