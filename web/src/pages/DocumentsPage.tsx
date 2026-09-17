import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileX } from 'lucide-react';
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

/**
 * The Documents section (nav restructure plan-back F1/F2): one page, three
 * sidebar views via the ?view= parameter — all (default), mine (owner=me),
 * and trash (trashed=true, rows restorable). The view keeps ?view= off the
 * route tree so /documents/:id stays unambiguous.
 *
 * Design-redesign Phase 2a (Design_System_Redesign_PlanBack.md): reskinned
 * onto PageHeader/Button/Label/Input/Select/Table/StatusBadge/EmptyState.
 * Behavior freeze — routes, ?view=/create/department params, filter wiring,
 * pagination, and every interaction are unchanged; the only structural
 * swaps are the F3 native-select → Radix Select replacements (sentinel
 * "all" values for the "no filter" options, since Radix SelectItem forbids
 * empty strings) and the empty result row becoming the shared EmptyState.
 * The create form stays inline (showCreate toggle, not a Dialog) and keeps
 * its exact validation, deep links, and active-only/membership filtering.
 */
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
  const [pageNumber, setPageNumber] = useState(0);

  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setError(null);
    documentApi
      .list({
        type: filters.type || undefined,
        department: filters.department || undefined,
        status: filters.status || undefined,
        q: filters.q || undefined,
        trashed: view === 'trash' || undefined,
        owner: view === 'mine' ? 'me' : undefined,
        page: pageNumber,
      })
      .then(setPage)
      .catch((err: Error) => setError(err.message));
  }, [filters, pageNumber, view]);

  useEffect(load, [load]);
  useEffect(() => {
    setPageNumber(0);
  }, [view]);
  useEffect(() => {
    // '+ New document' deep link from the dashboard's empty My Documents
    // card (?create=1) — creation itself stays on this page
    if (searchParams.get('create') === '1' && view !== 'trash') {
      setShowCreate(true);
    }
  }, [searchParams, view]);
  useEffect(() => {
    // includeInactive: filter dropdowns must offer deactivated types and
    // departments so existing documents referencing them stay searchable
    // (lookup admin plan-back F2); the creation form filters to active.
    lookupApi.types(true).then(setTypes).catch(() => undefined);
    lookupApi.departments(true).then(setDepartments).catch(() => undefined);
  }, []);

  // A ?department=<code> deep link (the department detail page's
  // '+ New document' CTA) preselects that department in the creation
  // form — only where the caller may actually create (active + member,
  // or admin; the levels plan-back's canCreate rule).
  const preselectDepartmentCode = searchParams.get('department');
  const preselectDepartmentId = preselectDepartmentCode
    ? departments.find(
        (d) =>
          d.code === preselectDepartmentCode &&
          d.active &&
          (isAdmin || user?.departments.some((ud) => ud.id === d.id)),
      )?.id
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

      {/* Filters: plain flex row per the plan-back — no Card wrapper. The
          Select "all" entries use a sentinel value because Radix SelectItem
          forbids empty strings; the sentinel maps back to '' filter state. */}
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
            placeholder="Name contains…"
            value={filters.q}
            onChange={(e) => {
              setFilters({ ...filters, q: e.target.value });
              setPageNumber(0);
            }}
          />
        </div>
      </div>

      <Sheet open={view !== 'trash' && showCreate} onOpenChange={handleOpenChange}>
        <SheetContent side="right" className="flex flex-col p-6 sm:max-w-lg overflow-y-auto">
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
                    {(isAdmin
                      ? departments.filter((d) => d.active)
                      : departments.filter(
                          (d) => d.active && user?.departments.some((ud) => ud.id === d.id),
                        )
                    ).map((d) => (
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
                <Label htmlFor="create-file">File (optional — becomes version 1)</Label>
                <Input id="create-file" name="file" type="file" />
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
              <Button type="submit" disabled={creating}>
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
        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Dept</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Updated</TableHead>
              {view === 'trash' && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(page?.content ?? []).map((doc: DocumentSummary) => (
              <TableRow key={doc.id}>
                <TableCell>
                  <Link className="text-primary hover:underline" to={`/documents/${doc.id}`}>
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
        <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page.page === 0}
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
            disabled={page.page + 1 >= page.totalPages}
            onClick={() => setPageNumber(page.page + 1)}
          >
            Next →
          </Button>
        </div>
      )}
    </>
  );
}
