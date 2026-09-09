import { api } from './client';
import type {
  Department,
  DocumentDetail,
  DocumentTier,
  DocumentType,
  DocumentsPage,
  DocumentVersion,
  RoleRow,
  UserRow,
  UserSummary,
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
  uploadVersion: (id: number, file: File, changeNotes: string | null) => {
    const form = new FormData();
    form.set('file', file);
    if (changeNotes) form.set('change_notes', changeNotes);
    return api.postForm<DocumentVersion>(`/documents/${id}/versions`, form);
  },
};

export const userApi = {
  list: () => api.get<UserRow[]>('/users'),
  create: (body: {
    name: string;
    email: string;
    departmentId: number;
    password: string;
    roles?: string[];
  }) => api.post<UserRow>('/users', body),
  update: (
    id: number,
    patch: { name?: string; departmentId?: number; adUsername?: string; active?: boolean; roles?: string[] },
  ) => api.patch<UserRow>(`/users/${id}`, patch),
  changePassword: (id: number, body: { currentPassword?: string; newPassword: string }) =>
    api.post<void>(`/users/${id}/password`, body),
  roles: () => api.get<RoleRow[]>('/roles'),
};
