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
  nextReviewDue: string | null;
  reviewOverdue: boolean;
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
  lastReviewedAt: string | null;
  nextReviewDue: string | null;
  reviewOverdue: boolean;
  pendingEffectiveDate: string | null;
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
  changeReference: string | null;
  effectiveAt: string | null;
  fileName: string;
  uploadedByUserId: number;
  uploadedByName: string;
  uploadedAt: string;
}

export interface WorkflowTask {
  id: string;
  name: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  candidateGroups: string[];
  claimedByMe: boolean;
  reapproval: boolean;
  dueDate: string | null;
  documentNumber: string;
  documentId: number;
  versionNumber: number;
}

export interface WorkflowInstance {
  id: number;
  documentId: number;
  documentNumber: string;
  documentVersionId: number;
  versionNumber: number;
  status: string;
  reapproval: boolean;
  startedByName: string;
  startedAt: string;
  completedAt: string | null;
  tasks: WorkflowTask[];
}

export interface AcknowledgmentRecord {
  id: number;
  documentId: number;
  documentVersionId: number;
  userId: number;
  userName: string;
  acknowledgedAt: string;
}

export interface AcknowledgmentUser {
  userId: number;
  userName: string;
}

export interface AcknowledgmentStatus {
  documentId: number;
  documentVersionId: number | null;
  versionNumber: number | null;
  opensAt: string | null;
  closesAt: string | null;
  overdue: boolean;
  requiredCount: number;
  acknowledged: AcknowledgmentRecord[];
  outstanding: AcknowledgmentUser[];
}

export interface AcknowledgmentAccess {
  documentId: number;
  userId: number;
  userName: string;
  grantedByUserId: number;
  grantedByName: string;
  grantedAt: string;
}

export interface UserSummary {
  id: number;
  name: string;
  email: string;
  departments: Department[];
  roles: string[];
  active: boolean;
}

export interface UserRow {
  id: number;
  name: string;
  email: string;
  departments: Department[];
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
