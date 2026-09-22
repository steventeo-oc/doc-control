import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { lookupApi } from '../api/resources';
import type { Department } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Card } from '../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';

export default function DepartmentsPage() {
  const { user, isAdmin } = useAuth();
  const [all, setAll] = useState<Department[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Dialog states
  const [createOpen, setCreateOpen] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [creating, setCreating] = useState(false);

  const [renaming, setRenaming] = useState<Department | null>(null);
  const [renameLabel, setRenameLabel] = useState('');
  const [savingRename, setSavingRename] = useState(false);

  const [deactivatePrompt, setDeactivatePrompt] = useState<{
    department: Department;
    documents: number;
    users: number;
  } | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  const [deletePrompt, setDeletePrompt] = useState<Department | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    lookupApi
      .departments(isAdmin)
      .then(setAll)
      .catch((err: Error) => setError(err.message));
  }, [isAdmin]);

  useEffect(load, [load]);

  const departments: Department[] = useMemo(() => {
    const list = isAdmin
      ? (all ?? [])
      : (all ? all.filter((d) => user?.departments.some((ud) => ud.id === d.id)) : (user?.departments ?? []))
          .slice()
          .sort((a, b) => a.code.localeCompare(b.code));
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter(
      (d) => d.code.toLowerCase().includes(q) || d.label.toLowerCase().includes(q)
    );
  }, [isAdmin, all, user, search]);

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    const code = newCode.trim().toUpperCase();
    const label = newLabel.trim();
    if (!code || !label) return;

    setCreating(true);
    setError(null);
    lookupApi
      .createDepartment(code, label)
      .then(() => {
        setNotice(`Department ${code} created.`);
        setCreateOpen(false);
        setNewCode('');
        setNewLabel('');
        load();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setCreating(false));
  }

  function openRename(d: Department) {
    setRenaming(d);
    setRenameLabel(d.label);
  }

  function handleRenameSubmit(e: FormEvent) {
    e.preventDefault();
    if (!renaming || !renameLabel.trim()) return;

    setSavingRename(true);
    setError(null);
    lookupApi
      .updateDepartment(renaming.id, { label: renameLabel.trim() })
      .then(() => {
        setNotice(`Department ${renaming.code} renamed.`);
        setRenaming(null);
        load();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setSavingRename(false));
  }

  function handleToggleClick(department: Department) {
    setError(null);
    if (!department.active) {
      // Direct reactivate
      lookupApi
        .updateDepartment(department.id, { active: true })
        .then(() => {
          setNotice(`Department ${department.code} activated.`);
          load();
        })
        .catch((err: Error) => setError(err.message));
      return;
    }

    // Fetch usage before prompting deactivation
    lookupApi
      .usageDepartment(department.id)
      .then((usage) => {
        setDeactivatePrompt({
          department,
          documents: usage.documents,
          users: usage.users,
        });
      })
      .catch((err: Error) => setError(err.message));
  }

  function confirmDeactivate() {
    if (!deactivatePrompt) return;
    const { department } = deactivatePrompt;
    setDeactivating(true);
    setError(null);
    lookupApi
      .updateDepartment(department.id, { active: false })
      .then(() => {
        setNotice(`Department ${department.code} deactivated.`);
        setDeactivatePrompt(null);
        load();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setDeactivating(false));
  }

  function confirmDelete() {
    if (!deletePrompt) return;
    const department = deletePrompt;
    setDeleting(true);
    setError(null);
    lookupApi
      .deleteDepartment(department.id)
      .then(() => {
        setNotice(`Department ${department.code} deleted.`);
        setDeletePrompt(null);
        load();
      })
      .catch((err: Error) => {
        setError(err.message);
        setDeletePrompt(null);
      })
      .finally(() => setDeleting(false));
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Departments"
        actions={
          isAdmin && (
            <Button
              size="sm"
              className="gap-1.5 rounded-xl shadow-xs"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="size-4" />
              <span>Add Department</span>
            </Button>
          )
        }
      />

      {error && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-sm font-medium text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          {notice}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search departments…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 rounded-xl border-border/50"
          />
        </div>
        <div className="text-sm text-muted-foreground">
          {departments.length} department{departments.length === 1 ? '' : 's'}
        </div>
      </div>

      <Card className="rounded-2xl border border-border/40 bg-card p-0 shadow-xs overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border/40 hover:bg-transparent">
              <TableHead className="w-28 font-semibold">Code</TableHead>
              <TableHead className="font-semibold">Label</TableHead>
              <TableHead className="w-24 font-semibold">Status</TableHead>
              <TableHead className="w-28 font-semibold">Documents</TableHead>
              <TableHead className="w-24 font-semibold">Members</TableHead>
              {isAdmin && <TableHead className="w-48 text-right font-semibold">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {departments.map((d) => (
              <TableRow key={d.id} className="border-border/30 hover:bg-muted/40 transition-colors">
                <TableCell className="font-mono font-medium">
                  <Link
                    to={`/departments/${d.id}`}
                    className="text-primary hover:underline font-semibold"
                  >
                    {d.code}
                  </Link>
                </TableCell>
                <TableCell className="font-medium text-foreground">
                  {d.label}
                </TableCell>
                <TableCell>
                  {d.active ? (
                    <Badge
                      variant="outline"
                      className="border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium"
                    >
                      Active
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-border/40 bg-muted/50 text-muted-foreground font-medium"
                    >
                      Inactive
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-muted text-foreground">
                    {d.documentCount ?? 0}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-muted text-foreground">
                    {d.memberCount ?? 0}
                  </span>
                </TableCell>
                {isAdmin && (
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-muted-foreground hover:text-foreground"
                        onClick={() => openRename(d)}
                      >
                        <Pencil className="size-3.5 mr-1" />
                        Rename
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-muted-foreground hover:text-foreground"
                        onClick={() => handleToggleClick(d)}
                      >
                        {d.active ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeletePrompt(d)}
                      >
                        <Trash2 className="size-3.5 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}

            {departments.length === 0 && (
              <TableRow>
                <TableCell colSpan={isAdmin ? 6 : 5} className="py-8 text-center">
                  <EmptyState
                    icon={Building2}
                    message={
                      search
                        ? `No departments match "${search}".`
                        : isAdmin
                        ? 'No departments exist yet. Click "+ Add Department" to create one.'
                        : 'You are not assigned to any departments.'
                    }
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Add Department Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Add Department</DialogTitle>
            <DialogDescription>
              Create a new department lookup row. The department code will be used in document prefixes and cannot be changed later.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3 mt-2">
            <div className="space-y-1">
              <Label htmlFor="dept-code" className="font-semibold">
                Department Code
              </Label>
              <Input
                id="dept-code"
                placeholder="e.g. ENG, QA, HR"
                maxLength={32}
                required
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                className="font-mono rounded-xl"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dept-label" className="font-semibold">
                Department Label
              </Label>
              <Input
                id="dept-label"
                placeholder="e.g. Engineering, Quality Assurance"
                maxLength={255}
                required
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                className="rounded-xl"
              />
            </div>
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={creating || !newCode.trim() || !newLabel.trim()}>
                {creating ? 'Creating…' : 'Create Department'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={Boolean(renaming)} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Rename Department</DialogTitle>
            <DialogDescription>
              Update the descriptive label for department{' '}
              <strong className="font-mono text-foreground">{renaming?.code}</strong>.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRenameSubmit} className="space-y-3 mt-2">
            <div className="space-y-1">
              <Label htmlFor="rename-label" className="font-semibold">
                Department Label
              </Label>
              <Input
                id="rename-label"
                maxLength={255}
                required
                value={renameLabel}
                onChange={(e) => setRenameLabel(e.target.value)}
                className="rounded-xl"
              />
            </div>
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRenaming(null)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={savingRename || !renameLabel.trim()}>
                {savingRename ? 'Saving…' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Deactivate Alert Dialog */}
      <AlertDialog
        open={Boolean(deactivatePrompt)}
        onOpenChange={(open) => !open && setDeactivatePrompt(null)}
      >
        <AlertDialogContent className="sm:max-w-md rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Deactivate Department {deactivatePrompt?.department.code}?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-muted-foreground">
              <p>
                {deactivatePrompt && deactivatePrompt.documents > 0
                  ? `• ${deactivatePrompt.documents} existing document(s) will keep referencing this department and remain searchable.`
                  : '• No documents reference this department.'}
              </p>
              <p>
                {deactivatePrompt && deactivatePrompt.users > 0
                  ? `• ${deactivatePrompt.users} user(s) currently belong to it. They will keep access to existing documents but cannot file new documents here.`
                  : '• No users currently belong to this department.'}
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deactivating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeactivate}
              disabled={deactivating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deactivating ? 'Deactivating…' : 'Deactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Alert Dialog */}
      <AlertDialog
        open={Boolean(deletePrompt)}
        onOpenChange={(open) => !open && setDeletePrompt(null)}
      >
        <AlertDialogContent className="sm:max-w-md rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete Department {deletePrompt?.code}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This action cannot be undone. It will permanently remove department{' '}
              <strong className="text-foreground">{deletePrompt?.label}</strong>, all user memberships, and its sequence counters.
              <br />
              <br />
              <em>Note: If any documents reference this department, deletion will be blocked by the server and you must deactivate it instead.</em>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting…' : 'Delete Department'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
