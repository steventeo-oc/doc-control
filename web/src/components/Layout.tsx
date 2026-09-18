import { FormEvent, useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Building2,
  CircleUserRound,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  ListChecks,
  Menu,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { lookupApi, userApi, workflowApi } from '../api/resources';
import type { Department, TaskCounts, UserSummary } from '../api/types';
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
function AccountMenu(props: {
  user: UserSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: 'right' | 'bottom';
  onOpenPassword: () => void;
  onLogout: () => void;
}) {
  return (
    <DropdownMenu open={props.open} onOpenChange={props.onOpenChange}>
      <DropdownMenuTrigger
        aria-label="Account menu"
        title="Account menu"
        className={cn(
          // bg-transparent/border-0: raw <button> elements fall through to
          // the legacy base-layer button rule (white bg + gray border) —
          // fine on un-migrated pages, wrong on this dark chrome.
          'shrink-0 rounded-lg border-0 bg-transparent text-slate-300 transition-colors outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/50',
          props.side === 'right'
            ? // Desktop rail: the same stacked icon+label treatment as
              // RailLink, so the account entry reads as part of the same
              // list instead of a floating icon.
              'flex w-full flex-col items-center gap-1 px-1 py-2 text-[11px] leading-tight'
            : // Mobile top bar: there is horizontal room here — icon with a
              // visible label beside it.
              'flex items-center gap-2 px-2 py-1.5 text-sm',
        )}
      >
        <CircleUserRound
          className={cn('text-slate-300', props.side === 'right' ? 'size-5' : 'size-6')}
          aria-hidden="true"
        />
        <span>Account</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={props.side} align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-foreground">{props.user?.name}</span>
            <span className="text-xs text-muted-foreground">{props.user?.email}</span>
            <span className="text-xs text-muted-foreground">
              {props.user?.departments.map((d) => `${d.code}: ${d.level}`).join(' · ')}
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
            props.onOpenChange(false);
            props.onOpenPassword();
          }}
        >
          Change password
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onLogout}>Log out</DropdownMenuItem>
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

  // --- Change-password dialog (F2: replaces window.prompt/window.alert) ---
  const [passwordOpen, setPasswordOpen] = useState(false);
  // Separate open state per account-menu instance — see AccountMenu's doc.
  const [railMenuOpen, setRailMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
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
    <div
      className={cn(
        'flex min-h-screen flex-col md:flex-row bg-background',
        // Dashboard & navigation plan-back round two: on the dashboard at
        // ≥861px the shell is exactly the viewport and nothing page-scrolls —
        // each dashboard card scrolls internally instead. Every other route,
        // and narrower widths on the dashboard, keep the natural page scroll.
        section === 'dashboard' && 'min-[861px]:h-screen min-[861px]:overflow-hidden',
      )}
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
                    const isActive = location.pathname + location.search === item.to;
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

      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col justify-between',
          section === 'dashboard' && 'min-[861px]:h-screen min-[861px]:min-h-0',
        )}
      >
        <div
          className={cn(
            'flex min-w-0 flex-1 items-start gap-6',
            section === 'dashboard' && 'min-[861px]:items-stretch min-[861px]:min-h-0',
          )}
        >
          {sidebarItems.length > 0 && (
            <aside className="hidden min-w-[220px] shrink-0 flex-col gap-0.5 border-r border-border p-4 md:flex self-stretch sticky top-0 max-h-[calc(100vh-49px)] overflow-y-auto z-10">
              {sidebarItems.map((item) => {
                const isActive = location.pathname + location.search === item.to;
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
          {/* The dashboard uses the full viewport width (round-two polish);
              the section pages keep the 1100px reading width anchored next to
              the sub-nav sidebar with consistent spacing. */}
          <main
            className={cn(
              'flex-1 p-6',
              section === 'dashboard' ? 'max-w-none' : 'w-full max-w-[1100px]',
              section === 'dashboard' &&
                'min-[861px]:flex min-[861px]:flex-col min-[861px]:min-h-0 min-[861px]:overflow-hidden',
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
