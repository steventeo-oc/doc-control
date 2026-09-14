import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DocumentsPage from './pages/DocumentsPage';
import DocumentDetailPage from './pages/DocumentDetailPage';
import TasksPage from './pages/TasksPage';
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
        <Route index element={<Navigate to="/documents" replace />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="documents/:id" element={<DocumentDetailPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="admin/types" element={<AdminTypesPage />} />
        <Route path="admin/tiers" element={<AdminTiersPage />} />
        <Route path="admin/users" element={<UsersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/documents" replace />} />
    </Routes>
  );
}
