import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import { auditApi, lookupApi } from '../api/resources';
import type { ActivityScope, AuditLogPage, Department } from '../api/types';
import { activityCategory } from '../api/activitySummary';
import { useAuth } from '../auth/AuthContext';
import ActivitySentence from '../components/ActivitySentence';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
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

/**
 * The full Activity view (activity plan-back, approved 2026-09-14): one
 * permission-scoped page for Mine / My Departments / Company (admins, F4).
 *
 * Overhauled to use modern Shadcn/ui components, extended time ranges for
 * ISO 9001 audits, keyword search, department filtering, enriched table
 * cells with category badges and linked department badges, and page-size
 * control.
 */

const RANGES = [
  { key: 'today', label: 'Today', days: 0 },
  { key: '7', label: 'Last 7 days', days: 6 },
  { key: '14', label: 'Last 14 days', days: 13 },
  { key: '30', label: 'Last 30 days', days: 29 },
  { key: '90', label: 'Last 90 days', days: 89 },
  { key: '365', label: 'Last 365 days', days: 364 },
  { key: 'all', label: 'All time', days: -1 },
];

const CATEGORIES = [
  { key: '', label: 'All categories' },
  { key: 'documents', label: 'Documents' },
  { key: 'workflow', label: 'Workflow' },
  { key: 'acknowledgment', label: 'Acknowledgment' },
  { key: 'membership', label: 'Membership' },
];

const PAGE_SIZES = [10, 20, 50];

const SCOPE_META: Record<ActivityScope, { title: string; description: string }> = {
  mine: {
    title: 'My Activity',
    description: 'Audit trail of actions performed by you.',
  },
  departments: {
    title: 'My Departments',
    description: 'Audit trail across your assigned departments.',
  },
  company: {
    title: 'Company-wide',
    description: 'Complete organization-wide ISO 9001 compliance audit trail.',
  },
};

const CATEGORY_BADGE_CLASSES: Record<string, string> = {
  blue: 'bg-info/15 text-info border-transparent',
  purple: 'bg-violet-100 text-violet-700 border-transparent',
  emerald: 'bg-success/15 text-success border-transparent',
  amber: 'bg-warning/15 text-warning border-transparent',
  slate: 'bg-muted text-muted-foreground border-transparent',
};

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
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState<AuditLogPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Search
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');

  // Department filter (for departments & company scopes)
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentFilter, setDepartmentFilter] = useState('');

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(searchInput);
      setPageNumber(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Load departments for the filter dropdown
  useEffect(() => {
    if (scope !== 'mine') {
      lookupApi.departments().then(setDepartments).catch(() => {});
    }
  }, [scope]);

  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[1];
  const isAllTime = range.days === -1;
  const to = isAllTime ? undefined : isoDate(new Date());
  const from = isAllTime ? undefined : isoDate(new Date(Date.now() - range.days * 86400000));

  const load = useCallback(() => {
    setError(null);
    setLoading(true);
    auditApi
      .list({
        scope,
        category: category || undefined,
        departmentId: departmentFilter ? Number(departmentFilter) : undefined,
        q: debouncedQ || undefined,
        from,
        to,
        page: pageNumber,
        pageSize,
      })
      .then(setPage)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [scope, category, departmentFilter, debouncedQ, from, to, pageNumber, pageSize]);

  useEffect(load, [load]);
  useEffect(() => {
    setPageNumber(0);
  }, [scope, category, rangeKey, departmentFilter, pageSize]);

  // Reset filters when scope changes
  useEffect(() => {
    setCategory('');
    setRangeKey('7');
    setDepartmentFilter('');
    setSearchInput('');
    setDebouncedQ('');
    setPageNumber(0);
  }, [scope]);

  const scopeMeta = SCOPE_META[scope];
  const hasActiveFilters = category || departmentFilter || debouncedQ || rangeKey !== '7';

  function clearFilters() {
    setCategory('');
    setDepartmentFilter('');
    setSearchInput('');
    setDebouncedQ('');
    setRangeKey('7');
    setPageNumber(0);
  }

  const exportFilters = {
    scope,
    category: category || undefined,
    departmentId: departmentFilter ? Number(departmentFilter) : undefined,
    q: debouncedQ || undefined,
    from,
    to,
  };

  return (
    <>
      {/* Page Header */}
      <PageHeader
        title={scopeMeta.title}
        actions={
          isAdmin && (
            <Button variant="outline" size="sm" asChild>
              <a href={auditApi.exportUrl(exportFilters)}>
                <Download className="mr-2 size-4" />
                Export CSV
              </a>
            </Button>
          )
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <p className="text-sm text-muted-foreground">{scopeMeta.description}</p>
        {page && (
          <Badge variant="secondary" className="shrink-0">
            {page.totalElements.toLocaleString()} {page.totalElements === 1 ? 'event' : 'events'}
          </Badge>
        )}
      </div>

      {/* Filter Toolbar */}
      <Card className="mb-4 py-3">
        <CardContent className="flex flex-wrap items-end gap-3">
          {/* Search */}
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by name, email, document, action…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9 pr-8"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => { setSearchInput(''); setDebouncedQ(''); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Category */}
          <Select value={category} onValueChange={(v) => setCategory(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c.key || '__all__'} value={c.key || '__all__'}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Department (visible for departments & company scopes) */}
          {scope !== 'mine' && (
            <Select
              value={departmentFilter}
              onValueChange={(v) => setDepartmentFilter(v === '__all__' ? '' : v)}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>
                    {d.code} — {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Period */}
          <Select value={rangeKey} onValueChange={setRangeKey}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Clear Filters */}
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="mr-1 size-3.5" />
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      {error && <div className="error-banner">{error}</div>}

      {/* Table */}
      <Card className="py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">When</TableHead>
                <TableHead className="w-[110px]">Category</TableHead>
                <TableHead className="w-[180px]">Who</TableHead>
                <TableHead>What</TableHead>
                <TableHead className="w-[100px]">Department</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !page && (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center">
                    <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              )}
              {page && page.content.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8">
                    <EmptyState
                      icon={Activity}
                      message="No activity matches the current filters."
                      cta={
                        hasActiveFilters && (
                          <Button variant="link" size="sm" onClick={clearFilters} className="h-auto p-0">
                            Reset filters
                          </Button>
                        )
                      }
                    />
                  </TableCell>
                </TableRow>
              )}
              {(page?.content ?? []).map((entry) => {
                const cat = activityCategory(entry);
                return (
                  <TableRow key={entry.id}>
                    {/* When */}
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(entry.performedAt).toLocaleString()}
                    </TableCell>

                    {/* Category */}
                    <TableCell>
                      <Badge className={CATEGORY_BADGE_CLASSES[cat.color] ?? CATEGORY_BADGE_CLASSES.slate}>
                        {cat.label}
                      </Badge>
                    </TableCell>

                    {/* Who */}
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{entry.actorName}</span>
                        <span className="text-xs text-muted-foreground">{entry.actorEmail}</span>
                      </div>
                    </TableCell>

                    {/* What */}
                    <TableCell>
                      <ActivitySentence entry={entry} />
                    </TableCell>

                    {/* Department */}
                    <TableCell>
                      {entry.departmentCode ? (
                        entry.departmentId ? (
                          <Link to={`/departments/${entry.departmentId}`}>
                            <Badge variant="outline" className="cursor-pointer hover:bg-accent">
                              {entry.departmentCode}
                            </Badge>
                          </Link>
                        ) : (
                          <Badge variant="outline">{entry.departmentCode}</Badge>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {page && page.totalPages > 0 && (
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Rows per page</span>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger className="h-8 w-[70px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Page {page.page + 1} of {page.totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={page.page === 0}
              onClick={() => setPageNumber(page.page - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={page.page + 1 >= page.totalPages}
              onClick={() => setPageNumber(page.page + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
