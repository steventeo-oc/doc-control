import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Power,
  Search,
  Users as UsersIcon,
  X,
} from 'lucide-react';
import { lookupApi, userApi } from '../api/resources';
import type { Department, MembershipLevel, RoleRow, UserRow } from '../api/types';
import { useAuth } from '../auth/AuthContext';
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

const MEMBERSHIP_LEVELS: { level: MembershipLevel; label: string; desc: string }[] = [
  { level: 'MANAGER', label: 'Manager', desc: 'Full department document & member management' },
  { level: 'COLLABORATOR', label: 'Collaborator', desc: 'Author, draft, submit, and review documents' },
  { level: 'CONTRIBUTOR', label: 'Contributor', desc: 'Submit drafts and view department documents' },
  { level: 'CONSUMER', label: 'Consumer', desc: 'Read released documents and complete acknowledgments' },
];

function getInitials(name?: string | null): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Search & Filters
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // --- Add User Dialog ---
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [addShowPassword, setAddShowPassword] = useState(false);
  const [addRoles, setAddRoles] = useState<string[]>(['User']);
  const [addDeptId, setAddDeptId] = useState<string>('');
  const [addDeptLevel, setAddDeptLevel] = useState<MembershipLevel>('COLLABORATOR');
  const [addSubmitting, setAddSubmitting] = useState(false);

  // --- Manage Departments Dialog ---
  const [deptUser, setDeptUser] = useState<UserRow | null>(null);
  const [userDeptMap, setUserDeptMap] = useState<Record<number, MembershipLevel>>({});
  const [deptSubmitting, setDeptSubmitting] = useState(false);

  // --- Reset Password Dialog ---
  const [pwdUser, setPwdUser] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSubmitting, setPwdSubmitting] = useState(false);

  // --- Confirmation Dialog ---
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
    Promise.all([
      userApi.list(),
      userApi.roles(),
      lookupApi.departments(true),
    ])
      .then(([usersData, rolesData, deptsData]) => {
        setUsers(usersData.slice().sort((a, b) => a.name.localeCompare(b.name)));
        setRoles(rolesData);
        setDepartments(deptsData.slice().sort((a, b) => a.code.localeCompare(b.code)));
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

  // --- User Creation ---
  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!addName.trim() || !addEmail.trim() || !addPassword) return;
    if (addPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setAddSubmitting(true);
    setError(null);

    const initialDepts = addDeptId
      ? [{ departmentId: Number(addDeptId), level: addDeptLevel }]
      : [];

    userApi
      .create({
        name: addName.trim(),
        email: addEmail.trim().toLowerCase(),
        password: addPassword,
        roles: addRoles,
        departments: initialDepts,
      })
      .then(() => {
        setNotice(`User ${addEmail.trim().toLowerCase()} created successfully.`);
        setAddOpen(false);
        setAddName('');
        setAddEmail('');
        setAddPassword('');
        setAddRoles(['User']);
        setAddDeptId('');
        setAddDeptLevel('COLLABORATOR');
        load();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setAddSubmitting(false));
  }

  // --- Department Memberships Management ---
  function openDeptDialog(user: UserRow) {
    setDeptUser(user);
    const map: Record<number, MembershipLevel> = {};
    user.departments.forEach((d) => {
      map[d.id] = d.level;
    });
    setUserDeptMap(map);
  }

  function handleSaveDepartments(e: FormEvent) {
    e.preventDefault();
    if (!deptUser) return;
    setDeptSubmitting(true);
    setError(null);

    const newMemberships = Object.entries(userDeptMap).map(([deptIdStr, level]) => ({
      departmentId: Number(deptIdStr),
      level,
    }));

    userApi
      .update(deptUser.id, { departments: newMemberships })
      .then(() => {
        setNotice(`Departments updated for ${deptUser.name}.`);
        setDeptUser(null);
        load();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setDeptSubmitting(false));
  }

  // --- Password Reset ---
  function openPasswordDialog(user: UserRow) {
    setPwdUser(user);
    setNewPassword('');
    setConfirmPassword('');
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setPwdError(null);
  }

  function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pwdUser) return;
    if (newPassword !== confirmPassword) {
      setPwdError('New passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setPwdError('Password must be at least 8 characters.');
      return;
    }

    setPwdSubmitting(true);
    setPwdError(null);

    userApi
      .changePassword(pwdUser.id, { newPassword })
      .then(() => {
        setNotice(`Password reset for ${pwdUser.name}.`);
        setPwdUser(null);
      })
      .catch((err: Error) => setPwdError(err.message))
      .finally(() => setPwdSubmitting(false));
  }

  // --- Role Toggle ---
  function handleToggleRole(user: UserRow, roleName: string) {
    if (user.id === me?.id && roleName === 'Admin') {
      setError('You cannot remove your own Admin role.');
      return;
    }
    const hasRole = user.roles.includes(roleName);
    const updatedRoles = hasRole
      ? user.roles.filter((r) => r !== roleName)
      : [...user.roles, roleName];

    runAction(
      () => userApi.update(user.id, { roles: updatedRoles }),
      `Updated roles for ${user.name}.`,
    );
  }

  // --- Activate / Deactivate Toggle ---
  function promptToggleActive(user: UserRow) {
    if (user.id === me?.id) {
      setError('You cannot deactivate your own account.');
      return;
    }

    const action = user.active ? 'deactivate' : 'activate';
    setConfirmDialog({
      open: true,
      title: `${user.active ? 'Deactivate' : 'Activate'} ${user.name}?`,
      description: user.active
        ? `Deactivating ${user.name} (${user.email}) will immediately prevent them from logging in or accessing controlled documents.`
        : `Reactivating ${user.name} will restore their login access and department permissions.`,
      actionLabel: user.active ? 'Deactivate' : 'Activate',
      variant: user.active ? 'destructive' : 'default',
      onConfirm: async () => {
        await runAction(
          () => userApi.update(user.id, { active: !user.active }),
          `User ${user.name} ${action}d.`,
        );
      },
    });
  }

  // --- Filtering ---
  const filteredUsers = users.filter((u) => {
    if (roleFilter !== 'ALL' && !u.roles.includes(roleFilter)) {
      return false;
    }
    if (statusFilter === 'ACTIVE' && !u.active) return false;
    if (statusFilter === 'INACTIVE' && u.active) return false;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const nameMatch = u.name.toLowerCase().includes(q);
      const emailMatch = u.email.toLowerCase().includes(q);
      const deptMatch = u.departments.some(
        (d) => d.code.toLowerCase().includes(q) || d.label.toLowerCase().includes(q),
      );
      if (!nameMatch && !emailMatch && !deptMatch) return false;
    }
    return true;
  });

  const hasActiveFilters = search.trim() !== '' || roleFilter !== 'ALL' || statusFilter !== 'ALL';

  return (
    <>
      <PageHeader
        title="Users"
        actions={
          <Button onClick={() => setAddOpen(true)} size="sm">
            <Plus className="mr-1.5 size-4" />
            Add User
          </Button>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <p className="text-sm text-muted-foreground">
          Manage employee accounts, role assignments, and department membership permissions.
        </p>
        <Badge variant="secondary" className="shrink-0">
          {filteredUsers.length} of {users.length} {users.length === 1 ? 'user' : 'users'}
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
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by name, email, or department…"
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

          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All roles</SelectItem>
              <SelectItem value="Admin">Admin</SelectItem>
              <SelectItem value="User">User</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="INACTIVE">Inactive</SelectItem>
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('');
                setRoleFilter('ALL');
                setStatusFilter('ALL');
              }}
            >
              <X className="mr-1 size-3.5" />
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card className="py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[240px]">User</TableHead>
                <TableHead>Department Memberships</TableHead>
                <TableHead className="w-[150px]">Roles</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead className="w-[180px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center">
                    <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              )}
              {!loading && filteredUsers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8">
                    <EmptyState
                      icon={UsersIcon}
                      message="No users match the selected criteria."
                      cta={
                        hasActiveFilters && (
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto p-0"
                            onClick={() => {
                              setSearch('');
                              setRoleFilter('ALL');
                              setStatusFilter('ALL');
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
              {filteredUsers.map((user) => {
                const isMe = user.id === me?.id;
                const visibleDepts = user.departments.slice(0, 3);
                const extraCount = user.departments.length - visibleDepts.length;

                return (
                  <TableRow key={user.id}>
                    {/* User Identity */}
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {getInitials(user.name)}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="font-medium text-foreground truncate flex items-center gap-1.5">
                            {user.name}
                            {isMe && (
                              <span className="text-[10px] text-muted-foreground font-normal">
                                (You)
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground truncate">{user.email}</span>
                        </div>
                      </div>
                    </TableCell>

                    {/* Department Memberships */}
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {user.departments.length === 0 ? (
                          <span className="text-xs text-muted-foreground italic">
                            No departments
                          </span>
                        ) : (
                          visibleDepts.map((d) => (
                            <span
                              key={d.id}
                              className={
                                d.level === 'MANAGER'
                                  ? 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-success/10 text-success border border-success/20'
                                  : d.level === 'COLLABORATOR'
                                  ? 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-info/10 text-info border border-info/20'
                                  : 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-muted/70 text-muted-foreground border border-border/30'
                              }
                              title={`${d.label} (${d.level})`}
                            >
                              <span className="font-semibold">{d.code}</span>
                              <span className="text-[9px] opacity-80 lowercase">
                                {d.level.toLowerCase()}
                              </span>
                            </span>
                          ))
                        )}
                        {extraCount > 0 && (
                          <span className="text-[10px] text-muted-foreground font-medium">
                            +{extraCount} more
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground ml-1"
                          onClick={() => openDeptDialog(user)}
                        >
                          <Pencil className="size-3 mr-1" />
                          Manage
                        </Button>
                      </div>
                    </TableCell>

                    {/* Roles */}
                    <TableCell>
                      <div className="flex items-center gap-1 flex-wrap">
                        {roles.map((role) => {
                          const hasRole = user.roles.includes(role.name);
                          const isAdminRole = role.name === 'Admin';
                          const disabled = isMe && isAdminRole;

                          return (
                            <button
                              key={role.id}
                              type="button"
                              disabled={disabled}
                              onClick={() => handleToggleRole(user, role.name)}
                              title={
                                disabled
                                  ? 'You cannot change your own Admin role'
                                  : `Click to ${hasRole ? 'remove' : 'add'} ${role.name} role`
                              }
                              className={
                                hasRole
                                  ? isAdminRole
                                    ? 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-primary text-primary-foreground transition-opacity hover:opacity-85 disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed'
                                    : 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-secondary text-secondary-foreground transition-opacity hover:opacity-85 disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed'
                                  : 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border border-border/60 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed'
                              }
                            >
                              {hasRole && <Check className="size-2.5 stroke-[3]" />}
                              {role.name}
                            </button>
                          );
                        })}
                      </div>
                    </TableCell>

                    {/* Status */}
                    <TableCell>
                      {user.active ? (
                        <Badge className="bg-success/15 text-success border-transparent">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-muted-foreground">
                          Inactive
                        </Badge>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          title="Reset password"
                          onClick={() => openPasswordDialog(user)}
                        >
                          <KeyRound className="size-3.5" />
                          <span className="sr-only sm:not-sr-only sm:ml-1 text-xs">Reset pwd</span>
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className={
                            user.active
                              ? 'h-8 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive'
                              : 'h-8 px-2 text-success hover:bg-success/10 hover:text-success'
                          }
                          disabled={isMe}
                          title={
                            isMe
                              ? 'You cannot deactivate your own account'
                              : user.active
                              ? 'Deactivate account'
                              : 'Activate account'
                          }
                          onClick={() => promptToggleActive(user)}
                        >
                          <Power className="size-3.5" />
                          <span className="sr-only sm:not-sr-only sm:ml-1 text-xs">
                            {user.active ? 'Deactivate' : 'Activate'}
                          </span>
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

      {/* --- Add User Dialog --- */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
            <DialogDescription>
              Create a new user account with initial roles and department permissions.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="add-name">Full name</Label>
                <Input
                  id="add-name"
                  required
                  placeholder="e.g. John Doe"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="add-email">Email</Label>
                <Input
                  id="add-email"
                  type="email"
                  required
                  placeholder="john.doe@company.com"
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-pwd">Initial password</Label>
              <div className="relative">
                <Input
                  id="add-pwd"
                  type={addShowPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  placeholder="Min 8 characters"
                  value={addPassword}
                  onChange={(e) => setAddPassword(e.target.value)}
                  className="pr-9"
                />
                <button
                  type="button"
                  aria-label={addShowPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setAddShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {addShowPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {/* Roles */}
            <div className="flex flex-col gap-1.5">
              <Label>Assigned roles</Label>
              <div className="flex items-center gap-3 pt-1">
                {roles.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addRoles.includes(r.name)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setAddRoles((prev) => [...prev, r.name]);
                        } else {
                          setAddRoles((prev) => prev.filter((name) => name !== r.name));
                        }
                      }}
                      className="rounded border-border"
                    />
                    <span>{r.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Primary Department */}
            <div className="flex flex-col gap-2 rounded-xl border border-border/50 bg-muted/20 p-3">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Primary Department Assignment
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Select value={addDeptId} onValueChange={setAddDeptId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select department…" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments
                      .filter((d) => d.active)
                      .map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>
                          {d.code} — {d.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>

                <Select
                  value={addDeptLevel}
                  onValueChange={(v) => setAddDeptLevel(v as MembershipLevel)}
                  disabled={!addDeptId}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEMBERSHIP_LEVELS.map((m) => (
                      <SelectItem key={m.level} value={m.level}>
                        {m.label} ({m.level})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={addSubmitting}>
                {addSubmitting ? 'Creating…' : 'Create User'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --- Manage Departments Dialog --- */}
      <Dialog open={!!deptUser} onOpenChange={(open) => !open && setDeptUser(null)}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Department Memberships — {deptUser?.name}</DialogTitle>
            <DialogDescription>
              Assign or update department access and permission levels for {deptUser?.email}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveDepartments} className="flex flex-col flex-1 min-h-0 gap-4">
            <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2 max-h-[50vh]">
              {departments.map((dept) => {
                const isAssigned = userDeptMap[dept.id] !== undefined;
                const currentLevel = userDeptMap[dept.id] ?? 'COLLABORATOR';

                return (
                  <div
                    key={dept.id}
                    className={
                      isAssigned
                        ? 'flex items-center justify-between gap-3 p-2.5 rounded-xl border border-primary/30 bg-primary/5 transition-colors'
                        : 'flex items-center justify-between gap-3 p-2.5 rounded-xl border border-border/40 bg-card hover:bg-muted/30 transition-colors'
                    }
                  >
                    <label className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isAssigned}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setUserDeptMap((prev) => {
                            const next = { ...prev };
                            if (checked) {
                              next[dept.id] = 'COLLABORATOR';
                            } else {
                              delete next[dept.id];
                            }
                            return next;
                          });
                        }}
                        className="size-4 rounded border-border"
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                          {dept.code}
                          {!dept.active && (
                            <span className="text-[10px] text-muted-foreground">(inactive)</span>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground truncate">{dept.label}</span>
                      </div>
                    </label>

                    {isAssigned && (
                      <div className="w-[170px] shrink-0">
                        <Select
                          value={currentLevel}
                          onValueChange={(lvl) => {
                            setUserDeptMap((prev) => ({
                              ...prev,
                              [dept.id]: lvl as MembershipLevel,
                            }));
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MEMBERSHIP_LEVELS.map((m) => (
                              <SelectItem key={m.level} value={m.level} className="text-xs">
                                {m.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-border/40">
              <Button type="button" variant="outline" onClick={() => setDeptUser(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={deptSubmitting}>
                {deptSubmitting ? 'Saving…' : 'Save Memberships'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --- Reset Password Dialog --- */}
      <Dialog open={!!pwdUser} onOpenChange={(open) => !open && setPwdUser(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password — {pwdUser?.name}</DialogTitle>
            <DialogDescription>
              Set a new secure password for {pwdUser?.email} (minimum 8 characters).
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
            {pwdError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
                {pwdError}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pwd-new">New password</Label>
              <div className="relative">
                <Input
                  id="pwd-new"
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  placeholder="Min 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="pr-9"
                />
                <button
                  type="button"
                  aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowNewPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showNewPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pwd-confirm">Confirm new password</Label>
              <div className="relative">
                <Input
                  id="pwd-confirm"
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pr-9"
                />
                <button
                  type="button"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setPwdUser(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pwdSubmitting}>
                {pwdSubmitting ? 'Resetting…' : 'Reset Password'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --- Confirmation Dialog --- */}
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
