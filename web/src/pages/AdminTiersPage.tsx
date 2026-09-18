import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Layers, Loader2, Pencil, Plus, Trash2, Power } from 'lucide-react';
import { lookupApi } from '../api/resources';
import type { DocumentTier } from '../api/types';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
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

export default function AdminTiersPage() {
  const [tiers, setTiers] = useState<DocumentTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Add Dialog
  const [addOpen, setAddOpen] = useState(false);
  const [newTierNumber, setNewTierNumber] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Edit Dialog
  const [editingTier, setEditingTier] = useState<DocumentTier | null>(null);
  const [editLabel, setEditLabel] = useState('');
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
    lookupApi
      .tiers(true)
      .then((data) => {
        setTiers(data.slice().sort((a, b) => a.tierNumber - b.tierNumber));
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
    if (!newTierNumber || !newLabel.trim()) return;
    setSubmitting(true);
    setError(null);
    lookupApi
      .createTier(Number(newTierNumber), newLabel.trim())
      .then(() => {
        setNotice(`Tier ${newTierNumber} created.`);
        setAddOpen(false);
        setNewTierNumber('');
        setNewLabel('');
        load();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setSubmitting(false));
  }

  function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editingTier || !editLabel.trim()) return;
    setEditSubmitting(true);
    setError(null);
    lookupApi
      .updateTier(editingTier.id, { label: editLabel.trim() })
      .then(() => {
        setNotice(`Tier ${editingTier.tierNumber} updated.`);
        setEditingTier(null);
        load();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setEditSubmitting(false));
  }

  async function promptToggleTier(tier: DocumentTier) {
    if (!tier.active) {
      await runAction(
        () => lookupApi.updateTier(tier.id, { active: true }),
        `Tier ${tier.tierNumber} activated.`,
      );
      return;
    }

    try {
      const { documentTypes } = await lookupApi.usageTier(tier.id);
      const usageDetail =
        documentTypes > 0
          ? `${documentTypes} document type(s) currently reference this tier and will continue to work.`
          : 'No document types currently reference this tier.';

      setConfirmDialog({
        open: true,
        title: `Deactivate Tier ${tier.tierNumber}?`,
        description: `${usageDetail} Are you sure you want to deactivate Tier ${tier.tierNumber} (${tier.label})?`,
        actionLabel: 'Deactivate',
        variant: 'destructive',
        onConfirm: async () => {
          await runAction(
            () => lookupApi.updateTier(tier.id, { active: false }),
            `Tier ${tier.tierNumber} deactivated.`,
          );
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check tier usage.');
    }
  }

  async function promptDeleteTier(tier: DocumentTier) {
    try {
      const { documentTypes } = await lookupApi.usageTier(tier.id);
      if (documentTypes > 0) {
        setError(
          `Cannot delete Tier ${tier.tierNumber}: it is referenced by ${documentTypes} document type(s). Deactivate it instead.`,
        );
        return;
      }

      setConfirmDialog({
        open: true,
        title: `Delete Tier ${tier.tierNumber}?`,
        description: `This will permanently remove Tier ${tier.tierNumber} (${tier.label}). This action cannot be undone.`,
        actionLabel: 'Delete',
        variant: 'destructive',
        onConfirm: async () => {
          await runAction(() => lookupApi.deleteTier(tier.id), `Tier ${tier.tierNumber} deleted.`);
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check tier usage.');
    }
  }

  return (
    <>
      <PageHeader
        title="Document Tiers"
        actions={
          <Button onClick={() => setAddOpen(true)} size="sm">
            <Plus className="mr-1.5 size-4" />
            Add Tier
          </Button>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <p className="text-sm text-muted-foreground">
          Document hierarchy levels governing review depth and approval requirements.
        </p>
        <Badge variant="secondary" className="shrink-0">
          {tiers.length} {tiers.length === 1 ? 'tier' : 'tiers'}
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

      <Card className="py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Tier</TableHead>
                <TableHead>Label</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[180px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && tiers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-12 text-center">
                    <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              )}
              {!loading && tiers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8">
                    <EmptyState icon={Layers} message="No document tiers defined yet." />
                  </TableCell>
                </TableRow>
              )}
              {tiers.map((tier) => (
                <TableRow key={tier.id}>
                  <TableCell>
                    <Badge variant="outline" className="font-semibold">
                      Tier {tier.tierNumber}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium text-foreground">{tier.label}</TableCell>
                  <TableCell>
                    {tier.active ? (
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
                        title="Edit tier label"
                        onClick={() => {
                          setEditingTier(tier);
                          setEditLabel(tier.label);
                        }}
                      >
                        <Pencil className="size-3.5" />
                        <span className="sr-only sm:not-sr-only sm:ml-1 text-xs">Edit</span>
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2"
                        title={tier.active ? 'Deactivate tier' : 'Activate tier'}
                        onClick={() => promptToggleTier(tier)}
                      >
                        <Power className="size-3.5" />
                        <span className="sr-only sm:not-sr-only sm:ml-1 text-xs">
                          {tier.active ? 'Deactivate' : 'Activate'}
                        </span>
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        title="Delete tier"
                        onClick={() => promptDeleteTier(tier)}
                      >
                        <Trash2 className="size-3.5" />
                        <span className="sr-only sm:not-sr-only sm:ml-1 text-xs">Delete</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Tier Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Document Tier</DialogTitle>
            <DialogDescription>
              Define a new document hierarchy level.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tier-number">Tier number</Label>
              <Input
                id="tier-number"
                type="number"
                min={1}
                required
                placeholder="e.g. 1"
                value={newTierNumber}
                onChange={(e) => setNewTierNumber(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tier-label">Label</Label>
              <Input
                id="tier-label"
                required
                maxLength={255}
                placeholder="e.g. Level 1 — Strategic & Policy"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating…' : 'Add Tier'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Tier Dialog */}
      <Dialog open={!!editingTier} onOpenChange={(open) => !open && setEditingTier(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Tier {editingTier?.tierNumber}</DialogTitle>
            <DialogDescription>
              Update the label description for Tier {editingTier?.tierNumber}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-tier-label">Label</Label>
              <Input
                id="edit-tier-label"
                required
                maxLength={255}
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setEditingTier(null)}>
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
