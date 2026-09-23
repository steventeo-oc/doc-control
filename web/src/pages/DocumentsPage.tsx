import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpDown, Download, FileX, Loader2, Star, X } from 'lucide-react';
import { documentApi, lookupApi } from '../api/resources';
import type { Department, DocumentNumberPreview, DocumentSummary, DocumentLevel, DocumentType, DocumentsPage as PageResult } from '../api/types';
import { DOCUMENT_STATUSES } from '../api/types';
import { cn } from '../lib/utils';
import { useAuth } from '../auth/AuthContext';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge, type StatusBadgeKind } from '../components/StatusBadge';
import { Badge } from '../components/ui/badge';
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
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawView = searchParams.get('view');
  const view = rawView === 'mine' || rawView === 'trash' || rawView === 'favorites' || rawView === 'archived'
    ? rawView
    : 'all';
  const [page, setPage] = useState<PageResult | null>(null);
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [levels, setLevels] = useState<DocumentLevel[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState({ type: '', level: '', department: '', status: '', q: '' });
  const [searchInput, setSearchInput] = useState('');
  const [pageNumber, setPageNumber] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [sortField, setSortField] = useState<'number' | 'name' | 'status' | 'updated' | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [loading, setLoading] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [selectedDeptId, setSelectedDeptId] = useState<number | null>(null);
  const [numberPreview, setNumberPreview] = useState<DocumentNumberPreview | null>(null);
  const [loadingNumber, setLoadingNumber] = useState(false);

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
        level: filters.level ? Number(filters.level) : undefined,
        department: filters.department || undefined,
        status: filters.status || undefined,
        q: filters.q || undefined,
        sort: sortField ? `${sortField},${sortOrder}` : undefined,
        trashed: view === 'trash' || undefined,
        archived: view === 'archived' || undefined,
        owner: view === 'mine' ? 'me' : undefined,
        favorite: view === 'favorites' ? true : undefined,
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
    if (searchParams.get('create') === '1' && view !== 'trash' && view !== 'archived') {
      setShowCreate(true);
    }
  }, [searchParams, view]);
  useEffect(() => {
    lookupApi.types(true).then(setTypes).catch(() => undefined);
    lookupApi.levels(true).then(setLevels).catch(() => undefined);
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

  useEffect(() => {
    if (showCreate && selectedDeptId === null) {
      if (preselectDepartmentId) {
        setSelectedDeptId(preselectDepartmentId);
      } else if (eligibleDepartments.length === 1) {
        setSelectedDeptId(eligibleDepartments[0].id);
      }
    }
  }, [showCreate, preselectDepartmentId, eligibleDepartments, selectedDeptId]);

  useEffect(() => {
    if (!selectedTypeId) {
      setNumberPreview(null);
      return;
    }
    setLoadingNumber(true);
    let active = true;
    documentApi
      .previewNextNumber(selectedTypeId, selectedDeptId || undefined)
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
  }, [selectedTypeId, selectedDeptId]);

  const selectedType = types.find((t) => t.id === selectedTypeId);
  const selectedDept = eligibleDepartments.find((d) => d.id === selectedDeptId);

  let previewDisplayNumber = '—';
  let previewHelperText = 'Select a document type to preview the document number.';

  if (selectedTypeId && !selectedDeptId) {
    previewDisplayNumber = selectedType ? `${selectedType.code}-[Dept]-????` : '—';
    if (numberPreview?.currentLatestDocumentNumber) {
      previewHelperText = `Current latest for ${selectedType?.code}: ${numberPreview.currentLatestDocumentNumber} · Select department to preview allocated number`;
    } else {
      previewHelperText = `Select a department to preview the next allocated document number for ${selectedType?.code ?? 'this type'}.`;
    }
  } else if (selectedTypeId && selectedDeptId) {
    if (numberPreview?.nextDocumentNumber) {
      previewDisplayNumber = numberPreview.nextDocumentNumber;
      if (numberPreview.currentLatestDocumentNumber) {
        previewHelperText = `Current latest: ${numberPreview.currentLatestDocumentNumber} · Next allocated: ${numberPreview.nextDocumentNumber}`;
      } else {
        previewHelperText = `No existing documents for ${selectedType?.code ?? ''}-${selectedDept?.code ?? ''} · First allocated: ${numberPreview.nextDocumentNumber}`;
      }
    } else {
      previewDisplayNumber = selectedType && selectedDept ? `${selectedType.code}-${selectedDept.code}-????` : '—';
      previewHelperText = 'Calculating next document number…';
    }
  }

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setShowCreate(open);
      if (!open) {
        setCreateError(null);
        setSelectedTypeId(null);
        setSelectedDeptId(null);
        setNumberPreview(null);
        if (searchParams.get('create')) {
          const nextParams = new URLSearchParams(searchParams);
          nextParams.delete('create');
          nextParams.delete('department');
          setSearchParams(nextParams, { replace: true });
        }
      } else {
        if (preselectDepartmentId) {
          setSelectedDeptId(preselectDepartmentId);
        } else if (eligibleDepartments.length === 1) {
          setSelectedDeptId(eligibleDepartments[0].id);
        }
      }
    },
    [searchParams, setSearchParams, preselectDepartmentId, eligibleDepartments],
  );

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const typeIdToUse = Number(data.get('documentTypeId') || selectedTypeId);
    const deptIdToUse = Number(data.get('departmentId') || selectedDeptId);
    setCreating(true);
    setCreateError(null);
    documentApi
      .create(
        typeIdToUse,
        deptIdToUse,
        String(data.get('name') ?? ''),
        data.get('file') instanceof File && (data.get('file') as File).size > 0
          ? (data.get('file') as File)
          : null,
      )
      .then((created) => {
        form.reset();
        setSelectedTypeId(null);
        setSelectedDeptId(null);
        setNumberPreview(null);
        handleOpenChange(false);
        navigate(`/documents/${created.id}`);
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
    filters.type || filters.level || filters.department || filters.status || searchInput,
  );

  function handleClearFilters() {
    setFilters({ type: '', level: '', department: '', status: '', q: '' });
    setSearchInput('');
    setPageNumber(0);
  }

  async function handleToggleFavorite(doc: DocumentSummary) {
    const nextVal = !doc.isFavorite;
    setPage((prev) => {
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
      setPage((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          content: prev.content.map((d) => (d.id === doc.id ? { ...d, isFavorite: !nextVal } : d)),
        };
      });
    }
  }

  return (
    <>
      <PageHeader
        title={
          view === 'archived'
            ? 'Archived & Obsolete Documents'
            : view === 'trash'
            ? 'Trash'
            : view === 'mine'
            ? 'My Documents'
            : view === 'favorites'
            ? 'Favorite Documents'
            : 'Documents'
        }
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a
                href={documentApi.exportUrl({
                  type: filters.type || undefined,
                  level: filters.level ? Number(filters.level) : undefined,
                  department: filters.department || undefined,
                  status: filters.status || undefined,
                  q: filters.q || undefined,
                  sort: sortField ? `${sortField},${sortOrder}` : undefined,
                  trashed: view === 'trash' || undefined,
                  archived: view === 'archived' || undefined,
                  owner: view === 'mine' ? 'me' : undefined,
                  favorite: view === 'favorites' ? true : undefined,
                })}
              >
                <Download className="mr-1.5 size-4" />
                Export CSV
              </a>
            </Button>
            {view !== 'trash' && view !== 'archived' && (
              <Button size="sm" type="button" onClick={() => handleOpenChange(true)}>
                New document
              </Button>
            )}
          </div>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-level">Level</Label>
          <Select
            value={filters.level || 'all'}
            onValueChange={(value) => {
              setFilters({ ...filters, level: value === 'all' ? '' : value });
              setPageNumber(0);
            }}
          >
            <SelectTrigger id="filter-level" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              {levels.map((t) => (
                <SelectItem key={t.id} value={String(t.levelNumber)}>
                  Level {t.levelNumber} ({t.label})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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

      <Sheet open={view !== 'trash' && view !== 'archived' && showCreate} onOpenChange={handleOpenChange}>
        <SheetContent side="right" className="flex flex-col p-6 sm:max-w-lg overflow-y-auto border-0">
          <SheetHeader className="p-0">
            <SheetTitle className="text-xl font-semibold">New document</SheetTitle>
            <SheetDescription>
              Create a new controlled document and optionally upload its initial revision file.
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
                <Select
                  name="documentTypeId"
                  required
                  value={selectedTypeId ? String(selectedTypeId) : ''}
                  onValueChange={(val) => setSelectedTypeId(Number(val))}
                >
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
                  value={selectedDeptId ? String(selectedDeptId) : ''}
                  onValueChange={(val) => setSelectedDeptId(Number(val))}
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
                <div className="flex items-center justify-between">
                  <Label htmlFor="create-document-number">Current Document Number</Label>
                  <span className="text-[11px] font-semibold tracking-wider uppercase text-muted-foreground">Auto-assigned</span>
                </div>
                <div className="relative">
                  <Input
                    id="create-document-number"
                    readOnly
                    tabIndex={-1}
                    value={previewDisplayNumber}
                    className="bg-muted/70 font-mono text-sm tracking-wide font-medium cursor-default select-all"
                    placeholder="e.g. WI-QA-0001"
                  />
                  {loadingNumber && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {previewHelperText}
                </p>
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
                  File (optional — becomes revision 0)
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
        <div className="mt-4 rounded-2xl border border-border/40 bg-card p-0 shadow-xs overflow-hidden">
          <Table className={cn('transition-opacity', loading && 'opacity-60')}>
            <TableHeader>
              <TableRow className="border-border/40 hover:bg-transparent">
                <TableHead className="w-9 px-2" />
                <TableHead
                  className="w-36 cursor-pointer select-none hover:text-foreground"
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
                  className="min-w-[240px] cursor-pointer select-none hover:text-foreground"
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
              <TableHead>Progress</TableHead>
              <TableHead>Level</TableHead>
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
              <TableRow key={doc.id} className="border-border/30 hover:bg-muted/40 transition-colors">
                <TableCell className="w-9 px-2">
                  {view !== 'trash' && (
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
                          'size-4 transition-colors',
                          doc.isFavorite
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-muted-foreground/40 hover:text-amber-400'
                        )}
                      />
                    </button>
                  )}
                </TableCell>
                <TableCell>
                  <Link
                    className="text-primary hover:underline font-semibold"
                    to={`/documents/${doc.id}`}
                    state={{ fromView: view }}
                  >
                    {doc.documentNumber}
                  </Link>
                </TableCell>
                <TableCell className="font-medium text-foreground">{doc.name}</TableCell>
                <TableCell>
                  <StatusBadge status={doc.status as StatusBadgeKind}>{doc.status}</StatusBadge>
                </TableCell>
                <TableCell>
                  {doc.revisionStatus === 'IN_REVIEW' && (
                    <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-500/30 whitespace-nowrap">
                      Rev {doc.revisionVersionNumber} in review
                    </span>
                  )}
                  {doc.revisionStatus === 'DRAFT' && (
                    <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 whitespace-nowrap">
                      Rev {doc.revisionVersionNumber} draft
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
                  {doc.levelNumber ? (
                    <Badge variant="outline" className="font-semibold text-xs whitespace-nowrap" title={doc.levelLabel ?? undefined}>
                      Level {doc.levelNumber}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground/40 text-xs">—</span>
                  )}
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
        </div>
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
              <SelectTrigger className="h-8 w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </>
  );
}
