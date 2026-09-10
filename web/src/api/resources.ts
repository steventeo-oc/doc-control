import { api } from './client';
import type {
  AcknowledgmentAccess,
  AcknowledgmentRecord,
  AcknowledgmentStatus,
  Department,
  DocumentDetail,
  DocumentTier,
  DocumentType,
  DocumentsPage,
  DocumentVersion,
  RoleRow,
  UserRow,
  UserSummary,
  WorkflowInstance,
  WorkflowTask,
} from './types';

export interface DocumentFilters {
  type?: string;
  department?: string;
  status?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export const authApi = {
  me: () => api.get<UserSummary>('/auth/me'),
  logout: () => api.post<void>('/auth/logout'),
};

export const lookupApi = {
  tiers: () => api.get<DocumentTier[]>('/document-tiers'),
  types: () => api.get<DocumentType[]>('/document-types'),
  createType: (code: string, label: string, tierId: number) =>
    api.post<DocumentType>('/document-types', { code, label, tierId }),
  updateType: (id: number, patch: { label?: string; tierId?: number; active?: boolean }) =>
    api.patch<DocumentType>(`/document-types/${id}`, patch),
  departments: () => api.get<Department[]>('/departments'),
  createDepartment: (code: string, label: string) =>
    api.post<Department>('/departments', { code, label }),
  updateDepartment: (id: number, patch: { label?: string; active?: boolean }) =>
    api.patch<Department>(`/departments/${id}`, patch),
};

export const documentApi = {
  list: (filters: DocumentFilters) => {
    const params = new URLSearchParams();
    if (filters.type) params.set('type', filters.type);
    if (filters.department) params.set('department', filters.department);
    if (filters.status) params.set('status', filters.status);
    if (filters.q) params.set('q', filters.q);
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

export const userApi = {
  list: () => api.get<UserRow[]>('/users'),
  create: (body: {
    name: string;
    email: string;
    departmentIds: number[];
    password: string;
    roles?: string[];
  }) => api.post<UserRow>('/users', body),
  update: (
    id: number,
    patch: {
      name?: string;
      departmentIds?: number[];
      adUsername?: string;
      active?: boolean;
      roles?: string[];
    },
  ) => api.patch<UserRow>(`/users/${id}`, patch),
  changePassword: (id: number, body: { currentPassword?: string; newPassword: string }) =>
    api.post<void>(`/users/${id}/password`, body),
  roles: () => api.get<RoleRow[]>('/roles'),
};
