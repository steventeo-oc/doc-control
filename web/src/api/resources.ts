import { api } from './client';
import type { AcknowledgmentAccess, AcknowledgmentRecord, AcknowledgmentStatus, ActivityScope, AuditLogPage, Department, DepartmentMember, DocumentDetail, DocumentTier, DocumentType, DocumentVersion, DocumentsPage, MembershipLevel, PendingAcknowledgment, ReviewerCandidate, RoleRow, UserRow, UserSummary, WorkflowInstance, WorkflowTask } from './types';

export interface DocumentFilters {
  type?: string;
  department?: string;
  status?: string;
  q?: string;
  /** Trash view (nav restructure plan-back F2): list soft-deleted documents. */
  trashed?: boolean;
  /** My Documents view: `owner=me` filters to the caller's own documents. */
  owner?: string;
  page?: number;
  pageSize?: number;
}

export const authApi = {
  // POST through the shared client so the CSRF double-submit header is
  // attached — a raw fetch here gets 401-rejected by Spring Security.
  login: (email: string, password: string) =>
    api.post<void>('/auth/login', { email, password }),
  me: () => api.get<UserSummary>('/auth/me'),
  logout: () => api.post<void>('/auth/logout'),
};

export const lookupApi = {
  // The admin/filter shape passes includeInactive so deactivated rows stay
  // visible (reactivation + searching documents that reference them);
  // creation dropdowns use the active-only default and/or filter locally.
  tiers: (includeInactive = false) =>
    api.get<DocumentTier[]>(`/document-tiers${includeInactive ? '?includeInactive=true' : ''}`),
  types: (includeInactive = false) =>
    api.get<DocumentType[]>(`/document-types${includeInactive ? '?includeInactive=true' : ''}`),
  departments: (includeInactive = false) =>
    api.get<Department[]>(`/departments${includeInactive ? '?includeInactive=true' : ''}`),
  usageDepartment: (id: number) => api.get<{ documents: number; users: number }>(`/departments/${id}/usage`),
  usageType: (id: number) => api.get<{ documents: number }>(`/document-types/${id}/usage`),
  usageTier: (id: number) => api.get<{ documentTypes: number }>(`/document-tiers/${id}/usage`),
  createTier: (tierNumber: number, label: string) =>
    api.post<DocumentTier>('/document-tiers', { tierNumber, label }),
  updateTier: (id: number, patch: { label?: string; active?: boolean }) =>
    api.patch<DocumentTier>(`/document-tiers/${id}`, patch),
  deleteTier: (id: number) => api.delete(`/document-tiers/${id}`),
  createType: (code: string, label: string, tierId: number) =>
    api.post<DocumentType>('/document-types', { code, label, tierId }),
  updateType: (id: number, patch: { label?: string; tierId?: number; active?: boolean }) =>
    api.patch<DocumentType>(`/document-types/${id}`, patch),
  deleteType: (id: number) => api.delete(`/document-types/${id}`),
  createDepartment: (code: string, label: string) =>
    api.post<Department>('/departments', { code, label }),
  updateDepartment: (id: number, patch: { label?: string; active?: boolean }) =>
    api.patch<Department>(`/departments/${id}`, patch),
  deleteDepartment: (id: number) => api.delete(`/departments/${id}`),
  departmentMembers: (id: number) =>
    api.get<DepartmentMember[]>(`/departments/${id}/members`),
  updateDepartmentMember: (id: number, userId: number, level: MembershipLevel) =>
    api.patch<DepartmentMember>(`/departments/${id}/members/${userId}`, { level }),
};

export const documentApi = {
  list: (filters: DocumentFilters) => {
    const params = new URLSearchParams();
    if (filters.type) params.set('type', filters.type);
    if (filters.department) params.set('department', filters.department);
    if (filters.status) params.set('status', filters.status);
    if (filters.q) params.set('q', filters.q);
    if (filters.trashed) params.set('trashed', 'true');
    if (filters.owner) params.set('owner', filters.owner);
    params.set('page', String(filters.page ?? 0));
    params.set('page_size', String(filters.pageSize ?? 20));
    return api.get<DocumentsPage>(`/documents?${params.toString()}`);
  },
  get: (id: number) => api.get<DocumentDetail>(`/documents/${id}`),
  create: (documentTypeId: number, departmentId: number, name: string, file: File | null) => {
    const form = new FormData();
    form.set('document_type_id', String(documentTypeId));
    form.set('department_id', String(departmentId));
    form.set('name', name);
    if (file) form.set('file', file);
    return api.postForm<DocumentDetail>('/documents', form);
  },
  update: (id: number, patch: { name?: string; ownerUserId?: number; status?: string }) =>
    api.patch<DocumentDetail>(`/documents/${id}`, patch),
  softDelete: (id: number) => api.delete(`/documents/${id}`),
  restore: (id: number) => api.post<DocumentDetail>(`/documents/${id}/restore`),
  versions: (id: number) => api.get<DocumentVersion[]>(`/documents/${id}/versions`),
  uploadVersion: (id: number, file: File, changeNotes: string | null, changeReference: string | null) => {
    const form = new FormData();
    form.set('file', file);
    if (changeNotes) form.set('change_notes', changeNotes);
    if (changeReference) form.set('change_reference', changeReference);
    return api.postForm<DocumentVersion>(`/documents/${id}/versions`, form);
  },
};

export interface AssigneeInput {
  type: 'USER' | 'ROLE';
  userId?: number;
  roleName?: string;
}

export const workflowApi = {
  myTasks: () => api.get<WorkflowTask[]>('/my/tasks'),
  instance: (id: number) => api.get<WorkflowInstance>(`/workflow-instances/${id}`),
  instanceTasks: (id: number) => api.get<WorkflowTask[]>(`/workflow-instances/${id}/tasks`),
  reviewerCandidates: (documentId: number) =>
    api.get<ReviewerCandidate[]>(`/documents/${documentId}/reviewer-candidates`),
  startApproval: (documentId: number, versionId: number, assignees: AssigneeInput[]) =>
    api.post<WorkflowInstance>(
      `/documents/${documentId}/versions/${versionId}/workflow/start`,
      { assignees },
    ),
  startReviewApproval: (documentId: number, assignees: AssigneeInput[]) =>
    api.post<WorkflowInstance>(`/documents/${documentId}/review-approval`, { assignees }),
  complete: (taskId: string, approved: boolean, comment: string | null, effectiveDate: string | null) =>
    api.post<WorkflowInstance>(`/workflow-tasks/${taskId}/complete`, {
      approved,
      comment,
      effectiveDate,
    }),
  delegate: (taskId: string, toUserId: number) =>
    api.post<WorkflowInstance>(`/workflow-tasks/${taskId}/delegate`, { toUserId }),
};

export const acknowledgmentApi = {
  pending: () => api.get<PendingAcknowledgment[]>('/my/acknowledgments'),
  acknowledge: (documentId: number) =>
    api.post<AcknowledgmentRecord>(`/documents/${documentId}/acknowledge`),
  status: (documentId: number) =>
    api.get<AcknowledgmentStatus>(`/documents/${documentId}/acknowledgments`),
  listAccess: (documentId: number) =>
    api.get<AcknowledgmentAccess[]>(`/documents/${documentId}/acknowledgments/access`),
  grant: (documentId: number, userId: number) =>
    api.post<AcknowledgmentAccess>(`/documents/${documentId}/acknowledgments/access`, { userId }),
  revoke: (documentId: number, userId: number) =>
    api.delete(`/documents/${documentId}/acknowledgments/access/${userId}`),
};

export interface ActivityFilters {
  scope: ActivityScope;
  category?: string;
  /** Inclusive ISO dates (the UI's Today/7/14/28 presets compute these). */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export const auditApi = {
  list: (filters: ActivityFilters) => {
    const params = new URLSearchParams();
    params.set('scope', filters.scope);
    if (filters.category) params.set('category', filters.category);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    params.set('page', String(filters.page ?? 0));
    params.set('page_size', String(filters.pageSize ?? 20));
    return api.get<AuditLogPage>(`/audit-log?${params.toString()}`);
  },
  /** Admin-only CSV export — a plain GET link (session cookie authenticates,
   * no CSRF needed); the backend sets the download filename. */
  exportUrl: (filters: ActivityFilters) => {
    const params = new URLSearchParams();
    params.set('scope', filters.scope);
    if (filters.category) params.set('category', filters.category);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    return `/api/audit-log/export?${params.toString()}`;
  },
};

export const userApi = {
  list: () => api.get<UserRow[]>('/users'),
  create: (body: {
    name: string;
    email: string;
    departments: { departmentId: number; level: MembershipLevel }[];
    password: string;
    roles?: string[];
  }) => api.post<UserRow>('/users', body),
  update: (
    id: number,
    patch: {
      name?: string;
      departments?: { departmentId: number; level: MembershipLevel }[];
      adUsername?: string;
      active?: boolean;
      roles?: string[];
    },
  ) => api.patch<UserRow>(`/users/${id}`, patch),
  changePassword: (id: number, body: { currentPassword?: string; newPassword: string }) =>
    api.post<void>(`/users/${id}/password`, body),
  roles: () => api.get<RoleRow[]>('/roles'),
};
