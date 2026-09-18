import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { lookupApi } from '../api/resources';
import type { DepartmentCandidateUser, DepartmentMember, MembershipLevel } from '../api/types';
import { EmptyState } from './EmptyState';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { Label } from './ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';

const LEVELS: { value: MembershipLevel; label: string; desc: string }[] = [
  { value: 'MANAGER', label: 'Manager', desc: 'Full control, members & document management' },
  { value: 'COLLABORATOR', label: 'Collaborator', desc: 'Edit all docs, delete own docs' },
  { value: 'CONTRIBUTOR', label: 'Contributor', desc: 'Create & edit own docs only' },
  { value: 'CONSUMER', label: 'Consumer', desc: 'Read-only access to released docs' },
];

export default function DepartmentMembersPanel({
  departmentId,
  departmentCode,
}: {
  departmentId: number;
  departmentCode?: string;
}) {
  const [members, setMembers] = useState<DepartmentMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Add Member Modal State
  const [addOpen, setAddOpen] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<DepartmentCandidateUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedLevel, setSelectedLevel] = useState<MembershipLevel>('CONTRIBUTOR');
  const [adding, setAdding] = useState(false);

  // Remove Member Modal State
  const [memberToRemove, setMemberToRemove] = useState<DepartmentMember | null>(null);
  const [removing, setRemoving] = useState(false);

  const loadMembers = useCallback(() => {
    lookupApi
      .departmentMembers(departmentId)
      .then(setMembers)
      .catch((err: Error) => setError(err.message));
  }, [departmentId]);

  useEffect(loadMembers, [loadMembers]);

  function openAddModal() {
    setError(null);
    setNotice(null);
    setSelectedUserId('');
    setSelectedLevel('CONTRIBUTOR');
    setAddOpen(true);
    setLoadingUsers(true);

    lookupApi
      .departmentAvailableUsers(departmentId)
      .then(setAvailableUsers)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingUsers(false));
  }

  function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedUserId) return;

    setAdding(true);
    setError(null);
    lookupApi
      .addDepartmentMember(departmentId, {
        userId: Number(selectedUserId),
        level: selectedLevel,
      })
      .then((newMember) => {
        setNotice(`Added ${newMember.name} as ${newMember.level}.`);
        setAddOpen(false);
        loadMembers();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setAdding(false));
  }

  function handleRemoveMember() {
    if (!memberToRemove) return;
    setRemoving(true);
    setError(null);
    lookupApi
      .removeDepartmentMember(departmentId, memberToRemove.userId)
      .then(() => {
        setNotice(`Removed ${memberToRemove.name} from department.`);
        setMemberToRemove(null);
        loadMembers();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setRemoving(false));
  }

  function changeLevel(userId: number, level: MembershipLevel) {
    setError(null);
    setNotice(null);
    lookupApi
      .updateDepartmentMember(departmentId, userId, level)
      .then((updated) => {
        setMembers((prev) => (prev ?? []).map((m) => (m.userId === userId ? updated : m)));
        setNotice(`Updated ${updated.name}'s role to ${updated.level}.`);
      })
      .catch((err: Error) => setError(err.message));
  }

  return (
    <Card className="rounded-2xl border border-border/40 bg-card p-5 shadow-xs space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <span>Members & Roles</span>
            {members && (
              <Badge variant="secondary" className="rounded-full text-[11px] px-2 py-0">
                {members.length}
              </Badge>
            )}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage departmental members and permission tiers.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs rounded-xl shadow-xs"
          onClick={openAddModal}
        >
          <Plus className="size-3.5" />
          <span>Add Member</span>
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs font-medium text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          {notice}
        </div>
      )}

      {members === null ? (
        <div className="py-6 text-center text-xs text-muted-foreground">Loading members…</div>
      ) : (
        <div className="rounded-xl border border-border/40 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border/40 hover:bg-transparent">
                <TableHead className="text-xs font-semibold">Name</TableHead>
                <TableHead className="text-xs font-semibold">Email</TableHead>
                <TableHead className="w-24 text-xs font-semibold">Status</TableHead>
                <TableHead className="w-44 text-xs font-semibold">Department Role</TableHead>
                <TableHead className="w-16 text-right text-xs font-semibold" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.userId} className="border-border/30 hover:bg-muted/40 transition-colors">
                  <TableCell className="text-xs font-medium text-foreground">
                    {member.name}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {member.email}
                  </TableCell>
                  <TableCell>
                    {member.userActive ? (
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
                  </TableCell>
                  <TableCell>
                    <Select
                      value={member.level}
                      onValueChange={(val) => changeLevel(member.userId, val as MembershipLevel)}
                    >
                      <SelectTrigger
                        aria-label={`Role for ${member.name}`}
                        className="h-8 text-xs rounded-lg border-border/40 bg-background"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-border/40 shadow-lg">
                        {LEVELS.map((lvl) => (
                          <SelectItem key={lvl.value} value={lvl.value} className="text-xs">
                            <div className="flex flex-col">
                              <span className="font-semibold">{lvl.label}</span>
                              <span className="text-[10px] text-muted-foreground">{lvl.desc}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setMemberToRemove(member)}
                      title={`Remove ${member.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}

              {members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center">
                    <EmptyState
                      icon={Users}
                      message='No members assigned to this department yet. Click "+ Add Member" to add colleagues.'
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Member Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="size-4 text-primary" />
              <span>Add Department Member</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Select an active colleague to add to department{' '}
              <strong className="font-semibold text-foreground">{departmentCode || 'this department'}</strong>.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddMember} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="candidate-user" className="text-xs font-semibold">
                User
              </Label>
              {loadingUsers ? (
                <div className="py-2 text-xs text-muted-foreground">Loading eligible colleagues…</div>
              ) : availableUsers.length === 0 ? (
                <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground border border-border/40">
                  All active users in the company are already members of this department.
                </div>
              ) : (
                <Select value={selectedUserId} onValueChange={setSelectedUserId} required>
                  <SelectTrigger id="candidate-user" className="w-full text-xs rounded-xl border-border/40">
                    <SelectValue placeholder="Select an eligible colleague…" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-border/40 shadow-xl max-h-56">
                    {availableUsers.map((u) => (
                      <SelectItem key={u.id} value={String(u.id)} className="text-xs">
                        {u.name} <span className="text-muted-foreground">({u.email})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="candidate-level" className="text-xs font-semibold">
                Department Role
              </Label>
              <Select
                value={selectedLevel}
                onValueChange={(val) => setSelectedLevel(val as MembershipLevel)}
              >
                <SelectTrigger id="candidate-level" className="w-full text-xs rounded-xl border-border/40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border/40 shadow-xl">
                  {LEVELS.map((lvl) => (
                    <SelectItem key={lvl.value} value={lvl.value} className="text-xs">
                      <div className="flex flex-col">
                        <span className="font-semibold">{lvl.label}</span>
                        <span className="text-[10px] text-muted-foreground">{lvl.desc}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAddOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={adding || !selectedUserId || availableUsers.length === 0}
              >
                {adding ? 'Adding…' : 'Add to Department'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Remove Member AlertDialog */}
      <AlertDialog
        open={Boolean(memberToRemove)}
        onOpenChange={(open) => !open && setMemberToRemove(null)}
      >
        <AlertDialogContent className="sm:max-w-md rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Member from Department?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground space-y-2">
              <p>
                Are you sure you want to remove <strong className="text-foreground">{memberToRemove?.name}</strong>{' '}
                ({memberToRemove?.email}) from this department?
              </p>
              <p>
                They will lose all permissions to create or edit documents in this department. Any documents previously authored by them will remain securely stored under this department.
              </p>
              {memberToRemove?.level === 'MANAGER' && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 text-[11px] font-medium text-amber-800 dark:text-amber-400">
                  Notice: This user is currently a Department Manager. Ensure another manager or admin is available to oversee this department.
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveMember}
              disabled={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removing ? 'Removing…' : 'Remove Member'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
