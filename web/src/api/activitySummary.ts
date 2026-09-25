import type { AuditLogEntry } from './types';

/**
 * Human rendering of audit rows for the activity surfaces (plan-back F6):
 * the API stays raw; this map turns entityType+action (+ the details the
 * write sites recorded) into a sentence and, where one exists, the row's
 * deep link. Unmapped combinations fall back to a readable default.
 */

export type CategoryInfo = {
  key: string;
  label: string;
  /** Tailwind color class stem for badge styling. */
  color: string;
};

const CATEGORY_MAP: Record<string, CategoryInfo> = {
  document: { key: 'documents', label: 'Documents', color: 'blue' },
  document_version: { key: 'documents', label: 'Documents', color: 'blue' },
  workflow_instance: { key: 'workflow', label: 'Workflow', color: 'purple' },
  daily_sweep: { key: 'workflow', label: 'Workflow', color: 'purple' },
  document_acknowledgment: { key: 'acknowledgment', label: 'Acknowledgment', color: 'emerald' },
  document_acknowledgment_access: { key: 'acknowledgment', label: 'Acknowledgment', color: 'emerald' },
  department: { key: 'membership', label: 'Membership', color: 'amber' },
  user: { key: 'membership', label: 'Membership', color: 'amber' },
};

const FALLBACK_CATEGORY: CategoryInfo = { key: 'system', label: 'System', color: 'slate' };

/** Returns the human-readable category for an audit entry's entityType. */
export function activityCategory(entry: AuditLogEntry): CategoryInfo {
  return CATEGORY_MAP[entry.entityType] ?? FALLBACK_CATEGORY;
}

function detail(entry: AuditLogEntry, key: string): string | null {
  const value = entry.details?.[key];
  return value === undefined || value === null ? null : String(value);
}

function documentNumber(entry: AuditLogEntry): string | null {
  return detail(entry, 'document_number');
}

/**
 * Resolves the underlying document ID from an audit log entry.
 * For document rows, this is entry.entityId.
 * For document_version, workflow_instance, and document_acknowledgment rows,
 * the actual document ID is in entry.details.document_id.
 */
export function resolveDocumentId(entry: AuditLogEntry): number | null {
  if (entry.entityType === 'document') {
    return entry.entityId;
  }
  const rawDocId = entry.details?.document_id;
  if (rawDocId !== undefined && rawDocId !== null) {
    const parsed = Number(rawDocId);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return null;
}

/** Where the row navigates: the document page for document-anchored
 * activity, the department page for department rows, nothing otherwise.
 * If departmentId is provided, routes to /departments/:deptId/documents/:docId. */
export function activityLink(entry: AuditLogEntry, departmentId?: number | null): string | null {
  const docId = resolveDocumentId(entry);
  if (docId) {
    if (departmentId) {
      return `/departments/${departmentId}/documents/${docId}`;
    }
    return `/documents/${docId}`;
  }

  switch (entry.entityType) {
    case 'department':
      return `/departments/${entry.entityId}`;
    default:
      return null;
  }
}

export function activitySummary(entry: AuditLogEntry): string {
  const doc = documentNumber(entry);
  const at = (text: string) => (doc ? `${text} ${doc}` : text);

  switch (`${entry.entityType}/${entry.action}`) {
    case 'document/created':
      return at('Created document');
    case 'document/updated':
      return at('Updated document');
    case 'document/deleted':
      return at('Moved document to trash:');
    case 'document/restored':
      return at('Restored document');
    case 'document/status_changed':
      return at('Changed status of');
    case 'document/review_clock_reset':
      return at('Reset the review clock on');
    case 'document/review_reset_scheduled':
      return at('Scheduled a review reset for');
    case 'document/favorited':
      return doc ? `Marked ${doc} as favorite` : 'Marked document as favorite';
    case 'document/unfavorited':
      return doc ? `Removed ${doc} from favorites` : 'Removed document from favorites';
    case 'document/reactivated':
      return doc ? `Reactivated ${doc}` : 'Reactivated document';
    case 'document/obsoleted': {
      const reason = detail(entry, 'reason');
      const suffix = reason ? ` (${reason})` : '';
      return doc ? `Marked ${doc} as obsolete${suffix}` : `Marked document as obsolete${suffix}`;
    }
    case 'document/draft_discarded':
      return doc ? `Discarded draft for ${doc}` : 'Discarded document draft';

    case 'document_version/created': {
      const version = detail(entry, 'version_number');
      const label = doc ? `${doc} v${version ?? '?'}` : `version ${version ?? ''}`;
      return `Uploaded ${label}`;
    }
    case 'document_version/original_downloaded':
      return at('Downloaded original of');
    case 'document_version/obsoleted_before_effective':
    case 'document_version/superseded_before_effective':
      return at('Obsoleted a pending version of');
    case 'document_version/draft_discarded': {
      const ver = detail(entry, 'version_number');
      const label = doc ? `${doc}${ver ? ` v${ver}` : ''}` : (ver ? `v${ver}` : 'draft');
      return `Discarded draft version for ${label}`;
    }
    case 'document_version/restored_from_version': {
      const src = detail(entry, 'source_version_number');
      const label = doc ? `${doc}` : 'document';
      return src ? `Restored ${label} from version ${src}` : `Restored ${label} from previous version`;
    }

    case 'workflow_instance/created':
      return entry.details?.kind === 'reapproval'
        ? at('Started the review re-approval of')
        : at('Started the approval of');
    case 'workflow_instance/completed':
      return at('Approval completed for');
    case 'workflow_instance/task_approved':
      return at('Approved a review task for');
    case 'workflow_instance/rejected':
      return at('Rejected the approval of');
    case 'workflow_instance/task_delegated': {
      const to = detail(entry, 'to_name');
      const target = to ? ` to ${to}` : '';
      if (doc) {
        return `Delegated review task for ${doc}${target}`;
      }
      return `Delegated review task${target}`;
    }

    case 'document_acknowledgment/created':
      return at('Acknowledged');
    case 'document_acknowledgment_access/granted':
      return at('Granted acknowledgment-status visibility on');
    case 'document_acknowledgment_access/revoked':
      return at('Revoked acknowledgment-status visibility on');

    case 'department/created':
      return `Created department ${detail(entry, 'code') ?? `#${entry.entityId}`}`;
    case 'department/updated':
      return `Updated department ${detail(entry, 'code') ?? `#${entry.entityId}`}`;
    case 'department/deleted':
      return `Deleted department ${detail(entry, 'code') ?? `#${entry.entityId}`}`;
    case 'department/member_level_changed': {
      const email = detail(entry, 'user_email');
      return `Changed membership level of ${email ?? 'a member'} in department #${entry.entityId}`;
    }
    case 'department/member_added': {
      const name = detail(entry, 'user_name') ?? detail(entry, 'user_email') ?? 'a member';
      const level = detail(entry, 'level');
      return `Added ${name}${level ? ` as ${level}` : ''} to department`;
    }
    case 'department/member_removed': {
      const name = detail(entry, 'user_name') ?? detail(entry, 'user_email') ?? 'a member';
      return `Removed ${name} from department`;
    }

    case 'user/created':
      return `Created user ${detail(entry, 'user_email') ?? detail(entry, 'email') ?? `#${entry.entityId}`}`;
    case 'user/updated':
      return `Updated user #${entry.entityId}`;
    case 'user/password_changed':
      return detail(entry, 'via') === 'email_reset'
        ? `Changed the password of user #${entry.entityId} (via email reset)`
        : `Changed the password of user #${entry.entityId}`;
    case 'daily_sweep/triggered':
      return `Daily sweep ran for ${detail(entry, 'date') ?? '—'} (${detail(entry, 'triggered_by') ?? 'manual'})`;
    default:
      return doc ? `${entry.action.replace(/_/g, ' ')} on ${doc}` : `${entry.entityType} ${entry.action.replace(/_/g, ' ')}`;
  }
}
