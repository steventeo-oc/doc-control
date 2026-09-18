import { FormEvent, useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Building2,
  ClipboardCheck,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { lookupApi, userApi, workflowApi } from '../api/resources';
import type { Department, TaskCounts, UserSummary } from '../api/types';
import { ApiError } from '../api/client';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
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
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from './ui/sheet';

/**
 * The app shell (nav restructure plan-back section 1; Dashboard added per
 * the dashboard plan-back, Activity per the activity plan-back).
 *
 * Dashboard_And_Navigation_PlanBack.md F4 (decided: Option 2): on md+ the
 * shell is a fixed-width left rail — brand mark on top, six icon+label
 * section switchers in the middle (Admin only for admins, same as before),
 * and the account menu anchored to the bottom. The per-section sidebar
 * (Documents' All/Mine/Trash, Tasks' three panes, Departments'
 * memberships, Activity's scope filter, and Admin's Types/Tiers/Users per
 * F3) renders as a second column immediately right of the rail. The
 * Dashboard has no sidebar and renders full-width, as before.
 *
 * Responsive collapse (same plan-back, "Responsive collapse"): below md
 * (768px) the rail and the secondary sidebar are hidden and replaced by a
 * slim top bar — hamburger trigger, brand mark, account menu — plus one
 * slide-out drawer stacking the section switcher and the current section's
 * sub-nav. Desktop (md+) markup and geometry are unchanged; the drawer is
 * additive for narrow widths. The drawer closes itself whenever a link
 * inside it is followed.
 */
type SectionItem = { label: string; to: string; badge?: number | string | null };

/**
 * The section switcher's single source of truth — the desktop rail and the
 * mobile drawer both render from this list. `adminOnly` entries are filtered
 * by role at render time (same visibility rule as before).
 */
const RAIL_ITEMS: { to: string; icon: LucideIcon; label: string; adminOnly?: boolean }[] = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  // Sections with a fixed default view point at the same canonical URL as
  // their first sidebar item, so the sidebar's exact-match highlight works
  // when navigating via the rail (a bare path matches nothing).
  { to: '/documents?view=all', icon: FileText, label: 'Documents' },
  { to: '/tasks?view=approvals', icon: ListChecks, label: 'Tasks' },
  { to: '/departments', icon: Building2, label: 'Depts' },
  { to: '/activity?scope=mine', icon: Activity, label: 'Activity' },
  { to: '/admin/types', icon: Settings, label: 'Admin', adminOnly: true },
];

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
      className="flex w-full flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] leading-tight text-slate-300 select-none transition-colors hover:bg-white/10 hover:text-white [&.active]:bg-white/15 [&.active]:text-white"
    >
      <Icon className="size-5" aria-hidden="true" />
      <span className="text-center">{label}</span>
    </NavLink>
  );
}

/**
 * The account menu (identity with department levels, Change password, Log
 * out) — one shared content definition rendered by BOTH chrome surfaces:
 * the desktop rail's bottom anchor (side="right") and the mobile top bar
 * (side="bottom"). Only the trigger's position differs; the contents must
 * never fork. Open state is per-instance because both triggers exist in the
 * DOM at once (one behind `hidden md:flex`, one behind `md:hidden`) — a
 * single shared state would portal-render two menus simultaneously.
 */
function getInitials(name?: string | null): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function AccountMenu(props: {
  user: UserSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: 'right' | 'bottom';
  onOpenPassword: () => void;
  onLogout: () => void;
}) {
  const initials = getInitials(props.user?.name);
  const isAdmin = props.user?.roles.includes('Admin') ?? false;

  return (
    <DropdownMenu open={props.open} onOpenChange={props.onOpenChange}>
      <DropdownMenuTrigger
        aria-label="Account menu"
        title={props.user ? `${props.user.name} (${props.user.email})` : 'Account menu'}
        className={cn(
          // bg-transparent/border-0: raw <button> elements fall through to
          // the legacy base-layer button rule (white bg + gray border) —
          // fine on un-migrated pages, wrong on this dark chrome.
          'shrink-0 rounded-lg border-0 bg-transparent text-slate-300 transition-colors outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/50',
          props.side === 'right'
            ? // Desktop rail: the same stacked icon+label treatment as
              // RailLink, so the account entry reads as part of the same
              // list instead of a floating icon.
              'flex w-full flex-col items-center gap-1.5 px-1 py-2 text-[11px] leading-tight'
            : // Mobile top bar: there is horizontal room here — icon with a
              // visible label beside it.
              'flex items-center gap-2 px-2 py-1.5 text-sm',
        )}
      >
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-semibold text-white">
          {initials}
        </div>
        <span>{props.side === 'right' ? 'Account' : (props.user?.name ?? 'Account')}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={props.side}
        align="end"
        className="w-72 p-1.5 rounded-2xl border border-border/50 bg-popover shadow-xl shadow-black/8 ring-1 ring-black/[0.04]"
      >
        <DropdownMenuLabel className="font-normal p-2 pb-2.5">
          <div className="flex items-start gap-2.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {initials}
            </div>
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1">
                <span className="font-medium text-foreground truncate text-sm">
                  {props.user?.name}
                </span>
                {isAdmin && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 shrink-0 font-medium">
                    Admin
                  </Badge>
                )}
              </div>
              <span className="text-xs text-muted-foreground truncate">
                {props.user?.email}
              </span>
            </div>
          </div>

          {/* Department Memberships */}
          {props.user?.departments && props.user.departments.length > 0 && (
            <div className="mt-2.5 pt-2 border-t border-border/40 flex flex-wrap gap-1">
              {props.user.departments.map((d) => (
                <span
                  key={d.id}
                  className={cn(
                    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border border-transparent',
                    d.level === 'MANAGER'
                      ? 'bg-success/10 text-success border-success/20'
                      : d.level === 'COLLABORATOR'
                      ? 'bg-info/10 text-info border-info/20'
                      : 'bg-muted/70 text-muted-foreground border-border/30',
                  )}
                  title={`${d.label} (${d.level})`}
                >
                  <span className="font-semibold">{d.code}</span>
                  <span className="text-[9px] opacity-80 lowercase">{d.level.toLowerCase()}</span>
                </span>
              ))}
            </div>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <NavLink to="/activity?scope=mine" className="flex items-center gap-2 cursor-pointer text-sm">
            <Activity className="size-4 text-muted-foreground" />
            <span>My activity</span>
          </NavLink>
        </DropdownMenuItem>

        <DropdownMenuItem
          className="flex items-center gap-2 cursor-pointer text-sm"
          onSelect={(event) => {
            // Prevent Radix from returning focus to the trigger before the
            // Dialog mounts — a known conflict when a Dialog is opened
            // from inside a DropdownMenuItem's onSelect handler. The
            // preventDefault also stops Radix's own close, so the menu
            // is closed explicitly here (verified: otherwise the Dialog
            // opens layered over a still-open menu).
            event.preventDefault();
            props.onOpenChange(false);
            props.onOpenPassword();
          }}
        >
          <KeyRound className="size-4 text-muted-foreground" />
          <span>Change password</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="flex items-center gap-2 cursor-pointer text-sm text-destructive focus:text-destructive focus:bg-destructive/10"
          onSelect={props.onLogout}
        >
          <LogOut className="size-4" />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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

  const [taskCounts, setTaskCounts] = useState<TaskCounts | null>(null);

  const refreshTaskCounts = useCallback(() => {
    if (user) {
      workflowApi.taskCounts().then(setTaskCounts).catch(() => undefined);
    }
  }, [user]);

  useEffect(() => {
    refreshTaskCounts();
    window.addEventListener('task-counts-updated', refreshTaskCounts);
    return () => window.removeEventListener('task-counts-updated', refreshTaskCounts);
  }, [refreshTaskCounts, location.pathname, location.search]);

  const departmentItems: SectionItem[] = [
    { label: 'Overview', to: '/departments' },
    ...(isAdmin ? adminDepartments : user?.departments ?? [])
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((d) => ({
        label: d.code + (d.active ? '' : ' (inactive)'),
        to: `/departments/${d.id}`,
      })),
  ];

  const sections: Record<string, { label: string; items: SectionItem[] }> = {
    documents: {
      label: 'Documents',
      items: [
        { label: 'All Documents', to: '/documents?view=all' },
        { label: 'My Documents', to: '/documents?view=mine' },
        { label: 'Favorites', to: '/documents?view=favorites' },
        { label: 'Archived', to: '/documents?view=archived' },
      ],
    },
    tasks: {
      label: 'Tasks',
      items: [
        { label: 'My Approvals', to: '/tasks?view=approvals', badge: taskCounts?.approvals },
        { label: 'Pending My Acknowledgment', to: '/tasks?view=acknowledgments', badge: taskCounts?.acknowledgments },
        { label: 'Started by Me', to: '/tasks?view=started', badge: taskCounts?.started },
        { label: 'Delegated by Me', to: '/tasks?view=delegated', badge: taskCounts?.delegated },
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
  const visibleRailItems = RAIL_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  function isSubnavActive(itemTo: string) {
    if (itemTo.includes('?')) {
      return location.pathname + location.search === itemTo;
    }
    if (itemTo === '/departments') {
      return location.pathname === '/departments';
    }
    return location.pathname === itemTo || location.pathname.startsWith(itemTo + '/');
  }

  // --- Change-password dialog (F2: replaces window.prompt/window.alert) ---
  const [passwordOpen, setPasswordOpen] = useState(false);
  // Separate open state per account-menu instance — see AccountMenu's doc.
  const [railMenuOpen, setRailMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);

  function openPasswordDialog() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setPasswordError(null);
    setPasswordSuccess(false);
    setPasswordOpen(true);
  }

  async function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.');
      return;
    }
    setPasswordSubmitting(true);
    setPasswordError(null);
    try {
      await userApi.changePassword(user.id, { currentPassword, newPassword });
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : 'Password change failed.');
    } finally {
      setPasswordSubmitting(false);
    }
  }

  return (
    <div
      className="flex min-h-screen flex-col md:flex-row bg-background"
    >
      {/* Mobile top bar (below md only): hamburger, brand mark, account menu —
          the three ways in, without the full-height rail. */}
      <header className="flex h-12 shrink-0 items-center justify-between bg-slate-900 px-3 text-white md:hidden">
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="Open navigation"
              className="flex size-9 items-center justify-center rounded-md border-0 bg-transparent outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/50"
            >
              <Menu className="size-5" aria-hidden="true" />
            </button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-72 gap-0 bg-slate-900 p-0 text-white [&>button[data-slot=sheet-close]]:text-slate-300"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <nav className="flex flex-col gap-1 p-3 pt-12" aria-label="Sections">
              {visibleRailItems.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 select-none transition-colors hover:bg-white/10 hover:text-white [&.active]:bg-white/15 [&.active]:text-white"
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </NavLink>
              ))}
            </nav>
            {sidebarItems.length > 0 && (
              <>
                <div className="mx-3 border-t border-white/10" />
                <p className="px-6 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 select-none">
                  {activeSection.label}
                </p>
                <nav
                  className="flex flex-col gap-0.5 px-3 pb-4"
                  aria-label={`${activeSection.label} pages`}
                >
                  {sidebarItems.map((item) => {
                    const isActive = isSubnavActive(item.to);
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        onClick={() => setDrawerOpen(false)}
                        className={() =>
                          cn(
                            'flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 no-underline select-none transition-colors hover:bg-white/10 hover:text-white',
                            isActive && 'bg-white/15 font-medium text-white hover:bg-white/15',
                          )
                        }
                      >
                        <span>{item.label}</span>
                        {typeof item.badge === 'number' && item.badge > 0 && (
                          <span className="px-1.5 py-0.5 text-xs rounded-full font-semibold bg-white/20 text-white">
                            {item.badge}
                          </span>
                        )}
                      </NavLink>
                    );
                  })}
                </nav>
              </>
            )}
          </SheetContent>
        </Sheet>
        <div className="flex size-8 items-center justify-center rounded-lg bg-white/10">
          <ClipboardCheck className="size-5" aria-hidden="true" />
        </div>
        <AccountMenu
          user={user}
          open={mobileMenuOpen}
          onOpenChange={setMobileMenuOpen}
          side="bottom"
          onOpenPassword={openPasswordDialog}
          onLogout={() => void handleLogout()}
        />
      </header>

      {/* Desktop rail (md+): sticky viewport height so account menu stays anchored */}
      <aside className="hidden w-20 shrink-0 flex-col items-center gap-2 bg-slate-900 py-4 text-white md:flex sticky top-0 h-screen z-20">
        {/* Brand mark: icon only — the rail is too narrow for the wordmark. */}
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/10">
          <ClipboardCheck className="size-6" aria-hidden="true" />
        </div>
        <nav className="flex w-full flex-1 flex-col items-center gap-1 px-1 pt-2">
          {visibleRailItems.map(({ to, icon, label }) => (
            <RailLink key={to} to={to} icon={icon} label={label} />
          ))}
        </nav>
        <AccountMenu
          user={user}
          open={railMenuOpen}
          onOpenChange={setRailMenuOpen}
          side="right"
          onOpenPassword={openPasswordDialog}
          onLogout={() => void handleLogout()}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-6">
          {sidebarItems.length > 0 && (
            <aside className="hidden min-w-[220px] shrink-0 flex-col gap-0.5 border-r border-border p-4 md:flex self-stretch sticky top-0 max-h-[calc(100vh-49px)] overflow-y-auto z-10">
              {sidebarItems.map((item) => {
                const isActive = isSubnavActive(item.to);
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={() =>
                      cn(
                        'flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm text-foreground no-underline select-none hover:bg-accent',
                        isActive && 'bg-primary/10 font-medium text-primary hover:bg-primary/10',
                      )
                    }
                  >
                    <span>{item.label}</span>
                    {typeof item.badge === 'number' && item.badge > 0 && (
                      <span
                        className={cn(
                          'px-1.5 py-0.5 text-xs rounded-full font-semibold',
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted-foreground/15 text-foreground'
                        )}
                      >
                        {item.badge}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </aside>
          )}
          <main
            className={cn(
              'flex-1 p-6 w-full',
              section === 'dashboard' ? 'max-w-none' : 'max-w-[1536px]',
            )}
          >
            <Outlet />
          </main>
        </div>
        <footer className="shrink-0 border-t border-border/40 px-6 py-4 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Overclock Pte. Ltd. All rights reserved.
        </footer>
      </div>

      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>
              Enter your current password and choose a new password (minimum 8 characters).
            </DialogDescription>
          </DialogHeader>
          {passwordSuccess ? (
            <div className="flex flex-col gap-4 py-2">
              <div className="rounded-md bg-success/10 border border-success/20 px-3.5 py-3 text-sm text-success flex items-center gap-2.5">
                <ShieldCheck className="size-5 shrink-0" />
                <span>Your password has been changed successfully.</span>
              </div>
              <DialogFooter>
                <Button type="button" onClick={() => setPasswordOpen(false)}>
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={handlePasswordSubmit}>
              {passwordError && (
                <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
                  {passwordError}
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="current-password">Current password</Label>
                <div className="relative">
                  <Input
                    id="current-password"
                    type={showCurrentPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="pr-9"
                  />
                  <button
                    type="button"
                    aria-label={showCurrentPassword ? 'Hide current password' : 'Show current password'}
                    onClick={() => setShowCurrentPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showCurrentPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-password">New password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="pr-9"
                  />
                  <button
                    type="button"
                    aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                    onClick={() => setShowNewPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showNewPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pr-9"
                  />
                  <button
                    type="button"
                    aria-label={showConfirmPassword ? 'Hide confirmed password' : 'Show confirmed password'}
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPasswordOpen(false)}
                >
                  Cancel
                </Button>
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
