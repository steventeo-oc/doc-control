import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Building2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Plus,
  Search,
  Star,
  Users,
  X,
} from 'lucide-react';
import { documentApi, lookupApi } from '../api/resources';
import type {
  AuditLogPage,
  Department,
  DocumentNumberPreview,
  DocumentSummary,
  DocumentTier,
  DocumentType,
  DocumentsPage as PageResult,
} from '../api/types';
import { DOCUMENT_STATUSES } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import ActivitySentence from '../components/ActivitySentence';
import DepartmentMembersPanel from '../components/DepartmentMembersPanel';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge, type StatusBadgeKind } from '../components/StatusBadge';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { cn } from '../lib/utils';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

export default function DepartmentDetailPage() {
  const { id } = useParams();
  const departmentId = Number(id);
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const [department, setDepartment] = useState<Department | null>(null);
  const [resolved, setResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<'documents' | 'members' | 'activity'>('documents');

  // Documents state
  const [docs, setDocs] = useState<PageResult | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [docSearch, setDocSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [tierFilter, setTierFilter] = useState('ALL');
  const [tiers, setTiers] = useState<DocumentTier[]>([]);
  const [sortField, setSortField] = useState<'number' | 'name' | 'status' | 'updated'>('updated');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  // Department activity feed state
  const [actPage, setActPage] = useState(0);
  const [activityData, setActivityData] = useState<AuditLogPage | null>(null);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  // In-place document creation state
  const [createOpen, setCreateOpen] = useState(false);
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [numberPreview, setNumberPreview] = useState<DocumentNumberPreview | null>(null);
  const [loadingNumber, setLoadingNumber] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const membership = user?.departments.find((d) => d.id === departmentId);
  const canManage = isAdmin || membership?.level === 'MANAGER';
  const canCreateHere = isAdmin || (!!membership && membership.level !== 'CONSUMER');

  // Load Department Metadata
  const loadDepartment = useCallback(() => {
    setError(null);
    lookupApi
      .getDepartment(departmentId)
      .then((dept) => {
        setDepartment(dept);
        setResolved(true);
      })
      .catch((err: Error) => {
        // Fallback to cached session membership if available
        if (membership) {
          setDepartment(membership);
        } else {
          setError(err.message);
        }
        setResolved(true);
      });
  }, [departmentId, membership]);

  useEffect(() => {
    loadDepartment();
  }, [loadDepartment]);

  // Load Document Types and Tiers
  useEffect(() => {
    lookupApi.types(true).then(setTypes).catch(() => undefined);
    lookupApi.tiers(true).then(setTiers).catch(() => undefined);
  }, []);

  // Calculate Next Document Number Preview
  useEffect(() => {
    if (!selectedTypeId || !department) {
      setNumberPreview(null);
      return;
    }
    setLoadingNumber(true);
    let active = true;
    documentApi
      .previewNextNumber(selectedTypeId, department.id)
      .then((res) => {
        if (active) setNumberPreview(res);
      })
      .catch(() => {
        if (active) setNumberPreview(null);
      })
      .finally(() => {
        if (active) setLoadingNumber(false);
      });
    return () => {
      active = false;
    };
  }, [selectedTypeId, department]);

  // Load Documents with Filters, Sorting & Pagination
  const loadDocuments = useCallback(() => {
    if (!department) return;
    setLoadingDocs(true);
    documentApi
      .list({
        department: department.code,
        tier: tierFilter !== 'ALL' ? Number(tierFilter) : undefined,
        type: typeFilter !== 'ALL' ? typeFilter : undefined,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
        q: docSearch.trim() || undefined,
        sort: `${sortField},${sortOrder}`,
        page,
        pageSize,
      })
      .then(setDocs)
      .catch(() => setDocs(null))
      .finally(() => setLoadingDocs(false));
  }, [department, docSearch, statusFilter, typeFilter, tierFilter, sortField, sortOrder, page, pageSize]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Load Activity Log
  const loadActivity = useCallback(() => {
    if (!department) return;
    setLoadingActivity(true);
    setActivityError(null);
    lookupApi
      .departmentActivity(department.id, { page: actPage, pageSize: 15 })
      .then(setActivityData)
      .catch((err: Error) => setActivityError(err.message))
      .finally(() => setLoadingActivity(false));
  }, [department, actPage]);

  useEffect(() => {
    if (activeTab === 'activity') {
      loadActivity();
    }
  }, [activeTab, loadActivity]);

  // Sorting Handler
  function handleSort(field: 'number' | 'name' | 'status' | 'updated') {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder(field === 'updated' ? 'desc' : 'asc');
    }
    setPage(0);
  }

  // Clear Filters Handler
  const hasActiveFilters = Boolean(
    docSearch.trim() || statusFilter !== 'ALL' || typeFilter !== 'ALL' || tierFilter !== 'ALL'
  );

  function handleClearFilters() {
    setDocSearch('');
    setStatusFilter('ALL');
    setTypeFilter('ALL');
    setTierFilter('ALL');
    setPage(0);
  }

  // Favorite Star Toggle Handler
  async function handleToggleFavorite(doc: DocumentSummary) {
    const nextVal = !doc.isFavorite;
    setDocs((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        content: prev.content.map((d) => (d.id === doc.id ? { ...d, isFavorite: nextVal } : d)),
      };
    });
    try {
      if (nextVal) {
        await documentApi.favorite(doc.id);
      } else {
        await documentApi.unfavorite(doc.id);
      }
    } catch {
      setDocs((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          content: prev.content.map((d) => (d.id === doc.id ? { ...d, isFavorite: !nextVal } : d)),
        };
      });
    }
  }

  // Reset page to 0 when search or filter changes
  function handleSearchChange(val: string) {
    setDocSearch(val);
    setPage(0);
  }

  function handleStatusChange(val: string) {
    setStatusFilter(val);
    setPage(0);
  }

  function handleTypeChange(val: string) {
    setTypeFilter(val);
    setPage(0);
  }

  function handleTierChange(val: string) {
    setTierFilter(val);
    setPage(0);
  }

  function openCreateModal() {
    setCreateError(null);
    setSelectedTypeId(null);
    setNumberPreview(null);
    setCreateOpen(true);
  }

  function handleCreateDocument(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedTypeId || !department) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    if (!name) return;
    const file =
      data.get('file') instanceof File && (data.get('file') as File).size > 0
        ? (data.get('file') as File)
        : null;

    setCreating(true);
    setCreateError(null);
    documentApi
      .create(selectedTypeId, department.id, name, file)
      .then((created) => {
        setCreateOpen(false);
        navigate(`/departments/${department.id}/documents/${created.id}`);
      })
      .catch((err: Error) => setCreateError(err.message))
      .finally(() => setCreating(false));
  }

  if (!resolved) {
    return (
      <div className="py-12 text-center text-xs text-muted-foreground">
        Loading department details…
      </div>
    );
  }

  if (!department) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild className="gap-1 text-xs text-muted-foreground">
          <Link to="/departments">
            <ArrowLeft className="size-3.5" />
            <span>All Departments</span>
          </Link>
        </Button>
        <Card className="p-8 text-center rounded-2xl border-border/40">
          <EmptyState
            icon={Building2}
            message={error || 'Department not found or you are not a member.'}
          />
        </Card>
      </div>
    );
  }

  const totalPages = docs?.totalPages ?? 0;
  const selectedType = types.find((t) => t.id === selectedTypeId);

  let previewDisplayNumber = '—';
  let previewHelperText = 'Select a document type to preview the next allocated document number.';

  if (selectedTypeId && department) {
    if (numberPreview?.nextDocumentNumber) {
      previewDisplayNumber = numberPreview.nextDocumentNumber;
      if (numberPreview.currentLatestDocumentNumber) {
        previewHelperText = `Current latest: ${numberPreview.currentLatestDocumentNumber} · Next allocated: ${numberPreview.nextDocumentNumber}`;
      } else {
        previewHelperText = `First document for ${selectedType?.code ?? ''}-${department.code} · Allocated: ${numberPreview.nextDocumentNumber}`;
      }
    } else {
      previewDisplayNumber = selectedType ? `${selectedType.code}-${department.code}-????` : '—';
      previewHelperText = 'Calculating next document number…';
    }
  }

  return (
    <div className="space-y-6">
      {/* Back Navigation & Page Header */}
      <div className="space-y-2">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="h-7 -ml-2 gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Link to="/departments">
            <ArrowLeft className="size-3.5" />
            <span>All Departments</span>
          </Link>
        </Button>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                <span className="font-mono text-primary">{department.code}</span> — {department.label}
              </h1>
              {department.active ? (
                <Badge
                  variant="outline"
                  className="border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px] font-medium"
                >
                  Active
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-border/40 bg-muted/50 text-muted-foreground text-[10px] font-medium"
                >
                  Inactive
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {membership && (
                <span>
                  Your role: <strong className="text-foreground">{membership.level}</strong> ·{' '}
                </span>
              )}
              <span>{department.documentCount ?? docs?.totalElements ?? 0} document(s)</span>
            </p>
          </div>

          {canCreateHere && (
            <Button
              size="sm"
              className="gap-1.5 rounded-xl shadow-xs self-start sm:self-auto"
              onClick={openCreateModal}
            >
              <Plus className="size-4" />
              <span>New Document</span>
            </Button>
          )}
        </div>
      </div>

      {/* KPI Metric Stat Cards (Total Documents & Department Members) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Card 1: Total Documents */}
        <Card className="rounded-2xl border border-border/40 bg-card p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Documents
            </span>
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileText className="size-4.5" />
            </span>
          </div>
          <div className="mt-2 space-y-1">
            <div className="text-3xl font-bold tracking-tight text-foreground">
              {department.documentCount ?? docs?.totalElements ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Controlled documents registered under {department.code}
            </p>
          </div>
        </Card>

        {/* Card 2: Department Members */}
        <Card className="rounded-2xl border border-border/40 bg-card p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Department Members
            </span>
            <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Users className="size-4.5" />
            </span>
          </div>
          <div className="mt-2 space-y-1">
            <div className="text-3xl font-bold tracking-tight text-foreground">
              {department.memberCount ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Assigned personnel & role authorization
            </p>
          </div>
        </Card>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-border/40 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('documents')}
          className={cn(
            'flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all',
            activeTab === 'documents'
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          )}
        >
          <FileText className="size-3.5" />
          <span>Documents</span>
          {docs && (
            <Badge
              variant="secondary"
              className={cn(
                'rounded-full text-[10px] px-1.5 py-0',
                activeTab === 'documents' && 'bg-primary-foreground/20 text-primary-foreground'
              )}
            >
              {docs.totalElements}
            </Badge>
          )}
        </button>

        {canManage && (
          <button
            type="button"
            onClick={() => setActiveTab('members')}
            className={cn(
              'flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all',
              activeTab === 'members'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
          >
            <Users className="size-3.5" />
            <span>Members & Roles</span>
            {department.memberCount !== null && department.memberCount !== undefined && (
              <Badge
                variant="secondary"
                className={cn(
                  'rounded-full text-[10px] px-1.5 py-0',
                  activeTab === 'members' && 'bg-primary-foreground/20 text-primary-foreground'
                )}
              >
                {department.memberCount}
              </Badge>
            )}
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveTab('activity')}
          className={cn(
            'flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all',
            activeTab === 'activity'
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          )}
        >
          <Activity className="size-3.5" />
          <span>Activity Feed</span>
          {activityData && (
            <Badge
              variant="secondary"
              className={cn(
                'rounded-full text-[10px] px-1.5 py-0',
                activeTab === 'activity' && 'bg-primary-foreground/20 text-primary-foreground'
              )}
            >
              {activityData.totalElements}
            </Badge>
          )}
        </button>
      </div>

      {/* Tab 1: Documents Section */}
      {activeTab === 'documents' && (
        <Card className="rounded-2xl border border-border/40 bg-card p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <span>Department Documents</span>
                {docs && (
                  <Badge variant="secondary" className="rounded-full text-[11px] px-2 py-0">
                    {docs.totalElements}
                  </Badge>
                )}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Controlled documents registered under {department.code}.
              </p>
            </div>

            {/* Search and Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-48 sm:w-56">
                <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search documents…"
                  value={docSearch}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-8 text-xs h-8 rounded-lg border-border/40"
                />
              </div>
              <Select value={tierFilter} onValueChange={handleTierChange}>
                <SelectTrigger className="h-8 w-28 text-xs rounded-lg border-border/40">
                  <SelectValue placeholder="Tier" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border/40 shadow-xl">
                  <SelectItem value="ALL" className="text-xs">
                    All Tiers
                  </SelectItem>
                  {tiers.map((t) => (
                    <SelectItem key={t.id} value={String(t.tierNumber)} className="text-xs">
                      Tier {t.tierNumber} ({t.label})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={handleTypeChange}>
                <SelectTrigger className="h-8 w-32 text-xs rounded-lg border-border/40">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border/40 shadow-xl">
                  <SelectItem value="ALL" className="text-xs">
                    All Types
                  </SelectItem>
                  {types.map((t) => (
                    <SelectItem key={t.id} value={t.code} className="text-xs">
                      {t.code}
                      {!t.active && ' (inactive)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={handleStatusChange}>
                <SelectTrigger className="h-8 w-32 text-xs rounded-lg border-border/40">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border/40 shadow-xl">
                  <SelectItem value="ALL" className="text-xs">
                    All Statuses
                  </SelectItem>
                  {DOCUMENT_STATUSES.map((st) => (
                    <SelectItem key={st} value={st} className="text-xs">
                      {st.replace('_', ' ').toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasActiveFilters && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClearFilters}
                  className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                  <span>Clear filters</span>
                </Button>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border/40 bg-card p-0 shadow-xs overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border/40 hover:bg-transparent">
                  <TableHead className="w-9 px-2" />
                  <TableHead
                    className="w-36 text-xs font-semibold cursor-pointer select-none hover:text-foreground"
                    onClick={() => handleSort('number')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Number</span>
                      {sortField === 'number' ? (
                        sortOrder === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
                      ) : (
                        <ArrowUpDown className="size-3 text-muted-foreground/40" />
                      )}
                    </div>
                  </TableHead>
                  <TableHead
                    className="min-w-[220px] text-xs font-semibold cursor-pointer select-none hover:text-foreground"
                    onClick={() => handleSort('name')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Title</span>
                      {sortField === 'name' ? (
                        sortOrder === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
                      ) : (
                        <ArrowUpDown className="size-3 text-muted-foreground/40" />
                      )}
                    </div>
                  </TableHead>
                  <TableHead
                    className="w-28 text-xs font-semibold cursor-pointer select-none hover:text-foreground"
                    onClick={() => handleSort('status')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Status</span>
                      {sortField === 'status' ? (
                        sortOrder === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
                      ) : (
                        <ArrowUpDown className="size-3 text-muted-foreground/40" />
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="w-28 text-xs font-semibold">Progress</TableHead>
                  <TableHead className="w-20 text-xs font-semibold">Tier</TableHead>
                  <TableHead className="w-20 text-xs font-semibold">Type</TableHead>
                  <TableHead className="w-28 text-xs font-semibold">Owner</TableHead>
                  <TableHead
                    className="w-32 text-right text-xs font-semibold cursor-pointer select-none hover:text-foreground"
                    onClick={() => handleSort('updated')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Updated</span>
                      {sortField === 'updated' ? (
                        sortOrder === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
                      ) : (
                        <ArrowUpDown className="size-3 text-muted-foreground/40" />
                      )}
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(docs?.content ?? []).map((doc) => (
                  <TableRow key={doc.id} className="border-border/30 hover:bg-muted/40 transition-colors">
                    <TableCell className="w-9 px-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          handleToggleFavorite(doc);
                        }}
                        className="p-1 rounded hover:bg-muted/80 transition-colors"
                        title={doc.isFavorite ? 'Remove from favorites' : 'Mark as favorite'}
                      >
                        <Star
                          className={cn(
                            'size-3.5 transition-colors',
                            doc.isFavorite
                              ? 'fill-amber-400 text-amber-400'
                              : 'text-muted-foreground/30 hover:text-amber-400'
                          )}
                        />
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-semibold">
                      <Link
                        to={`/departments/${department.id}/documents/${doc.id}`}
                        className="text-primary hover:underline"
                      >
                        {doc.documentNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs font-medium text-foreground">
                      {doc.name}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={doc.status as StatusBadgeKind}>
                        {doc.status}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>
                      {doc.revisionStatus === 'IN_REVIEW' && (
                        <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-500/30 whitespace-nowrap">
                          v{doc.revisionVersionNumber} in review
                        </span>
                      )}
                      {doc.revisionStatus === 'DRAFT' && (
                        <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 whitespace-nowrap">
                          v{doc.revisionVersionNumber} draft
                        </span>
                      )}
                      {doc.revisionStatus === 'RE_APPROVAL' && (
                        <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold bg-purple-500/15 text-purple-700 dark:text-purple-400 border border-purple-500/30 whitespace-nowrap">
                          re-approval
                        </span>
                      )}
                      {!doc.revisionStatus && (
                        <span className="text-muted-foreground/40 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {doc.tierNumber ? (
                        <Badge variant="outline" className="text-[11px] font-semibold whitespace-nowrap" title={doc.tierLabel ?? undefined}>
                          Tier {doc.tierNumber}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {doc.documentTypeCode || '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {doc.ownerName}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {new Date(doc.updatedAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </TableCell>
                  </TableRow>
                ))}

                {(docs?.content.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center">
                      <EmptyState
                        icon={FileText}
                        message={
                          hasActiveFilters
                            ? 'No documents match the specified filters.'
                            : 'No documents in this department yet.'
                        }
                        cta={
                          hasActiveFilters ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2 text-xs rounded-xl gap-1"
                              onClick={handleClearFilters}
                            >
                              <X className="size-3.5" />
                              <span>Clear all filters</span>
                            </Button>
                          ) : canCreateHere ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2 text-xs rounded-xl"
                              onClick={openCreateModal}
                            >
                              Create First Document
                            </Button>
                          ) : undefined
                        }
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Controls */}
          {docs && docs.totalElements > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2.5 text-xs rounded-lg gap-1"
                  disabled={page === 0 || loadingDocs}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="size-3.5" />
                  <span>Previous</span>
                </Button>
                <span className="text-xs text-muted-foreground px-1">
                  Page {page + 1} of {Math.max(1, totalPages)} ({docs.totalElements} documents)
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2.5 text-xs rounded-lg gap-1"
                  disabled={page >= totalPages - 1 || loadingDocs}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <span>Next</span>
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Rows per page:</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(val) => {
                    setPageSize(Number(val));
                    setPage(0);
                  }}
                >
                  <SelectTrigger className="h-8 w-20 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Tab 2: Members Panel (for Managers & Admins) */}
      {activeTab === 'members' && canManage && (
        <DepartmentMembersPanel
          departmentId={departmentId}
          departmentCode={department.code}
          onMemberChange={loadDepartment}
        />
      )}

      {/* Tab 3: Department Activity Feed */}
      {activeTab === 'activity' && (
        <Card className="rounded-2xl border border-border/40 bg-card p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <span>Department Activity Log</span>
                {activityData && (
                  <Badge variant="secondary" className="rounded-full text-[11px] px-2 py-0">
                    {activityData.totalElements}
                  </Badge>
                )}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Audit trail of document changes and actions in {department.code}.
              </p>
            </div>
          </div>

          {activityError && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs font-medium text-destructive">
              {activityError}
            </div>
          )}

          {loadingActivity && !activityData ? (
            <div className="py-10 text-center text-xs text-muted-foreground">
              Loading activity log…
            </div>
          ) : (activityData?.content.length ?? 0) === 0 ? (
            <div className="py-10 text-center">
              <EmptyState
                icon={Activity}
                message="No recent activity recorded for this department."
              />
            </div>
          ) : (
            <div className="rounded-xl border border-border/40 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/40 hover:bg-transparent">
                    <TableHead className="w-44 text-xs font-semibold">When</TableHead>
                    <TableHead className="w-48 text-xs font-semibold">User</TableHead>
                    <TableHead className="text-xs font-semibold">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activityData?.content.map((entry) => (
                    <TableRow key={entry.id} className="border-border/30 hover:bg-muted/40 transition-colors">
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {new Date(entry.performedAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs font-medium text-foreground">
                        <div>{entry.actorName}</div>
                        {entry.actorEmail && (
                          <div className="text-[11px] text-muted-foreground font-normal">
                            {entry.actorEmail}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-foreground">
                        <ActivitySentence entry={entry} departmentId={department.id} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Activity Pagination */}
          {activityData && activityData.totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <div className="text-xs text-muted-foreground">
                Showing page {actPage + 1} of {activityData.totalPages} ({activityData.totalElements} total)
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs rounded-lg gap-1"
                  disabled={actPage === 0 || loadingActivity}
                  onClick={() => setActPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="size-3.5" />
                  <span>Previous</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs rounded-lg gap-1"
                  disabled={actPage >= activityData.totalPages - 1 || loadingActivity}
                  onClick={() => setActPage((p) => p + 1)}
                >
                  <span>Next</span>
                  <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* In-Place Create Document Drawer / Sheet */}
      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg p-6 flex flex-col justify-between overflow-y-auto">
          <div>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <FileText className="size-5 text-primary" />
                <span>New Document</span>
              </SheetTitle>
              <SheetDescription className="text-xs text-muted-foreground">
                Create a new controlled document in department{' '}
                <strong className="font-semibold text-foreground">{department.code}</strong>.
              </SheetDescription>
            </SheetHeader>

            {createError && (
              <div className="mt-3 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs font-medium text-destructive">
                {createError}
              </div>
            )}

            <form id="create-doc-form" onSubmit={handleCreateDocument} className="space-y-4 mt-4">
              {/* Department (Fixed) */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Department</Label>
                <div className="rounded-xl border border-border/40 bg-muted/40 px-3 py-2 text-xs flex items-center justify-between">
                  <span className="font-medium text-foreground">
                    {department.label}
                  </span>
                  <Badge variant="outline" className="font-mono text-[10px] font-semibold bg-background">
                    {department.code}
                  </Badge>
                </div>
              </div>

              {/* Document Type */}
              <div className="space-y-1.5">
                <Label htmlFor="doc-type" className="text-xs font-semibold">
                  Document Type
                </Label>
                <Select
                  value={selectedTypeId ? String(selectedTypeId) : ''}
                  onValueChange={(val) => setSelectedTypeId(Number(val))}
                  required
                >
                  <SelectTrigger id="doc-type" className="text-xs rounded-xl border-border/40">
                    <SelectValue placeholder="Select a document type…" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-border/40 shadow-xl max-h-56">
                    {types
                      .filter((t) => t.active)
                      .map((t) => (
                        <SelectItem key={t.id} value={String(t.id)} className="text-xs">
                          <span className="font-mono font-semibold mr-1.5">{t.code}</span>
                          <span className="text-muted-foreground">— {t.label}</span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Allocated Number Preview */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">Allocated Document Number</Label>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Auto-assigned
                  </span>
                </div>
                <div className="relative">
                  <Input
                    readOnly
                    tabIndex={-1}
                    value={previewDisplayNumber}
                    className="bg-muted/50 font-mono text-xs font-semibold tracking-wide cursor-default select-all rounded-xl border-border/40"
                  />
                  {loadingNumber && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {previewHelperText}
                </p>
              </div>

              {/* Document Title / Name */}
              <div className="space-y-1.5">
                <Label htmlFor="doc-name" className="text-xs font-semibold">
                  Document Title
                </Label>
                <Input
                  id="doc-name"
                  name="name"
                  required
                  maxLength={255}
                  placeholder="e.g. Standard Operating Procedure for Assembly Calibration"
                  className="text-xs rounded-xl border-border/40"
                />
              </div>

              {/* Initial File (Optional) */}
              <div className="space-y-1.5">
                <Label htmlFor="doc-file" className="text-xs font-semibold cursor-pointer">
                  Initial File <span className="text-muted-foreground font-normal">(optional — creates v1 draft)</span>
                </Label>
                <Input
                  id="doc-file"
                  name="file"
                  type="file"
                  className="cursor-pointer file:cursor-pointer text-xs rounded-xl border-border/40"
                />
              </div>
            </form>
          </div>

          <SheetFooter className="p-0 flex flex-row justify-end gap-2 mt-6">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="create-doc-form"
              size="sm"
              disabled={creating || !selectedTypeId}
            >
              {creating ? 'Creating…' : 'Create Document'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
