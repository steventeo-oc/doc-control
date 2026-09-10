import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function Layout() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="layout">
      <header className="topbar">
        <span className="brand">Document Control</span>
        <nav>
          <NavLink to="/" end>
            Documents
          </NavLink>
          <NavLink to="/tasks">My tasks</NavLink>
          <NavLink to="/lookups">Lookups</NavLink>
          {isAdmin && <NavLink to="/users">Users</NavLink>}
        </nav>
        <div className="session">
          <span>
            {user?.name}{' '}
            <small>({user?.departments.map((d) => d.code).join(', ')})</small>
          </span>
          <button type="button" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
