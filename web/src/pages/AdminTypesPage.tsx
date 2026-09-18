import { FormEvent, useCallback, useEffect, useState } from 'react';
import { FileType2, Loader2, Pencil, Plus, Power, Search, Trash2, X } from 'lucide-react';
import { lookupApi } from '../api/resources';
import type { DocumentTier, DocumentType } from '../api/types';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

export default function AdminTypesPage() {
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [tiers, setTiers] = useState<DocumentTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Search and Filter
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('ALL');

  // Add Dialog
  const [addOpen, setAddOpen] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newTierId, setNewTierId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Edit Dialog
  const [editingType, setEditingType] = useState<DocumentType | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editTierId, setEditTierId] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Confirm Action Dialog
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    actionLabel: string;
    variant?: 'default' | 'destructive';
    onConfirm: () => Promise<void>;
  }>({
    open: false,
    title: '',
    description: '',
    actionLabel: '',
    onConfirm: async () => {},
  });

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([lookupApi.types(true), lookupApi.tiers(true)])
      .then(([typesData, tiersData]) => {
        setTypes(typesData.slice().sort((a, b) => a.code.localeCompare(b.code)));
        setTiers(tiersData.slice().sort((a, b) => a.tierNumber - b.tierNumber));
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function runAction(action: () => Promise<unknown>, successMessage: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    }
  }

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newCode.trim() || !newLabel.trim() || !newTierId) return;
    setSubmitting(true);
    setError(null);
    lookupApi
      .createType(newCode.trim().toUpperCase(), newLabel.trim(), Number(newTierId))
      .then(() => {
        setNotice(`Document type ${newCode.trim().toUpperCase()} created.`);
        setAddOpen(false);
        setNewCode('');
        setNewLabel('');
        setNewTierId('');
        load();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setSubmitting(false));
  }

  function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editingType || !editLabel.trim() || !editTierId) return;
    setEditSubmitting(true);
    setError(null);
    lookupApi
      .updateType(editingType.id, {
        label: editLabel.trim(),
        tierId: Number(editTierId),
      })
      .then(() => {
        setNotice(`Document type ${editingType.code} updated.`);
        setEditingType(null);
        load();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setEditSubmitting(false));
  }

  async function promptToggleType(type: DocumentType) {
    if (!type.active) {
      await runAction(
        () => lookupApi.updateType(type.id, { active: true }),
        `Document type ${type.code} activated.`,
      );
      return;
    }

    try {
      const { documents } = await lookupApi.usageType(type.id);
      const usageDetail =
        documents > 0
          ? `${documents} existing document(s) keep using this type and stay searchable.`
          : 'No documents currently reference this type.';

      setConfirmDialog({
        open: true,
        title: `Deactivate Type ${type.code}?`,
        description: `${usageDetail} Are you sure you want to deactivate ${type.code} (${type.label})? New documents will not be able to select it.`,
        actionLabel: 'Deactivate',
        variant: 'destructive',
        onConfirm: async () => {
          await runAction(
            () => lookupApi.updateType(type.id, { active: false }),
            `Document type ${type.code} deactivated.`,
          );
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check type usage.');
    }
  }

  async function promptDeleteType(type: DocumentType) {
    try {
      const { documents } = await lookupApi.usageType(type.id);
      if (documents > 0) {
        setError(
          `Cannot delete Document Type ${type.code}: it is referenced by ${documents} document(s). Deactivate it instead.`,
        );
        return;
      }

      setConfirmDialog({
        open: true,
        title: `Delete Type ${type.code}?`,
        description: `This will permanently remove Document Type ${type.code} (${type.label}). This action cannot be undone.`,
        actionLabel: 'Delete',
        variant: 'destructive',
        onConfirm: async () => {
          await runAction(() => lookupApi.deleteType(type.id), `Document type ${type.code} deleted.`);
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check type usage.');
    }
  }

  const filteredTypes = types.filter((type) => {
    if (tierFilter !== 'ALL' && String(type.tierId) !== tierFilter) {
      return false;
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const codeMatch = type.code.toLowerCase().includes(q);
      const labelMatch = type.label.toLowerCase().includes(q);
      if (!codeMatch && !labelMatch) return false;
    }
    return true;
  });

  const hasActiveFilters = search.trim() !== '' || tierFilter !== 'ALL';

  return (
    <>
      <PageHeader
        title="Document Types"
        actions={
          <Button onClick={() => setAddOpen(true)} size="sm">
            <Plus className="mr-1.5 size-4" />
            Add Type
          </Button>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <p className="text-sm text-muted-foreground">
          Controlled document classifications, prefixes, and tier assignments.
        </p>
        <Badge variant="secondary" className="shrink-0">
          {filteredTypes.length} of {types.length} {types.length === 1 ? 'type' : 'types'}
        </Badge>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-xl border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
          {notice}
        </div>
      )}

      {/* Filter Toolbar */}
      <Card className="mb-4 py-3">
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by code or label…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-8"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <Select value={tierFilter} onValueChange={setTierFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All tiers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All tiers</SelectItem>
              {tiers.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  Tier {t.tierNumber} — {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('');
                setTierFilter('ALL');
              }}
            >
              <X className="mr-1 size-3.5" />
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Types Table */}
      <Card className="py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Code</TableHead>
                <TableHead>Label</TableHead>
                <TableHead className="w-[200px]">Tier</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[180px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && types.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center">
                    <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              )}
              {!loading && filteredTypes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8">
                    <EmptyState
                      icon={FileType2}
                      message="No document types match the current criteria."
                      cta={
                        hasActiveFilters && (
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto p-0"
                            onClick={() => {
                              setSearch('');
                              setTierFilter('ALL');
                            }}
                          >
                            Reset filters
                          </Button>
                        )
                      }
                    />
                  </TableCell>
                </TableRow>
              )}
              {filteredTypes.map((type) => {
                const tier = tiers.find((t) => t.id === type.tierId);
                return (
                  <TableRow key={type.id}>
                    <TableCell>
                      <Badge variant="outline" className="font-semibold tracking-wide">
                        {type.code}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium text-foreground">{type.label}</TableCell>
                    <TableCell>
                      {tier ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-muted-foreground">
                            Tier {tier.tierNumber}
                          </span>
                          <span className="text-xs text-muted-foreground truncate max-w-[140px]">
                            {tier.label}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {type.active ? (
                        <Badge className="bg-success/15 text-success border-transparent">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-muted-foreground">
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          title="Edit document type"
                          onClick={() => {
                            setEditingType(type);
                            setEditLabel(type.label);
                            setEditTierId(String(type.tierId));
                          }}
                        >
                          <Pencil className="size-3.5" />
                          <span className="sr-only sm:not-sr-only sm:ml-1 text-xs">Edit</span>
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          title={type.active ? 'Deactivate type' : 'Activate type'}
                          onClick={() => promptToggleType(type)}
                        >
                          <Power className="size-3.5" />
                          <span className="sr-only sm:not-sr-only sm:ml-1 text-xs">
                            {type.active ? 'Deactivate' : 'Activate'}
                          </span>
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          title="Delete type"
                          onClick={() => promptDeleteType(type)}
                        >
                          <Trash2 className="size-3.5" />
                          <span className="sr-only sm:not-sr-only sm:ml-1 text-xs">Delete</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Type Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Document Type</DialogTitle>
            <DialogDescription>
              Create a new document type classification code.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="type-code">Code</Label>
              <Input
                id="type-code"
                required
                maxLength={32}
                placeholder="e.g. SOP, WI, POL"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                className="font-mono uppercase"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="type-label">Label</Label>
              <Input
                id="type-label"
                required
                maxLength={255}
                placeholder="e.g. Standard Operating Procedure"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="type-tier">Tier</Label>
              <Select value={newTierId} onValueChange={setNewTierId} required>
                <SelectTrigger id="type-tier">
                  <SelectValue placeholder="Choose tier…" />
                </SelectTrigger>
                <SelectContent>
                  {tiers
                    .filter((t) => t.active)
                    .map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        Tier {t.tierNumber} — {t.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating…' : 'Add Type'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Type Dialog */}
      <Dialog open={!!editingType} onOpenChange={(open) => !open && setEditingType(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Document Type {editingType?.code}</DialogTitle>
            <DialogDescription>
              Update the description or assigned tier for {editingType?.code}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-type-label">Label</Label>
              <Input
                id="edit-type-label"
                required
                maxLength={255}
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-type-tier">Tier</Label>
              <Select value={editTierId} onValueChange={setEditTierId} required>
                <SelectTrigger id="edit-type-tier">
                  <SelectValue placeholder="Choose tier…" />
                </SelectTrigger>
                <SelectContent>
                  {tiers
                    .filter((t) => t.active)
                    .map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        Tier {t.tierNumber} — {t.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setEditingType(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={editSubmitting}>
                {editSubmitting ? 'Saving…' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <AlertDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmDialog.variant ?? 'default'}
              onClick={async () => {
                await confirmDialog.onConfirm();
              }}
            >
              {confirmDialog.actionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
