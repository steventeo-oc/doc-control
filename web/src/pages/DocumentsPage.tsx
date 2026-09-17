import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpDown, FileX, Loader2, X } from 'lucide-react';
import { documentApi, lookupApi } from '../api/resources';
import type { Department, DocumentSummary, DocumentType, DocumentsPage as PageResult } from '../api/types';
import { DOCUMENT_STATUSES } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge, type StatusBadgeKind } from '../components/StatusBadge';
import { Button } from '../components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../components/ui/sheet';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
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

export default function DocumentsPage() {
  const { user, isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') === 'mine' || searchParams.get('view') === 'trash'
    ? (searchParams.get('view') as 'mine' | 'trash')
    : 'all';
  const [page, setPage] = useState<PageResult | null>(null);
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState({ type: '', department: '', status: '', q: '' });
  const [searchInput, setSearchInput] = useState('');
  const [pageNumber, setPageNumber] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [sortField, setSortField] = useState<'number' | 'name' | 'status' | 'updated' | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [loading, setLoading] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => (prev.q === searchInput ? prev : { ...prev, q: searchInput }));
      setPageNumber(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(() => {
    setError(null);
    setLoading(true);
    documentApi
      .list({
        type: filters.type || undefined,
        department: filters.department || undefined,
        status: filters.status || undefined,
        q: filters.q || undefined,
        sort: sortField ? `${sortField},${sortOrder}` : undefined,
        trashed: view === 'trash' || undefined,
        owner: view === 'mine' ? 'me' : undefined,
        page: pageNumber,
        pageSize,
      })
      .then(setPage)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [filters, pageNumber, pageSize, sortField, sortOrder, view]);

  useEffect(load, [load]);
  useEffect(() => {
    setPageNumber(0);
  }, [view]);
  useEffect(() => {
    if (searchParams.get('create') === '1' && view !== 'trash') {
      setShowCreate(true);
    }
  }, [searchParams, view]);
  useEffect(() => {
    lookupApi.types(true).then(setTypes).catch(() => undefined);
    lookupApi.departments(true).then(setDepartments).catch(() => undefined);
  }, []);

  const eligibleDepartments = isAdmin
    ? departments.filter((d) => d.active)
    : departments.filter(
        (d) =>
          d.active &&
          user?.departments.some((ud) => ud.id === d.id && ud.level !== 'CONSUMER'),
      );

  const preselectDepartmentCode = searchParams.get('department');
  const preselectDepartmentId = preselectDepartmentCode
    ? eligibleDepartments.find((d) => d.code === preselectDepartmentCode)?.id
    : undefined;

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setShowCreate(open);
      if (!open) {
        setCreateError(null);
        if (searchParams.get('create')) {
          const nextParams = new URLSearchParams(searchParams);
          nextParams.delete('create');
          nextParams.delete('department');
          setSearchParams(nextParams, { replace: true });
        }
      }
    },
    [searchParams, setSearchParams],
  );

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setCreating(true);
    setCreateError(null);
    documentApi
      .create(
        Number(data.get('documentTypeId')),
        Number(data.get('departmentId')),
        String(data.get('name') ?? ''),
        data.get('file') instanceof File && (data.get('file') as File).size > 0
          ? (data.get('file') as File)
          : null,
      )
      .then(() => {
        form.reset();
        handleOpenChange(false);
        load();
      })
      .catch((err: Error) => setCreateError(err.message))
      .finally(() => setCreating(false));
  }

  function runRestore(documentId: number) {
    setError(null);
    documentApi
      .restore(documentId)
      .then(load)
      .catch((err: Error) => setError(err.message));
  }

  function handleSort(field: 'number' | 'name' | 'status' | 'updated') {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder(field === 'updated' ? 'desc' : 'asc');
    }
    setPageNumber(0);
  }

  const hasActiveFilters = Boolean(
    filters.type || filters.department || filters.status || searchInput,
  );

  function handleClearFilters() {
    setFilters({ type: '', department: '', status: '', q: '' });
    setSearchInput('');
    setPageNumber(0);
  }

  return (
    <>
      <PageHeader
        title="Documents"
        actions={
          view !== 'trash' && (
            <Button type="button" onClick={() => handleOpenChange(true)}>
              New document
            </Button>
          )
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-type">Type</Label>
          <Select
            value={filters.type || 'all'}
            onValueChange={(value) => {
              setFilters({ ...filters, type: value === 'all' ? '' : value });
              setPageNumber(0);
            }}
          >
            <SelectTrigger id="filter-type" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {types.map((t) => (
                <SelectItem key={t.id} value={t.code}>
                  {t.code}
                  {!t.active && ' (inactive)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-department">Department</Label>
          <Select
            value={filters.department || 'all'}
            onValueChange={(value) => {
              setFilters({ ...filters, department: value === 'all' ? '' : value });
              setPageNumber(0);
            }}
          >
            <SelectTrigger id="filter-department" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.code}>
                  {d.code}
                  {!d.active && ' (inactive)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-status">Status</Label>
          <Select
            value={filters.status || 'all'}
            onValueChange={(value) => {
              setFilters({ ...filters, status: value === 'all' ? '' : value });
              setPageNumber(0);
            }}
          >
            <SelectTrigger id="filter-status" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {DOCUMENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-search">Search</Label>
          <Input
            id="filter-search"
            type="search"
            className="w-56"
            placeholder="Search name or number…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        {hasActiveFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClearFilters}
            className="h-9 gap-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
            Clear filters
          </Button>
        )}
        {loading && (
          <div className="flex items-center pb-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        )}
      </div>

      <Sheet open={view !== 'trash' && showCreate} onOpenChange={handleOpenChange}>
        <SheetContent side="right" className="flex flex-col p-6 sm:max-w-lg overflow-y-auto border-0">
          <SheetHeader className="p-0">
            <SheetTitle className="text-xl font-semibold">New document</SheetTitle>
            <SheetDescription>
              Create a new controlled document and optionally upload its initial version file.
            </SheetDescription>
          </SheetHeader>
          <form className="mt-4 flex flex-1 flex-col justify-between gap-6" onSubmit={handleCreate}>
            <div className="flex flex-col gap-4">
              {createError && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {createError}
                </div>
              )}
              {eligibleDepartments.length === 0 && (
                <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                  You do not have Contributor or Manager permissions in any department. Document creation requires at least Contributor membership.
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="create-type">Type</Label>
                <Select name="documentTypeId" required>
                  <SelectTrigger id="create-type" className="w-full">
                    <SelectValue placeholder="Choose type…" />
                  </SelectTrigger>
                  <SelectContent>
                    {types
                      .filter((t) => t.active)
                      .map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          {t.code} — {t.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="create-department">Department</Label>
                <Select
                  key={preselectDepartmentId ? String(preselectDepartmentId) : 'default'}
                  name="departmentId"
                  required
                  defaultValue={preselectDepartmentId ? String(preselectDepartmentId) : undefined}
                >
                  <SelectTrigger id="create-department" className="w-full">
                    <SelectValue placeholder="Choose department…" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleDepartments.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>
                        {d.code} — {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="create-name">Name</Label>
                <Input
                  id="create-name"
                  name="name"
                  required
                  maxLength={255}
                  placeholder="e.g. Incoming Inspection Procedure"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="create-file" className="cursor-pointer">
                  File (optional — becomes version 1)
                </Label>
                <Input
                  id="create-file"
                  name="file"
                  type="file"
                  className="cursor-pointer file:cursor-pointer"
                />
              </div>
            </div>
            <SheetFooter className="p-0 flex flex-row justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creating || eligibleDepartments.length === 0}>
                {creating ? 'Creating…' : 'Create document'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      {error && (
        <div className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {page && page.content.length === 0 ? (
        <div className="mt-4">
          <EmptyState icon={FileX} message="No documents match." />
        </div>
      ) : (
        <Table className={`mt-4 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <TableHeader>
            <TableRow>
              <TableHead
                className="cursor-pointer select-none hover:text-foreground"
                onClick={() => handleSort('number')}
              >
                <div className="flex items-center gap-1">
                  <span>Number</span>
                  {sortField === 'number' ? (
                    sortOrder === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />
                  ) : (
                    <ArrowUpDown className="size-3 text-muted-foreground/50" />
                  )}
                </div>
              </TableHead>
              <TableHead
                className="cursor-pointer select-none hover:text-foreground"
                onClick={() => handleSort('name')}
              >
                <div className="flex items-center gap-1">
                  <span>Name</span>
                  {sortField === 'name' ? (
                    sortOrder === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />
                  ) : (
                    <ArrowUpDown className="size-3 text-muted-foreground/50" />
                  )}
                </div>
              </TableHead>
              <TableHead
                className="cursor-pointer select-none hover:text-foreground"
                onClick={() => handleSort('status')}
              >
                <div className="flex items-center gap-1">
                  <span>Status</span>
                  {sortField === 'status' ? (
                    sortOrder === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />
                  ) : (
                    <ArrowUpDown className="size-3 text-muted-foreground/50" />
                  )}
                </div>
              </TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Dept</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead
                className="cursor-pointer select-none hover:text-foreground"
                onClick={() => handleSort('updated')}
              >
                <div className="flex items-center gap-1">
                  <span>Updated</span>
                  {sortField === 'updated' ? (
                    sortOrder === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />
                  ) : (
                    <ArrowUpDown className="size-3 text-muted-foreground/50" />
                  )}
                </div>
              </TableHead>
              {view === 'trash' && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(page?.content ?? []).map((doc: DocumentSummary) => (
              <TableRow key={doc.id}>
                <TableCell>
                  <Link
                    className="text-primary hover:underline font-medium"
                    to={`/documents/${doc.id}`}
                    state={{ fromView: view }}
                  >
                    {doc.documentNumber}
                  </Link>
                </TableCell>
                <TableCell>{doc.name}</TableCell>
                <TableCell>
                  <StatusBadge status={doc.status as StatusBadgeKind}>{doc.status}</StatusBadge>
                </TableCell>
                <TableCell>
                  <StatusBadge status="dept">{doc.documentTypeCode}</StatusBadge>
                </TableCell>
                <TableCell>
                  <StatusBadge status="dept">{doc.departmentCode}</StatusBadge>
                </TableCell>
                <TableCell>{doc.ownerName}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {new Date(doc.updatedAt).toLocaleString()}
                </TableCell>
                {view === 'trash' && (
                  <TableCell>
                    <Button type="button" variant="outline" size="sm" onClick={() => runRestore(doc.id)}>
                      Restore
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {page && page.totalPages > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page.page === 0 || loading}
              onClick={() => setPageNumber(page.page - 1)}
            >
              ← Prev
            </Button>
            <span>
              Page {page.page + 1} of {page.totalPages} ({page.totalElements} documents)
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page.page + 1 >= page.totalPages || loading}
              onClick={() => setPageNumber(page.page + 1)}
            >
              Next →
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs">Rows per page:</span>
            <Select
              value={String(pageSize)}
              onValueChange={(val) => {
                setPageSize(Number(val));
                setPageNumber(0);
              }}
            >
              <SelectTrigger className="h-8 w-18">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </>
  );
}
