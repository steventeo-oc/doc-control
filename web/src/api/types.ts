// Mirrors the backend DTOs (camelCase over the wire).

export interface Department {
  id: number;
  code: string;
  label: string;
  active: boolean;
}

export interface DocumentTier {
  id: number;
  tierNumber: number;
  label: string;
  active: boolean;
}

export interface DocumentType {
  id: number;
  code: string;
  label: string;
  tierId: number;
  active: boolean;
}

export interface DocumentSummary {
  id: number;
  documentNumber: string;
  name: string;
  status: string;
  documentTypeCode: string;
  departmentCode: string;
  ownerUserId: number;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentsPage {
  content: DocumentSummary[];
  page: number;
  pageSize: number;
  totalElements: number;
  totalPages: number;
}

export interface DocumentDetail {
  id: number;
  documentNumber: string;
  name: string;
  status: string;
  documentTypeId: number;
  documentTypeCode: string;
  departmentId: number;
  departmentCode: string;
  sequenceNumber: number;
  ownerUserId: number;
  ownerName: string;
  currentVersionId: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DocumentVersion {
  id: number;
  documentId: number;
  versionNumber: number;
  status: string;
  changeNotes: string | null;
  fileName: string;
  uploadedByUserId: number;
  uploadedByName: string;
  uploadedAt: string;
}

export interface UserSummary {
  id: number;
  name: string;
  email: string;
  department: Department;
  roles: string[];
  active: boolean;
}

export interface UserRow {
  id: number;
  name: string;
  email: string;
  department: Department;
  adUsername: string | null;
  active: boolean;
  roles: string[];
}

export interface RoleRow {
  id: number;
  name: string;
}

export const DOCUMENT_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'released',
  'superseded',
  'obsolete',
] as const;
