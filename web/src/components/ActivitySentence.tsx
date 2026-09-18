import { Link } from 'react-router-dom';
import { activityLink, activitySummary } from '../api/activitySummary';
import type { AuditLogEntry } from '../api/types';

/** One audit row as a readable sentence, linked to its home where one
 * exists (activity plan-back F6). Shared by the dashboard card, the
 * Activity page, and the Department Activity tab. */
export default function ActivitySentence({
  entry,
  departmentId,
}: {
  entry: AuditLogEntry;
  departmentId?: number | null;
}) {
  const link = activityLink(entry, departmentId);
  const text = activitySummary(entry);
  return link ? (
    <Link to={link} className="text-primary hover:underline">
      {text}
    </Link>
  ) : (
    <>{text}</>
  );
}
