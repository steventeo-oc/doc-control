import type { AuditLogEntry } from './types';

/**
 * Human rendering of audit rows for the activity surfaces (plan-back F6):
 * the API stays raw; this map turns entityType+action (+ the details the
 * write sites recorded) into a sentence and, where one exists, the row's
 * deep link. Unmapped combinations fall back to a readable default.
 */

function detail(entry: AuditLogEntry, key: string): string | null {
  const value = entry.details?.[key];
  return value === undefined || value === null ? null : String(value);
}

function documentNumber(entry: AuditLogEntry): string | null {
  return detail(entry, 'document_number');
}

/** Where the row navigates: the document page for document-anchored
 * activity, the department page for department rows, nothing otherwise. */
export function activityLink(entry: AuditLogEntry): string | null {
  switch (entry.entityType) {
    case 'document':
    case 'document_version':
    case 'workflow_instance':
      return `/documents/${entry.entityId}`;
    case 'document_acknowledgment':
    case 'document_acknowledgment_access':
      return `/documents/${entry.entityId}`;
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
    case 'document_version/created': {
      const version = detail(entry, 'version_number');
      const label = doc ? `${doc} v${version ?? '?'}` : `version ${version ?? ''}`;
      return `Uploaded ${label}`;
    }
    case 'document_version/original_downloaded':
      return at('Downloaded the original of');
    case 'document_version/superseded_before_effective':
      return at('Superseded a pending version of');
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
    case 'workflow_instance/task_delegated':
      return at('Delegated a review task for');
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
      return `Changed the membership level of ${email ?? 'a member'} in department #${entry.entityId}`;
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
      return doc ? `${entry.action} on ${doc}` : `${entry.entityType} ${entry.action}`;
  }
}
