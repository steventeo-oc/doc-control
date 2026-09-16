import { FormEvent, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Building2,
  CircleUserRound,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  ListChecks,
  Settings,
  type LucideIcon,
} from 'lucide-react';
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
 * the dashboard plan-back, Activity per the activity plan-back).
 *
 * Dashboard_And_Navigation_PlanBack.md F4 (decided: Option 2): the old
 * horizontal top bar is replaced by a fixed-width left rail — brand mark
 * on top, six icon+label section switchers in the middle (Admin only for
 * admins, same as before), and the account menu anchored to the bottom.
 * The per-section sidebar (Documents' All/Mine/Trash, Tasks' three panes,
 * Departments' memberships, Activity's scope filter, and Admin's new
 * Types/Tiers/Users per F3) renders as a second column immediately right
 * of the rail — its content, data sources, and width are unchanged. The
 * Dashboard has no sidebar and renders full-width, as before. The mobile
 * hamburger-drawer collapse is a deliberate follow-up round — desktop
 * only here; narrow widths simply keep the fixed rail (shrink-0 stops it
 * ever crushing the content to zero).
 */
type SectionItem = { label: string; to: string };

/**
 * One rail entry: icon stacked above a short label (F4 — labeled, not
 * icon-only-with-tooltip: this app's audience spans experience levels, and
 * discoverability matters more than density here). Same active visual
 * language as the old horizontal pills, applied to the stacked block.
 */
function RailLink({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return (
    <NavLink
      to={to}
      className="flex w-full flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] leading-tight text-slate-300 transition-colors hover:bg-white/10 hover:text-white [&.active]:bg-white/15 [&.active]:text-white"
    >
      <Icon className="size-5" aria-hidden="true" />
      <span className="text-center">{label}</span>
    </NavLink>
  );
}

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
    // F3: Admin previously had no sidebar at all — the only way between
    // Types/Tiers/Users was editing the URL. Same shape as the other four
    // sections, no special-casing.
    admin: {
      label: 'Admin',
      items: [
        { label: 'Types', to: '/admin/types' },
        { label: 'Tiers', to: '/admin/tiers' },
        { label: 'Users', to: '/admin/users' },
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
    <div className="flex min-h-screen">
      <aside className="flex w-20 shrink-0 flex-col items-center gap-2 bg-slate-900 py-4 text-white">
        {/* Brand mark: icon only — the rail is too narrow for the wordmark. */}
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/10">
          <ClipboardCheck className="size-6" aria-hidden="true" />
        </div>
        <nav className="flex w-full flex-1 flex-col items-center gap-1 px-1 pt-2">
          <RailLink to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
          <RailLink to="/documents" icon={FileText} label="Documents" />
          <RailLink to="/tasks" icon={ListChecks} label="Tasks" />
          <RailLink to="/departments" icon={Building2} label="Depts" />
          <RailLink to="/activity" icon={Activity} label="Activity" />
          {isAdmin && <RailLink to="/admin/types" icon={Settings} label="Admin" />}
        </nav>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            aria-label="Account menu"
            className="flex shrink-0 items-center justify-center rounded-full outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <CircleUserRound className="size-7 text-slate-300" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-64">
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
      </aside>

      <div className="flex min-w-0 flex-1 items-start gap-6">
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
            the section pages keep the centered 1100px reading width — now
            measured from the rail's right edge instead of the viewport's. */}
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
