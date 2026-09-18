import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  FileCheck2,
  FileText,
  Folder,
  GripVertical,
  Inbox,
  Loader2,
  Plus,
  RotateCcw,
  SlidersHorizontal,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { cn } from '../lib/utils';

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

export type WidgetId = 'tasks' | 'documents' | 'departments' | 'activity';

export interface UserDashboardLayout {
  /** 3 columns: Column 0 (Left), Column 1 (Middle), Column 2 (Right) */
  columns: [WidgetId[], WidgetId[], WidgetId[]];
  hidden: WidgetId[];
}

const DEFAULT_DASHBOARD_LAYOUT: UserDashboardLayout = {
  columns: [
    ['tasks'],
    ['documents'],
    ['departments', 'activity'],
  ],
  hidden: [],
};

const WIDGET_TITLES: Record<WidgetId, string> = {
  tasks: 'Action Center',
  documents: 'My Controlled Documents',
  departments: 'My Departments',
  activity: 'Recent Activity',
};

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

  // Storage key scoped to user.id
  const storageKey = useMemo(
    () => (user ? `doccontrol_dashboard_layout_${user.id}` : 'doccontrol_dashboard_layout_guest'),
    [user?.id],
  );

  // Customization & Layout state
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [layout, setLayout] = useState<UserDashboardLayout>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.columns) && parsed.columns.length === 3) {
          return parsed as UserDashboardLayout;
        }
      }
    } catch (e) {
      console.error('Failed to load dashboard layout from storage', e);
    }
    return DEFAULT_DASHBOARD_LAYOUT;
  });

  // Drag & drop state
  const [draggedWidget, setDraggedWidget] = useState<WidgetId | null>(null);
  const [dragOverCol, setDragOverCol] = useState<number | null>(null);
  const [dragOverWidget, setDragOverWidget] = useState<WidgetId | null>(null);

  // Load layout on user switch
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.columns) && parsed.columns.length === 3) {
          setLayout(parsed);
          return;
        }
      }
    } catch (e) {
      console.error('Failed to load user dashboard layout', e);
    }
    setLayout(DEFAULT_DASHBOARD_LAYOUT);
  }, [storageKey]);

  const saveLayout = useCallback(
    (newLayout: UserDashboardLayout) => {
      setLayout(newLayout);
      try {
        localStorage.setItem(storageKey, JSON.stringify(newLayout));
      } catch (e) {
        console.error('Failed to save dashboard layout', e);
      }
    },
    [storageKey],
  );

  const resetLayout = useCallback(() => {
    saveLayout(DEFAULT_DASHBOARD_LAYOUT);
  }, [saveLayout]);

  const moveWidget = useCallback(
    (widgetId: WidgetId, targetCol: number, targetIndex?: number) => {
      const newCols: [WidgetId[], WidgetId[], WidgetId[]] = [
        layout.columns[0].filter((id) => id !== widgetId),
        layout.columns[1].filter((id) => id !== widgetId),
        layout.columns[2].filter((id) => id !== widgetId),
      ];

      if (targetIndex !== undefined && targetIndex >= 0) {
        newCols[targetCol].splice(targetIndex, 0, widgetId);
      } else {
        newCols[targetCol].push(widgetId);
      }

      saveLayout({
        ...layout,
        columns: newCols,
        hidden: layout.hidden.filter((id) => id !== widgetId),
      });
    },
    [layout, saveLayout],
  );

  const moveWidgetDirection = useCallback(
    (widgetId: WidgetId, direction: 'left' | 'right' | 'up' | 'down') => {
      let currentCol = -1;
      let currentIndex = -1;
      for (let c = 0; c < 3; c++) {
        const idx = layout.columns[c].indexOf(widgetId);
        if (idx !== -1) {
          currentCol = c;
          currentIndex = idx;
          break;
        }
      }
      if (currentCol === -1) return;

      if (direction === 'left' && currentCol > 0) {
        moveWidget(widgetId, currentCol - 1);
      } else if (direction === 'right' && currentCol < 2) {
        moveWidget(widgetId, currentCol + 1);
      } else if (direction === 'up' && currentIndex > 0) {
        const newCol = [...layout.columns[currentCol]];
        const temp = newCol[currentIndex - 1];
        newCol[currentIndex - 1] = widgetId;
        newCol[currentIndex] = temp;
        const newCols: [WidgetId[], WidgetId[], WidgetId[]] = [
          currentCol === 0 ? newCol : layout.columns[0],
          currentCol === 1 ? newCol : layout.columns[1],
          currentCol === 2 ? newCol : layout.columns[2],
        ];
        saveLayout({ ...layout, columns: newCols });
      } else if (direction === 'down' && currentIndex < layout.columns[currentCol].length - 1) {
        const newCol = [...layout.columns[currentCol]];
        const temp = newCol[currentIndex + 1];
        newCol[currentIndex + 1] = widgetId;
        newCol[currentIndex] = temp;
        const newCols: [WidgetId[], WidgetId[], WidgetId[]] = [
          currentCol === 0 ? newCol : layout.columns[0],
          currentCol === 1 ? newCol : layout.columns[1],
          currentCol === 2 ? newCol : layout.columns[2],
        ];
        saveLayout({ ...layout, columns: newCols });
      }
    },
    [layout, moveWidget, saveLayout],
  );

  const hideWidget = useCallback(
    (widgetId: WidgetId) => {
      const newCols: [WidgetId[], WidgetId[], WidgetId[]] = [
        layout.columns[0].filter((id) => id !== widgetId),
        layout.columns[1].filter((id) => id !== widgetId),
        layout.columns[2].filter((id) => id !== widgetId),
      ];
      saveLayout({
        columns: newCols,
        hidden: Array.from(new Set([...layout.hidden, widgetId])),
      });
    },
    [layout, saveLayout],
  );

  const restoreWidget = useCallback(
    (widgetId: WidgetId) => {
      let shortestCol = 0;
      let minLen = layout.columns[0].length;
      for (let c = 1; c < 3; c++) {
        if (layout.columns[c].length < minLen) {
          minLen = layout.columns[c].length;
          shortestCol = c;
        }
      }
      moveWidget(widgetId, shortestCol);
    },
    [layout, moveWidget],
  );

  // Data fetching
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
    const pDocs = documentApi.list({ owner: 'me', page: 0, pageSize: 8 }).catch((err: Error) => {
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
        pageSize: 8,
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

  // Render sub-components for individual widgets
  function renderTasksCard() {
    return (
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
              {combinedTasks.slice(0, 8).map((row) => {
                const isApproval = row.kind === 'approval';
                const docId = isApproval ? row.task.documentId : row.entry.documentId;
                const docNum = isApproval ? row.task.documentNumber : row.entry.documentNumber;
                const docTitle = isApproval ? row.task.name : row.entry.name;
                const deptCode = isApproval ? row.task.departmentCode : row.entry.departmentCode;
                const verNum = isApproval ? row.task.versionNumber : row.entry.versionNumber;
                const isReapproval = isApproval ? row.task.reapproval : false;

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
    );
  }

  function renderDocumentsCard() {
    return (
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
              {myDocs.content.slice(0, 8).map((doc: DocumentSummary) => (
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
                      {doc.tierNumber ? (
                        <Badge
                          variant="outline"
                          className="font-semibold text-[11px] py-0 px-1.5 whitespace-nowrap bg-background"
                          title={doc.tierLabel ?? undefined}
                        >
                          Tier {doc.tierNumber}
                        </Badge>
                      ) : null}

                      {doc.documentTypeCode && (
                        <Badge variant="outline" className="text-[11px] py-0 px-1.5 font-medium bg-background">
                          {doc.documentTypeCode}
                        </Badge>
                      )}

                      {doc.departmentCode && (
                        <Badge variant="outline" className="text-[11px] py-0 px-1.5 bg-background">
                          {doc.departmentCode}
                        </Badge>
                      )}

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
    );
  }

  function renderDepartmentsCard() {
    return (
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
    );
  }

  function renderActivityCard() {
    return (
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
    );
  }

  function renderWidget(id: WidgetId) {
    switch (id) {
      case 'tasks':
        return renderTasksCard();
      case 'documents':
        return renderDocumentsCard();
      case 'departments':
        return renderDepartmentsCard();
      case 'activity':
        return renderActivityCard();
      default:
        return null;
    }
  }

  return (
    <div className="space-y-6 pb-12 w-full">
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
            {isCustomizing && (
              <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 text-xs font-semibold animate-pulse">
                Customize Mode
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

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Customization controls */}
          {isCustomizing ? (
            <div className="flex items-center gap-2">
              {layout.hidden.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-9 gap-1.5 shadow-xs">
                      <Eye className="size-4" />
                      <span>Hidden ({layout.hidden.length})</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {layout.hidden.map((id) => (
                      <DropdownMenuItem key={id} onClick={() => restoreWidget(id)}>
                        <Plus className="size-3.5 mr-2" />
                        <span>Show {WIDGET_TITLES[id]}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={resetLayout}
                className="h-9 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                title="Reset to default 3-column layout"
              >
                <RotateCcw className="size-3.5" />
                <span className="hidden sm:inline">Reset Defaults</span>
              </Button>

              <Button
                size="sm"
                onClick={() => setIsCustomizing(false)}
                className="h-9 gap-1.5 shadow-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Check className="size-4" />
                <span>Done</span>
              </Button>
            </div>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsCustomizing(true)}
                className="h-9 gap-1.5 shadow-xs"
                title="Personalize and rearrange dashboard cards"
              >
                <SlidersHorizontal className="size-4" />
                <span>Customize</span>
              </Button>

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
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* KPI Metrics Executive Banner */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 w-full">
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

      {/* Main Content Grid: 3-Column Command Center with Dynamic User-Defined Columns */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-12 items-start w-full">
        {/* Column 0: Left Column (default xl:col-span-5) */}
        <div
          className={cn(
            'lg:col-span-1 xl:col-span-5 space-y-6 transition-colors rounded-2xl min-h-[140px]',
            isCustomizing && 'p-2.5 border-2 border-dashed border-border/60 bg-muted/15',
            dragOverCol === 0 && 'border-primary/60 bg-primary/5 ring-2 ring-primary/20',
          )}
          onDragEnter={(e) => {
            if (isCustomizing) {
              e.preventDefault();
              setDragOverCol(0);
            }
          }}
          onDragOver={(e) => {
            if (isCustomizing) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setDragOverCol(null);
          }}
          onDrop={(e) => {
            if (!isCustomizing) return;
            e.preventDefault();
            const wId = (e.dataTransfer.getData('text/plain') as WidgetId) || draggedWidget;
            if (wId) moveWidget(wId, 0);
            setDragOverCol(null);
            setDragOverWidget(null);
          }}
        >
          {layout.columns[0].length === 0 && isCustomizing && (
            <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-border/60 text-xs font-medium text-muted-foreground">
              Drop card here (Column 1)
            </div>
          )}
          {layout.columns[0].map((widgetId, idx) => (
            <DraggableCardWrapper
              key={widgetId}
              widgetId={widgetId}
              colIndex={0}
              itemIndex={idx}
              totalInCol={layout.columns[0].length}
              isCustomizing={isCustomizing}
              onMoveDirection={moveWidgetDirection}
              onHide={hideWidget}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', widgetId);
                e.dataTransfer.effectAllowed = 'move';
                setTimeout(() => {
                  setDraggedWidget(widgetId);
                }, 0);
              }}
              onDragEnd={() => {
                setDraggedWidget(null);
                setDragOverCol(null);
                setDragOverWidget(null);
              }}
              onDragEnter={(e) => {
                if (isCustomizing) {
                  e.preventDefault();
                  e.stopPropagation();
                  if (draggedWidget && draggedWidget !== widgetId) {
                    setDragOverWidget(widgetId);
                  }
                }
              }}
              onDragOver={(e) => {
                if (isCustomizing) {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'move';
                }
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                if (dragOverWidget === widgetId) {
                  setDragOverWidget(null);
                }
              }}
              onDrop={(e) => {
                if (!isCustomizing) return;
                e.preventDefault();
                e.stopPropagation();
                const wId = (e.dataTransfer.getData('text/plain') as WidgetId) || draggedWidget;
                if (wId && wId !== widgetId) {
                  moveWidget(wId, 0, idx);
                }
                setDragOverWidget(null);
                setDragOverCol(null);
              }}
              isDragOver={dragOverWidget === widgetId}
              isDragging={draggedWidget === widgetId}
            >
              {renderWidget(widgetId)}
            </DraggableCardWrapper>
          ))}
        </div>

        {/* Column 1: Middle Column (default xl:col-span-4) */}
        <div
          className={cn(
            'lg:col-span-1 xl:col-span-4 space-y-6 transition-colors rounded-2xl min-h-[140px]',
            isCustomizing && 'p-2.5 border-2 border-dashed border-border/60 bg-muted/15',
            dragOverCol === 1 && 'border-primary/60 bg-primary/5 ring-2 ring-primary/20',
          )}
          onDragEnter={(e) => {
            if (isCustomizing) {
              e.preventDefault();
              setDragOverCol(1);
            }
          }}
          onDragOver={(e) => {
            if (isCustomizing) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setDragOverCol(null);
          }}
          onDrop={(e) => {
            if (!isCustomizing) return;
            e.preventDefault();
            const wId = (e.dataTransfer.getData('text/plain') as WidgetId) || draggedWidget;
            if (wId) moveWidget(wId, 1);
            setDragOverCol(null);
            setDragOverWidget(null);
          }}
        >
          {layout.columns[1].length === 0 && isCustomizing && (
            <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-border/60 text-xs font-medium text-muted-foreground">
              Drop card here (Column 2)
            </div>
          )}
          {layout.columns[1].map((widgetId, idx) => (
            <DraggableCardWrapper
              key={widgetId}
              widgetId={widgetId}
              colIndex={1}
              itemIndex={idx}
              totalInCol={layout.columns[1].length}
              isCustomizing={isCustomizing}
              onMoveDirection={moveWidgetDirection}
              onHide={hideWidget}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', widgetId);
                e.dataTransfer.effectAllowed = 'move';
                setTimeout(() => {
                  setDraggedWidget(widgetId);
                }, 0);
              }}
              onDragEnd={() => {
                setDraggedWidget(null);
                setDragOverCol(null);
                setDragOverWidget(null);
              }}
              onDragEnter={(e) => {
                if (isCustomizing) {
                  e.preventDefault();
                  e.stopPropagation();
                  if (draggedWidget && draggedWidget !== widgetId) {
                    setDragOverWidget(widgetId);
                  }
                }
              }}
              onDragOver={(e) => {
                if (isCustomizing) {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'move';
                }
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                if (dragOverWidget === widgetId) {
                  setDragOverWidget(null);
                }
              }}
              onDrop={(e) => {
                if (!isCustomizing) return;
                e.preventDefault();
                e.stopPropagation();
                const wId = (e.dataTransfer.getData('text/plain') as WidgetId) || draggedWidget;
                if (wId && wId !== widgetId) {
                  moveWidget(wId, 1, idx);
                }
                setDragOverWidget(null);
                setDragOverCol(null);
              }}
              isDragOver={dragOverWidget === widgetId}
              isDragging={draggedWidget === widgetId}
            >
              {renderWidget(widgetId)}
            </DraggableCardWrapper>
          ))}
        </div>

        {/* Column 2: Right Column (default xl:col-span-3) */}
        <div
          className={cn(
            'lg:col-span-2 xl:col-span-3 space-y-6 transition-colors rounded-2xl min-h-[140px]',
            isCustomizing && 'p-2.5 border-2 border-dashed border-border/60 bg-muted/15',
            dragOverCol === 2 && 'border-primary/60 bg-primary/5 ring-2 ring-primary/20',
          )}
          onDragEnter={(e) => {
            if (isCustomizing) {
              e.preventDefault();
              setDragOverCol(2);
            }
          }}
          onDragOver={(e) => {
            if (isCustomizing) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setDragOverCol(null);
          }}
          onDrop={(e) => {
            if (!isCustomizing) return;
            e.preventDefault();
            const wId = (e.dataTransfer.getData('text/plain') as WidgetId) || draggedWidget;
            if (wId) moveWidget(wId, 2);
            setDragOverCol(null);
            setDragOverWidget(null);
          }}
        >
          {layout.columns[2].length === 0 && isCustomizing && (
            <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-border/60 text-xs font-medium text-muted-foreground">
              Drop card here (Column 3)
            </div>
          )}
          {layout.columns[2].map((widgetId, idx) => (
            <DraggableCardWrapper
              key={widgetId}
              widgetId={widgetId}
              colIndex={2}
              itemIndex={idx}
              totalInCol={layout.columns[2].length}
              isCustomizing={isCustomizing}
              onMoveDirection={moveWidgetDirection}
              onHide={hideWidget}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', widgetId);
                e.dataTransfer.effectAllowed = 'move';
                setTimeout(() => {
                  setDraggedWidget(widgetId);
                }, 0);
              }}
              onDragEnd={() => {
                setDraggedWidget(null);
                setDragOverCol(null);
                setDragOverWidget(null);
              }}
              onDragEnter={(e) => {
                if (isCustomizing) {
                  e.preventDefault();
                  e.stopPropagation();
                  if (draggedWidget && draggedWidget !== widgetId) {
                    setDragOverWidget(widgetId);
                  }
                }
              }}
              onDragOver={(e) => {
                if (isCustomizing) {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'move';
                }
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                if (dragOverWidget === widgetId) {
                  setDragOverWidget(null);
                }
              }}
              onDrop={(e) => {
                if (!isCustomizing) return;
                e.preventDefault();
                e.stopPropagation();
                const wId = (e.dataTransfer.getData('text/plain') as WidgetId) || draggedWidget;
                if (wId && wId !== widgetId) {
                  moveWidget(wId, 2, idx);
                }
                setDragOverWidget(null);
                setDragOverCol(null);
              }}
              isDragOver={dragOverWidget === widgetId}
              isDragging={draggedWidget === widgetId}
            >
              {renderWidget(widgetId)}
            </DraggableCardWrapper>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * DraggableCardWrapper provides drag handles, move direction buttons,
 * and visibility toggle toolbars when customizing the dashboard.
 */
function DraggableCardWrapper(props: {
  widgetId: WidgetId;
  colIndex: number;
  itemIndex: number;
  totalInCol: number;
  isCustomizing: boolean;
  isDragOver?: boolean;
  isDragging?: boolean;
  onMoveDirection: (widgetId: WidgetId, dir: 'left' | 'right' | 'up' | 'down') => void;
  onHide: (widgetId: WidgetId) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  children: React.ReactNode;
}) {
  const {
    widgetId,
    colIndex,
    itemIndex,
    totalInCol,
    isCustomizing,
    isDragOver,
    isDragging,
    onMoveDirection,
    onHide,
    onDragStart,
    onDragEnd,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    children,
  } = props;

  return (
    <div
      draggable={isCustomizing}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'group/card relative',
        isCustomizing &&
          'rounded-2xl p-1.5 ring-1 ring-border/70 bg-card/60 shadow-xs hover:ring-primary/40 select-none cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-40 ring-2 ring-primary/40',
        isDragOver && 'ring-2 ring-primary bg-primary/5',
      )}
    >
      {isCustomizing && (
        <div className="mb-2 flex items-center justify-between rounded-xl bg-muted/80 px-3 py-1.5 text-xs text-muted-foreground border border-border/40 backdrop-blur-xs select-none">
          <div className="flex items-center gap-1.5 text-foreground/80 hover:text-foreground">
            <GripVertical className="size-4 text-muted-foreground/80" />
            <span className="font-semibold text-[11px] uppercase tracking-wider text-foreground">
              {WIDGET_TITLES[widgetId]}
            </span>
          </div>

          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={colIndex === 0}
              onClick={() => onMoveDirection(widgetId, 'left')}
              className="size-7 p-0 hover:bg-accent"
              title="Move card to left column"
            >
              <ArrowLeft className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={itemIndex === 0}
              onClick={() => onMoveDirection(widgetId, 'up')}
              className="size-7 p-0 hover:bg-accent"
              title="Move card up"
            >
              <ArrowUp className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={itemIndex === totalInCol - 1}
              onClick={() => onMoveDirection(widgetId, 'down')}
              className="size-7 p-0 hover:bg-accent"
              title="Move card down"
            >
              <ArrowDown className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={colIndex === 2}
              onClick={() => onMoveDirection(widgetId, 'right')}
              className="size-7 p-0 hover:bg-accent"
              title="Move card to right column"
            >
              <ArrowRight className="size-3.5" />
            </Button>
            <div className="mx-1 h-3 w-px bg-border/60" />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onHide(widgetId)}
              className="size-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              title="Hide this card from dashboard"
            >
              <EyeOff className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
