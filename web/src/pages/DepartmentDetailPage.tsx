import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Building2, ChevronLeft, ChevronRight, FileText, Plus, Search } from 'lucide-react';
import { documentApi, lookupApi } from '../api/resources';
import type { Department, DocumentsPage as PageResult } from '../api/types';
import { DOCUMENT_STATUSES } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import DepartmentMembersPanel from '../components/DepartmentMembersPanel';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge, type StatusBadgeKind } from '../components/StatusBadge';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
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

export default function DepartmentDetailPage() {
  const { id } = useParams();
  const departmentId = Number(id);
  const { user, isAdmin } = useAuth();
  const [department, setDepartment] = useState<Department | null>(null);
  const [resolved, setResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Documents state
  const [docs, setDocs] = useState<PageResult | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [docSearch, setDocSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(0);
  const pageSize = 15;

  const membership = user?.departments.find((d) => d.id === departmentId);
  const canManage = isAdmin || membership?.level === 'MANAGER';
  const canCreateHere = isAdmin || (!!membership && membership.level !== 'CONSUMER');

  // Load Department Metadata
  useEffect(() => {
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

  // Load Documents with Filters & Pagination
  const loadDocuments = useCallback(() => {
    if (!department) return;
    setLoadingDocs(true);
    documentApi
      .list({
        department: department.code,
        q: docSearch.trim() || undefined,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
        page,
        pageSize,
      })
      .then(setDocs)
      .catch(() => setDocs(null))
      .finally(() => setLoadingDocs(false));
  }, [department, docSearch, statusFilter, page]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Reset page to 0 when search or filter changes
  function handleSearchChange(val: string) {
    setDocSearch(val);
    setPage(0);
  }

  function handleStatusChange(val: string) {
    setStatusFilter(val);
    setPage(0);
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
              <span>{docs?.totalElements ?? 0} document(s)</span>
            </p>
          </div>

          {canCreateHere && (
            <Button size="sm" asChild className="gap-1.5 rounded-xl shadow-xs self-start sm:self-auto">
              <Link to={`/documents?create=1&department=${encodeURIComponent(department.code)}`}>
                <Plus className="size-4" />
                <span>New Document</span>
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Members Panel (for Managers & Admins) */}
      {canManage && (
        <DepartmentMembersPanel
          departmentId={departmentId}
          departmentCode={department.code}
        />
      )}

      {/* Documents Section */}
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
          <div className="flex items-center gap-2">
            <div className="relative w-48 sm:w-56">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <Input
                placeholder="Search documents…"
                value={docSearch}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-8 text-xs h-8 rounded-lg border-border/40"
              />
            </div>
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
          </div>
        </div>

        <div className="rounded-xl border border-border/40 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border/40 hover:bg-transparent">
                <TableHead className="w-36 text-xs font-semibold">Number</TableHead>
                <TableHead className="text-xs font-semibold">Title</TableHead>
                <TableHead className="w-28 text-xs font-semibold">Type</TableHead>
                <TableHead className="w-28 text-xs font-semibold">Status</TableHead>
                <TableHead className="w-32 text-xs font-semibold">Owner</TableHead>
                <TableHead className="w-36 text-right text-xs font-semibold">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(docs?.content ?? []).map((doc) => (
                <TableRow key={doc.id} className="border-border/30 hover:bg-muted/40 transition-colors">
                  <TableCell className="font-mono text-xs font-semibold">
                    <Link
                      to={`/documents/${doc.id}`}
                      className="text-primary hover:underline"
                    >
                      {doc.documentNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs font-medium text-foreground">
                    {doc.name}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">
                    {doc.documentTypeCode || '—'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={doc.status as StatusBadgeKind}>
                      {doc.status}
                    </StatusBadge>
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
                  <TableCell colSpan={6} className="py-10 text-center">
                    <EmptyState
                      icon={FileText}
                      message={
                        docSearch || statusFilter !== 'ALL'
                          ? 'No documents match the specified filters.'
                          : 'No documents in this department yet.'
                      }
                      cta={
                        canCreateHere && !docSearch && statusFilter === 'ALL' ? (
                          <Button size="sm" variant="outline" asChild className="mt-2 text-xs rounded-xl">
                            <Link to={`/documents?create=1&department=${encodeURIComponent(department.code)}`}>
                              Create First Document
                            </Link>
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
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <div className="text-xs text-muted-foreground">
              Showing page {page + 1} of {totalPages} ({docs?.totalElements} total)
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs rounded-lg gap-1"
                disabled={page === 0 || loadingDocs}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="size-3.5" />
                <span>Previous</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs rounded-lg gap-1"
                disabled={page >= totalPages - 1 || loadingDocs}
                onClick={() => setPage((p) => p + 1)}
              >
                <span>Next</span>
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
