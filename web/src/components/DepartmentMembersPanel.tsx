import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Plus, Search, Trash2, UserPlus, Users, X } from 'lucide-react';
import { lookupApi } from '../api/resources';
import type { DepartmentCandidateUser, DepartmentMember, MembershipLevel } from '../api/types';
import { cn } from '../lib/utils';
import { EmptyState } from './EmptyState';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { Input } from './ui/input';
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
  onMemberChange,
}: {
  departmentId: number;
  departmentCode?: string;
  onMemberChange?: () => void;
}) {
  const [members, setMembers] = useState<DepartmentMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Add Member Modal State
  const [addOpen, setAddOpen] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<DepartmentCandidateUser[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedUserObj, setSelectedUserObj] = useState<DepartmentCandidateUser | null>(null);
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

  const [memberSearch, setMemberSearch] = useState('');

  const filteredMembers = useMemo(() => {
    if (!members) return [];
    if (!memberSearch.trim()) return members;
    const q = memberSearch.trim().toLowerCase();
    return members.filter(
      (m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
    );
  }, [members, memberSearch]);

  // Debounced Search for Available Users
  useEffect(() => {
    if (!addOpen) return;
    const timer = setTimeout(() => {
      setLoadingUsers(true);
      lookupApi
        .departmentAvailableUsers(departmentId, userSearch.trim() || undefined)
        .then((res) => {
          setAvailableUsers(res);
        })
        .catch(() => setAvailableUsers([]))
        .finally(() => setLoadingUsers(false));
    }, 250);

    return () => clearTimeout(timer);
  }, [addOpen, userSearch, departmentId]);

  function openAddModal() {
    setError(null);
    setNotice(null);
    setSelectedUserId('');
    setSelectedUserObj(null);
    setUserSearch('');
    setSelectedLevel('CONTRIBUTOR');
    setAddOpen(true);
    setLoadingUsers(true);

    lookupApi
      .departmentAvailableUsers(departmentId)
      .then(setAvailableUsers)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingUsers(false));
  }

  function handleSelectUser(u: DepartmentCandidateUser) {
    setSelectedUserId(String(u.id));
    setSelectedUserObj(u);
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
        onMemberChange?.();
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
        onMemberChange?.();
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
            Manage departmental members and permission levels.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              placeholder="Search members..."
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="h-8 pl-8 pr-7 rounded-xl border-border/40 bg-background"
            />
            {memberSearch && (
              <button
                type="button"
                onClick={() => setMemberSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 rounded-xl shadow-xs whitespace-nowrap"
            onClick={openAddModal}
          >
            <Plus className="size-3.5" />
            <span>Add Member</span>
          </Button>
        </div>
      </div>

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

      {members === null ? (
        <div className="py-6 text-center text-sm text-muted-foreground">Loading members…</div>
      ) : (
        <div className="rounded-xl border border-border/40 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border/40 hover:bg-transparent">
                <TableHead className="font-semibold">Name</TableHead>
                <TableHead className="font-semibold">Email</TableHead>
                <TableHead className="w-24 font-semibold">Status</TableHead>
                <TableHead className="w-44 font-semibold">Department Role</TableHead>
                <TableHead className="w-16 text-right font-semibold" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredMembers.map((member) => (
                <TableRow key={member.userId} className="border-border/30 hover:bg-muted/40 transition-colors">
                  <TableCell className="font-medium text-foreground">
                    {member.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {member.email}
                  </TableCell>
                  <TableCell>
                    {member.userActive ? (
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

              {filteredMembers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center">
                    <EmptyState
                      icon={Users}
                      message={
                        memberSearch
                          ? `No members match "${memberSearch}".`
                          : 'No members assigned to this department yet. Click "+ Add Member" to add colleagues.'
                      }
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Member Dialog with Searchable Combobox */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="size-4 text-primary" />
              <span>Add Department Member</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Search and select an active employee to add to department{' '}
              <strong className="font-semibold text-foreground">{departmentCode || 'this department'}</strong>.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddMember} className="space-y-4 mt-2 w-full min-w-0">
            {/* Search Input */}
            <div className="space-y-1.5 w-full min-w-0">
              <Label htmlFor="candidate-search" className="text-xs font-semibold">
                Search Employee
              </Label>
              <div className="relative w-full min-w-0">
                <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  id="candidate-search"
                  placeholder="Type name or email to search…"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="pl-8 pr-8 text-xs rounded-xl border-border/40 w-full"
                  autoComplete="off"
                />
                {userSearch && (
                  <button
                    type="button"
                    onClick={() => setUserSearch('')}
                    className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground bg-transparent border-0 p-0 cursor-pointer"
                    title="Clear search"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Candidate List or Loading State */}
            <div className="space-y-1 w-full min-w-0">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
                <span>Eligible Colleagues</span>
                {loadingUsers ? (
                  <span className="flex items-center gap-1">
                    <Loader2 className="size-3 animate-spin" /> Searching…
                  </span>
                ) : (
                  <span>{availableUsers.length} found</span>
                )}
              </div>

              <div className="max-h-48 overflow-y-auto overflow-x-hidden rounded-xl border border-border/40 p-1 space-y-1 bg-muted/20 w-full min-w-0">
                {availableUsers.map((u) => {
                  const isSelected = selectedUserId === String(u.id);
                  const initials = (u.name || '')
                    .split(' ')
                    .filter(Boolean)
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase() || 'U';

                  return (
                    <div
                      key={u.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelectUser(u)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelectUser(u);
                        }
                      }}
                      className={cn(
                        'w-full flex items-center justify-between p-2 rounded-xl text-left transition-all text-xs cursor-pointer min-w-0 select-none',
                        isSelected
                          ? 'bg-primary/10 border border-primary/30 text-foreground font-medium ring-1 ring-primary/20'
                          : 'hover:bg-muted/60 text-foreground border border-transparent'
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1 overflow-hidden">
                        <div
                          className={cn(
                            'size-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0',
                            isSelected
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted-foreground/15 text-muted-foreground'
                          )}
                        >
                          {initials}
                        </div>
                        <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
                          <span className="font-medium truncate text-foreground block">{u.name}</span>
                          <span className="text-[11px] text-muted-foreground truncate block">{u.email}</span>
                        </div>
                      </div>
                      {isSelected && <Check className="size-4 text-primary shrink-0 ml-2" />}
                    </div>
                  );
                })}

                {!loadingUsers && availableUsers.length === 0 && (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    {userSearch
                      ? `No eligible colleagues found matching "${userSearch}".`
                      : 'All active employees are already members of this department.'}
                  </div>
                )}
              </div>
            </div>

            {/* Selected User Indicator */}
            {selectedUserObj && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-2.5 flex items-center justify-between gap-2 text-xs w-full min-w-0">
                <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                  <Check className="size-3.5 text-primary shrink-0" />
                  <span className="text-muted-foreground shrink-0">Selected:</span>
                  <span className="font-semibold text-foreground truncate min-w-0">{selectedUserObj.name}</span>
                  <span className="text-muted-foreground truncate text-[11px] shrink-0 max-w-[150px]">
                    ({selectedUserObj.email})
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => {
                    setSelectedUserId('');
                    setSelectedUserObj(null);
                  }}
                >
                  Change
                </Button>
              </div>
            )}

            {/* Role Selection */}
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
                disabled={adding || !selectedUserId}
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
