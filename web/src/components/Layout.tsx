import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { lookupApi, userApi } from '../api/resources';
import type { Department } from '../api/types';

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
 */
type SectionItem = { label: string; to: string };

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

  async function handleChangePassword() {
    const currentPassword = window.prompt('Current password:');
    if (!currentPassword) return;
    const newPassword = window.prompt('New password (min 8 chars):');
    if (!newPassword || !user) return;
    try {
      await userApi.changePassword(user.id, { currentPassword, newPassword });
      window.alert('Password changed.');
    } catch (err) {
      window.alert((err as Error).message);
    }
  }

  return (
    <div className="layout">
      <header className="topbar">
        <span className="brand">Document Control</span>
        <nav>
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/documents">Documents</NavLink>
          <NavLink to="/tasks">Tasks</NavLink>
          <NavLink to="/departments">Departments</NavLink>
          <NavLink to="/activity">Activity</NavLink>
          {isAdmin && <NavLink to="/admin/types">Admin</NavLink>}
        </nav>
        <details className="account-menu">
          <summary>
            {user?.name} <small>({user?.email})</small>
          </summary>
          <div className="account-panel">
            <div className="account-identity">
              <strong>{user?.name}</strong>
              <small>{user?.email}</small>
              <small>{user?.departments.map((d) => `${d.code}: ${d.level}`).join(' · ')}</small>
            </div>
            <button type="button" onClick={handleChangePassword}>
              Change password
            </button>
            <button type="button" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </details>
      </header>
      <div className="shell">
        {sidebarItems.length > 0 && (
          <aside className="sidebar">
            {sidebarItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={() =>
                  'sidebar-link' + (location.pathname + location.search === item.to ? ' active' : '')
                }
              >
                {item.label}
              </NavLink>
            ))}
          </aside>
        )}
        {/* The dashboard uses the full viewport width (round-two polish);
            the section pages keep the centered 1100px reading width. */}
        <main className={'content' + (section === 'dashboard' ? ' content-wide' : '')}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
