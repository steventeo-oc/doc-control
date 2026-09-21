import { api } from './client';
import type { AcknowledgmentAccess, AcknowledgmentRecord, AcknowledgmentStatus, ActivityScope, AuditLogPage, DelegatedTask, Department, DepartmentCandidateUser, DepartmentMember, DocumentDetail, DocumentNumberPreview, DocumentTier, DocumentType, DocumentVersion, DocumentsPage, MembershipLevel, PendingAcknowledgment, ReviewerCandidate, RoleRow, StartedInstance, TaskCounts, UserRow, UserSummary, WorkflowInstance, WorkflowTask } from './types';

export interface DocumentFilters {
  type?: string;
  tier?: number;
  department?: string;
  status?: string;
  q?: string;
  sort?: string;
  /** Trash view (nav restructure plan-back F2): list soft-deleted documents. */
  trashed?: boolean;
  /** Archived view: list retired/obsolete documents. */
  archived?: boolean;
  /** My Documents view: `owner=me` filters to the caller's own documents. */
  owner?: string;
  /** Favorites view: `favorite=true` filters to the caller's starred documents. */
  favorite?: boolean;
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
  forgotPassword: (email: string) => api.post<void>('/auth/forgot-password', { email }),
  resetPassword: (token: string, newPassword: string) =>
    api.post<void>('/auth/reset-password', { token, newPassword }),
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
  getDepartment: (id: number) => api.get<Department>(`/departments/${id}`),
  departmentMembers: (id: number) =>
    api.get<DepartmentMember[]>(`/departments/${id}/members`),
  departmentAvailableUsers: (id: number, q?: string) => {
    const query = q ? `?q=${encodeURIComponent(q)}` : '';
    return api.get<DepartmentCandidateUser[]>(`/departments/${id}/available-users${query}`);
  },
  addDepartmentMember: (id: number, data: { userId: number; level: MembershipLevel }) =>
    api.post<DepartmentMember>(`/departments/${id}/members`, data),
  removeDepartmentMember: (id: number, userId: number) =>
    api.delete(`/departments/${id}/members/${userId}`),
  updateDepartmentMember: (id: number, userId: number, level: MembershipLevel) =>
    api.patch<DepartmentMember>(`/departments/${id}/members/${userId}`, { level }),
  departmentActivity: (id: number, params?: { page?: number; pageSize?: number }) => {
    const q = new URLSearchParams();
    if (params?.page !== undefined) q.set('page', String(params.page));
    if (params?.pageSize !== undefined) q.set('page_size', String(params.pageSize));
    const qs = q.toString() ? `?${q.toString()}` : '';
    return api.get<AuditLogPage>(`/departments/${id}/activity${qs}`);
  },
};

export const documentApi = {
  list: (filters: DocumentFilters) => {
    const params = new URLSearchParams();
    if (filters.type) params.set('type', filters.type);
    if (filters.tier) params.set('tier', String(filters.tier));
    if (filters.department) params.set('department', filters.department);
    if (filters.status) params.set('status', filters.status);
    if (filters.q) params.set('q', filters.q);
    if (filters.sort) params.set('sort', filters.sort);
    if (filters.trashed) params.set('trashed', 'true');
    if (filters.archived) params.set('archived', 'true');
    if (filters.owner) params.set('owner', filters.owner);
    if (filters.favorite) params.set('favorite', 'true');
    params.set('page', String(filters.page ?? 0));
    params.set('page_size', String(filters.pageSize ?? 20));
    return api.get<DocumentsPage>(`/documents?${params.toString()}`);
  },
  exportUrl: (filters: DocumentFilters) => {
    const params = new URLSearchParams();
    if (filters.type) params.set('type', filters.type);
    if (filters.tier) params.set('tier', String(filters.tier));
    if (filters.department) params.set('department', filters.department);
    if (filters.status) params.set('status', filters.status);
    if (filters.q) params.set('q', filters.q);
    if (filters.sort) params.set('sort', filters.sort);
    if (filters.trashed) params.set('trashed', 'true');
    if (filters.archived) params.set('archived', 'true');
    if (filters.owner) params.set('owner', filters.owner);
    if (filters.favorite) params.set('favorite', 'true');
    const qs = params.toString();
    return `/api/documents/export${qs ? `?${qs}` : ''}`;
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
  markObsolete: (id: number, reason?: string) =>
    api.post<void>(`/documents/${id}/obsolete`, { reason }),
  reactivate: (id: number, reason?: string) =>
    api.post<void>(`/documents/${id}/reactivate`, { reason }),
  discardDraftDocument: (id: number) =>
    api.delete(`/documents/${id}/draft`),
  favorite: (id: number) => api.post<void>(`/documents/${id}/favorite`, {}),
  unfavorite: (id: number) => api.delete(`/documents/${id}/favorite`),
  versions: (id: number) => api.get<DocumentVersion[]>(`/documents/${id}/versions`),
  uploadVersion: (id: number, file: File, changeNotes: string | null, changeReference: string | null) => {
    const form = new FormData();
    form.set('file', file);
    if (changeNotes) form.set('change_notes', changeNotes);
    if (changeReference) form.set('change_reference', changeReference);
    return api.postForm<DocumentVersion>(`/documents/${id}/versions`, form);
  },
  restoreVersion: (id: number, versionId: number, reason?: string) =>
    api.post<DocumentVersion>(`/documents/${id}/versions/${versionId}/restore`, { reason }),
  discardDraftVersion: (id: number, versionId: number) =>
    api.delete(`/documents/${id}/versions/${versionId}`),
  previewNextNumber: (documentTypeId: number, departmentId?: number | null) => {
    const params = new URLSearchParams();
    params.set('document_type_id', String(documentTypeId));
    if (departmentId) params.set('department_id', String(departmentId));
    return api.get<DocumentNumberPreview>(`/documents/next-number?${params.toString()}`);
  },
  activity: (id: number) => api.get<DocumentActivity[]>(`/documents/${id}/activity`),
};

export interface DocumentActivity {
  id: number;
  performedAt: string;
  actorId: number | null;
  actorName: string;
  actorEmail: string | null;
  entityType: string;
  entityId: number;
  action: string;
  details?: Record<string, any>;
}

export interface AssigneeInput {
  type: 'USER' | 'ROLE';
  userId?: number;
  roleName?: string;
}

export interface WorkflowFeedback {
  instanceId: number;
  versionNumber: number;
  action: string;
  actorName: string;
  comment: string;
  timestamp: string;
}

export const workflowApi = {
  myTasks: () => api.get<WorkflowTask[]>('/my/tasks'),
  startedByMe: () => api.get<StartedInstance[]>('/my/started-instances'),
  instance: (id: number) => api.get<WorkflowInstance>(`/workflow-instances/${id}`),
  instanceTasks: (id: number) => api.get<WorkflowTask[]>(`/workflow-instances/${id}/tasks`),
  reviewerCandidates: (documentId: number) =>
    api.get<ReviewerCandidate[]>(`/documents/${documentId}/reviewer-candidates`),
  reviewerRoles: (documentId: number) =>
    api.get<string[]>(`/documents/${documentId}/reviewer-roles`),
  activeWorkflow: (documentId: number) =>
    api.get<StartedInstance | null>(`/documents/${documentId}/workflow`),
  cancelWorkflow: (documentId: number) =>
    api.post<void>(`/documents/${documentId}/workflow/cancel`),
  latestFeedback: (documentId: number) =>
    api.get<WorkflowFeedback | null>(`/documents/${documentId}/workflow/latest-feedback`),
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
  delegate: (taskId: string, toUserId: number, message?: string | null) =>
    api.post<WorkflowInstance>(`/workflow-tasks/${taskId}/delegate`, { toUserId, message: message || null }),
  recall: (taskId: string) =>
    api.post<WorkflowInstance>(`/workflow-tasks/${taskId}/recall`),
  delegatedByMe: () => api.get<DelegatedTask[]>('/my/delegated-tasks'),
  taskCounts: () => api.get<TaskCounts>('/my/task-counts'),
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
  departmentId?: number;
  q?: string;
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
    if (filters.departmentId) params.set('department_id', String(filters.departmentId));
    if (filters.q) params.set('q', filters.q);
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
    if (filters.departmentId) params.set('department_id', String(filters.departmentId));
    if (filters.q) params.set('q', filters.q);
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
