// Mirrors the backend DTOs (camelCase over the wire).

export interface Department {
  id: number;
  code: string;
  label: string;
  active: boolean;
  documentCount?: number | null;
  memberCount?: number | null;
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
  isFavorite?: boolean;
  revisionVersionNumber?: number | null;
  revisionStatus?: 'DRAFT' | 'IN_REVIEW' | 'RE_APPROVAL' | null;
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
  isFavorite?: boolean;
}

export interface DocumentNumberPreview {
  typeId: number;
  typeCode: string;
  departmentId: number | null;
  departmentCode: string | null;
  nextSequenceNumber: number | null;
  nextDocumentNumber: string;
  currentLatestSequenceNumber: number | null;
  currentLatestDocumentNumber: string | null;
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

export interface ReviewerCandidate {
  id: number;
  name: string;
  email: string;
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
  documentName?: string;
  documentId: number;
  versionId?: number;
  versionNumber: number;
  changeNotes?: string | null;
  /** Code of the document's department (null only for orphaned tasks). */
  departmentCode: string | null;
  delegatedBy?: string | null;
  delegationMessage?: string | null;
  delegatedAt?: string | null;
}

export interface DelegatedTask {
  taskId: string;
  documentId: number | null;
  documentNumber: string | null;
  documentName?: string | null;
  versionNumber: number | null;
  delegatedToUserId: number | null;
  delegatedToName: string;
  delegatedToEmail: string | null;
  delegationMessage?: string | null;
  delegatedAt: string | null;
  dueDate: string | null;
  status: 'pending' | 'completed';
  canRecall: boolean;
}

export interface TaskCounts {
  approvals: number;
  acknowledgments: number;
  started: number;
  delegated: number;
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

export interface WorkflowReviewerState {
  userId?: number | null;
  name: string | null;
  email?: string | null;
  state: 'approved' | 'pending';
  role: string | null;
  actionAt?: string | null;
  comment?: string | null;
  effectiveDate?: string | null;
  delegated?: boolean;
  delegatedByUserId?: number | null;
  delegatedByName?: string | null;
  delegatedByEmail?: string | null;
  delegatedToName?: string | null;
  delegatedToEmail?: string | null;
  delegationMessage?: string | null;
  delegatedAt?: string | null;
  dueDate?: string | null;
}

/** One approval the caller started ("Started by Me" pane): reviewers is
 * populated only while in progress — approved entries from the engine's
 * finished-task history, pending from active tasks (claimed tasks name
 * their assignee, pooled tasks the candidate role). */
export interface StartedInstance {
  id: number;
  documentId: number;
  documentNumber: string;
  documentName?: string;
  versionNumber: number;
  status: string | null;
  reapproval: boolean;
  startedAt: string;
  completedAt: string | null;
  reviewers: WorkflowReviewerState[];
  feedbackAction?: string | null;
  feedbackActor?: string | null;
  feedbackComment?: string | null;
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

export type MembershipLevel = 'MANAGER' | 'COLLABORATOR' | 'CONTRIBUTOR' | 'CONSUMER';

export interface DepartmentMembership {
  id: number;
  code: string;
  label: string;
  active: boolean;
  level: MembershipLevel;
}

export interface PendingAcknowledgment {
  documentId: number;
  versionId?: number;
  documentNumber: string;
  name: string;
  departmentCode: string;
  versionNumber: number;
  effectiveAt: string | null;
  windowClosesAt: string | null;
  overdue: boolean;
}

/** One activity row (activity plan-back F6) — details carry the free-form
 * context (document_number, version_number, …) each action wrote. */
export interface AuditLogEntry {
  id: number;
  performedAt: string;
  actorName: string;
  actorEmail: string;
  entityType: string;
  action: string;
  entityId: number;
  departmentCode: string | null;
  details: Record<string, unknown> | null;
}

export type ActivityScope = 'mine' | 'departments' | 'company';

export interface AuditLogPage {
  content: AuditLogEntry[];
  page: number;
  pageSize: number;
  totalElements: number;
  totalPages: number;
}

export interface DepartmentMember {
  userId: number;
  name: string;
  email: string;
  userActive: boolean;
  level: MembershipLevel;
}

export interface DepartmentCandidateUser {
  id: number;
  name: string;
  email: string;
}

export interface UserSummary {
  id: number;
  name: string;
  email: string;
  departments: DepartmentMembership[];
  roles: string[];
  active: boolean;
}

export interface UserRow {
  id: number;
  name: string;
  email: string;
  departments: DepartmentMembership[];
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
  'obsolete',
] as const;
