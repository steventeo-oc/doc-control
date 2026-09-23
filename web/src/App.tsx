import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import DashboardPage from './pages/DashboardPage';
import ActivityPage from './pages/ActivityPage';
import AssistantPage from './pages/AssistantPage';
import DocumentsPage from './pages/DocumentsPage';
import DocumentDetailPage from './pages/DocumentDetailPage';
import TasksPage from './pages/TasksPage';
import DepartmentsPage from './pages/DepartmentsPage';
import DepartmentDetailPage from './pages/DepartmentDetailPage';
import AdminTypesPage from './pages/AdminTypesPage';
import AdminLevelsPage from './pages/AdminLevelsPage';
import UsersPage from './pages/UsersPage';

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
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
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
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
        <Route path="activity" element={<ActivityPage />} />
        {/* "Ask" (AI assistant): a separate service behind /api/assistant. The rail item shows only when the service
            is running and open to the user; the page itself explains itself when it is opened by URL anyway. */}
        <Route path="assistant" element={<AssistantPage />} />
        <Route path="departments" element={<DepartmentsPage />} />
        <Route path="departments/:id" element={<DepartmentDetailPage />} />
        <Route path="departments/:deptId/documents/:id" element={<DocumentDetailPage />} />
        <Route path="admin/types" element={<AdminTypesPage />} />
        <Route path="admin/levels" element={<AdminLevelsPage />} />
        <Route path="admin/users" element={<UsersPage />} />
        {/* redirects for the pre-restructure paths (plan-back section 1) */}
        <Route path="lookups" element={<Navigate to="/admin/types" replace />} />
        <Route path="users" element={<Navigate to="/admin/users" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
