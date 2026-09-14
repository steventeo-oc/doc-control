import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import DocumentsPage from './pages/DocumentsPage';
import DocumentDetailPage from './pages/DocumentDetailPage';
import TasksPage from './pages/TasksPage';
import DepartmentsPage from './pages/DepartmentsPage';
import DepartmentDetailPage from './pages/DepartmentDetailPage';
import AdminTypesPage from './pages/AdminTypesPage';
import AdminTiersPage from './pages/AdminTiersPage';
import UsersPage from './pages/UsersPage';

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="page-loading">Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        {/* Dashboard landing page (plan-back F1/F4): an explicit /dashboard
            path — overloading / would trip the Layout's || 'documents'
            section fallback — with the index and catch-all pointing at it. */}
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="documents/:id" element={<DocumentDetailPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="departments" element={<DepartmentsPage />} />
        <Route path="departments/:id" element={<DepartmentDetailPage />} />
        <Route path="admin/types" element={<AdminTypesPage />} />
        <Route path="admin/tiers" element={<AdminTiersPage />} />
        <Route path="admin/users" element={<UsersPage />} />
        {/* redirects for the pre-restructure paths (plan-back section 1) */}
        <Route path="lookups" element={<Navigate to="/admin/types" replace />} />
        <Route path="users" element={<Navigate to="/admin/users" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
