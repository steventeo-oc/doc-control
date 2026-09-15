import { FormEvent, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDownIcon } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { lookupApi, userApi } from '../api/resources';
import type { Department } from '../api/types';
import { ApiError } from '../api/client';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

/**
 * The app shell (nav restructure plan-back section 1; Dashboard added per
 * the dashboard plan-back, Activity per the activity plan-back): top
 * navigation with the section set — Dashboard | Documents | Tasks |
 * Departments | Activity | Admin — plus an Account menu, and a
 * per-section sidebar rendered from this config when the active section
 * has entries (the dashboard has none and renders full-width). The
 * Departments sidebar is built from the signed-in user's memberships;
 * admins see every department. Activity's sidebar is its scope filter
 * (Mine / My Departments, plus Company-wide for admins).
 *
 * Design-redesign Phase 1: reskinned with Tailwind/shadcn — the Account
 * menu is now a Radix DropdownMenu (was a native <details>) and the
 * password-change flow is a Dialog with real fields (was window.prompt /
 * window.alert, F2 in the plan-back). The nav row also gained
 * overflow-x-auto so it scrolls instead of clipping "Admin" at narrower
 * widths (UI/UX review finding #4) — no items were removed or reordered.
 */
type SectionItem = { label: string; to: string };

const NAV_LINK_CLASS =
  'shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/10 hover:text-white [&.active]:bg-white/15 [&.active]:text-white';

export default function Layout() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const section = location.pathname.split('/')[1] || 'documents';

  // The Departments sidebar: the user's own memberships, or every
  // department for admins (fetched with includeInactive, inactive marked).
  const [adminDepartments, setAdminDepartments] = useState<Department[]>([]);
  useEffect(() => {
    if (isAdmin) {
      lookupApi.departments(true).then(setAdminDepartments).catch(() => undefined);
    }
  }, [isAdmin]);

  const departmentItems: SectionItem[] = (isAdmin
    ? adminDepartments
    : user?.departments ?? []
  )
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((d) => ({
      label: d.code + (d.active ? '' : ' (inactive)'),
      to: `/departments/${d.id}`,
    }));

  const sections: Record<string, { label: string; items: SectionItem[] }> = {
    documents: {
      label: 'Documents',
      items: [
        { label: 'All Documents', to: '/documents?view=all' },
        { label: 'My Documents', to: '/documents?view=mine' },
        { label: 'Trash', to: '/documents?view=trash' },
      ],
    },
    tasks: {
      label: 'Tasks',
      items: [
        { label: 'My Approvals', to: '/tasks?view=approvals' },
        { label: 'Pending My Acknowledgment', to: '/tasks?view=acknowledgments' },
        { label: 'Started by Me', to: '/tasks?view=started' },
      ],
    },
    departments: { label: 'Departments', items: departmentItems },
    // Activity's scope filter wears the section sidebar (activity plan-back
    // F4): Mine / My Departments for everyone, Company for admins.
    activity: {
      label: 'Activity',
      items: [
        { label: 'My activity', to: '/activity?scope=mine' },
        { label: 'My departments', to: '/activity?scope=departments' },
        ...(isAdmin ? [{ label: 'Company-wide', to: '/activity?scope=company' }] : []),
      ],
    },
  };

  const activeSection = sections[section];
  const sidebarItems = activeSection?.items ?? [];

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  // --- Change-password dialog (F2: replaces window.prompt/window.alert) ---
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);

  function openPasswordDialog() {
    setCurrentPassword('');
    setNewPassword('');
    setPasswordError(null);
    setPasswordSuccess(false);
    setPasswordOpen(true);
  }

  async function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    setPasswordSubmitting(true);
    setPasswordError(null);
    try {
      await userApi.changePassword(user.id, { currentPassword, newPassword });
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : 'Password change failed.');
    } finally {
      setPasswordSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-[52px] items-center gap-6 bg-slate-900 px-6 text-white">
        <span className="shrink-0 font-bold tracking-wide">Document Control</span>
        <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          <NavLink to="/dashboard" className={NAV_LINK_CLASS}>
            Dashboard
          </NavLink>
          <NavLink to="/documents" className={NAV_LINK_CLASS}>
            Documents
          </NavLink>
          <NavLink to="/tasks" className={NAV_LINK_CLASS}>
            Tasks
          </NavLink>
          <NavLink to="/departments" className={NAV_LINK_CLASS}>
            Departments
          </NavLink>
          <NavLink to="/activity" className={NAV_LINK_CLASS}>
            Activity
          </NavLink>
          {isAdmin && (
            <NavLink to="/admin/types" className={NAV_LINK_CLASS}>
              Admin
            </NavLink>
          )}
        </nav>

        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-sm text-white outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/50">
            {user?.name} <span className="text-xs text-slate-300">({user?.email})</span>
            <ChevronDownIcon className="size-3.5 text-slate-300" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-foreground">{user?.name}</span>
                <span className="text-xs text-muted-foreground">{user?.email}</span>
                <span className="text-xs text-muted-foreground">
                  {user?.departments.map((d) => `${d.code}: ${d.level}`).join(' · ')}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(event) => {
                // Prevent Radix from returning focus to the trigger before the
                // Dialog mounts — a known conflict when a Dialog is opened
                // from inside a DropdownMenuItem's onSelect handler. The
                // preventDefault also stops Radix's own close, so the menu
                // is closed explicitly here (verified: otherwise the Dialog
                // opens layered over a still-open menu).
                event.preventDefault();
                setMenuOpen(false);
                openPasswordDialog();
              }}
            >
              Change password
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void handleLogout()}>Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="flex items-start gap-6">
        {sidebarItems.length > 0 && (
          <aside className="flex min-w-[220px] flex-col gap-0.5 border-r border-border p-4">
            {sidebarItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={() =>
                  cn(
                    'rounded-md px-3 py-1.5 text-sm text-foreground no-underline hover:bg-accent',
                    location.pathname + location.search === item.to &&
                      'bg-primary/10 font-medium text-primary hover:bg-primary/10',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </aside>
        )}
        {/* The dashboard uses the full viewport width (round-two polish);
            the section pages keep the centered 1100px reading width. */}
        <main
          className={cn(
            'flex-1 p-6',
            section === 'dashboard' ? 'max-w-none' : 'mx-auto w-full max-w-[1100px]',
          )}
        >
          <Outlet />
        </main>
      </div>

      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>
              Enter your current password and a new password (minimum 8 characters).
            </DialogDescription>
          </DialogHeader>
          {passwordSuccess ? (
            <div className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
              Password changed.
            </div>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={handlePasswordSubmit}>
              {passwordError && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {passwordError}
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="current-password">Current password</Label>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={passwordSubmitting}>
                  {passwordSubmitting ? 'Changing…' : 'Change password'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
